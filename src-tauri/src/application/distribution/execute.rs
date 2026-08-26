//! Distribution 执行用例 —— 分发域的副作用半区。
//!
//! Task 5（distribution 域重构）自 `engine/dist_execute` 迁入，行为保持逐字节等价：
//! - [`sync_scene`] — legacy 单向增量同步入口
//! - [`execute_distribution_request`] — install/update/remove、文件写入、结果收集、执行前校验
//! - [`execute_remove_distributed`] — 独立移除受管内容（33 号 3.3 / DEC-1）
//! - [`validate_existing_single_file_targets`] — SingleFile 目标执行前校验
//!
//! 技能 / 项目路径 / 磁盘现状读取已改走 ports trait 对象
//! （[`DistributionRepository`] / [`DistributionFileSystem`]），由兼容层
//! （engine facade）组装具体适配器注入；规则同步写路径与插件 install/sync/remove
//! 调用仍留在 engine 层。原 `engine/dist_execute` 保留为兼容 facade，
//! 入口点与调用方完全不变。

use super::preview::build_distribution_plan_for_request;
use crate::application::distribution::remove::validate_removal_targets;
use crate::engine::dist_plan::{
    resolve_distribution_instance, resolve_global_distribution_instance,
};
use crate::engine::rule_distribution;
use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::ports::distribution::DistributionRepository;
use crate::ports::filesystem::DistributionFileSystem;
use crate::types::{
    DistributionIntent, DistributionIntentMode, DistributionPlan, DistributionRequest,
    PlatformInstance, RulesFormat, SyncResult,
};

