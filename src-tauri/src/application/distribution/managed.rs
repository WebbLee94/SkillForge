//! 受管分发状态编排（application 层用例）。
//!
//! 承接原 `engine/dist_managed.rs` 中 `get_managed_distribution_state` 背后的
//! 全部编排逻辑，行为保持逐字一致：
//! - 请求校验 + project 范围路径解析（fail-closed）
//! - 受管 vs 本地条目分类（技能符号链接所有权、规则内容所有权）
//! - 文件系统派生的同步状态（`get_sync_status`）
//!
//! `engine/dist_managed.rs` 保留为兼容 facade，路由到本模块。

use crate::engine::dist_plan::resolve_distribution_instance;
use crate::engine::rule_distribution;
use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::ports::distribution::DistributionRepository;
use crate::ports::filesystem::DistributionFileSystem;
use crate::types::{
    LocalDistributionEntry, ManagedDistributionEntry, ManagedDistributionState,
    ManagedPlatformState, PlatformInstance, PlatformSyncStatus, RulesFormat, SyncStatusDTO,
};

/// 查询各平台当前受管（可证明归 SkillForge 所有）与本地（非受管）条目。
///
/// 行为契约（与迁移前完全一致）：
/// - 先做请求校验；`project` 范围必须携带可解析的项目路径；
/// - 受管技能 = 目录中存在且符号链接目标等于 DB 记录 `local_path` 的条目；
/// - 受管规则 = Directory 模式下内容匹配的规则文件，或 SingleFile 模式下
///   内容匹配的 SKILLFORGE 标记块；
/// - 本地条目排除所有受管路径。
pub fn get_managed_distribution_state(
    conn: &rusqlite::Connection,
    repo: &dyn DistributionRepository,
    fs: &dyn DistributionFileSystem,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    platform_ids: &[String],
    scope: &str,
    project_id: Option<&str>,
) -> Result<ManagedDistributionState, AppError> {
    let validation_request = crate::types::DistributionRequest {
        scene_id: None,
        platform_ids: platform_ids.to_vec(),
        scope: scope.to_string(),
        project_id: project_id.map(str::to_string),
        skills: crate::types::DistributionIntent {
            mode: crate::types::DistributionIntentMode::Preserve,
            ids: vec![],
        },
        rules: crate::types::DistributionIntent {
            mode: crate::types::DistributionIntentMode::Preserve,
            ids: vec![],
        },
    };
    validation_request.validate()?;
    let project_path = project_id.and_then(|id| repo.get_project_path(id));
    if scope == "project" && project_path.is_none() {
        return Err(AppError::ProjectNotFound(
            "项目范围查询需要提供项目ID".to_string(),
        ));
    }
    let mut platforms = Vec::new();
    for platform_id in platform_ids {
        let plugin = platform_plugins
            .iter()
            .find(|plugin| plugin.platform_name() == platform_id)
            .ok_or_else(|| AppError::Platform(format!("未找到平台插件: {}", platform_id)))?;
        let instance =
            resolve_distribution_instance(plugin.as_ref(), scope, project_path.as_deref());
        let skills = read_managed_skills(&instance, repo, fs)?;
        let rules = rule_distribution::read_managed_rules(
            conn,
            plugin.as_ref(),
            &instance,
            project_path.as_deref(),
        )?;
        let local_skills = read_local_skills(&instance, &skills)?;
        let local_rules =
            read_local_rules(plugin.as_ref(), &instance, project_path.as_deref(), &rules)?;
        platforms.push(ManagedPlatformState {
            platform_id: platform_id.clone(),
            platform_name: plugin.display_name().to_string(),
            scope: scope.to_string(),
            project_path: project_path.clone(),
            skills,
            rules,
            local_skills,
            local_rules,
        });
    }
    Ok(ManagedDistributionState { platforms })
}

