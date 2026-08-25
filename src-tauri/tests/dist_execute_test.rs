//! Focused tests for `engine::dist_execute` — execution / side-effecting
//! writes / result collection / execute validations boundaries.
//!
//! TDD note (Phase 5 TASK-033 / TASK-037): these tests reference
//! `skillforge_lib::engine::dist_execute` and were written first (RED);
//! they only compile after `dist_execute` exists as a module owning the
//! moved execution functions.

use skillforge_lib::db::migrations;
use skillforge_lib::engine::dist_execute;
use skillforge_lib::error::AppError;
use skillforge_lib::plugins::platform::PlatformPlugin;
use skillforge_lib::types::{DistributionIntent, DistributionIntentMode, DistributionRequest};
#[cfg(unix)]
use skillforge_lib::types::{
    PlatformCapabilities, PlatformInstance, PlatformPaths, Skill, SkillPlatformStatus, SyncResult,
};

mod support;

fn init_db() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok();
    migrations::run_migrations(&mut conn).unwrap();
    conn
}

fn distribution_request(
    skills: DistributionIntent,
    rules: DistributionIntent,
) -> DistributionRequest {
    DistributionRequest {
        scene_id: None,
        platform_ids: vec!["test-plat".to_string()],
        scope: "global".to_string(),
        project_id: None,
        skills,
        rules,
    }
}

fn intent(mode: DistributionIntentMode, ids: &[&str]) -> DistributionIntent {
    DistributionIntent {
        mode,
        ids: ids.iter().map(|id| (*id).to_string()).collect(),
    }
}

fn insert_skill(conn: &rusqlite::Connection, plugin: &support::TestPlatformPlugin, id: &str) {
    let skill = plugin.create_source_skill(id, id, "---\nname: test\n---\n");
    conn.execute(
        "INSERT INTO resources (id, kind, name, source_type, installed_at, updated_at, local_path) VALUES (?1, 'skill', ?2, ?3, ?4, ?4, ?5)",
        rusqlite::params![skill.id, skill.name, skill.source_type, skill.installed_at, skill.local_path],
    )
    .unwrap();
}

#[test]
fn execute_installs_skill_and_collects_result() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "skill-a");
    let skills_dir = plugin.skills_dir();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &["skill-a"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );
    let plan = skillforge_lib::engine::dist_plan::build_distribution_plan_for_request(
        &conn, &plugins, &request,
    )
    .unwrap();

    let result =
        dist_execute::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    assert_eq!(result.installed, vec!["skill-a"]);
    assert!(result.updated.is_empty());
    assert!(result.errors.is_empty());
    assert!(skills_dir.join("skill-a").exists());
}

#[test]
fn execute_rejects_stale_plan() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "skill-a");
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &["skill-a"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );
    // Build a plan, then change disk state so the plan is stale.
    let plan = skillforge_lib::engine::dist_plan::build_distribution_plan_for_request(
        &conn, &plugins, &request,
    )
    .unwrap();
    std::fs::create_dir_all(plugins[0].detect().unwrap().remove(0).path).unwrap();
    std::fs::create_dir(
        std::path::Path::new(&plugins[0].detect().unwrap().remove(0).path).join("skill-a"),
    )
    .unwrap();

    let result = dist_execute::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(matches!(
        result,
        Err(skillforge_lib::error::AppError::DistributionInvalid(_))
    ));
}

#[cfg(unix)]
#[test]
fn execute_removes_selected_managed_skill() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "managed-skill");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let source = conn
        .query_row(
            "SELECT local_path FROM resources WHERE id = 'managed-skill' AND kind = 'skill'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    std::os::unix::fs::symlink(&source, plugin.skills_dir().join("managed-skill")).unwrap();
    std::fs::create_dir(plugin.skills_dir().join("unknown-skill")).unwrap();
    let skills_dir = plugin.skills_dir();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::RemoveSelected, &["managed-skill"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );
    let plan = skillforge_lib::engine::dist_plan::build_distribution_plan_for_request(
        &conn, &plugins, &request,
    )
    .unwrap();

    let result =
        dist_execute::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    assert_eq!(result.removed, vec!["managed-skill"]);
    assert!(!skills_dir.join("managed-skill").exists());
    assert!(skills_dir.join("unknown-skill").exists());
}

