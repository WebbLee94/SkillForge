//! Preview use case — read-only distribution planning (`DistributionPlan`
//! generation). Moved from `engine/dist_plan.rs`, which remains a thin
//! compatibility facade forwarding to this module.
//!
//! Orchestration owned here:
//!
//! - validate the [`DistributionRequest`]
//! - resolve project path from DB if scope is `project`
//! - resolve per-platform instances via plugin `detect()` (global) or the
//!   configured project path pattern (project scope)
//! - read current skills / rules from disk (filesystem-as-truth)
//! - call the pure planner ([`calculate_distribution_plan`]) for diffs
//!
//! Read-only guarantee: this flow must never create directories or files —
//! missing target directories are simply treated as empty current state.

use crate::domain::distribution::plan::{
    calculate_distribution_plan_with_content, plan_has_removals, ContentDigestPair,
};
use crate::engine::content_hash;
use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::ports::distribution::DistributionRepository;
use crate::ports::filesystem::DistributionFileSystem;
use crate::types::{
    DistributionIntent, DistributionIntentMode, DistributionPlan, DistributionRequest,
    PlatformInstance,
};

/// Build a read-only distribution plan comparing desired vs current state.
///
/// - `skill_ids` / `rule_ids` are the explicit desired sets (scene_id is informational only)
/// - `scene_id` does NOT override explicit IDs
/// - Project scope resolves `project_id` from DB to filesystem path
/// - Missing target directories are treated as empty (no directories created)
/// - Returns classified add/update/remove per platform
#[allow(clippy::too_many_arguments)]
pub fn build_distribution_plan(
    repo: &dyn DistributionRepository,
    fs: &dyn DistributionFileSystem,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    skill_ids: &[String],
    rule_ids: &[String],
    _scene_id: Option<&str>,
    platform_ids: &[String],
    scope: &str,
    project_id: Option<&str>,
) -> Result<DistributionPlan, AppError> {
    let request = DistributionRequest {
        scene_id: _scene_id.map(str::to_string),
        platform_ids: platform_ids.to_vec(),
        scope: scope.to_string(),
        project_id: project_id.map(str::to_string),
        skills: legacy_distribution_intent(skill_ids),
        rules: legacy_distribution_intent(rule_ids),
    };
    build_distribution_plan_for_request(repo, fs, platform_plugins, &request)
}