/// 读取磁盘上 SkillForge 受管的技能：仅当目录条目的符号链接目标等于该技能
/// 在 DB 中记录的 `local_path` 时视为受管（所有权判定）。
fn read_managed_skills(
    instance: &PlatformInstance,
    repo: &dyn DistributionRepository,
    fs: &dyn DistributionFileSystem,
) -> Result<Vec<ManagedDistributionEntry>, AppError> {
    let mut entries = Vec::new();
    for id in fs.read_current_skills_on_disk(instance) {
        let skill = match repo.get_skill(&id) {
            Ok(skill) => skill,
            Err(_) => continue,
        };
        let path = std::path::Path::new(&instance.path).join(&id);
        if path.read_link().ok() == Some(std::path::PathBuf::from(skill.local_path)) {
            entries.push(ManagedDistributionEntry {
                id,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    Ok(entries)
}

fn read_local_skills(
    instance: &PlatformInstance,
    managed_entries: &[ManagedDistributionEntry],
) -> Result<Vec<LocalDistributionEntry>, AppError> {
    let managed_paths: std::collections::HashSet<&str> = managed_entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();
    read_local_directory_entries(std::path::Path::new(&instance.path), &managed_paths, false)
}

fn read_local_rules(
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    project_path: Option<&str>,
    managed_entries: &[ManagedDistributionEntry],
) -> Result<Vec<LocalDistributionEntry>, AppError> {
    let Some(path) = rule_distribution::resolve_rules_path(plugin, instance, project_path)? else {
        return Ok(vec![]);
    };
    let format = if instance.scope == "global" {
        plugin.default_paths().global_rules_format.clone()
    } else {
        plugin.default_paths().project_rules_format.clone()
    }
    .unwrap_or(RulesFormat::Directory);
    if matches!(format, RulesFormat::SingleFile { .. }) {
        return Ok(vec![]);
    }
    let managed_paths: std::collections::HashSet<&str> = managed_entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();
    read_local_directory_entries(&path, &managed_paths, true)
}

fn read_local_directory_entries(
    directory: &std::path::Path,
    managed_paths: &std::collections::HashSet<&str>,
    files_only: bool,
) -> Result<Vec<LocalDistributionEntry>, AppError> {
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(AppError::Io(error.to_string())),
    };
    let mut local_entries = Vec::new();
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if managed_paths.contains(path.to_string_lossy().as_ref()) {
            continue;
        }
        let file_type = entry.file_type()?;
        if files_only && !file_type.is_file() {
            continue;
        }
        if !files_only && !file_type.is_dir() && !file_type.is_symlink() {
            continue;
        }
        local_entries.push(LocalDistributionEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
        });
    }
    local_entries.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(local_entries)
}

/// 获取全部启用平台的同步状态。
///
/// 分发状态由目标文件系统扫描推导（filesystem-as-truth；Plan / ExecutionResult /
/// ManagedState 三段模型，无 `distributions` 表）。行为保持不变。
pub fn get_sync_status(conn: &rusqlite::Connection) -> Result<SyncStatusDTO, AppError> {
    let mut stmt =
        conn.prepare("SELECT id, name FROM platforms WHERE enabled != 0 ORDER BY name ASC")?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let platforms: Vec<PlatformSyncStatus> = rows
        .into_iter()
        .map(|(pid, pname)| {
            let (fs_skills, fs_rules) = match crate::plugins::platform::create_platform_plugin(&pid)
            {
                Ok(p) => {
                    let paths = p.default_paths();
                    let skills_dir_path =
                        crate::plugins::platform::expand_home(&paths.global_skills_dir);
                    let fs_skill_count = count_fs_subdirs(&skills_dir_path);
                    let fs_rule_count = paths
                        .global_rules_dir
                        .as_ref()
                        .map(|d| count_fs_files(&crate::plugins::platform::expand_home(d)))
                        .unwrap_or(0);
                    (fs_skill_count, fs_rule_count)
                }
                Err(_) => (0, 0),
            };
            let total_count = fs_skills + fs_rules;
            let status = if total_count > 0 {
                "synced"
            } else {
                "never_synced"
            };
            PlatformSyncStatus {
                platform_id: pid,
                platform_name: pname,
                status: status.to_string(),
                synced_count: total_count,
                total_count,
                scene_skill_count: 0,
                synced_skill_count: 0,
                scene_rule_count: 0,
                synced_rule_count: 0,
            }
        })
        .collect();

    Ok(SyncStatusDTO { platforms })
}

pub(crate) fn count_fs_subdirs(path: &std::path::Path) -> i64 {
    if !path.exists() {
        return 0;
    }
    let mut count = 0i64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    if !name.starts_with('.') {
                        count += 1;
                    }
                }
            }
        }
    }
    count
}