#[test]
fn sync_scene_legacy_additive_install_keeps_working() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "skill-a");
    let skills_dir = plugin.skills_dir();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_execute::sync_scene(
        &conn,
        &plugins,
        &["skill-a".to_string()],
        &[],
        None,
        Some(&["test-plat".to_string()]),
        "global",
        None,
    )
    .unwrap();

    assert_eq!(result.installed, vec!["skill-a"]);
    assert!(skills_dir.join("skill-a").exists());
}

#[test]
fn sync_scene_scene_id_is_ignored_and_additive_behavior_retained() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "requested-skill");
    insert_skill(&conn, &plugin, "scene-skill");
    let skills_dir = plugin.skills_dir();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    // scene_id must NOT resolve/filter skills from the scene: only the
    // explicit skill_ids drive the additive install.
    let result = dist_execute::sync_scene(
        &conn,
        &plugins,
        &["requested-skill".to_string()],
        &[],
        Some("nonexistent-scene"),
        Some(&["test-plat".to_string()]),
        "global",
        None,
    )
    .unwrap();

    assert_eq!(result.installed, vec!["requested-skill"]);
    assert!(skills_dir.join("requested-skill").exists());
    assert!(!skills_dir.join("scene-skill").exists());
}

// ── skipped counting (v1.0.0 result bucket) ───────────────────────────

fn insert_rule(conn: &rusqlite::Connection, id: &str, content: &str, format: &str) {
    conn.execute(
        "INSERT INTO resources (id, kind, name, source_type, format, content, version, updated_at, installed_at) VALUES (?1, 'rule', ?2, 'manual', ?3, ?4, 1, ?5, ?5)",
        rusqlite::params![id, id, format, content, chrono::Utc::now().to_rfc3339()],
    )
    .unwrap();
}

/// Pre-deploy a skill symlink so it is already in sync (mirrors
/// `execute_removes_selected_managed_skill`).
#[cfg(unix)]
fn presync_skill(conn: &rusqlite::Connection, plugin: &support::TestPlatformPlugin, id: &str) {
    let source: String = conn
        .query_row(
            "SELECT local_path FROM resources WHERE id = ?1 AND kind = 'skill'",
            [id],
            |row| row.get(0),
        )
        .unwrap();
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    std::os::unix::fs::symlink(&source, plugin.skills_dir().join(id)).unwrap();
}

#[cfg(unix)]
#[test]
fn execute_distribution_counts_skipped_for_skill_already_in_sync() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "skill-a");
    presync_skill(&conn, &plugin, "skill-a");
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &["skill-a"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );
    let plan = skillforge_lib::engine::dist_plan::build_distribution_plan_for_request(
        &conn, &plugins, &request,
    )
    .unwrap();

    let result =
        dist_execute::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    assert!(result.installed.is_empty());
    assert!(result.updated.is_empty());
    assert_eq!(result.skipped, 1);
    assert!(result.errors.is_empty());
}

#[test]
fn execute_distribution_counts_zero_skipped_for_fresh_install() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "skill-a");
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &["skill-a"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );
    let plan = skillforge_lib::engine::dist_plan::build_distribution_plan_for_request(
        &conn, &plugins, &request,
    )
    .unwrap();

    let result =
        dist_execute::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    assert_eq!(result.installed, vec!["skill-a"]);
    assert_eq!(result.skipped, 0);
    assert!(result.errors.is_empty());
}

#[test]
fn execute_distribution_counts_skipped_for_rule_already_in_sync() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    insert_rule(&conn, "rule-1", "content-1", "md");
    std::fs::create_dir_all(plugin.rules_dir()).unwrap();
    std::fs::write(plugin.rules_dir().join("rule-1.md"), "content-1").unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::AddOrUpdate, &["rule-1"]),
    );
    let plan = skillforge_lib::engine::dist_plan::build_distribution_plan_for_request(
        &conn, &plugins, &request,
    )
    .unwrap();

    let result =
        dist_execute::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    assert!(result.installed.is_empty());
    assert!(result.updated.is_empty());
    assert_eq!(result.skipped, 1);
    assert!(result.errors.is_empty());
}

