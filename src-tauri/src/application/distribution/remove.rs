//! RemoveSelected 移除前校验（application 层用例，fail-closed）。
//!
//! 承接原 `engine/dist_managed.rs::validate_removal_targets`：
//! 在任何变更发生之前，逐一确认每个移除目标仍归 SkillForge 所有。
//! 纯所有权决策委托给 `domain::distribution::policy`；DB / 文件系统读取
//! 与平台编排留在本层。任何不确定都整体拒绝（fail-closed）。

use crate::domain::distribution::policy::{classify_skill_symlink, SkillLinkOwnership};
use crate::engine::dist_plan::resolve_distribution_instance;
use crate::engine::rule_distribution;
use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::ports::distribution::DistributionRepository;
use crate::types::{DistributionPlan, DistributionRequest, RulesFormat};

/// 校验每个 RemoveSelected 目标在变更发生前仍归 SkillForge 所有。
/// 目标不是 SkillForge 受管符号链接、或 SingleFile 规则文件含未知/被修改的
/// 托管块时，返回 `DistributionInvalid`（与迁移前文案逐字一致）。
pub(crate) fn validate_removal_targets(
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
        if matches!(
            request.skills.mode,
            crate::types::DistributionIntentMode::RemoveSelected
        ) {
            for id in &platform.skills_to_remove {
                // 语义锁定：目标缺失（且非悬空链接）→ 跳过；存在但读不出
                // 符号链接 → 拒绝；链接目标 ≠ DB local_path → 拒绝。
                let skill = repo.get_skill(id)?;
                let target = std::path::Path::new(&instance.path).join(id);
                let target_present = target.exists() || target.symlink_metadata().is_ok();
                let ownership = classify_skill_symlink(
                    id,
                    target_present,
                    target
                        .read_link()
                        .ok()
                        .map(|link| link.to_string_lossy().to_string())
                        .as_deref(),
                    &skill.local_path,
                );
                if let SkillLinkOwnership::Reject(message) = ownership {
                    return Err(AppError::DistributionInvalid(message));
                }
            }
        }
        if matches!(
            request.rules.mode,
            crate::types::DistributionIntentMode::RemoveSelected
        ) {
            let rules_format = if request.scope == "global" {
                plugin.default_paths().global_rules_format.clone()
            } else {
                plugin.default_paths().project_rules_format.clone()
            }
            .unwrap_or(RulesFormat::Directory);
            if matches!(rules_format, RulesFormat::SingleFile { .. }) {
                let rules_path = rule_distribution::resolve_rules_path(
                    plugin.as_ref(),
                    &instance,
                    project_path.as_deref(),
                )?;
                if let Some(path) = rules_path {
                    if path.exists() {
                        let content = std::fs::read_to_string(&path).map_err(|error| {
                            AppError::DistributionInvalid(format!(
                                "无法读取规则文件 '{}': {}",
                                path.display(),
                                error
                            ))
                        })?;
                        let blocks = rule_distribution::parse_managed_rule_blocks(&content)?;
                        rule_distribution::validate_single_file_rule_blocks(conn, &blocks)?;
                    }
                }
            }
            rule_distribution::validate_rule_removal_targets(
                conn,
                plugin.as_ref(),
                &instance,
                &platform.rules_to_remove,
                &rules_format,
                project_path.as_deref(),
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::types::{
        DistributionIntent, DistributionIntentMode, PlatformCapabilities, PlatformDistributionPlan,
        PlatformInstance, PlatformPaths, SyncResult,
    };
    use rusqlite::params;

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        schema::create_tables(&conn).unwrap();
        conn
    }

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

    fn skills_plugin(skills_dir: &std::path::Path) -> Box<TestPlugin> {
        Box::new(TestPlugin {
            paths: PlatformPaths {
                global_skills_dir: skills_dir.to_string_lossy().to_string(),
                project_skills_pattern: String::new(),
                global_rules_dir: None,
                project_rules_pattern: None,
                global_rules_format: None,
                project_rules_format: None,
            },
        })
    }

    fn single_file_plugin(rules_file: &std::path::Path) -> Box<TestPlugin> {
        Box::new(TestPlugin {
            paths: PlatformPaths {
                global_skills_dir: String::new(),
                project_skills_pattern: String::new(),
                global_rules_dir: Some(rules_file.to_string_lossy().to_string()),
                project_rules_pattern: None,
                global_rules_format: Some(RulesFormat::SingleFile {
                    file_name: "AGENTS.md".to_string(),
                }),
                project_rules_format: None,
            },
        })
    }

    fn symlink(target: &std::path::Path, link: &std::path::Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    fn unique_root(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skillforge-app-remove-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// 空 intent 维度用 Preserve（与 execute_remove_distributed 的构造一致），
    /// 避免 validate_removal_targets 对空维度报错。
    fn intent(ids: &[&str]) -> DistributionIntent {
        DistributionIntent {
            mode: if ids.is_empty() {
                DistributionIntentMode::Preserve
            } else {
                DistributionIntentMode::RemoveSelected
            },
            ids: ids.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn removal_request(skill_ids: &[&str], rule_ids: &[&str]) -> DistributionRequest {
        DistributionRequest {
            scene_id: None,
            platform_ids: vec!["test".to_string()],
            scope: "global".to_string(),
            project_id: None,
            skills: intent(skill_ids),
            rules: intent(rule_ids),
        }
    }

    fn removal_plan(skill_ids: &[&str], rule_ids: &[&str]) -> DistributionPlan {
        DistributionPlan {
            platforms: vec![PlatformDistributionPlan {
                platform_id: "test".to_string(),
                platform_name: "Test".to_string(),
                skills_to_add: vec![],
                skills_to_update: vec![],
                skills_to_remove: skill_ids.iter().map(|s| s.to_string()).collect(),
                rules_to_add: vec![],
                rules_to_update: vec![],
                rules_to_remove: rule_ids.iter().map(|s| s.to_string()).collect(),
            }],
            has_removals: !skill_ids.is_empty() || !rule_ids.is_empty(),
        }
    }

    fn validate(
        conn: &rusqlite::Connection,
        plugins: &[Box<dyn PlatformPlugin>],
        request: &DistributionRequest,
        plan: &DistributionPlan,
    ) -> Result<(), AppError> {
        let repo = crate::adapters::db::SqliteDistributionRepository::new(conn);
        super::validate_removal_targets(conn, &repo, plugins, request, plan)
    }

    /// fail-closed 锁定：符号链接指向非 SkillForge 来源时必须整体拒绝，
    /// 错误文案与迁移前逐字一致。
    #[test]
    fn rejects_symlink_whose_target_is_not_skillforge_source() {
        let conn = setup_db();
        let root = unique_root("wrong-target");
        let src_owned = root.join("src-owned");
        let src_elsewhere = root.join("src-elsewhere");
        std::fs::create_dir_all(&src_owned).unwrap();
        std::fs::create_dir_all(&src_elsewhere).unwrap();
        insert_skill(&conn, "skill-a", &src_owned);

        let skills_dir = root.join("platform-skills");
        std::fs::create_dir_all(&skills_dir).unwrap();
        symlink(&src_elsewhere, &skills_dir.join("skill-a"));

        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![skills_plugin(&skills_dir)];
        let error = validate(
            &conn,
            &plugins,
            &removal_request(&["skill-a"], &[]),
            &removal_plan(&["skill-a"], &[]),
        )
        .unwrap_err();
        match error {
            AppError::DistributionInvalid(message) => {
                assert!(message.contains("符号链接目标不是 SkillForge 来源"));
            }
            other => panic!("期望 DistributionInvalid，实际: {:?}", other),
        }

        std::fs::remove_dir_all(&root).ok();
    }

    /// fail-closed 锁定：目标是普通目录（读不出符号链接）时必须拒绝。
    #[test]
    fn rejects_regular_directory_instead_of_symlink() {
        let conn = setup_db();
        let root = unique_root("not-link");
        let src_owned = root.join("src-owned");
        std::fs::create_dir_all(&src_owned).unwrap();
        insert_skill(&conn, "skill-a", &src_owned);

        let skills_dir = root.join("platform-skills");
        let target = skills_dir.join("skill-a");
        std::fs::create_dir_all(&target).unwrap(); // 普通目录，非符号链接

        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![skills_plugin(&skills_dir)];
        let error = validate(
            &conn,
            &plugins,
            &removal_request(&["skill-a"], &[]),
            &removal_plan(&["skill-a"], &[]),
        )
        .unwrap_err();
        match error {
            AppError::DistributionInvalid(message) => {
                assert!(message.contains("不是 SkillForge 管理的符号链接"));
            }
            other => panic!("期望 DistributionInvalid，实际: {:?}", other),
        }

        std::fs::remove_dir_all(&root).ok();
    }

    /// 正常路径锁定：目标缺失（跳过）与正确归属的符号链接均放行。
    #[test]
    fn accepts_absent_and_correctly_owned_targets() {
        let conn = setup_db();
        let root = unique_root("owned-ok");
        let src_owned = root.join("src-owned");
        std::fs::create_dir_all(&src_owned).unwrap();

        // 场景 A：磁盘上不存在该技能目录 → Absent，放行
        insert_skill(&conn, "skill-gone", &src_owned);
        // 场景 B：正确指向 DB 来源的符号链接 → Owned，放行
        insert_skill(&conn, "skill-live", &src_owned);

        let skills_dir = root.join("platform-skills");
        std::fs::create_dir_all(&skills_dir).unwrap();
        symlink(&src_owned, &skills_dir.join("skill-live"));

        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![skills_plugin(&skills_dir)];
        validate(
            &conn,
            &plugins,
            &removal_request(&["skill-gone", "skill-live"], &[]),
            &removal_plan(&["skill-gone", "skill-live"], &[]),
        )
        .expect("缺失目标应跳过、正确归属目标应放行");

        std::fs::remove_dir_all(&root).ok();
    }

    /// SingleFile 锁定：规则文件包含畸形 SKILLFORGE 标记时必须拒绝移除。
    #[test]
    fn rejects_single_file_with_malformed_managed_block() {
        let conn = setup_db();
        let root = unique_root("sf-bad");
        std::fs::create_dir_all(&root).unwrap();
        let rules_file = root.join("AGENTS.md");
        std::fs::write(
            &rules_file,
            "# 用户内容\n<!-- SKILLFORGE:rule:rule-1 -->\n没有闭合标记的内容\n",
        )
        .unwrap();

        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![single_file_plugin(&rules_file)];
        let error = validate(
            &conn,
            &plugins,
            &removal_request(&[], &["rule-1"]),
            &removal_plan(&[], &["rule-1"]),
        )
        .unwrap_err();
        match error {
            AppError::DistributionInvalid(message) => {
                assert!(message.contains("畸形或不匹配的 SkillForge 标记块"));
            }
            other => panic!("期望 DistributionInvalid，实际: {:?}", other),
        }

        std::fs::remove_dir_all(&root).ok();
    }

    /// SingleFile 正常路径锁定：内容匹配 DB 的托管块允许移除校验通过。
    #[test]
    fn accepts_single_file_with_matching_managed_block() {
        let conn = setup_db();
        let root = unique_root("sf-good");
        std::fs::create_dir_all(&root).unwrap();
        let rules_file = root.join("AGENTS.md");
        std::fs::write(
            &rules_file,
            "# 用户内容\n<!-- SKILLFORGE:rule:rule-1 -->\n# Rule 1\n正文\n<!-- /SKILLFORGE:rule:rule-1 -->\n",
        )
        .unwrap();
        insert_rule(&conn, "rule-1", "# Rule 1\n正文");

        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![single_file_plugin(&rules_file)];
        validate(
            &conn,
            &plugins,
            &removal_request(&[], &["rule-1"]),
            &removal_plan(&[], &["rule-1"]),
        )
        .expect("内容匹配的托管块应通过移除前校验");

        std::fs::remove_dir_all(&root).ok();
    }
}
