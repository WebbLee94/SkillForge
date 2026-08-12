//! Focused tests for `engine::dist_execute` — execution / side-effecting
//! writes / result collection / execute validations boundaries.
//!
//! TDD note (Phase 5 TASK-033 / TASK-037): these tests reference
//! `skillforge_lib::engine::dist_execute` and were written first (RED);
//! they only compile after `dist_execute` exists as a module owning the
//! moved execution functions.

use skillforge_lib::db::migrations;
use skillforge_lib::engine::dist_execute;
use skillforge_lib::plugins::platform::PlatformPlugin;
use skillforge_lib::types::{DistributionIntent, DistributionIntentMode, DistributionRequest};

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
        "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
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

#[test]
fn execute_removes_selected_managed_skill() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "managed-skill");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let source = conn
        .query_row(
            "SELECT local_path FROM skills WHERE id = 'managed-skill'",
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