#[test]
fn execute_distribution_counts_skipped_for_single_file_rule_already_in_sync() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "rule-1", "content-1\n", "md");
    std::fs::create_dir_all(plugin.rules_file().parent().unwrap()).unwrap();
    std::fs::write(
        plugin.rules_file(),
        "<!-- SKILLFORGE:rule:rule-1 -->\ncontent-1\n<!-- /SKILLFORGE:rule:rule-1 -->\n",
    )
    .unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::AddOrUpdate, &["rule-1"]),
    );
    let plan = skillforge_lib::engine::dist_plan::build_distribution_plan_for_request(
        &conn, &plugins, &request,
    )
    .unwrap();

    let result =
        dist_execute::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    assert!(result.updated.is_empty());
    assert_eq!(result.skipped, 1);
    assert!(result.errors.is_empty());
}

#[cfg(unix)]
#[test]
fn execute_distribution_counts_skipped_across_skills_and_rules() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    insert_skill(&conn, &plugin, "skill-a");
    presync_skill(&conn, &plugin, "skill-a");
    insert_rule(&conn, "rule-1", "content-1", "md");
    std::fs::create_dir_all(plugin.rules_dir()).unwrap();
    std::fs::write(plugin.rules_dir().join("rule-1.md"), "content-1").unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &["skill-a"]),
        intent(DistributionIntentMode::AddOrUpdate, &["rule-1"]),
    );
    let plan = skillforge_lib::engine::dist_plan::build_distribution_plan_for_request(
        &conn, &plugins, &request,
    )
    .unwrap();

    let result =
        dist_execute::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    assert_eq!(result.skipped, 2);
    assert!(result.errors.is_empty());
}

#[cfg(unix)]
#[test]
fn sync_scene_counts_skipped_for_skill_already_on_disk() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "skill-a");
    insert_skill(&conn, &plugin, "skill-b");
    presync_skill(&conn, &plugin, "skill-a");
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_execute::sync_scene(
        &conn,
        &plugins,
        &["skill-a".to_string(), "skill-b".to_string()],
        &[],
        None,
        Some(&["test-plat".to_string()]),
        "global",
        None,
    )
    .unwrap();

    assert_eq!(result.installed, vec!["skill-b"]);
    assert_eq!(result.skipped, 1);
    assert!(result.errors.is_empty());
}

#[test]
fn sync_scene_counts_skipped_for_rule_already_in_sync() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    insert_rule(&conn, "rule-1", "content-1", "md");
    std::fs::create_dir_all(plugin.rules_dir()).unwrap();
    std::fs::write(plugin.rules_dir().join("rule-1.md"), "content-1").unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_execute::sync_scene(
        &conn,
        &plugins,
        &[],
        &["rule-1".to_string()],
        None,
        Some(&["test-plat".to_string()]),
        "global",
        None,
    )
    .unwrap();

    assert!(result.installed.is_empty());
    assert!(result.updated.is_empty());
    assert_eq!(result.skipped, 1);
    assert!(result.errors.is_empty());
}

// ── remove_distributed 执行契约（33 号 3.3 / DEC-1，A6）─────────────

/// 确定性失败注入：委托 TestPlatformPlugin 全部方法，仅 remove 恒返 Err。
#[cfg(unix)]
struct FailingRemovePlugin {
    inner: support::TestPlatformPlugin,
}
#[cfg(unix)]
impl PlatformPlugin for FailingRemovePlugin {
    fn platform_name(&self) -> &'static str {
        self.inner.platform_name()
    }
    fn display_name(&self) -> &'static str {
        self.inner.display_name()
    }
    fn detect(&self) -> Result<Vec<PlatformInstance>, AppError> {
        self.inner.detect()
    }
    fn install(&self, skill: &Skill, instance: &PlatformInstance) -> Result<(), AppError> {
        self.inner.install(skill, instance)
    }
    fn sync(&self, skill: &Skill, instance: &PlatformInstance) -> Result<SyncResult, AppError> {
        self.inner.sync(skill, instance)
    }
    fn remove(&self, _skill_id: &str, _instance: &PlatformInstance) -> Result<(), AppError> {
        Err(AppError::Io("注入的移除失败".to_string()))
    }
    fn status(
        &self,
        skill_id: &str,
        instance: &PlatformInstance,
    ) -> Result<SkillPlatformStatus, AppError> {
        self.inner.status(skill_id, instance)
    }
    fn default_paths(&self) -> PlatformPaths {
        self.inner.default_paths()
    }
    fn capabilities(&self) -> PlatformCapabilities {
        self.inner.capabilities()
    }
}

