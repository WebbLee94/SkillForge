//! Focused tests for `engine::dist_managed` — managed-state / ownership
//! checks / RemoveSelected validations boundaries.
//!
//! TDD note (Phase 5 TASK-034 / TASK-037): these tests reference
//! `skillforge_lib::engine::dist_managed` and were written first (RED);
//! they only compile after `dist_managed` exists as a module owning the
//! moved managed-state functions.

use skillforge_lib::db::migrations;
use skillforge_lib::engine::dist_managed;
use skillforge_lib::plugins::platform::PlatformPlugin;

mod support;

fn init_db() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok();
    migrations::run_migrations(&mut conn).unwrap();
    conn
}

fn insert_skill(conn: &rusqlite::Connection, plugin: &support::TestPlatformPlugin, id: &str) {
    let skill = plugin.create_source_skill(id, id, "---\nname: test\n---\n");
    conn.execute(
        "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![skill.id, skill.name, skill.source_type, skill.installed_at, skill.local_path],
    )
    .unwrap();
}

fn insert_rule(conn: &rusqlite::Connection, id: &str, content: &str) {
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params![id, id, "md", content, chrono::Utc::now().to_rfc3339()],
    )
    .unwrap();
}

#[test]
fn managed_state_separates_managed_from_local_entries() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    insert_skill(&conn, &plugin, "managed-skill");
    insert_rule(&conn, "managed-rule", "managed content");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let source = conn
        .query_row(
            "SELECT local_path FROM skills WHERE id = 'managed-skill'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    std::os::unix::fs::symlink(source, plugin.skills_dir().join("managed-skill")).unwrap();
    std::fs::create_dir(plugin.skills_dir().join("unknown-skill")).unwrap();
    std::fs::create_dir_all(plugin.rules_dir()).unwrap();
    std::fs::write(
        plugin.rules_dir().join("managed-rule.md"),
        "managed content",
    )
    .unwrap();
    std::fs::write(plugin.rules_dir().join("local-rule.md"), "local content").unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let state = dist_managed::get_managed_distribution_state(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .unwrap();

    assert_eq!(
        state.platforms[0]
            .skills
            .iter()
            .map(|e| e.id.as_str())
            .collect::<Vec<_>>(),
        vec!["managed-skill"]
    );
    assert_eq!(
        state.platforms[0]
            .local_skills
            .iter()
            .map(|e| e.name.as_str())
            .collect::<Vec<_>>(),
        vec!["unknown-skill"]
    );
    assert_eq!(
        state.platforms[0]
            .rules
            .iter()
            .map(|e| e.id.as_str())
            .collect::<Vec<_>>(),
        vec!["managed-rule"]
    );
    assert_eq!(
        state.platforms[0]
            .local_rules
            .iter()
            .map(|e| e.name.as_str())
            .collect::<Vec<_>>(),
        vec!["local-rule.md"]
    );
}

#[test]
fn managed_state_skips_symlink_not_pointing_at_skill_source() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    // Create a skill in DB whose local_path is somewhere else, then create a
    // symlink in the platform dir that does NOT point at that source.
    let skill = plugin.create_source_skill("managed-skill", "Managed", "---\n---\n");
    conn.execute(
        "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            skill.id,
            skill.name,
            skill.source_type,
            skill.installed_at,
            "/some/other/source".to_string()
        ],
    )
    .unwrap();
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let wrong_target = plugin.skills_dir().join("sources").join("managed-skill");
    std::fs::create_dir_all(&wrong_target).unwrap();
    std::os::unix::fs::symlink(&wrong_target, plugin.skills_dir().join("managed-skill")).unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let state = dist_managed::get_managed_distribution_state(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .unwrap();

    // The entry is NOT owned (symlink target != skill.local_path), so it
    // must not appear as a managed skill.
    assert!(state.platforms[0].skills.is_empty());
}

#[test]
fn managed_state_rejects_global_with_project_id() {
    let conn = init_db();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];

    let result = dist_managed::get_managed_distribution_state(
        &conn,
        &plugins,
        &[],
        "global",
        Some("project-a"),
    );

    assert!(matches!(
        result,
        Err(skillforge_lib::error::AppError::DistributionInvalid(message))
            if message.contains("global")
    ));
}

#[test]
fn removeselected_rejects_non_skillforge_symlink_before_mutation() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "managed-skill");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    // A symlink targeting a foreign dir (≠ skill.local_path) is not owned.
    let foreign = plugin.skills_dir().join("foreign-target");
    std::fs::create_dir_all(&foreign).unwrap();
    std::os::unix::fs::symlink(&foreign, plugin.skills_dir().join("managed-skill")).unwrap();
    let symlink = plugin.skills_dir().join("managed-skill");
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = skillforge_lib::types::DistributionRequest {
        scene_id: None,
        platform_ids: vec!["test-plat".to_string()],
        scope: "global".to_string(),
        project_id: None,
        skills: skillforge_lib::types::DistributionIntent {
            mode: skillforge_lib::types::DistributionIntentMode::RemoveSelected,
            ids: vec!["managed-skill".to_string()],
        },
        rules: skillforge_lib::types::DistributionIntent {
            mode: skillforge_lib::types::DistributionIntentMode::Preserve,
            ids: vec![],
        },
    };
    let plan = skillforge_lib::engine::dist_plan::build_distribution_plan_for_request(
        &conn, &plugins, &request,
    )
    .unwrap();

    let result = skillforge_lib::engine::dist_execute::execute_distribution_request(
        &conn, &plugins, &request, &plan,
    );

    // Rejection with DistributionInvalid happens before any mutation.
    assert!(matches!(
        result,
        Err(skillforge_lib::error::AppError::DistributionInvalid(message))
            if message.contains("符号链接目标不是 SkillForge 来源")
    ));
    assert!(symlink.exists() || symlink.symlink_metadata().is_ok());
}