/// Sync skills and rules to one or more platforms.
///
/// This is the core distribution operation:
/// 1. Use directly provided skill/rule IDs (never resolve/filter by scene —
///    `_scene_id` is kept for API compatibility and is ignored)
/// 2. Auto-resolve platforms to all enabled platforms if not specified
/// 3. For each platform, compute diff and execute install/update/remove
///
/// Legacy semantics: additive/preserving — omitted IDs never imply removal.
#[allow(clippy::too_many_arguments)]
pub fn sync_scene(
    conn: &rusqlite::Connection,
    repo: &dyn DistributionRepository,
    fs: &dyn DistributionFileSystem,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    skill_ids: &[String],
    rule_ids: &[String],
    _scene_id: Option<&str>,
    platform_ids: Option<&[String]>,
    scope: &str,
    project_id: Option<&str>,
) -> Result<SyncResult, AppError> {
    // If no platforms specified, auto-resolve to all enabled platforms
    let resolved_platform_ids: Vec<String>;
    let platform_ids = match platform_ids {
        Some(ids) if !ids.is_empty() => ids,
        _ => {
            resolved_platform_ids = crate::engine::scene_engine::get_scene_platforms(conn, "")?;
            if resolved_platform_ids.is_empty() {
                return Err(AppError::Platform("没有已启用的平台".to_string()));
            }
            &resolved_platform_ids
        }
    };
    let mut result = SyncResult {
        installed: Vec::new(),
        updated: Vec::new(),
        removed: Vec::new(),
        skipped: 0,
        errors: Vec::new(),
    };
    // Legacy sync is additive/preserving: omitted IDs never imply removal.
    let skill_ids: Vec<String> = skill_ids.to_vec();
    let rule_ids: Vec<String> = rule_ids.to_vec();
    // Get project path if project-scoped
    let project_path: Option<String> = if scope == "project" {
        Some(
            project_id
                .and_then(|pid| repo.get_project_path(pid))
                .ok_or_else(|| {
                    AppError::ProjectNotFound("项目范围同步需要提供项目ID".to_string())
                })?,
        )
    } else {
        None
    };
    // For each target platform
    for platform_id in platform_ids {
        let plugin = platform_plugins
            .iter()
            .find(|p| p.platform_name() == platform_id)
            .ok_or_else(|| AppError::Platform(format!("未找到平台插件: {}", platform_id)))?;
        // Detect platform instances
        let instances = match plugin.detect() {
            Ok(instances) => instances,
            Err(e) => {
                result
                    .errors
                    .push(format!("检测平台 '{}' 失败: {}", platform_id, e));
                continue;
            }
        };
        // Find matching instance for the requested scope
        let instance = if scope == "global" {
            instances
                .into_iter()
                .find(|i| i.scope == "global")
                .unwrap_or_else(|| resolve_global_distribution_instance(plugin.as_ref()))
        } else {
            // Project scope: construct instance path
            let base_path = project_path
                .as_ref()
                .map(|p| {
                    let pattern = plugin.default_paths().project_skills_pattern.clone();
                    pattern.replace("{project}", p)
                })
                .unwrap_or_default();
            PlatformInstance {
                platform_id: platform_id.to_string(),
                platform_name: platform_id.to_string(),
                path: base_path,
                scope: "project".to_string(),
            }
        };
        // Ensure instance directory exists
        if let Some(parent) = std::path::Path::new(&instance.path).parent() {
            crate::engine::fs_watcher::mute_self_writes(parent);
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!("无法创建平台目录 '{}': {}", parent.display(), e))
            })?;
        }
        // Compute diff: what's currently on disk vs what should be
        let current_skill_ids = fs.read_current_skills_on_disk(&instance);
        // Skills to install (in scene but not in current distribution)
        let to_install: Vec<&String> = skill_ids
            .iter()
            .filter(|id| !current_skill_ids.contains(id))
            .collect();
        // Skills already present on disk require no work (skipped).
        result.skipped += (skill_ids.len() - to_install.len()) as u32;
        let to_remove: Vec<&String> = Vec::new();
        // Execute installs
        for skill_id in &to_install {
            match repo.get_skill(skill_id) {
                Ok(skill) => match plugin.install(&skill, &instance) {
                    Ok(_) => {
                        result.installed.push(skill_id.to_string());
                    }
                    Err(e) => {
                        result.errors.push(format!(
                            "安装技能 '{}' 到 {} 失败: {}",
                            skill_id, platform_id, e
                        ));
                    }
                },
                Err(e) => {
                    result
                        .errors
                        .push(format!("技能 '{}' 未在数据库中找到: {}", skill_id, e));
                }
            }
        }
        // Execute removes
        for skill_id in &to_remove {
            match plugin.remove(skill_id, &instance) {
                Ok(_) => {
                    result.removed.push(skill_id.to_string());
                }
                Err(e) => {
                    result.errors.push(format!(
                        "从 {} 移除技能 '{}' 失败: {}",
                        platform_id, skill_id, e
                    ));
                }
            }
        }
        // Sync rules for platforms that support rules
        let rules_supported = if instance.scope == "global" {
            plugin.default_paths().global_rules_dir.is_some()
        } else {
            plugin.default_paths().project_rules_pattern.is_some()
        };
        if rules_supported {
            let rules_format = if instance.scope == "global" {
                plugin.default_paths().global_rules_format.clone()
            } else {
                plugin.default_paths().project_rules_format.clone()
            }
            .unwrap_or(RulesFormat::Directory);
            rule_distribution::sync_rules_to_platform(
                conn,
                &**plugin,
                &instance,
                &rule_ids,
                &rules_format,
                project_path.as_deref(),
                false,
                &mut result,
            )?;
        }
    }
    Ok(result)
}