// 契约 6：部分失败收集 —— 平台 A 移除成功、平台 B 注入失败，单项失败不中止其他项
#[test]
fn remove_distributed_collects_partial_failures() {
    let conn = init_db();
    let good = support::TestPlatformPlugin::new("plat-a", "Platform A");
    let bad_inner = support::TestPlatformPlugin::new("plat-b", "Platform B");
    insert_skill(&conn, &good, "s-a");
    insert_skill(&conn, &bad_inner, "s-b");
    // 捕获路径句柄后再装箱（TestPlatformPlugin 非 Clone，装箱后无法再借用）
    let good_skills_dir = good.skills_dir();
    let bad_skills_dir = bad_inner.skills_dir();
    std::fs::create_dir_all(&good_skills_dir).unwrap();
    std::fs::create_dir_all(&bad_skills_dir).unwrap();
    let src_a: String = conn
        .query_row(
            "SELECT local_path FROM resources WHERE id='s-a' AND kind='skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let src_b: String = conn
        .query_row(
            "SELECT local_path FROM resources WHERE id='s-b' AND kind='skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    std::os::unix::fs::symlink(&src_a, good_skills_dir.join("s-a")).unwrap();
    std::os::unix::fs::symlink(&src_b, bad_skills_dir.join("s-b")).unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![
        Box::new(good),
        Box::new(FailingRemovePlugin { inner: bad_inner }),
    ];

    let result = dist_execute::execute_remove_distributed(
        &conn,
        &plugins,
        &["plat-a".to_string(), "plat-b".to_string()],
        "global",
        None,
        &["s-a".to_string(), "s-b".to_string()],
        &[],
    )
    .expect("部分失败仍应返回 Ok(SyncResult)");
    assert_eq!(result.removed, vec!["s-a".to_string()]);
    assert_eq!(result.errors.len(), 1);
    assert!(result.errors[0].contains("s-b"));
    // 平台 A 的 symlink 已删除；平台 B 的 symlink 未被删除（失败项保留，供重试）
    assert!(good_skills_dir.join("s-a").symlink_metadata().is_err());
    assert!(bad_skills_dir.join("s-b").symlink_metadata().is_ok());
}

// ── 走查修复 F3：同平台规则部分失败时保留实际成功的移除 ─────────────

/// 尝试让单个文件的 unlink 确定性失败（macOS: uchg 不可变标志；Windows: 只读属性）。
/// 返回是否成功注入失败（Linux 无法对单个 unlink 注入失败，返回 false）。
fn block_file_unlink(path: &std::path::Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("chflags")
            .arg("uchg")
            .arg(path)
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(target_os = "windows")]
    {
        let mut permissions = std::fs::metadata(path)
            .expect("rule file metadata")
            .permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(path, permissions).is_ok()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = path;
        false
    }
}

// 走查 F3：规则 rule-a 实际移除后，rule-b 的 unlink 失败 → removed 仍须保留 rule:rule-a
#[test]
fn remove_distributed_preserves_successful_rule_removals_when_later_rule_fails() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    insert_rule(&conn, "rule-a", "content-a", "md");
    insert_rule(&conn, "rule-b", "content-b", "md");
    let rules_dir = plugin.rules_dir();
    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(rules_dir.join("rule-a.md"), "content-a").unwrap();
    let b_path = rules_dir.join("rule-b.md");
    std::fs::write(&b_path, "content-b").unwrap();
    // 后置规则（rule-b）的 unlink 被注入失败；前置规则（rule-a）在失败前已实际移除
    let blocked = block_file_unlink(&b_path);
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_execute::execute_remove_distributed(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
        &[],
        &["rule-a".to_string(), "rule-b".to_string()],
    )
    .expect("部分失败仍应返回 Ok(SyncResult)");

    if blocked {
        // 实际成功的移除必须保留在 removed；失败项进入 errors，文件保留供重试
        assert_eq!(result.removed, vec!["rule:rule-a".to_string()]);
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].starts_with("test-plat:"));
        assert!(!rules_dir.join("rule-a.md").exists());
        assert!(b_path.exists());
        // 清理不可变标志，保证 tempdir 可回收
        let _ = std::process::Command::new("chflags")
            .arg("nouchg")
            .arg(&b_path)
            .status();
    } else {
        // Linux 等无法注入单文件 unlink 失败的平台：退化为全成功路径
        assert_eq!(
            result.removed,
            vec!["rule:rule-a".to_string(), "rule:rule-b".to_string()]
        );
        assert!(result.errors.is_empty());
    }
}