pub fn build_distribution_plan_for_request(
    repo: &dyn DistributionRepository,
    fs: &dyn DistributionFileSystem,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    request: &DistributionRequest,
) -> Result<DistributionPlan, AppError> {
    request.validate()?;

    // Resolve project path if project-scoped
    let project_path: Option<String> = if request.scope == "project" {
        Some(
            request
                .project_id
                .as_deref()
                .and_then(|pid| repo.get_project_path(pid))
                .ok_or_else(|| {
                    AppError::ProjectNotFound("项目范围计划需要提供项目ID".to_string())
                })?,
        )
    } else {
        None
    };
    let mut plan_platforms = Vec::new();
    for platform_id in &request.platform_ids {
        let plugin = platform_plugins
            .iter()
            .find(|p| p.platform_name() == *platform_id)
            .ok_or_else(|| AppError::Platform(format!("未找到平台插件: {}", platform_id)))?;
        let instances = match plugin.detect() {
            Ok(instances) => instances,
            Err(e) => {
                return Err(AppError::Platform(format!(
                    "检测平台 '{}' 失败: {}",
                    platform_id, e
                )));
            }
        };
        // Find matching instance for the requested scope
        let instance = if request.scope == "global" {
            instances
                .into_iter()
                .find(|i| i.scope == "global")
                .unwrap_or_else(|| PlatformInstance {
                    platform_id: platform_id.to_string(),
                    platform_name: platform_id.to_string(),
                    path: crate::plugins::platform::expand_home(
                        &plugin.default_paths().global_skills_dir,
                    )
                    .to_string_lossy()
                    .to_string(),
                    scope: "global".to_string(),
                })
        } else {
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
        // Read current state from disk (read-only — NO directory creation)
        let current_skills = fs.read_current_skills_on_disk(&instance);
        let mut platform_request = request.clone();
        platform_request.platform_ids = vec![platform_id.to_string()];
        // Compute rule diff (if platform supports rules)
        let current_rules =
            fs.read_current_rules_on_disk(&**plugin, &instance, project_path.as_deref())?;
        let skill_digests =
            collect_skill_digests(repo, fs, &request.skills, &current_skills, &instance);
        let rule_digests = collect_rule_digests(
            repo,
            fs,
            &request.rules,
            &current_rules,
            &**plugin,
            &instance,
            project_path.as_deref(),
        )?;
        let mut platform_plan = calculate_distribution_plan_with_content(
            platform_id,
            plugin.display_name(),
            &current_skills,
            &current_rules,
            &platform_request,
            &skill_digests,
            &rule_digests,
        )?;
        let rules_supported = if instance.scope == "global" {
            plugin.default_paths().global_rules_dir.is_some()
        } else {
            plugin.default_paths().project_rules_pattern.is_some()
        };
        if !rules_supported {
            platform_plan.rules_to_add.clear();
            platform_plan.rules_to_update.clear();
            platform_plan.rules_to_remove.clear();
        }
        let platform_name = plugin.display_name().to_string();
        platform_plan.platform_name = platform_name;
        plan_platforms.push(platform_plan);
    }
    let overall_has_removals = plan_has_removals(&plan_platforms);
    Ok(DistributionPlan {
        platforms: plan_platforms,
        has_removals: overall_has_removals,
    })
}

fn legacy_distribution_intent(ids: &[String]) -> DistributionIntent {
    if ids.is_empty() {
        DistributionIntent {
            mode: DistributionIntentMode::Preserve,
            ids: vec![],
        }
    } else {
        DistributionIntent {
            mode: DistributionIntentMode::AddOrUpdate,
            ids: ids.to_vec(),
        }
    }
}

fn collect_skill_digests(
    repo: &dyn DistributionRepository,
    fs: &dyn DistributionFileSystem,
    intent: &DistributionIntent,
    current: &[String],
    instance: &PlatformInstance,
) -> ContentDigestPair {
    if intent.mode != DistributionIntentMode::AddOrUpdate {
        return ContentDigestPair::default();
    }
    let mut digests = ContentDigestPair::default();
    for id in intent.ids.iter().filter(|id| current.contains(id)) {
        let Some(deployed) = fs.deployed_skill_digest(instance, id) else {
            continue;
        };
        let library = library_skill_digest(repo, id);
        if let Some(library) = library {
            digests.library.insert(id.clone(), library);
            digests.deployed.insert(id.clone(), deployed);
        }
    }
    digests
}

fn library_skill_digest(repo: &dyn DistributionRepository, skill_id: &str) -> Option<String> {
    let skill = repo.get_skill(skill_id).ok()?;
    let path = std::path::Path::new(&skill.local_path);
    if !path.exists() {
        return None;
    }
    content_hash::hash_directory(path).ok()
}

fn collect_rule_digests(
    repo: &dyn DistributionRepository,
    fs: &dyn DistributionFileSystem,
    intent: &DistributionIntent,
    current: &[String],
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    project_base: Option<&str>,
) -> Result<ContentDigestPair, AppError> {
    if intent.mode != DistributionIntentMode::AddOrUpdate {
        return Ok(ContentDigestPair::default());
    }
    let mut digests = ContentDigestPair::default();
    for id in intent.ids.iter().filter(|id| current.contains(id)) {
        let Some(deployed) = fs.deployed_rule_digest(plugin, instance, project_base, id)? else {
            continue;
        };
        let Ok(rule) = repo.get_rule(id) else {
            continue;
        };
        digests
            .library
            .insert(id.clone(), content_hash::rule_content_digest(&rule.content));
        digests.deployed.insert(id.clone(), deployed);
    }
    Ok(digests)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::types::{PlatformCapabilities, PlatformPaths};
    use crate::types::{RulesFormat, SkillPlatformStatus, SyncResult};
    use std::collections::BTreeSet;
    use std::path::Path;

    // ── Fixtures ────────────────────────────────────────────────────

    struct PreviewTestPlugin {
        paths: PlatformPaths,
        instances: Vec<PlatformInstance>,
    }

    impl PlatformPlugin for PreviewTestPlugin {
        fn platform_name(&self) -> &'static str {
            "test"
        }

        fn display_name(&self) -> &'static str {
            "Test"
        }

        fn detect(&self) -> Result<Vec<PlatformInstance>, AppError> {
            Ok(self.instances.clone())
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
        ) -> Result<SkillPlatformStatus, AppError> {
            Ok(SkillPlatformStatus {
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
                rules_global: self.paths.global_rules_dir.is_some(),
                rules_project: self.paths.project_rules_pattern.is_some(),
                rules_format_global: self.paths.global_rules_format.clone(),
                rules_format_project: self.paths.project_rules_format.clone(),
                limitation_notes: vec![],
            }
        }
    }

    /// Global-scope plugin whose detected instance points at `skills_dir`.
    /// `rules_dir = None` simulates a platform without rules support.
    fn dir_plugin(skills_dir: &Path, rules_dir: Option<&Path>) -> Box<dyn PlatformPlugin> {
        Box::new(PreviewTestPlugin {
            paths: PlatformPaths {
                global_skills_dir: String::new(),
                project_skills_pattern: String::new(),
                global_rules_dir: rules_dir.map(|d| d.to_string_lossy().to_string()),
                project_rules_pattern: None,
                global_rules_format: Some(RulesFormat::Directory),
                project_rules_format: None,
            },
            instances: vec![PlatformInstance {
                platform_id: "test".to_string(),
                platform_name: "Test".to_string(),
                path: skills_dir.to_string_lossy().to_string(),
                scope: "global".to_string(),
            }],
        })
    }

    /// Project-scope plugin resolving `{project}` patterns under a project base.
    fn project_plugin(
        skills_pattern: &str,
        rules_pattern: Option<&str>,
    ) -> Box<dyn PlatformPlugin> {
        Box::new(PreviewTestPlugin {
            paths: PlatformPaths {
                global_skills_dir: String::new(),
                project_skills_pattern: skills_pattern.to_string(),
                global_rules_dir: None,
                project_rules_pattern: rules_pattern.map(str::to_string),
                global_rules_format: Some(RulesFormat::Directory),
                project_rules_format: Some(RulesFormat::Directory),
            },
            instances: vec![],
        })
    }

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        schema::create_tables(&conn).unwrap();
        conn
    }

    fn insert_project(conn: &rusqlite::Connection, id: &str, name: &str, path: &Path) {
        conn.execute(
            "INSERT INTO projects (id, name, path, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, NULL, ?4, ?4)",
            rusqlite::params![
                id,
                name,
                path.to_string_lossy().to_string(),
                chrono::Utc::now().to_rfc3339()
            ],
        )
        .unwrap();
    }

    fn intent(mode: DistributionIntentMode, ids: &[&str]) -> DistributionIntent {
        DistributionIntent {
            mode,
            ids: ids.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn request(
        scope: &str,
        project_id: Option<&str>,
        skills: DistributionIntent,
        rules: DistributionIntent,
    ) -> DistributionRequest {
        DistributionRequest {
            scene_id: None,
            platform_ids: vec!["test".to_string()],
            scope: scope.to_string(),
            project_id: project_id.map(str::to_string),
            skills,
            rules,
        }
    }

    /// Recursive listing of `root` (relative path + kind). Empty set when the
    /// directory itself does not exist.
    fn snapshot(root: &Path) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        if !root.exists() {
            return out;
        }
        for entry in walkdir::WalkDir::new(root).min_depth(1) {
            let entry = entry.unwrap();
            let rel = entry.path().strip_prefix(root).unwrap().to_string_lossy();
            let kind = if entry.file_type().is_dir() { "d" } else { "f" };
            out.insert(format!("{kind}:{rel}"));
        }
        out
    }

    /// Run the same request through BOTH entry points — the old engine
    /// compatibility facade and the new application use case — asserting
    /// identical output (preview equivalence before/after extraction).
    fn preview_via_both_paths(
        conn: &rusqlite::Connection,
        plugins: &[Box<dyn PlatformPlugin>],
        req: &DistributionRequest,
    ) -> DistributionPlan {
        let repo = crate::adapters::db::SqliteDistributionRepository::new(conn);
        let fs = crate::adapters::filesystem::EngineDistributionFileSystem;
        let via_facade =
            crate::engine::dist_plan::build_distribution_plan_for_request(conn, plugins, req)
                .expect("facade preview should succeed");
        let via_application = super::build_distribution_plan_for_request(&repo, &fs, plugins, req)
            .expect("application preview should succeed");
        assert_eq!(via_facade, via_application, "新旧入口输出必须一致");
        via_application
    }

    fn expect_both_err_equivalent(
        conn: &rusqlite::Connection,
        plugins: &[Box<dyn PlatformPlugin>],
        req: &DistributionRequest,
    ) -> String {
        let repo = crate::adapters::db::SqliteDistributionRepository::new(conn);
        let fs = crate::adapters::filesystem::EngineDistributionFileSystem;
        let facade_err =
            crate::engine::dist_plan::build_distribution_plan_for_request(conn, plugins, req)
                .expect_err("facade preview should fail")
                .to_string();
        let app_err = super::build_distribution_plan_for_request(&repo, &fs, plugins, req)
            .expect_err("application preview should fail")
            .to_string();
        assert_eq!(facade_err, app_err, "新旧入口错误必须一致");
        facade_err
    }

    // ── Equivalence + behavior locks ────────────────────────────────

    #[test]
    fn preview_global_add_or_update_partial_diff_is_stable() {
        let tmp = tempfile::TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        let rules_dir = tmp.path().join("rules");
        std::fs::create_dir_all(skills_dir.join("a")).unwrap();
        std::fs::create_dir_all(&rules_dir).unwrap();

        let plugins = vec![dir_plugin(&skills_dir, Some(&rules_dir))];
        let req = request(
            "global",
            None,
            intent(DistributionIntentMode::AddOrUpdate, &["a", "b"]),
            intent(DistributionIntentMode::Preserve, &[]),
        );

        let before = snapshot(tmp.path());
        let plan = preview_via_both_paths(&setup_db(), &plugins, &req);
        assert_eq!(snapshot(tmp.path()), before, "preview 不得改动文件系统");

        assert_eq!(plan.platforms.len(), 1);
        let p = &plan.platforms[0];
        assert_eq!(p.platform_id, "test");
        assert_eq!(p.platform_name, "Test");
        assert_eq!(p.skills_to_add, vec!["b"]);
        assert!(p.skills_to_update.is_empty());
        assert!(p.skills_to_remove.is_empty());
        assert!(p.rules_to_add.is_empty());
        assert!(p.rules_to_update.is_empty());
        assert!(p.rules_to_remove.is_empty());
        assert!(!plan.has_removals);
    }

    #[test]
    fn preview_global_remove_selected_only_targets_present_entries() {
        let tmp = tempfile::TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        let rules_dir = tmp.path().join("rules");
        for id in ["a", "b", "c"] {
            std::fs::create_dir_all(skills_dir.join(id)).unwrap();
        }
        std::fs::create_dir_all(&rules_dir).unwrap();

        let plugins = vec![dir_plugin(&skills_dir, Some(&rules_dir))];
        let req = request(
            "global",
            None,
            intent(DistributionIntentMode::RemoveSelected, &["b", "zz"]),
            intent(DistributionIntentMode::Preserve, &[]),
        );

        let plan = preview_via_both_paths(&setup_db(), &plugins, &req);
        let p = &plan.platforms[0];
        assert_eq!(p.skills_to_remove, vec!["b"], "只允许移除磁盘上存在的条目");
        assert!(p.skills_to_add.is_empty());
        assert!(plan.has_removals);
    }

    #[test]
    fn preview_preserve_mode_never_touches_missing_directories() {
        let tmp = tempfile::TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        let rules_dir = tmp.path().join("rules");
        // 目标目录均不存在 —— 只读保证要求 preview 后仍然不存在。

        let plugins = vec![dir_plugin(&skills_dir, Some(&rules_dir))];
        let req = request(
            "global",
            None,
            intent(DistributionIntentMode::Preserve, &[]),
            intent(DistributionIntentMode::Preserve, &[]),
        );

        let before = snapshot(tmp.path());
        let plan = preview_via_both_paths(&setup_db(), &plugins, &req);

        assert_eq!(snapshot(tmp.path()), before);
        assert!(!skills_dir.exists(), "不得创建 skills 目录");
        assert!(!rules_dir.exists(), "不得创建 rules 目录");
        assert!(plan.platforms[0].skills_to_add.is_empty());
        assert!(plan.platforms[0].rules_to_add.is_empty());
        assert!(!plan.has_removals);
    }

    #[test]
    fn preview_clears_rule_sections_when_platform_has_no_rules_support() {
        let tmp = tempfile::TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        std::fs::create_dir_all(&skills_dir).unwrap();

        // global_rules_dir = None ⇒ 平台不支持规则
        let plugins = vec![dir_plugin(&skills_dir, None)];
        let req = request(
            "global",
            None,
            intent(DistributionIntentMode::AddOrUpdate, &["a"]),
            intent(DistributionIntentMode::AddOrUpdate, &["r1"]),
        );

        let plan = preview_via_both_paths(&setup_db(), &plugins, &req);
        let p = &plan.platforms[0];
        assert_eq!(p.skills_to_add, vec!["a"]);
        assert!(p.rules_to_add.is_empty(), "不支持规则的平台必须清空规则段");
        assert!(p.rules_to_update.is_empty());
        assert!(p.rules_to_remove.is_empty());
    }

    #[test]
    fn preview_project_scope_resolves_pattern_and_rule_stems() {
        let tmp = tempfile::TempDir::new().unwrap();
        let project_root = tmp.path().join("my-project");
        std::fs::create_dir_all(project_root.join(".sf/skills/x")).unwrap();
        std::fs::create_dir_all(project_root.join(".sf/rules")).unwrap();
        std::fs::write(project_root.join(".sf/rules/r1.md"), "# R1").unwrap();

        let conn = setup_db();
        insert_project(&conn, "p1", "My Project", &project_root);

        let plugins = vec![project_plugin(
            "{project}/.sf/skills",
            Some("{project}/.sf/rules"),
        )];
        let req = request(
            "project",
            Some("p1"),
            intent(DistributionIntentMode::AddOrUpdate, &["x", "y"]),
            intent(DistributionIntentMode::AddOrUpdate, &["r1", "r2"]),
        );

        let before = snapshot(tmp.path());
        let plan = preview_via_both_paths(&conn, &plugins, &req);
        assert_eq!(snapshot(tmp.path()), before, "preview 不得改动项目目录");

        let p = &plan.platforms[0];
        // 磁盘现状：skills 含 x，rules 含 stem r1
        assert_eq!(p.skills_to_add, vec!["y"]);
        assert!(p.skills_to_remove.is_empty());
        assert_eq!(p.rules_to_add, vec!["r2"]);
        assert!(p.rules_to_remove.is_empty());
        assert!(!plan.has_removals);
    }

    #[test]
    fn preview_project_scope_requires_resolvable_project_identically() {
        let plugins = vec![project_plugin(".sf/skills", Some(".sf/rules"))];

        // 缺少 project_id：请求校验失败（DistributionInvalid）
        let req_missing = request(
            "project",
            None,
            intent(DistributionIntentMode::Preserve, &[]),
            intent(DistributionIntentMode::Preserve, &[]),
        );
        let err = expect_both_err_equivalent(&setup_db(), &plugins, &req_missing);
        assert!(err.contains("project 范围必须提供 project_id"));

        // project_id 无法解析为路径：ProjectNotFound
        let req_unresolved = request(
            "project",
            Some("ghost"),
            intent(DistributionIntentMode::Preserve, &[]),
            intent(DistributionIntentMode::Preserve, &[]),
        );
        let err = expect_both_err_equivalent(&setup_db(), &plugins, &req_unresolved);
        assert!(err.contains("项目范围计划需要提供项目ID"));
    }

    #[test]
    fn preview_unknown_platform_fails_identically_on_both_entries() {
        let tmp = tempfile::TempDir::new().unwrap();
        let plugins = vec![dir_plugin(&tmp.path().join("skills"), None)];
        let mut req = request(
            "global",
            None,
            intent(DistributionIntentMode::Preserve, &[]),
            intent(DistributionIntentMode::Preserve, &[]),
        );
        req.platform_ids = vec!["nope".to_string()];

        let err = expect_both_err_equivalent(&setup_db(), &plugins, &req);
        assert!(err.contains("未找到平台插件"));
    }

    #[test]
    fn legacy_build_distribution_plan_forwards_with_same_output() {
        let tmp = tempfile::TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        let rules_dir = tmp.path().join("rules");
        std::fs::create_dir_all(skills_dir.join("a")).unwrap();
        std::fs::create_dir_all(&rules_dir).unwrap();

        let conn = setup_db();
        let plugins = vec![dir_plugin(&skills_dir, Some(&rules_dir))];

        let legacy = crate::engine::dist_plan::build_distribution_plan(
            &conn,
            &plugins,
            &["a".to_string(), "b".to_string()],
            &[],
            None,
            &["test".to_string()],
            "global",
            None,
        )
        .expect("legacy entry should succeed");

        let modern = {
            let repo = crate::adapters::db::SqliteDistributionRepository::new(&conn);
            let fs = crate::adapters::filesystem::EngineDistributionFileSystem;
            super::build_distribution_plan_for_request(
                &repo,
                &fs,
                &plugins,
                &request(
                    "global",
                    None,
                    intent(DistributionIntentMode::AddOrUpdate, &["a", "b"]),
                    // 空 ids 的旧语义 = Preserve
                    intent(DistributionIntentMode::Preserve, &[]),
                ),
            )
            .expect("modern entry should succeed")
        };

        assert_eq!(
            legacy, modern,
            "旧签名入口与新入口输出必须一致（空 ids ⇒ Preserve）"
        );
    }

    #[test]
    fn distribution_plan_serialization_shape_is_unchanged() {
        // 锁定 preview 输出的 IPC 形状：字段名保持 snake_case 原样输出。
        let plan = DistributionPlan {
            platforms: vec![crate::types::PlatformDistributionPlan {
                platform_id: "test".to_string(),
                platform_name: "Test".to_string(),
                skills_to_add: vec!["a".to_string()],
                skills_to_update: vec![],
                skills_to_remove: vec![],
                rules_to_add: vec![],
                rules_to_update: vec![],
                rules_to_remove: vec![],
            }],
            has_removals: false,
        };

        let json = serde_json::to_value(&plan).unwrap();
        assert_eq!(json["has_removals"], serde_json::json!(false));
        let p0 = &json["platforms"][0];
        for key in [
            "platform_id",
            "platform_name",
            "skills_to_add",
            "skills_to_update",
            "skills_to_remove",
            "rules_to_add",
            "rules_to_update",
            "rules_to_remove",
        ] {
            assert!(p0.get(key).is_some(), "缺少字段 {key}，IPC 形状发生变化");
        }
    }

    // ── Fake ports 解耦证明 ─────────────────────────────────────────

    /// 解耦证明：preview 用例经 ports trait 对象在 project 范围下完整跑通
    /// 「项目路径解析 → 磁盘技能现状 → 磁盘规则现状 → diff」全链路，
    /// 全程无 DB 连接、无真实目录。
    #[test]
    fn preview_runs_through_fake_ports_without_db_or_disk() {
        use crate::application::distribution::test_fakes::{
            FakeDistributionFileSystem, FakeDistributionRepository,
        };

        let mut repo = FakeDistributionRepository::default();
        repo.insert_project_path("p1", "/mem/project");
        let fs = FakeDistributionFileSystem::default()
            .with_skills_at("/mem/project/.sf/skills", &["x"])
            .with_rules_at("/mem/project/.sf/rules", &["r1"]);

        let plugins = vec![project_plugin(
            "{project}/.sf/skills",
            Some("{project}/.sf/rules"),
        )];
        let req = request(
            "project",
            Some("p1"),
            intent(DistributionIntentMode::AddOrUpdate, &["x", "y"]),
            intent(DistributionIntentMode::AddOrUpdate, &["r1", "r2"]),
        );

        let plan = build_distribution_plan_for_request(&repo, &fs, &plugins, &req)
            .expect("fake ports 驱动的 preview 应成功");

        assert!(
            !std::path::Path::new("/mem/project").exists(),
            "全程未触达真实磁盘"
        );
        let p = &plan.platforms[0];
        assert_eq!(p.platform_id, "test");
        assert_eq!(p.skills_to_add, vec!["y"], "磁盘现状 x 来自 fake");
        assert!(p.skills_to_remove.is_empty());
        assert_eq!(p.rules_to_add, vec!["r2"], "规则现状 r1 来自 fake");
        assert!(p.rules_to_remove.is_empty());
        assert!(!plan.has_removals);
    }

    /// fail-closed 经由端口生效：fake 仓储无法解析项目路径时，
    /// preview 拒绝且错误文案与真实实现一致。
    #[test]
    fn preview_with_fakes_missing_project_path_fails_closed() {
        use crate::application::distribution::test_fakes::{
            FakeDistributionFileSystem, FakeDistributionRepository,
        };

        let repo = FakeDistributionRepository::default();
        let fs = FakeDistributionFileSystem::default();
        let plugins = vec![project_plugin(".sf/skills", Some(".sf/rules"))];
        let req = request(
            "project",
            Some("ghost"),
            intent(DistributionIntentMode::Preserve, &[]),
            intent(DistributionIntentMode::Preserve, &[]),
        );

        let err = build_distribution_plan_for_request(&repo, &fs, &plugins, &req)
            .expect_err("未解析的项目路径必须拒绝");
        match err {
            AppError::ProjectNotFound(msg) => {
                assert_eq!(msg, "项目范围计划需要提供项目ID");
            }
            other => panic!("期望 ProjectNotFound，实际: {:?}", other),
        }
    }

    // ── CL-034 内容级 checksum 合同 ─────────────────────────────────

    fn insert_skill_row(conn: &rusqlite::Connection, id: &str, local_path: &Path) {
        conn.execute(
            "INSERT INTO resources (id, kind, name, source_type, installed_at, updated_at, local_path)
             VALUES (?1, 'skill', ?1, 'local', ?2, ?2, ?3)",
            rusqlite::params![
                id,
                chrono::Utc::now().to_rfc3339(),
                local_path.to_string_lossy().to_string()
            ],
        )
        .unwrap();
    }

    fn insert_rule_row(conn: &rusqlite::Connection, id: &str, content: &str) {
        conn.execute(
            "INSERT INTO resources (id, kind, name, source_type, installed_at, updated_at, format, content, version)
             VALUES (?1, 'rule', ?1, 'manual', ?3, ?3, 'md', ?2, 1)",
            rusqlite::params![id, content, chrono::Utc::now().to_rfc3339()],
        )
        .unwrap();
    }

    #[test]
    fn preview_classifies_outdated_skill_copy_as_update() {
        let tmp = tempfile::TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        let library_dir = tmp.path().join("library").join("skill-a");
        std::fs::create_dir_all(skills_dir.join("skill-a")).unwrap();
        std::fs::create_dir_all(&library_dir).unwrap();
        std::fs::write(library_dir.join("SKILL.md"), "library v2").unwrap();
        std::fs::write(skills_dir.join("skill-a").join("SKILL.md"), "deployed v1").unwrap();

        let conn = setup_db();
        insert_skill_row(&conn, "skill-a", &library_dir);

        let plugins = vec![dir_plugin(&skills_dir, None)];
        let req = request(
            "global",
            None,
            intent(DistributionIntentMode::AddOrUpdate, &["skill-a"]),
            intent(DistributionIntentMode::Preserve, &[]),
        );

        let plan = preview_via_both_paths(&conn, &plugins, &req);
        let p = &plan.platforms[0];
        assert!(p.skills_to_add.is_empty());
        assert_eq!(p.skills_to_update, vec!["skill-a"]);
        assert!(p.skills_to_remove.is_empty());
    }

    #[test]
    fn preview_keeps_matching_skill_copy_out_of_update_list() {
        let tmp = tempfile::TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        let library_dir = tmp.path().join("library").join("skill-a");
        std::fs::create_dir_all(skills_dir.join("skill-a")).unwrap();
        std::fs::create_dir_all(&library_dir).unwrap();
        std::fs::write(library_dir.join("SKILL.md"), "same").unwrap();
        std::fs::write(skills_dir.join("skill-a").join("SKILL.md"), "same").unwrap();

        let conn = setup_db();
        insert_skill_row(&conn, "skill-a", &library_dir);

        let plugins = vec![dir_plugin(&skills_dir, None)];
        let req = request(
            "global",
            None,
            intent(DistributionIntentMode::AddOrUpdate, &["skill-a"]),
            intent(DistributionIntentMode::Preserve, &[]),
        );

        let plan = preview_via_both_paths(&conn, &plugins, &req);
        let p = &plan.platforms[0];
        assert!(p.skills_to_add.is_empty());
        assert!(p.skills_to_update.is_empty(), "内容一致不得误报更新");
    }

    #[test]
    fn preview_classifies_user_modified_rule_file_as_update() {
        let tmp = tempfile::TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        let rules_dir = tmp.path().join("rules");
        std::fs::create_dir_all(skills_dir.join("a")).unwrap();
        std::fs::create_dir_all(&rules_dir).unwrap();
        std::fs::write(rules_dir.join("r1.md"), "user edited").unwrap();

        let conn = setup_db();
        insert_rule_row(&conn, "r1", "# R1");

        let plugins = vec![dir_plugin(&skills_dir, Some(&rules_dir))];
        let req = request(
            "global",
            None,
            intent(DistributionIntentMode::Preserve, &[]),
            intent(DistributionIntentMode::AddOrUpdate, &["r1", "r2"]),
        );

        let plan = preview_via_both_paths(&conn, &plugins, &req);
        let p = &plan.platforms[0];
        assert_eq!(p.rules_to_add, vec!["r2"]);
        assert_eq!(p.rules_to_update, vec!["r1"]);
        assert!(!plan.has_removals);
    }

    /// 解耦证明（CL-034）：fake 端口的部署侧摘要直接驱动规则 update 分类，
    /// 全程无 DB、无真实磁盘；摘要一致的条目不进任何列表。
    #[test]
    fn fake_ports_drive_rule_update_classification_without_disk_or_db() {
        use crate::application::distribution::test_fakes::{
            FakeDistributionFileSystem, FakeDistributionRepository,
        };

        let mut repo = FakeDistributionRepository::default();
        repo.insert_project_path("p1", "/mem/project");
        repo.insert_rule("r1", "md", "# R1");
        repo.insert_rule("r3", "md", "# R3");

        let matching = content_hash::rule_content_digest("# R1");
        let fs = FakeDistributionFileSystem::default()
            .with_skills_at("/mem/project/.sf/skills", &["x"])
            .with_rules_at("/mem/project/.sf/rules", &["r1", "r3"])
            .with_skill_digest_at("/mem/project/.sf/skills", "x", "deployed-only")
            .with_rule_digest_at("/mem/project/.sf/rules", "r1", &matching)
            .with_rule_digest_at("/mem/project/.sf/rules", "r3", "drifted");

        let plugins = vec![project_plugin(
            "{project}/.sf/skills",
            Some("{project}/.sf/rules"),
        )];
        let req = request(
            "project",
            Some("p1"),
            intent(DistributionIntentMode::AddOrUpdate, &["x"]),
            intent(DistributionIntentMode::AddOrUpdate, &["r1", "r2", "r3"]),
        );

        let plan = build_distribution_plan_for_request(&repo, &fs, &plugins, &req)
            .expect("fake ports 驱动的 preview 应成功");

        assert!(
            !std::path::Path::new("/mem/project").exists(),
            "全程未触达真实磁盘"
        );
        let p = &plan.platforms[0];
        assert_eq!(p.rules_to_add, vec!["r2"], "缺失条目仍进 add");
        assert_eq!(
            p.rules_to_update,
            vec!["r3"],
            "摘要漂移的已部署规则进 update"
        );
        assert!(
            p.skills_to_add.is_empty() && p.skills_to_update.is_empty(),
            "库内摘要缺失时技能不参与 update 判定"
        );
        assert!(!plan.has_removals);
    }
}