pub fn execute_distribution_request(
    conn: &rusqlite::Connection,
    repo: &dyn DistributionRepository,
    fs: &dyn DistributionFileSystem,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    request: &DistributionRequest,
    submitted_plan: &DistributionPlan,
) -> Result<SyncResult, AppError> {
    request.validate()?;
    let recomputed_plan = build_distribution_plan_for_request(repo, fs, platform_plugins, request)?;
    if submitted_plan != &recomputed_plan {
        return Err(AppError::DistributionInvalid(
            "分发计划已过期或与当前状态不匹配，请重新预览".to_string(),
        ));
    }
    validate_existing_single_file_targets(conn, repo, platform_plugins, request, &recomputed_plan)?;
    validate_removal_targets(conn, repo, platform_plugins, request, &recomputed_plan)?;

    let project_path = request
        .project_id
        .as_deref()
        .and_then(|id| repo.get_project_path(id));
    let mut result = SyncResult {
        installed: vec![],
        updated: vec![],
        removed: vec![],
        skipped: 0,
        errors: vec![],
    };
    for platform in &recomputed_plan.platforms {
        let plugin = platform_plugins
            .iter()
            .find(|plugin| plugin.platform_name() == platform.platform_id)
            .ok_or_else(|| {
                AppError::Platform(format!("未找到平台插件: {}", platform.platform_id))
            })?;
        let instance = resolve_distribution_instance(
            plugin.as_ref(),
            request.scope.as_str(),
            project_path.as_deref(),
        );
        if matches!(request.skills.mode, DistributionIntentMode::AddOrUpdate) {
            for id in &request.skills.ids {
                let skill = repo.get_skill(id)?;
                let sync_result = plugin.sync(&skill, &instance)?;
                if sync_result.installed.is_empty() && sync_result.updated.is_empty() {
                    result.skipped += 1;
                }
                result.installed.extend(sync_result.installed);
                result.updated.extend(sync_result.updated);
            }
        }
        if matches!(request.skills.mode, DistributionIntentMode::RemoveSelected) {
            for id in &platform.skills_to_remove {
                plugin.remove(id, &instance)?;
                result.removed.push(id.clone());
            }
        }
        let rules_format = if request.scope == "global" {
            plugin.default_paths().global_rules_format.clone()
        } else {
            plugin.default_paths().project_rules_format.clone()
        }
        .unwrap_or(RulesFormat::Directory);
        match request.rules.mode {
            DistributionIntentMode::Preserve => {}
            DistributionIntentMode::AddOrUpdate => {
                rule_distribution::sync_rules_to_platform(
                    conn,
                    plugin.as_ref(),
                    &instance,
                    &request.rules.ids,
                    &rules_format,
                    project_path.as_deref(),
                    false,
                    &mut result,
                )?;
            }
            DistributionIntentMode::RemoveSelected => {
                rule_distribution::remove_selected_rules(
                    conn,
                    plugin.as_ref(),
                    &instance,
                    &platform.rules_to_remove,
                    &rules_format,
                    project_path.as_deref(),
                    &mut result,
                )?;
            }
        }
    }
    Ok(result)
}

/// 33 号 3.3 / DEC-1：独立移除受管内容。
/// 语义约束：仅允许 RemoveSelected；fail-closed（任一请求 id 不在重算移除列表 → 整体拒绝）；
/// 所有权校验复用 validate_removal_targets；执行阶段部分失败收集到 result.errors。
#[allow(clippy::too_many_arguments)]
pub fn execute_remove_distributed(
    conn: &rusqlite::Connection,
    repo: &dyn DistributionRepository,
    fs: &dyn DistributionFileSystem,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    platform_ids: &[String],
    scope: &str,
    project_id: Option<&str>,
    skill_ids: &[String],
    rule_ids: &[String],
) -> Result<SyncResult, AppError> {
    if skill_ids.is_empty() && rule_ids.is_empty() {
        return Err(AppError::DistributionInvalid(
            "没有待移除的受管内容".to_string(),
        ));
    }
    let request = DistributionRequest {
        scene_id: None,
        platform_ids: platform_ids.to_vec(),
        scope: scope.to_string(),
        project_id: project_id.map(str::to_string),
        // 空维度用 Preserve：RemoveSelected(空) 与 Preserve 的计划完全一致，
        // 但可避免 validate_removal_targets 在无规则平台对空 rules 报"不支持移除"。
        skills: DistributionIntent {
            mode: if skill_ids.is_empty() {
                DistributionIntentMode::Preserve
            } else {
                DistributionIntentMode::RemoveSelected
            },
            ids: skill_ids.to_vec(),
        },
        rules: DistributionIntent {
            mode: if rule_ids.is_empty() {
                DistributionIntentMode::Preserve
            } else {
                DistributionIntentMode::RemoveSelected
            },
            ids: rule_ids.to_vec(),
        },
    };
    request.validate()?;
    let plan = build_distribution_plan_for_request(repo, fs, platform_plugins, &request)?;

    // fail-closed 预检（类型安全，走查 F1）：每个请求 skill id 只对 skills_to_remove、
    // 每个请求 rule id 只对 rules_to_remove 校验；技能/规则各自命名空间，杜绝跨类型
    // 同 ID 掩盖。覆盖按「至少一个目标平台」计：managed-state 选择是扁平 id 列表，
    // 某项可能只在请求平台的一个子集上受管，严格「每平台都在」会误拒合法选择。
    let skills_covered: std::collections::HashSet<&str> = plan
        .platforms
        .iter()
        .flat_map(|platform| platform.skills_to_remove.iter().map(|id| id.as_str()))
        .collect();
    let rules_covered: std::collections::HashSet<&str> = plan
        .platforms
        .iter()
        .flat_map(|platform| platform.rules_to_remove.iter().map(|id| id.as_str()))
        .collect();
    for id in skill_ids {
        if !skills_covered.contains(id.as_str()) {
            return Err(AppError::DistributionInvalid(format!(
                "移除目标 '{}' 已变化或不再受管，请重新扫描",
                id
            )));
        }
    }
    for id in rule_ids {
        if !rules_covered.contains(id.as_str()) {
            return Err(AppError::DistributionInvalid(format!(
                "移除目标 '{}' 已变化或不再受管，请重新扫描",
                id
            )));
        }
    }

    validate_existing_single_file_targets(conn, repo, platform_plugins, &request, &plan)?;
    validate_removal_targets(conn, repo, platform_plugins, &request, &plan)?;

    let project_path = project_id.and_then(|id| repo.get_project_path(id));
    let mut result = SyncResult {
        installed: vec![],
        updated: vec![],
        removed: vec![],
        skipped: 0,
        errors: vec![],
    };
    for platform in &plan.platforms {
        let plugin = platform_plugins
            .iter()
            .find(|plugin| plugin.platform_name() == platform.platform_id)
            .ok_or_else(|| {
                AppError::Platform(format!("未找到平台插件: {}", platform.platform_id))
            })?;
        let instance = resolve_distribution_instance(
            plugin.as_ref(),
            request.scope.as_str(),
            project_path.as_deref(),
        );
        for id in &platform.skills_to_remove {
            match plugin.remove(id, &instance) {
                Ok(_) => result.removed.push(id.clone()),
                Err(e) => result.errors.push(format!(
                    "从 {} 移除技能 '{}' 失败: {}",
                    platform.platform_id, id, e
                )),
            }
        }
        let rules_format = if request.scope == "global" {
            plugin.default_paths().global_rules_format.clone()
        } else {
            plugin.default_paths().project_rules_format.clone()
        }
        .unwrap_or(RulesFormat::Directory);
        if !platform.rules_to_remove.is_empty() {
            let mut per_platform = SyncResult {
                installed: vec![],
                updated: vec![],
                removed: vec![],
                skipped: 0,
                errors: vec![],
            };
            if let Err(e) = rule_distribution::remove_selected_rules(
                conn,
                plugin.as_ref(),
                &instance,
                &platform.rules_to_remove,
                &rules_format,
                project_path.as_deref(),
                &mut per_platform,
            ) {
                result
                    .errors
                    .push(format!("{}: {}", platform.platform_id, e));
            }
            // 走查 F3：无论整体是否失败，实际成功的规则移除必须保留在 removed 中
            result.removed.extend(per_platform.removed);
        }
    }
    Ok(result)
}

