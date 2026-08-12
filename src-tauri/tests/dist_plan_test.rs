//! Focused tests for `engine::dist_plan` — plan generation / preview
//! boundaries. These prove the plan module owns preview/DistributionPlan
//! calculation and stays read-only (no directory creation).
//!
//! TDD note (Phase 5 TASK-032 / TASK-037): these tests reference
//! `skillforge_lib::engine::dist_plan` and were written first (RED); they
//! only compile after `dist_plan` exists as a module owning the moved
//! plan-calculation functions.

use skillforge_lib::db::migrations;
use skillforge_lib::engine::dist_plan;
use skillforge_lib::engine::scene_engine;
use skillforge_lib::plugins::platform::PlatformPlugin;
use skillforge_lib::types::{
    CreateSceneDTO, DistributionIntent, DistributionIntentMode, DistributionRequest,
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
        "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![skill.id, skill.name, skill.source_type, skill.installed_at, skill.local_path],
    )
    .unwrap();
}

#[test]
fn plan_calculates_add_for_missing_skill() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &["skill-a"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );

    let plan = dist_plan::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    assert_eq!(plan.platforms[0].skills_to_add, vec!["skill-a"]);
    assert!(plan.platforms[0].skills_to_remove.is_empty());
    assert!(!plan.has_removals);
}

#[test]
fn plan_calculates_remove_for_existing_skill() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    std::fs::create_dir(plugin.skills_dir().join("skill-existing")).unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::RemoveSelected, &["skill-existing"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );

    let plan = dist_plan::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    assert_eq!(plan.platforms[0].skills_to_remove, vec!["skill-existing"]);
    assert!(plan.has_removals);
}

#[test]
fn plan_generation_does_not_create_target_directories() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    // Deliberately do NOT create the skills dir — plan must be read-only.
    let skills_dir = plugin.skills_dir();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &["skill-a"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );

    let plan = dist_plan::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    assert_eq!(plan.platforms[0].skills_to_add, vec!["skill-a"]);
    assert!(!skills_dir.exists(), "plan generation must not create dirs");
}

#[test]
fn pure_diff_function_classifies_intents() {
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &["skill-a", "skill-b"]),
        intent(DistributionIntentMode::RemoveSelected, &["rule-existing"]),
    );

    let plan = dist_plan::calculate_distribution_plan(
        "test-plat",
        "Test Platform",
        &["skill-b".to_string()],
        &["rule-existing".to_string()],
        &request,
    )
    .unwrap();

    assert_eq!(plan.skills_to_add, vec!["skill-a"]);
    assert_eq!(plan.skills_to_remove, Vec::<String>::new());
    assert_eq!(plan.rules_to_add, Vec::<String>::new());
    assert_eq!(plan.rules_to_remove, vec!["rule-existing"]);
}

#[test]
fn read_current_skills_on_disk_returns_dirs_only() {
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    std::fs::create_dir(plugin.skills_dir().join("skill-one")).unwrap();
    std::fs::write(plugin.skills_dir().join("readme.md"), "not a skill dir").unwrap();
    std::fs::create_dir(plugin.skills_dir().join(".hidden")).unwrap();
    let instance = plugin.detect().unwrap().remove(0);

    let current = dist_plan::read_current_skills_on_disk(&instance);

    assert_eq!(current, vec!["skill-one".to_string()]);
}

#[test]
fn resolve_scene_skills_returns_enabled_scene_skills() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "skill-a");
    insert_skill(&conn, &plugin, "skill-b");
    let dto = CreateSceneDTO {
        name: "Scene".to_string(),
        description: None,
        icon: None,
        skill_ids: Some(vec!["skill-a".to_string()]),
        rule_ids: None,
    };
    let scene = scene_engine::create_scene(&conn, &dto).unwrap();

    let resolved = dist_plan::resolve_scene_skills(&conn, &scene.id).unwrap();

    assert_eq!(resolved, vec!["skill-a".to_string()]);
}