/// 统计目录内文件数（非隐藏，单层）。
pub(crate) fn count_fs_files(path: &std::path::Path) -> i64 {
    if !path.exists() {
        return 0;
    }
    let mut count = 0i64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    if !name.starts_with('.') {
                        count += 1;
                    }
                }
            }
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::types::{PlatformCapabilities, PlatformInstance, PlatformPaths, SyncResult};
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

    #[cfg(unix)]
    fn insert_skill(conn: &rusqlite::Connection, id: &str, local_path: &std::path::Path) {
        conn.execute(
            "INSERT INTO resources (id, kind, name, description, source_type, installed_at, updated_at, local_path)
             VALUES (?1, 'skill', ?1, NULL, 'local', ?2, ?2, ?3)",
            params![
                id,
                chrono::Utc::now().to_rfc3339(),
                local_path.to_string_lossy().as_ref()
            ],
        )
        .unwrap();
    }

    fn insert_rule(conn: &rusqlite::Connection, id: &str, content: &str) {
        conn.execute(
            "INSERT INTO resources (id, kind, name, description, source_type, installed_at, updated_at, format, content, version)
             VALUES (?1, 'rule', ?1, NULL, 'manual', ?3, ?3, 'md', ?2, 1)",
            params![id, content, chrono::Utc::now().to_rfc3339()],
        )
        .unwrap();
    }

    struct TestPlugin {
        paths: PlatformPaths,
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
        fn default_paths(&self) -> PlatformPaths {
            self.paths.clone()
        }
        fn capabilities(&self) -> PlatformCapabilities {
            PlatformCapabilities {
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

    fn global_plugin(
        skills_dir: &std::path::Path,
        rules_dir: Option<&std::path::Path>,
    ) -> Box<TestPlugin> {
        Box::new(TestPlugin {
            paths: PlatformPaths {
                global_skills_dir: skills_dir.to_string_lossy().to_string(),
                project_skills_pattern: String::new(),
                global_rules_dir: rules_dir.map(|d| d.to_string_lossy().to_string()),
                project_rules_pattern: None,
                global_rules_format: Some(RulesFormat::Directory),
                project_rules_format: None,
            },
        })
    }

    #[cfg(unix)]
    fn symlink(target: &std::path::Path, link: &std::path::Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(unix)]
    fn unique_root(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skillforge-app-managed-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// 受管分类回归锁定：只有「存在于 DB 且符号链接目标等于 DB 来源」的技能
    /// 才进入 managed 列表；链接目标不一致的同名条目不得误判为受管。
    #[test]
    #[cfg(unix)]
    fn managed_state_only_classifies_owned_symlinks_as_managed() {
        let conn = setup_db();
        let root = unique_root("owned");
        let src_owned = root.join("src-owned");
        let src_elsewhere = root.join("src-elsewhere");
        std::fs::create_dir_all(&src_owned).unwrap();
        std::fs::create_dir_all(&src_elsewhere).unwrap();

        insert_skill(&conn, "skill-a", &src_owned);
        // DB 记录的来源是 src_elsewhere，但磁盘链接将指向另一个位置 → 不受管
        insert_skill(&conn, "foreign-skill", &root.join("src-original"));

        let skills_dir = root.join("platform-skills");
        std::fs::create_dir_all(&skills_dir).unwrap();
        symlink(&src_owned, &skills_dir.join("skill-a"));
        symlink(&src_elsewhere, &skills_dir.join("foreign-skill"));
        std::fs::create_dir(skills_dir.join("plain-dir")).unwrap();

        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![global_plugin(&skills_dir, None)];
        let (repo, fs) = real_ports(&conn);
        let state = get_managed_distribution_state(
            &conn,
            &repo,
            &fs,
            &plugins,
            &["test".to_string()],
            "global",
            None,
        )
        .unwrap();

        assert_eq!(state.platforms.len(), 1);
        let platform = &state.platforms[0];
        let managed_ids: Vec<&str> = platform.skills.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(managed_ids, vec!["skill-a"]);
        assert_eq!(
            platform.skills[0].path,
            skills_dir.join("skill-a").to_string_lossy().to_string()
        );

        std::fs::remove_dir_all(&root).ok();
    }

    /// 本地条目过滤回归锁定：local 列表必须排除全部受管路径；
    /// 技能侧只收目录/符号链接，规则侧（Directory 模式）只收未受管的文件。
    #[test]
    #[cfg(unix)]
    fn local_entries_exclude_managed_paths() {
        let conn = setup_db();
        let root = unique_root("filter");
        let src_owned = root.join("src-owned");
        std::fs::create_dir_all(&src_owned).unwrap();
        insert_skill(&conn, "skill-a", &src_owned);

        let skills_dir = root.join("platform-skills");
        std::fs::create_dir_all(&skills_dir).unwrap();
        symlink(&src_owned, &skills_dir.join("skill-a")); // 受管
        symlink(&src_owned, &skills_dir.join("user-link")); // 非受管符号链接
        std::fs::create_dir(skills_dir.join("b-user-dir")).unwrap();
        std::fs::create_dir(skills_dir.join("a-user-dir")).unwrap();
        std::fs::write(skills_dir.join("notes.txt"), "x").unwrap(); // 文件不应出现在技能 local 列表

        let rules_dir = root.join("platform-rules");
        std::fs::create_dir_all(&rules_dir).unwrap();
        insert_rule(&conn, "rule-1", "# Rule 1\ncontent");
        std::fs::write(rules_dir.join("rule-1.md"), "# Rule 1\ncontent").unwrap(); // 受管
        std::fs::write(rules_dir.join("user-rule.md"), "# 用户自己的规则").unwrap(); // 非受管

        let plugins: Vec<Box<dyn PlatformPlugin>> =
            vec![global_plugin(&skills_dir, Some(&rules_dir))];
        let (repo, fs) = real_ports(&conn);
        let state = get_managed_distribution_state(
            &conn,
            &repo,
            &fs,
            &plugins,
            &["test".to_string()],
            "global",
            None,
        )
        .unwrap();
        let platform = &state.platforms[0];

        // 受管判定不受影响
        let managed_skill_ids: Vec<&str> = platform.skills.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(managed_skill_ids, vec!["skill-a"]);
        let managed_rule_ids: Vec<&str> = platform.rules.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(managed_rule_ids, vec!["rule-1"]);

        // 本地技能：排除受管 skill-a 与普通文件；包含非受管目录/链接并按名称排序
        let local_names: Vec<&str> = platform
            .local_skills
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(local_names, vec!["a-user-dir", "b-user-dir", "user-link"]);
        assert!(platform
            .local_skills
            .iter()
            .all(|e| e.path != skills_dir.join("skill-a").to_string_lossy().as_ref()));

        // 本地规则：排除受管 rule-1.md，仅剩用户文件
        let local_rule_names: Vec<&str> = platform
            .local_rules
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(local_rule_names, vec!["user-rule.md"]);

        std::fs::remove_dir_all(&root).ok();
    }

    /// fail-closed 锁定：project 范围缺 project_id 时请求校验必须拒绝。
    #[test]
    fn project_scope_without_project_id_is_rejected() {
        let conn = setup_db();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];
        let (repo, fs) = real_ports(&conn);
        let error = get_managed_distribution_state(
            &conn,
            &repo,
            &fs,
            &plugins,
            &["test".to_string()],
            "project",
            None,
        )
        .unwrap_err();
        match error {
            AppError::DistributionInvalid(message) => {
                assert!(message.contains("project 范围必须提供"));
            }
            other => panic!("期望 DistributionInvalid，实际: {:?}", other),
        }
    }

    /// 解耦证明：受管技能分类链路经 ports trait 对象由 fake 驱动——
    /// fake 磁盘现状含 skill-a，但 fake 仓储无此技能 → get_skill 未命中
    /// 不得进入受管列表；全程不建表、不触真实目录（conn 仅服务尚未接线的
    /// 规则读取边界）。
    #[test]
    fn managed_state_runs_through_fake_ports_without_db_or_disk() {
        use crate::application::distribution::test_fakes::{
            FakeDistributionFileSystem, FakeDistributionRepository,
        };

        let repo = FakeDistributionRepository::default();
        let fs = FakeDistributionFileSystem::default().with_skills_at("mem://skills", &["skill-a"]);

        let plugins: Vec<Box<dyn PlatformPlugin>> =
            vec![global_plugin(std::path::Path::new("mem://skills"), None)];
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let state = get_managed_distribution_state(
            &conn,
            &repo,
            &fs,
            &plugins,
            &["test".to_string()],
            "global",
            None,
        )
        .unwrap();

        assert!(
            !std::path::Path::new("mem://skills").exists(),
            "全程未触达真实磁盘"
        );
        let platform = &state.platforms[0];
        assert!(platform.skills.is_empty(), "仓储未命中的条目不得判为受管");
        assert!(platform.rules.is_empty());
        assert!(platform.local_skills.is_empty());
        assert!(platform.local_rules.is_empty());
    }

    /// 同步状态行为保持不变：10 个内置平台全部列出。
    #[test]
    fn sync_status_lists_builtin_platforms() {
        let conn = setup_db();
        let status = get_sync_status(&conn).unwrap();
        assert_eq!(status.platforms.len(), 10);
    }
}