fn validate_existing_single_file_targets(
    conn: &rusqlite::Connection,
    repo: &dyn DistributionRepository,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    request: &DistributionRequest,
    plan: &DistributionPlan,
) -> Result<(), AppError> {
    let project_path = request
        .project_id
        .as_deref()
        .and_then(|id| repo.get_project_path(id));
    for platform in &plan.platforms {
        let plugin = platform_plugins
            .iter()
            .find(|plugin| plugin.platform_name() == platform.platform_id)
            .ok_or_else(|| {
                AppError::Platform(format!("未找到平台插件: {}", platform.platform_id))
            })?;
        let instance = resolve_distribution_instance(
            plugin.as_ref(),
            request.scope.as_str(),
            project_path.as_deref(),
        );
        let rules_format = if request.scope == "global" {
            plugin.default_paths().global_rules_format.clone()
        } else {
            plugin.default_paths().project_rules_format.clone()
        }
        .unwrap_or(RulesFormat::Directory);
        if !matches!(rules_format, RulesFormat::SingleFile { .. }) {
            continue;
        }
        let Some(path) = rule_distribution::resolve_rules_path(
            plugin.as_ref(),
            &instance,
            project_path.as_deref(),
        )?
        else {
            continue;
        };
        if !path.exists() {
            continue;
        }
        let content = std::fs::read_to_string(&path).map_err(|error| {
            AppError::DistributionInvalid(format!(
                "无法读取规则文件 '{}': {}",
                path.display(),
                error
            ))
        })?;
        rule_distribution::validate_single_file_rule_blocks(
            conn,
            &rule_distribution::parse_managed_rule_blocks(&content)?,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use rusqlite::params;

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        schema::create_tables(&conn).unwrap();
        conn
    }

    /// 组装真实直通适配器（与 engine facade 的组装方式一致）。
    fn real_ports<'a>(
        conn: &'a rusqlite::Connection,
    ) -> (
        crate::adapters::db::SqliteDistributionRepository<'a>,
        crate::adapters::filesystem::EngineDistributionFileSystem,
    ) {
        (
            crate::adapters::db::SqliteDistributionRepository::new(conn),
            crate::adapters::filesystem::EngineDistributionFileSystem,
        )
    }

    #[test]
    fn test_sync_to_missing_directory() {
        // Test that syncing to a non-existent directory auto-creates it
        let test_dir = format!("/tmp/skillforge-test-sync-{}", std::process::id());
        let _ = std::fs::remove_dir_all(&test_dir); // cleanup from previous runs
                                                    // Verify the directory doesn't exist yet
        assert!(!std::path::Path::new(&test_dir).exists());
        // Simulate the directory creation logic from sync_scene
        let path = std::path::Path::new(&test_dir);
        if let Some(parent) = path.parent() {
            let result = std::fs::create_dir_all(parent);
            assert!(result.is_ok(), "Should be able to create parent directory");
        }
        // Verify directory was created
        assert!(path.parent().unwrap().exists());
        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }

    #[test]
    fn test_sync_scene_no_platforms() {
        let conn = setup_db();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];
        // sync_scene with empty skill/rule lists and no scene_id should succeed
        // (no skills to install, nothing to fail on)
        // With no platforms explicitly specified, it auto-resolves to 10 enabled platforms
        // but since plugins list is empty, each platform will fail with "platform not found"
        let result = {
            let (repo, fs) = real_ports(&conn);
            sync_scene(
                &conn,
                &repo,
                &fs,
                &plugins,
                &[],
                &[],
                None,
                None,
                "global",
                None,
            )
        };
        assert!(result.is_err());
    }

    #[test]
    fn test_sync_project_scope_without_project() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();
        // Create a scene with a platform association
        conn.execute(
            "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
            params!["test-scene", "Test Scene", "A test", now, now],
        )
        .unwrap();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];
        // Sync with project scope but no project_id should fail
        let result = {
            let (repo, fs) = real_ports(&conn);
            sync_scene(
                &conn,
                &repo,
                &fs,
                &plugins,
                &[],
                &[],
                None,
                None,
                "project",
                None,
            )
        };
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::ProjectNotFound(msg) => assert!(msg.contains("项目ID")),
            other => panic!("Expected ProjectNotFound error, got: {:?}", other),
        }
    }

    struct TestPlugin {
        skills_global_dir: std::path::PathBuf,
    }

    impl TestPlugin {
        fn plugin(skills_global_dir: &std::path::Path) -> Box<dyn PlatformPlugin> {
            Box::new(TestPlugin {
                skills_global_dir: skills_global_dir.to_path_buf(),
            })
        }
    }

    impl PlatformPlugin for TestPlugin {
        fn platform_name(&self) -> &'static str {
            "test"
        }

        fn display_name(&self) -> &'static str {
            "Test"
        }

        fn detect(&self) -> Result<Vec<PlatformInstance>, AppError> {
            Ok(vec![])
        }

        fn install(
            &self,
            _skill: &crate::types::Skill,
            _instance: &PlatformInstance,
        ) -> Result<(), AppError> {
            Ok(())
        }

        fn sync(
            &self,
            _skill: &crate::types::Skill,
            _instance: &PlatformInstance,
        ) -> Result<SyncResult, AppError> {
            Ok(SyncResult {
                installed: vec![],
                updated: vec![],
                removed: vec![],
                skipped: 0,
                errors: vec![],
            })
        }

        fn remove(&self, skill_id: &str, instance: &PlatformInstance) -> Result<(), AppError> {
            std::fs::remove_file(std::path::Path::new(&instance.path).join(skill_id))
                .map_err(|e| AppError::Io(e.to_string()))
        }

        fn status(
            &self,
            _skill_id: &str,
            _instance: &PlatformInstance,
        ) -> Result<crate::types::SkillPlatformStatus, AppError> {
            Ok(crate::types::SkillPlatformStatus {
                installed: false,
                path: None,
                version: None,
                checksum: None,
            })
        }

        fn default_paths(&self) -> crate::types::PlatformPaths {
            crate::types::PlatformPaths {
                global_skills_dir: self.skills_global_dir.to_string_lossy().to_string(),
                project_skills_pattern: "{project}/skills".to_string(),
                global_rules_dir: None,
                project_rules_pattern: None,
                global_rules_format: None,
                project_rules_format: None,
            }
        }

        fn capabilities(&self) -> crate::types::PlatformCapabilities {
            crate::types::PlatformCapabilities {
                skills_global: true,
                skills_project: true,
                rules_global: false,
                rules_project: false,
                rules_format_global: None,
                rules_format_project: None,
                limitation_notes: vec![],
            }
        }
    }

    fn insert_skill(conn: &rusqlite::Connection, id: &str, local_path: &str) {
        conn.execute(
            "INSERT INTO resources (id, kind, name, description, source_type, source_url, current_ver, installed_at, updated_at, local_path, metadata)
             VALUES (?1, 'skill', ?1, NULL, 'local', NULL, '1.0.0', ?2, ?2, ?3, NULL)",
            params![id, chrono::Utc::now().to_rfc3339(), local_path],
        )
        .unwrap();
    }

    fn preserve_rules() -> crate::types::DistributionIntent {
        crate::types::DistributionIntent {
            mode: DistributionIntentMode::Preserve,
            ids: vec![],
        }
    }

    #[test]
    fn execute_distribution_request_rejects_stale_submitted_plan() {
        let conn = setup_db();
        let base = tempfile::tempdir().unwrap();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![TestPlugin::plugin(base.path())];
        insert_skill(&conn, "skill-1", "/tmp/sources/skill-1");
        let request = DistributionRequest {
            scene_id: None,
            platform_ids: vec!["test".to_string()],
            scope: "global".to_string(),
            project_id: None,
            skills: crate::types::DistributionIntent {
                mode: DistributionIntentMode::AddOrUpdate,
                ids: vec!["skill-1".to_string()],
            },
            rules: preserve_rules(),
        };

        let mut submitted = crate::engine::dist_plan::build_distribution_plan_for_request(
            &conn, &plugins, &request,
        )
        .unwrap();
        assert!(!submitted.has_removals);
        submitted.has_removals = true;

        let (repo, fs) = real_ports(&conn);
        let err = execute_distribution_request(&conn, &repo, &fs, &plugins, &request, &submitted)
            .unwrap_err();
        assert!(err.to_string().contains("分发计划已过期"), "got: {err}");
    }

    #[test]
    fn execute_distribution_request_with_matching_plan_reports_skips() {
        let conn = setup_db();
        let base = tempfile::tempdir().unwrap();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![TestPlugin::plugin(base.path())];
        insert_skill(&conn, "skill-1", "/tmp/sources/skill-1");
        let request = DistributionRequest {
            scene_id: None,
            platform_ids: vec!["test".to_string()],
            scope: "global".to_string(),
            project_id: None,
            skills: crate::types::DistributionIntent {
                mode: DistributionIntentMode::AddOrUpdate,
                ids: vec!["skill-1".to_string()],
            },
            rules: preserve_rules(),
        };

        let submitted = crate::engine::dist_plan::build_distribution_plan_for_request(
            &conn, &plugins, &request,
        )
        .unwrap();
        let (repo, fs) = real_ports(&conn);
        let result =
            execute_distribution_request(&conn, &repo, &fs, &plugins, &request, &submitted)
                .unwrap();

        assert_eq!(result.skipped, 1);
        assert!(result.installed.is_empty());
        assert!(result.updated.is_empty());
        assert!(result.removed.is_empty());
        assert!(result.errors.is_empty());
    }

    #[test]
    fn execute_remove_distributed_requires_targets() {
        let conn = setup_db();
        let base = tempfile::tempdir().unwrap();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![TestPlugin::plugin(base.path())];

        let (repo, fs) = real_ports(&conn);
        let err = execute_remove_distributed(
            &conn,
            &repo,
            &fs,
            &plugins,
            &["test".to_string()],
            "global",
            None,
            &[],
            &[],
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("没有待移除的受管内容"),
            "got: {err}"
        );
    }

    #[test]
    fn execute_remove_distributed_project_scope_requires_existing_project() {
        let conn = setup_db();
        let base = tempfile::tempdir().unwrap();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![TestPlugin::plugin(base.path())];

        let (repo, fs) = real_ports(&conn);
        let err = execute_remove_distributed(
            &conn,
            &repo,
            &fs,
            &plugins,
            &["test".to_string()],
            "project",
            Some("ghost-project"),
            &["skill-1".to_string()],
            &[],
        )
        .unwrap_err();
        match err {
            AppError::ProjectNotFound(msg) => assert!(msg.contains("项目ID"), "got: {msg}"),
            other => panic!("expected ProjectNotFound, got: {other:?}"),
        }
    }

    #[test]
    fn execute_remove_distributed_fails_closed_when_target_not_managed() {
        let conn = setup_db();
        let base = tempfile::tempdir().unwrap();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![TestPlugin::plugin(base.path())];
        insert_skill(&conn, "ghost-skill", "/tmp/sources/ghost-skill");

        let (repo, fs) = real_ports(&conn);
        let err = execute_remove_distributed(
            &conn,
            &repo,
            &fs,
            &plugins,
            &["test".to_string()],
            "global",
            None,
            &["ghost-skill".to_string()],
            &[],
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("已变化或不再受管"),
            "fail-closed rejection expected, got: {err}"
        );
    }

    #[test]
    #[cfg(unix)]
    fn execute_remove_distributed_removes_owned_symlink_only() {
        use std::os::unix::fs::symlink;

        let conn = setup_db();
        let base = tempfile::tempdir().unwrap();
        let skills_dir = base.path().join("skills");
        let source = base.path().join("sources").join("skill-1");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&skills_dir).unwrap();
        symlink(&source, skills_dir.join("skill-1")).unwrap();
        let foreign_marker = skills_dir.join("user-dir");
        std::fs::create_dir_all(&foreign_marker).unwrap();
        let source_path = source.to_string_lossy().to_string();
        insert_skill(&conn, "skill-1", &source_path);
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![TestPlugin::plugin(&skills_dir)];

        let (repo, fs) = real_ports(&conn);
        let result = execute_remove_distributed(
            &conn,
            &repo,
            &fs,
            &plugins,
            &["test".to_string()],
            "global",
            None,
            &["skill-1".to_string()],
            &[],
        )
        .unwrap();

        assert_eq!(result.removed, vec!["skill-1".to_string()]);
        assert!(result.errors.is_empty());
        assert!(
            !skills_dir.join("skill-1").exists(),
            "owned symlink must be removed"
        );
        assert!(source.exists(), "source content must be preserved");
        assert!(
            foreign_marker.exists(),
            "unmanaged entries must not be touched"
        );
    }

    /// 结果收集测试插件：`sync_installed` 控制 sync 上报（区别于 TestPlugin 的恒空结果），
    /// 并提供 Directory 规则目录以驱动真实的规则文件写入路径。
    struct ExecTestPlugin {
        paths: crate::types::PlatformPaths,
        detect_instances: Vec<PlatformInstance>,
        sync_installed: bool,
    }

    impl ExecTestPlugin {
        fn global(
            skills_dir: &std::path::Path,
            rules_dir: &std::path::Path,
            sync_installed: bool,
        ) -> Self {
            Self {
                paths: crate::types::PlatformPaths {
                    global_skills_dir: skills_dir.to_string_lossy().to_string(),
                    project_skills_pattern: String::new(),
                    global_rules_dir: Some(rules_dir.to_string_lossy().to_string()),
                    project_rules_pattern: None,
                    global_rules_format: Some(RulesFormat::Directory),
                    project_rules_format: None,
                },
                detect_instances: vec![PlatformInstance {
                    platform_id: "test".to_string(),
                    platform_name: "Test".to_string(),
                    path: skills_dir.to_string_lossy().to_string(),
                    scope: "global".to_string(),
                }],
                sync_installed,
            }
        }
    }

    impl PlatformPlugin for ExecTestPlugin {
        fn platform_name(&self) -> &'static str {
            "test"
        }

        fn display_name(&self) -> &'static str {
            "Test"
        }

        fn detect(&self) -> Result<Vec<PlatformInstance>, AppError> {
            Ok(self.detect_instances.clone())
        }

        fn install(
            &self,
            _skill: &crate::types::Skill,
            _i: &PlatformInstance,
        ) -> Result<(), AppError> {
            Ok(())
        }

        fn sync(
            &self,
            skill: &crate::types::Skill,
            _instance: &PlatformInstance,
        ) -> Result<SyncResult, AppError> {
            Ok(SyncResult {
                installed: if self.sync_installed {
                    vec![skill.id.clone()]
                } else {
                    vec![]
                },
                updated: vec![],
                removed: vec![],
                skipped: 0,
                errors: vec![],
            })
        }

        fn remove(&self, _skill_id: &str, _instance: &PlatformInstance) -> Result<(), AppError> {
            Ok(())
        }

        fn status(
            &self,
            _skill_id: &str,
            _instance: &PlatformInstance,
        ) -> Result<crate::types::SkillPlatformStatus, AppError> {
            Ok(crate::types::SkillPlatformStatus {
                installed: false,
                path: None,
                version: None,
                checksum: None,
            })
        }

        fn default_paths(&self) -> crate::types::PlatformPaths {
            self.paths.clone()
        }

        fn capabilities(&self) -> crate::types::PlatformCapabilities {
            crate::types::PlatformCapabilities {
                skills_global: true,
                skills_project: true,
                rules_global: true,
                rules_project: true,
                rules_format_global: self.paths.global_rules_format.clone(),
                rules_format_project: self.paths.project_rules_format.clone(),
                limitation_notes: vec![],
            }
        }
    }

    #[test]
    fn execute_collects_successful_results_and_skip_accounting() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_dir = tmp.path().join("skills");
        let rules_dir = tmp.path().join("rules");
        std::fs::create_dir_all(&skills_dir).unwrap();
        std::fs::create_dir_all(&rules_dir).unwrap();

        let conn = setup_db();
        insert_skill(&conn, "skill-1", "/tmp/sources/skill-1");
        conn.execute(
            "INSERT INTO resources (id, kind, name, description, source_type, installed_at, updated_at, format, content, version) VALUES ('rule-1', 'rule', 'Rule 1', NULL, 'manual', ?1, ?1, 'md', '# Rule 1\n', 1)",
            params![chrono::Utc::now().to_rfc3339()],
        )
        .unwrap();

        let request = DistributionRequest {
            scene_id: None,
            platform_ids: vec!["test".to_string()],
            scope: "global".to_string(),
            project_id: None,
            skills: DistributionIntent {
                mode: DistributionIntentMode::AddOrUpdate,
                ids: vec!["skill-1".to_string()],
            },
            rules: DistributionIntent {
                mode: DistributionIntentMode::AddOrUpdate,
                ids: vec!["rule-1".to_string()],
            },
        };

        // 第一轮：插件上报 installed → 计入 installed、不计 skipped；
        // 规则走真实 Directory 写盘路径 → 计入 "rule:<id>"。
        let plugins_hit: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(ExecTestPlugin::global(
            &skills_dir,
            &rules_dir,
            true,
        ))];
        let (repo_hit, fs_hit) = real_ports(&conn);
        let submitted =
            build_distribution_plan_for_request(&repo_hit, &fs_hit, &plugins_hit, &request)
                .unwrap();
        let result = execute_distribution_request(
            &conn,
            &repo_hit,
            &fs_hit,
            &plugins_hit,
            &request,
            &submitted,
        )
        .unwrap();

        assert!(result.installed.contains(&"skill-1".to_string()));
        assert_eq!(result.skipped, 0);
        assert!(result.installed.contains(&"rule:rule-1".to_string()));
        assert!(result.updated.is_empty());
        assert!(result.removed.is_empty());
        assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
        assert_eq!(
            std::fs::read_to_string(rules_dir.join("rule-1.md")).unwrap(),
            "# Rule 1\n"
        );

        // 第二轮（对照）：插件上报无变化 → 必须计入 skipped（skip accounting）。
        // 注意：第一轮已把 rule-1.md 写入磁盘，需按当前磁盘状态重算计划再提交，
        // 否则会触发"计划已过期"校验而非进入执行阶段。
        let plugins_noop: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(ExecTestPlugin::global(
            &skills_dir,
            &rules_dir,
            false,
        ))];
        let (repo_noop, fs_noop) = real_ports(&conn);
        let submitted2 =
            build_distribution_plan_for_request(&repo_noop, &fs_noop, &plugins_noop, &request)
                .unwrap();
        let result2 = execute_distribution_request(
            &conn,
            &repo_noop,
            &fs_noop,
            &plugins_noop,
            &request,
            &submitted2,
        )
        .unwrap();

        // 既有语义：skipped 同时覆盖技能（execute 循环判定）与规则
        // （rule_distribution 内部对已同步文件计数）→ 1 技能 + 1 规则 = 2。
        assert_eq!(
            result2.skipped, 2,
            "unchanged skill and unchanged rule must both count as skipped"
        );
        assert!(!result2.installed.contains(&"skill-1".to_string()));
    }
}
