use skillforge_lib::db::migrations;
use skillforge_lib::engine::dist_engine;
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

#[test]
fn test_resolve_scene_skills_empty_scene() {
    let conn = init_db();

    let dto = CreateSceneDTO {
        name: "Empty Scene".to_string(),
        description: None,
        icon: None,
        skill_ids: None,
        rule_ids: None,
    };
    let scene = skillforge_lib::engine::scene_engine::create_scene(&conn, &dto).unwrap();

    let resolved = dist_engine::resolve_scene_skills(&conn, &scene.id)
        .expect("resolve_scene_skills should succeed for empty scene");
    assert!(resolved.is_empty(), "empty scene should resolve no skills");
}

#[test]
fn test_get_sync_status_initial_state() {
    let conn = init_db();

    let status = dist_engine::get_sync_status(&conn).expect("get_sync_status should succeed");
    assert!(
        !status.platforms.is_empty(),
        "sync status should have platforms"
    );
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

fn intent(mode: DistributionIntentMode, ids: &[&str]) -> DistributionIntent {
    DistributionIntent {
        mode,
        ids: ids.iter().map(|id| (*id).to_string()).collect(),
    }
}

#[test]
fn plan_rules_only_preserves_existing_skills() {
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::AddOrUpdate, &["rule-a"]),
    );

    let plan = dist_engine::calculate_distribution_plan(
        "test-plat",
        "Test Platform",
        &["skill-existing".to_string()],
        &["rule-existing".to_string()],
        &request,
    )
    .unwrap();

    assert!(plan.skills_to_add.is_empty());
    assert!(plan.skills_to_update.is_empty());
    assert!(plan.skills_to_remove.is_empty());
    assert_eq!(plan.rules_to_add, vec!["rule-a"]);
    assert!(plan.rules_to_remove.is_empty());
}

#[test]
fn plan_skills_only_preserves_existing_rules() {
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &["skill-a"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );

    let plan = dist_engine::calculate_distribution_plan(
        "test-plat",
        "Test Platform",
        &["skill-existing".to_string()],
        &["rule-existing".to_string()],
        &request,
    )
    .unwrap();

    assert_eq!(plan.skills_to_add, vec!["skill-a"]);
    assert!(plan.skills_to_remove.is_empty());
    assert!(plan.rules_to_add.is_empty());
    assert!(plan.rules_to_update.is_empty());
    assert!(plan.rules_to_remove.is_empty());
}

#[test]
fn request_planner_reports_selected_removals_from_current_disk_state() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    std::fs::create_dir_all(plugin.skills_dir().join("skill-existing")).unwrap();
    let plugins: Vec<Box<dyn skillforge_lib::plugins::platform::PlatformPlugin>> =
        vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::RemoveSelected, &["skill-existing"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );

    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    assert_eq!(plan.platforms[0].skills_to_remove, vec!["skill-existing"]);
    assert!(plan.has_removals);
}

#[test]
fn empty_add_or_update_does_not_remove_existing_content() {
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &[]),
        intent(DistributionIntentMode::AddOrUpdate, &[]),
    );

    let plan = dist_engine::calculate_distribution_plan(
        "test-plat",
        "Test Platform",
        &["skill-existing".to_string()],
        &["rule-existing".to_string()],
        &request,
    )
    .unwrap();

    assert!(plan.skills_to_add.is_empty());
    assert!(plan.skills_to_remove.is_empty());
    assert!(plan.rules_to_add.is_empty());
    assert!(plan.rules_to_remove.is_empty());
    assert!(plan.skills_to_remove.is_empty());
    assert!(plan.rules_to_remove.is_empty());
}

#[test]
fn preserve_intent_is_a_noop_without_file_writes() {
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::Preserve, &[]),
    );

    let plan = dist_engine::calculate_distribution_plan(
        "test-plat",
        "Test Platform",
        &["skill-existing".to_string()],
        &["rule-existing".to_string()],
        &request,
    )
    .unwrap();

    assert!(plan.skills_to_add.is_empty());
    assert!(plan.skills_to_update.is_empty());
    assert!(plan.skills_to_remove.is_empty());
    assert!(plan.rules_to_add.is_empty());
    assert!(plan.rules_to_update.is_empty());
    assert!(plan.rules_to_remove.is_empty());
}

#[test]
fn distribution_intent_serializes_modes_as_snake_case() {
    let value =
        serde_json::to_value(intent(DistributionIntentMode::RemoveSelected, &["skill-a"])).unwrap();

    assert_eq!(value["mode"], "remove_selected");
    assert_eq!(value["ids"], serde_json::json!(["skill-a"]));
}

#[test]
fn distribution_request_rejects_preserve_ids() {
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &["skill-a"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );

    assert!(matches!(
        request.validate(),
        Err(skillforge_lib::error::AppError::DistributionInvalid(message))
            if message.contains("preserve")
    ));
}

#[test]
fn distribution_request_rejects_invalid_scope_combinations() {
    let mut request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::Preserve, &[]),
    );
    request.scope = "workspace".to_string();
    assert!(request.validate().is_err());

    request.scope = "project".to_string();
    assert!(request.validate().is_err());

    request.scope = "global".to_string();
    request.project_id = Some("project-a".to_string());
    assert!(request.validate().is_err());
}

#[test]
fn remove_selected_removes_managed_skill_and_preserves_unknown_directory() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "managed-skill");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let managed_source = conn
        .query_row(
            "SELECT local_path FROM skills WHERE id = 'managed-skill'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    std::os::unix::fs::symlink(&managed_source, plugin.skills_dir().join("managed-skill")).unwrap();
    std::fs::create_dir(plugin.skills_dir().join("unknown-skill")).unwrap();
    let skills_dir = plugin.skills_dir();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::RemoveSelected, &["managed-skill"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    assert!(!skills_dir.join("managed-skill").exists());
    assert!(skills_dir.join("unknown-skill").exists());
}

#[test]
fn remove_selected_skill_and_invalid_single_file_rule_fail_before_any_mutation() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_skill(&conn, &plugin, "managed-skill");
    insert_rule(&conn, "managed-rule", "managed content");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let managed_source = conn
        .query_row(
            "SELECT local_path FROM skills WHERE id = 'managed-skill'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    std::os::unix::fs::symlink(&managed_source, plugin.skills_dir().join("managed-skill")).unwrap();
    let original = "<!-- SKILLFORGE:rule:managed-rule -->\nmanaged content<!-- /SKILLFORGE:rule:managed-rule -->\n<!-- SKILLFORGE:rule:unknown-rule -->\nunknown content<!-- /SKILLFORGE:rule:unknown-rule -->\n";
    std::fs::write(plugin.rules_file(), original).unwrap();
    let skills_dir = plugin.skills_dir();
    let rules_file = plugin.rules_file();
    let before_modified = std::fs::metadata(&rules_file).unwrap().modified().unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::RemoveSelected, &["managed-skill"]),
        intent(DistributionIntentMode::RemoveSelected, &["managed-rule"]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert!(skills_dir.join("managed-skill").exists());
    assert_eq!(std::fs::read_to_string(&rules_file).unwrap(), original);
    assert_eq!(
        std::fs::metadata(&rules_file).unwrap().modified().unwrap(),
        before_modified
    );
}

#[test]
fn remove_selected_skill_with_invalid_non_utf8_single_file_fails_before_skill_mutation() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_skill(&conn, &plugin, "managed-skill");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let managed_source = conn
        .query_row(
            "SELECT local_path FROM skills WHERE id = 'managed-skill'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    std::os::unix::fs::symlink(&managed_source, plugin.skills_dir().join("managed-skill")).unwrap();
    let skills_dir = plugin.skills_dir();
    let rules_file = plugin.rules_file();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::RemoveSelected, &["managed-skill"]),
        intent(DistributionIntentMode::RemoveSelected, &[]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();
    let original = vec![b'u', b's', b'e', b'r', b' ', 0xff, b'\n'];
    std::fs::write(&rules_file, &original).unwrap();

    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert!(skills_dir.join("managed-skill").exists());
    assert_eq!(std::fs::read(&rules_file).unwrap(), original);
}

#[test]
fn add_or_update_skill_with_invalid_single_file_marker_fails_before_skill_mutation() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_skill(&conn, &plugin, "new-skill");
    let skills_dir = plugin.skills_dir();
    let rules_file = plugin.rules_file();
    let original = "<!-- SKILLFORGE:rule:unknown-rule -->\nunknown content<!-- /SKILLFORGE:rule:unknown-rule -->\n";
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &["new-skill"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();
    std::fs::write(&rules_file, original).unwrap();

    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert!(!skills_dir.join("new-skill").exists());
    assert_eq!(std::fs::read_to_string(&rules_file).unwrap(), original);
}

#[test]
fn remove_selected_rule_requires_managed_directory_file() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    insert_rule(&conn, "managed-rule", "managed content");
    std::fs::create_dir_all(plugin.rules_dir()).unwrap();
    std::fs::write(
        plugin.rules_dir().join("managed-rule.md"),
        "managed content",
    )
    .unwrap();
    std::fs::write(plugin.rules_dir().join("unknown-rule.md"), "user content").unwrap();
    let rules_dir = plugin.rules_dir();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::RemoveSelected, &["managed-rule"]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    assert!(!rules_dir.join("managed-rule.md").exists());
    assert!(rules_dir.join("unknown-rule.md").exists());
}

#[test]
fn opencode_agents_file_preserves_user_content_and_other_managed_blocks() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "remove-me", "managed remove");
    insert_rule(&conn, "keep-me", "managed keep");
    std::fs::write(
        plugin.rules_file(),
        "user instructions\n<!-- SKILLFORGE:rule:remove-me -->\nmanaged remove<!-- /SKILLFORGE:rule:remove-me -->\n<!-- SKILLFORGE:rule:keep-me -->\nmanaged keep<!-- /SKILLFORGE:rule:keep-me -->\n",
    )
    .unwrap();
    let rules_file = plugin.rules_file();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::RemoveSelected, &["remove-me"]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    let content = std::fs::read_to_string(rules_file).unwrap();
    assert!(content.contains("user instructions"));
    assert!(!content.contains("remove-me"));
    assert!(content.contains("keep-me"));
    assert!(
        content.contains("managed keep"),
        "unexpected AGENTS.md: {content}"
    );
}

#[test]
fn malformed_single_file_marker_rejects_removal_without_writing() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "remove-me", "managed remove");
    let original = "user instructions\n<!-- SKILLFORGE:rule:remove-me -->\nunterminated\n";
    std::fs::write(plugin.rules_file(), original).unwrap();
    let rules_file = plugin.rules_file();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::RemoveSelected, &["remove-me"]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();
    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert_eq!(std::fs::read_to_string(rules_file).unwrap(), original);
}

#[test]
fn managed_state_query_separates_local_entries_from_removable_entries() {
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
    std::fs::write(plugin.rules_dir().join("modified-rule.md"), "user content").unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let state = dist_engine::get_managed_distribution_state(
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
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec!["managed-skill"]
    );
    assert_eq!(
        state.platforms[0]
            .rules
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec!["managed-rule"]
    );
    assert_eq!(
        state.platforms[0]
            .local_skills
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>(),
        vec!["unknown-skill"]
    );
    assert_eq!(
        state.platforms[0]
            .local_rules
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>(),
        vec!["modified-rule.md"]
    );
}

#[test]
fn removal_request_for_unknown_skill_or_rule_fails_without_writes() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    std::fs::create_dir_all(plugin.rules_dir()).unwrap();
    std::fs::create_dir(plugin.skills_dir().join("unknown-skill")).unwrap();
    std::fs::write(plugin.rules_dir().join("unknown-rule.md"), "user content").unwrap();
    let skills_dir = plugin.skills_dir();
    let rules_dir = plugin.rules_dir();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::RemoveSelected, &["unknown-skill"]),
        intent(DistributionIntentMode::RemoveSelected, &["unknown-rule"]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();
    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert!(skills_dir.join("unknown-skill").exists());
    assert_eq!(
        std::fs::read_to_string(rules_dir.join("unknown-rule.md")).unwrap(),
        "user content"
    );
}

#[test]
fn managed_state_rejects_global_project_id() {
    let conn = init_db();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];

    let result = dist_engine::get_managed_distribution_state(
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
fn single_file_state_excludes_unknown_and_modified_marker_blocks() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "valid-rule", "valid content");
    insert_rule(&conn, "modified-rule", "database content");
    std::fs::write(
        plugin.rules_file(),
        "user\n<!-- SKILLFORGE:rule:valid-rule -->\nvalid content<!-- /SKILLFORGE:rule:valid-rule -->\n<!-- SKILLFORGE:rule:modified-rule -->\nuser edit<!-- /SKILLFORGE:rule:modified-rule -->\n<!-- SKILLFORGE:rule:unknown-rule -->\nunknown<!-- /SKILLFORGE:rule:unknown-rule -->\n",
    )
    .unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let state = dist_engine::get_managed_distribution_state(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .unwrap();

    assert_eq!(
        state.platforms[0]
            .rules
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec!["valid-rule"]
    );
}

#[test]
fn removal_of_modified_single_file_rule_fails_without_writing() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "modified-rule", "database content");
    let original = "user\n<!-- SKILLFORGE:rule:modified-rule -->\nuser edit\n<!-- /SKILLFORGE:rule:modified-rule -->\n";
    std::fs::write(plugin.rules_file(), original).unwrap();
    let rules_file = plugin.rules_file();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::RemoveSelected, &["modified-rule"]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert_eq!(std::fs::read_to_string(rules_file).unwrap(), original);
}

#[test]
fn duplicate_single_file_rule_with_modified_block_fails_without_partial_removal() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "duplicate-rule", "managed content");
    let original = r#"<!-- SKILLFORGE:rule:duplicate-rule -->
managed content<!-- /SKILLFORGE:rule:duplicate-rule -->
<!-- SKILLFORGE:rule:duplicate-rule -->
modified content<!-- /SKILLFORGE:rule:duplicate-rule -->
"#;
    std::fs::write(plugin.rules_file(), original).unwrap();
    let rules_file = plugin.rules_file();
    let before_modified = std::fs::metadata(&rules_file).unwrap().modified().unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::RemoveSelected, &["duplicate-rule"]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert_eq!(std::fs::read_to_string(&rules_file).unwrap(), original);
    assert_eq!(
        std::fs::metadata(&rules_file).unwrap().modified().unwrap(),
        before_modified
    );
}

#[test]
fn duplicate_single_file_valid_and_unknown_rules_fail_without_partial_removal() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "known-rule", "known content");
    let original = r#"<!-- SKILLFORGE:rule:known-rule -->
known content<!-- /SKILLFORGE:rule:known-rule -->
<!-- SKILLFORGE:rule:unknown-rule -->
unknown content<!-- /SKILLFORGE:rule:unknown-rule -->
<!-- SKILLFORGE:rule:unknown-rule -->
unknown content again<!-- /SKILLFORGE:rule:unknown-rule -->
"#;
    std::fs::write(plugin.rules_file(), original).unwrap();
    let rules_file = plugin.rules_file();
    let before_modified = std::fs::metadata(&rules_file).unwrap().modified().unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(
            DistributionIntentMode::RemoveSelected,
            &["known-rule", "unknown-rule"],
        ),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert_eq!(std::fs::read_to_string(&rules_file).unwrap(), original);
    assert_eq!(
        std::fs::metadata(&rules_file).unwrap().modified().unwrap(),
        before_modified
    );
}

#[test]
fn remove_selected_duplicate_identical_single_file_blocks_fails_without_writing() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "duplicate-rule", "managed content");
    let original = "<!-- SKILLFORGE:rule:duplicate-rule -->\nmanaged content<!-- /SKILLFORGE:rule:duplicate-rule -->\n<!-- SKILLFORGE:rule:duplicate-rule -->\nmanaged content<!-- /SKILLFORGE:rule:duplicate-rule -->\n";
    std::fs::write(plugin.rules_file(), original).unwrap();
    let rules_file = plugin.rules_file();
    let before_modified = std::fs::metadata(&rules_file).unwrap().modified().unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::RemoveSelected, &["duplicate-rule"]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert_eq!(std::fs::read_to_string(&rules_file).unwrap(), original);
    assert_eq!(
        std::fs::metadata(&rules_file).unwrap().modified().unwrap(),
        before_modified
    );
}

#[test]
fn remove_selected_unrelated_modified_single_file_block_fails_without_writing() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "requested-rule", "requested content");
    insert_rule(&conn, "other-rule", "database content");
    let original = "<!-- SKILLFORGE:rule:requested-rule -->\nrequested content<!-- /SKILLFORGE:rule:requested-rule -->\n<!-- SKILLFORGE:rule:other-rule -->\nuser modified<!-- /SKILLFORGE:rule:other-rule -->\n";
    std::fs::write(plugin.rules_file(), original).unwrap();
    let rules_file = plugin.rules_file();
    let before_modified = std::fs::metadata(&rules_file).unwrap().modified().unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::RemoveSelected, &["requested-rule"]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert_eq!(std::fs::read_to_string(&rules_file).unwrap(), original);
    assert_eq!(
        std::fs::metadata(&rules_file).unwrap().modified().unwrap(),
        before_modified
    );
}

#[test]
fn remove_selected_unrelated_unknown_single_file_block_fails_without_writing() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "requested-rule", "requested content");
    let original = "<!-- SKILLFORGE:rule:requested-rule -->\nrequested content<!-- /SKILLFORGE:rule:requested-rule -->\n<!-- SKILLFORGE:rule:unknown-rule -->\nunknown content<!-- /SKILLFORGE:rule:unknown-rule -->\n";
    std::fs::write(plugin.rules_file(), original).unwrap();
    let rules_file = plugin.rules_file();
    let before_modified = std::fs::metadata(&rules_file).unwrap().modified().unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::RemoveSelected, &["requested-rule"]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert_eq!(std::fs::read_to_string(&rules_file).unwrap(), original);
    assert_eq!(
        std::fs::metadata(&rules_file).unwrap().modified().unwrap(),
        before_modified
    );
}

#[test]
fn remove_selected_is_noop_on_platform_without_entry() {
    let conn = init_db();
    let first =
        support::TestPlatformPlugin::with_rules("test-plat-a", "Test Platform A", false, "");
    let second =
        support::TestPlatformPlugin::with_rules("test-plat-b", "Test Platform B", false, "");
    insert_rule(&conn, "shared-rule", "shared content");
    std::fs::create_dir_all(first.rules_dir()).unwrap();
    std::fs::write(first.rules_dir().join("shared-rule.md"), "shared content").unwrap();
    let first_rules = first.rules_dir();
    let second_rules = second.rules_dir();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(first), Box::new(second)];
    let request = DistributionRequest {
        scene_id: None,
        platform_ids: vec!["test-plat-a".to_string(), "test-plat-b".to_string()],
        scope: "global".to_string(),
        project_id: None,
        skills: intent(DistributionIntentMode::Preserve, &[]),
        rules: intent(DistributionIntentMode::RemoveSelected, &["shared-rule"]),
    };
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    assert!(!first_rules.join("shared-rule.md").exists());
    assert!(!second_rules.join("shared-rule.md").exists());
}

#[test]
fn additive_single_file_sync_preserves_existing_bytes() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "new-rule", "new content");
    insert_rule(&conn, "retained", "legacy bytes\n");
    let original = "user line 1\n\nuser line 2\n<!-- SKILLFORGE:rule:retained -->\nlegacy bytes\n<!-- /SKILLFORGE:rule:retained -->\n";
    std::fs::write(plugin.rules_file(), original).unwrap();
    let rules_file = plugin.rules_file();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::AddOrUpdate, &["new-rule"]),
    );
    dist_engine::execute_distribution_request(
        &conn,
        &plugins,
        &request,
        &dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap(),
    )
    .unwrap();

    let updated = std::fs::read(rules_file).unwrap();
    let marker = b"<!-- SKILLFORGE:rule:new-rule -->";
    let marker_start = updated
        .windows(marker.len())
        .position(|window| window == marker)
        .unwrap();
    assert_eq!(&updated[..marker_start], original.as_bytes());
}

#[test]
fn structured_project_opencode_rule_distribution_preserves_user_content_and_records_audit_logs() {
    // Given: a project-scoped OpenCode AGENTS.md with user-authored content and global rules.
    let conn = init_db();
    let project_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().to_string_lossy().to_string();
    let plugin =
        support::TestPlatformPlugin::with_project_single_file_rules("opencode", "OpenCode");
    insert_rule(&conn, "library-rule-a", "# Library A\n");
    insert_rule(&conn, "library-rule-b", "# Library B\n");
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            "my-talk",
            "my-talk",
            project_path,
            chrono::Utc::now().to_rfc3339(),
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .unwrap();
    let agents_file = plugin.project_rules_file(&project_path);
    std::fs::create_dir_all(agents_file.parent().unwrap()).unwrap();
    std::fs::write(&agents_file, "# My Talk\n\nKeep this user content.\n").unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = DistributionRequest {
        scene_id: None,
        platform_ids: vec!["opencode".to_string()],
        scope: "project".to_string(),
        project_id: Some("my-talk".to_string()),
        skills: intent(DistributionIntentMode::AddOrUpdate, &[]),
        rules: intent(
            DistributionIntentMode::AddOrUpdate,
            &["library-rule-a", "library-rule-b"],
        ),
    };
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    // When: the structured request distributes the selected global Library rules.
    dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    // Then: user content and both managed rule blocks survive in AGENTS.md without logging rule content.
    let content = std::fs::read_to_string(&agents_file).unwrap();
    assert!(content.starts_with("# My Talk\n\nKeep this user content.\n"));
    for rule_id in ["library-rule-a", "library-rule-b"] {
        assert!(content.contains(&format!("<!-- SKILLFORGE:rule:{rule_id} -->")));
        assert!(content.contains(&format!("<!-- /SKILLFORGE:rule:{rule_id} -->")));
    }
    assert!(content.contains("# Library A\n"));
    assert!(content.contains("# Library B\n"));
    let logs: Vec<(String, String, String, Option<String>)> = conn
        .prepare(
            "SELECT action, target_id, status, message FROM sync_logs
             WHERE target_type = 'rule' ORDER BY target_id",
        )
        .unwrap()
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        logs,
        vec![
            (
                "add_or_update".to_string(),
                "library-rule-a".to_string(),
                "success".to_string(),
                None
            ),
            (
                "add_or_update".to_string(),
                "library-rule-b".to_string(),
                "success".to_string(),
                None
            ),
        ]
    );
}

#[test]
fn project_single_file_relative_pattern_writes_and_reads_registered_project_not_cwd() {
    // Given: OpenCode's project rule pattern is a relative AGENTS.md path.
    let conn = init_db();
    let project_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().to_string_lossy().to_string();
    let plugin = support::TestPlatformPlugin::with_project_single_file_rules_pattern(
        "opencode",
        "OpenCode",
        "AGENTS.md",
    );
    insert_rule(&conn, "library-rule", "# Library Rule\n");
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            "relative-pattern-project",
            "relative-pattern-project",
            project_path,
            chrono::Utc::now().to_rfc3339(),
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .unwrap();
    let request = DistributionRequest {
        scene_id: None,
        platform_ids: vec!["opencode".to_string()],
        scope: "project".to_string(),
        project_id: Some("relative-pattern-project".to_string()),
        skills: intent(DistributionIntentMode::Preserve, &[]),
        rules: intent(DistributionIntentMode::AddOrUpdate, &["library-rule"]),
    };
    let cwd_agents = std::env::current_dir().unwrap().join("AGENTS.md");
    let cwd_content_before = std::fs::read(&cwd_agents).ok();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    // When: the selected rule is distributed and then read through managed state.
    dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();
    let managed = dist_engine::get_managed_distribution_state(
        &conn,
        &plugins,
        &["opencode".to_string()],
        "project",
        Some("relative-pattern-project"),
    )
    .unwrap();

    // Then: only the registered project receives AGENTS.md; the process CWD stays unchanged.
    let project_agents = project_dir.path().join("AGENTS.md");
    assert!(project_agents.exists());
    assert!(std::fs::read_to_string(&project_agents)
        .unwrap()
        .contains("<!-- SKILLFORGE:rule:library-rule -->"));
    assert_eq!(
        managed.platforms[0].rules[0].path,
        project_agents.to_string_lossy()
    );
    assert_eq!(std::fs::read(&cwd_agents).ok(), cwd_content_before);
}

#[test]
fn project_rule_pattern_escaping_project_fails_closed_before_writes() {
    // Given: a project rule pattern attempts to escape the registered root.
    let conn = init_db();
    let project_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().to_string_lossy().to_string();
    let plugin = support::TestPlatformPlugin::with_project_single_file_rules_pattern(
        "opencode",
        "OpenCode",
        "../AGENTS.md",
    );
    insert_rule(&conn, "library-rule", "# Library Rule\n");
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            "escaping-pattern-project",
            "escaping-pattern-project",
            project_path,
            chrono::Utc::now().to_rfc3339(),
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .unwrap();
    let request = DistributionRequest {
        scene_id: None,
        platform_ids: vec!["opencode".to_string()],
        scope: "project".to_string(),
        project_id: Some("escaping-pattern-project".to_string()),
        skills: intent(DistributionIntentMode::Preserve, &[]),
        rules: intent(DistributionIntentMode::AddOrUpdate, &["library-rule"]),
    };
    let escaped_path = project_dir.path().parent().unwrap().join("AGENTS.md");
    let escaped_content_before = std::fs::read(&escaped_path).ok();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    // When: planning and execution validate the unsafe target.
    let plan_result = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request);

    // Then: validation fails before any target can be created or changed.
    assert!(plan_result.is_err());
    assert!(!project_dir.path().join("AGENTS.md").exists());
    assert_eq!(std::fs::read(&escaped_path).ok(), escaped_content_before);
}

#[test]
fn project_rule_relative_registered_root_fails_closed_before_planning() {
    // Given: the registered project root remains relative after home expansion.
    let conn = init_db();
    let relative_project = format!("relative-project-{}", std::process::id());
    let plugin = support::TestPlatformPlugin::with_project_single_file_rules_pattern(
        "opencode",
        "OpenCode",
        "AGENTS.md",
    );
    insert_rule(&conn, "library-rule", "# Library Rule\n");
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            "relative-root-project",
            "relative-root-project",
            relative_project,
            chrono::Utc::now().to_rfc3339(),
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .unwrap();
    let request = DistributionRequest {
        scene_id: None,
        platform_ids: vec!["opencode".to_string()],
        scope: "project".to_string(),
        project_id: Some("relative-root-project".to_string()),
        skills: intent(DistributionIntentMode::Preserve, &[]),
        rules: intent(DistributionIntentMode::AddOrUpdate, &["library-rule"]),
    };
    let cwd_target = std::env::current_dir()
        .unwrap()
        .join(&relative_project)
        .join("AGENTS.md");
    let cwd_target_before = std::fs::read(&cwd_target).ok();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    // When: planning resolves the project-scoped rule path.
    let plan_result = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request);

    // Then: the relative root is rejected and its CWD-relative target is unchanged.
    assert!(plan_result.is_err());
    assert_eq!(std::fs::read(&cwd_target).ok(), cwd_target_before);
}

#[cfg(unix)]
#[test]
fn project_rule_symlink_component_escaping_root_fails_closed_before_planning() {
    // Given: a path component inside the project is a symlink to an external temporary directory.
    let conn = init_db();
    let project_dir = tempfile::tempdir().unwrap();
    let outside_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().to_string_lossy().to_string();
    let linked_dir = project_dir.path().join("linked-rules");
    std::os::unix::fs::symlink(outside_dir.path(), &linked_dir).unwrap();
    let external_target = outside_dir.path().join("AGENTS.md");
    let external_content_before = std::fs::read(&external_target).ok();
    let plugin = support::TestPlatformPlugin::with_project_single_file_rules_pattern(
        "opencode",
        "OpenCode",
        "{project}/linked-rules/AGENTS.md",
    );
    insert_rule(&conn, "library-rule", "# Library Rule\n");
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            "symlink-root-project",
            "symlink-root-project",
            project_path,
            chrono::Utc::now().to_rfc3339(),
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .unwrap();
    let request = DistributionRequest {
        scene_id: None,
        platform_ids: vec!["opencode".to_string()],
        scope: "project".to_string(),
        project_id: Some("symlink-root-project".to_string()),
        skills: intent(DistributionIntentMode::Preserve, &[]),
        rules: intent(DistributionIntentMode::AddOrUpdate, &["library-rule"]),
    };
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    // When: planning resolves a target containing the symlinked directory.
    let plan_result = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request);

    // Then: the external target cannot be read, created, or changed.
    assert!(plan_result.is_err());
    assert_eq!(
        std::fs::read(&external_target).ok(),
        external_content_before
    );
}

#[test]
fn structured_project_opencode_preflight_rule_failure_records_content_free_audit_logs() {
    // Given: a malformed project-scoped OpenCode AGENTS.md and two requested Library rules.
    let conn = init_db();
    let project_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().to_string_lossy().to_string();
    let plugin =
        support::TestPlatformPlugin::with_project_single_file_rules("opencode", "OpenCode");
    insert_rule(&conn, "library-rule-a", "# secret library content A\n");
    insert_rule(&conn, "library-rule-b", "# secret library content B\n");
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            "my-talk",
            "my-talk",
            project_path,
            chrono::Utc::now().to_rfc3339(),
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .unwrap();
    let agents_file = plugin.project_rules_file(&project_path);
    let original = b"# User content\n<!-- SKILLFORGE:rule:orphan -->\nunterminated\n";
    std::fs::create_dir_all(agents_file.parent().unwrap()).unwrap();
    std::fs::write(&agents_file, original).unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = DistributionRequest {
        scene_id: None,
        platform_ids: vec!["opencode".to_string()],
        scope: "project".to_string(),
        project_id: Some("my-talk".to_string()),
        skills: intent(DistributionIntentMode::Preserve, &[]),
        rules: intent(
            DistributionIntentMode::AddOrUpdate,
            &["library-rule-a", "library-rule-b"],
        ),
    };
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    // When: structured rule distribution performs preflight validation.
    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    // Then: preflight fails without modifying the target and audits every requested rule without content.
    assert!(result.is_err());
    assert_eq!(std::fs::read(&agents_file).unwrap(), original);
    let logs: Vec<(String, String, String, String)> = conn
        .prepare(
            "SELECT action, target_id, status, message FROM sync_logs
             WHERE target_type = 'rule' ORDER BY target_id",
        )
        .unwrap()
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0].0, "add_or_update");
    assert_eq!(logs[0].1, "library-rule-a");
    assert_eq!(logs[0].2, "error");
    assert_eq!(logs[1].1, "library-rule-b");
    for (_, _, _, message) in logs {
        assert!(!message.contains("secret library content"));
    }
}

#[test]
fn structured_project_opencode_selected_noop_rules_record_success_audit_logs() {
    // Given: selected project rules are already represented by matching marker blocks.
    let conn = init_db();
    let project_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().to_string_lossy().to_string();
    let plugin =
        support::TestPlatformPlugin::with_project_single_file_rules("opencode", "OpenCode");
    insert_rule(&conn, "library-rule-a", "# Library A\n");
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            "my-talk",
            "my-talk",
            project_path,
            chrono::Utc::now().to_rfc3339(),
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .unwrap();
    let agents_file = plugin.project_rules_file(&project_path);
    std::fs::create_dir_all(agents_file.parent().unwrap()).unwrap();
    std::fs::write(
        &agents_file,
        "<!-- SKILLFORGE:rule:library-rule-a -->\n# Library A\n<!-- /SKILLFORGE:rule:library-rule-a -->\n",
    )
    .unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = DistributionRequest {
        scene_id: None,
        platform_ids: vec!["opencode".to_string()],
        scope: "project".to_string(),
        project_id: Some("my-talk".to_string()),
        skills: intent(DistributionIntentMode::Preserve, &[]),
        rules: intent(DistributionIntentMode::AddOrUpdate, &["library-rule-a"]),
    };
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    // When: the selected rule requires no file mutation.
    dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();

    // Then: the selection is still recorded as a content-free successful rule action.
    let log: (String, String, Option<String>) = conn
        .query_row(
            "SELECT action, status, message FROM sync_logs
             WHERE target_type = 'rule' AND target_id = 'library-rule-a'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        log,
        ("add_or_update".to_string(), "success".to_string(), None)
    );
}

#[test]
fn strict_switch_rejects_malformed_single_file_before_scene_update() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("UPDATE platforms SET enabled = 0", [])
        .unwrap();
    conn.execute(
        "INSERT INTO platforms (id, name, adapter, enabled) VALUES ('test-plat', 'Test Platform', 'test', 1)",
        [],
    )
    .unwrap();
    for scene_id in ["old-scene", "new-scene"] {
        conn.execute(
            "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
             VALUES (?1, ?2, 0, 0, ?3, ?4)",
            rusqlite::params![scene_id, scene_id, now, now],
        )
        .unwrap();
    }
    for (scene_id, rule_id) in [("old-scene", "old-rule"), ("new-scene", "new-rule")] {
        conn.execute(
            "INSERT INTO rules (id, name, format, content, version, updated_at)
             VALUES (?1, ?2, 'md', ?3, 1, ?4)",
            rusqlite::params![rule_id, rule_id, rule_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO scene_rules (scene_id, rule_id, enabled, sort_order)
             VALUES (?1, ?2, 1, 0)",
            rusqlite::params![scene_id, rule_id],
        )
        .unwrap();
    }
    conn.execute(
        "UPDATE app_config SET value = 'old-scene' WHERE key = 'global_scene_id'",
        [],
    )
    .unwrap();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    std::fs::write(
        plugin.rules_file(),
        "user\n<!-- SKILLFORGE:rule:old-rule -->\nunterminated\n",
    )
    .unwrap();
    let rules_file = plugin.rules_file();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_engine::switch_global_scene(&conn, &plugins, "new-scene");

    assert!(result.is_err());
    assert_eq!(
        std::fs::read_to_string(rules_file).unwrap(),
        "user\n<!-- SKILLFORGE:rule:old-rule -->\nunterminated\n"
    );
    let current_scene: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'global_scene_id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(current_scene.as_deref(), Some("old-scene"));
}

#[test]
fn strict_switch_directory_mismatch_rejects_before_skill_mutation() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("UPDATE platforms SET enabled = 0", [])
        .unwrap();
    conn.execute(
        "INSERT INTO platforms (id, name, adapter, enabled) VALUES ('test-plat', 'Test Platform', 'test', 1)",
        [],
    )
    .unwrap();
    for scene_id in ["old-scene", "new-scene"] {
        conn.execute(
            "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
             VALUES (?1, ?2, 0, 0, ?3, ?4)",
            rusqlite::params![scene_id, scene_id, now, now],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES ('old-rule', 'old-rule', 'md', 'database content', 1, ?1)",
        rusqlite::params![now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO scene_rules (scene_id, rule_id, enabled, sort_order)
         VALUES ('old-scene', 'old-rule', 1, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE app_config SET value = 'old-scene' WHERE key = 'global_scene_id'",
        [],
    )
    .unwrap();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    std::fs::create_dir_all(plugin.rules_dir()).unwrap();
    std::fs::write(plugin.rules_dir().join("old-rule.md"), "user edit").unwrap();
    let rules_file = plugin.rules_dir().join("old-rule.md");
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_engine::switch_global_scene(&conn, &plugins, "new-scene");

    assert!(result.is_err());
    assert_eq!(std::fs::read_to_string(rules_file).unwrap(), "user edit");
    let current_scene: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'global_scene_id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(current_scene.as_deref(), Some("old-scene"));
}

#[test]
fn strict_switch_single_file_unknown_marker_rejects_before_scene_update() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("UPDATE platforms SET enabled = 0", [])
        .unwrap();
    conn.execute(
        "INSERT INTO platforms (id, name, adapter, enabled) VALUES ('test-plat', 'Test Platform', 'test', 1)",
        [],
    )
    .unwrap();
    for scene_id in ["old-scene", "new-scene"] {
        conn.execute(
            "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
             VALUES (?1, ?2, 0, 0, ?3, ?4)",
            rusqlite::params![scene_id, scene_id, now, now],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES ('old-rule', 'old-rule', 'md', 'old content', 1, ?1)",
        rusqlite::params![now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO scene_rules (scene_id, rule_id, enabled, sort_order)
         VALUES ('old-scene', 'old-rule', 1, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE app_config SET value = 'old-scene' WHERE key = 'global_scene_id'",
        [],
    )
    .unwrap();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    let original =
        "<!-- SKILLFORGE:rule:unknown-rule -->\nunknown\n<!-- /SKILLFORGE:rule:unknown-rule -->\n";
    std::fs::write(plugin.rules_file(), original).unwrap();
    let rules_file = plugin.rules_file();
    let before_modified = std::fs::metadata(&rules_file).unwrap().modified().unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_engine::switch_global_scene(&conn, &plugins, "new-scene");

    assert!(result.is_err());
    assert_eq!(std::fs::read_to_string(&rules_file).unwrap(), original);
    assert_eq!(
        std::fs::metadata(&rules_file).unwrap().modified().unwrap(),
        before_modified
    );
    let current_scene: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'global_scene_id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(current_scene.as_deref(), Some("old-scene"));
}

#[test]
fn strict_switch_single_file_duplicate_modified_marker_rejects_before_scene_update() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("UPDATE platforms SET enabled = 0", [])
        .unwrap();
    conn.execute(
        "INSERT INTO platforms (id, name, adapter, enabled) VALUES ('test-plat', 'Test Platform', 'test', 1)",
        [],
    )
    .unwrap();
    for scene_id in ["old-scene", "new-scene"] {
        conn.execute(
            "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
             VALUES (?1, ?2, 0, 0, ?3, ?4)",
            rusqlite::params![scene_id, scene_id, now, now],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES ('old-rule', 'old-rule', 'md', 'old content', 1, ?1)",
        rusqlite::params![now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO scene_rules (scene_id, rule_id, enabled, sort_order)
         VALUES ('old-scene', 'old-rule', 1, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE app_config SET value = 'old-scene' WHERE key = 'global_scene_id'",
        [],
    )
    .unwrap();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    let original = "<!-- SKILLFORGE:rule:old-rule -->\nold content<!-- /SKILLFORGE:rule:old-rule -->\n<!-- SKILLFORGE:rule:old-rule -->\nmodified content<!-- /SKILLFORGE:rule:old-rule -->\n";
    std::fs::write(plugin.rules_file(), original).unwrap();
    let rules_file = plugin.rules_file();
    let before_modified = std::fs::metadata(&rules_file).unwrap().modified().unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_engine::switch_global_scene(&conn, &plugins, "new-scene");

    assert!(result.is_err());
    assert_eq!(std::fs::read_to_string(&rules_file).unwrap(), original);
    assert_eq!(
        std::fs::metadata(&rules_file).unwrap().modified().unwrap(),
        before_modified
    );
    let current_scene: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'global_scene_id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(current_scene.as_deref(), Some("old-scene"));
}

#[test]
fn strict_switch_single_file_absent_rule_is_noop_and_preserves_user_bytes() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("UPDATE platforms SET enabled = 0", [])
        .unwrap();
    conn.execute(
        "INSERT INTO platforms (id, name, adapter, enabled) VALUES ('test-plat', 'Test Platform', 'test', 1)",
        [],
    )
    .unwrap();
    for scene_id in ["old-scene", "new-scene"] {
        conn.execute(
            "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
             VALUES (?1, ?2, 0, 0, ?3, ?4)",
            rusqlite::params![scene_id, scene_id, now, now],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES ('old-rule', 'old-rule', 'md', 'old content', 1, ?1)",
        rusqlite::params![now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO scene_rules (scene_id, rule_id, enabled, sort_order)
         VALUES ('old-scene', 'old-rule', 1, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE app_config SET value = 'old-scene' WHERE key = 'global_scene_id'",
        [],
    )
    .unwrap();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    let original = b"user bytes\n<!-- user comment -->\n";
    std::fs::write(plugin.rules_file(), original).unwrap();
    let before_modified = std::fs::metadata(plugin.rules_file())
        .unwrap()
        .modified()
        .unwrap();
    let rules_file = plugin.rules_file();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_engine::switch_global_scene(&conn, &plugins, "new-scene").unwrap();

    assert_eq!(std::fs::read(&rules_file).unwrap(), original);
    assert!(result.removed.is_empty());
    assert_eq!(
        std::fs::metadata(rules_file).unwrap().modified().unwrap(),
        before_modified
    );
}

#[test]
fn strict_switch_single_file_absent_rule_preserves_existing_empty_file() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("UPDATE platforms SET enabled = 0", [])
        .unwrap();
    conn.execute(
        "INSERT INTO platforms (id, name, adapter, enabled) VALUES ('test-plat', 'Test Platform', 'test', 1)",
        [],
    )
    .unwrap();
    for scene_id in ["old-scene", "new-scene"] {
        conn.execute(
            "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
             VALUES (?1, ?2, 0, 0, ?3, ?4)",
            rusqlite::params![scene_id, scene_id, now, now],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES ('old-rule', 'old-rule', 'md', 'old content', 1, ?1)",
        rusqlite::params![now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO scene_rules (scene_id, rule_id, enabled, sort_order)
         VALUES ('old-scene', 'old-rule', 1, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE app_config SET value = 'old-scene' WHERE key = 'global_scene_id'",
        [],
    )
    .unwrap();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    let rules_file = plugin.rules_file();
    let original = Vec::new();
    std::fs::write(&rules_file, &original).unwrap();
    let before_modified = std::fs::metadata(&rules_file).unwrap().modified().unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_engine::switch_global_scene(&conn, &plugins, "new-scene").unwrap();

    assert!(rules_file.exists());
    assert_eq!(std::fs::read(&rules_file).unwrap(), original);
    assert!(result.removed.is_empty());
    assert_eq!(
        std::fs::metadata(&rules_file).unwrap().modified().unwrap(),
        before_modified
    );
}

#[test]
fn single_file_sync_rejects_non_utf8_existing_file_without_mutation() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "new-rule", "new content");
    let rules_file = plugin.rules_file();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::Preserve, &[]),
        intent(DistributionIntentMode::AddOrUpdate, &["new-rule"]),
    );
    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();
    let original = vec![
        b'u', b's', b'e', b'r', b' ', b'c', b'o', b'n', b't', b'e', b'n', b't', 0xff,
    ];
    std::fs::write(&rules_file, &original).unwrap();

    let result = dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan);

    assert!(result.is_err());
    assert_eq!(std::fs::read(rules_file).unwrap(), original);
}

// ── Distribution Plan tests ──────────────────────────────────────────

/// Finding 2 fix: uses TempDir-isolated project path (never /tmp).
#[test]
fn test_plan_project_scope_missing_project_id() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    let plugins: Vec<Box<dyn skillforge_lib::plugins::platform::PlatformPlugin>> =
        vec![Box::new(plugin)];

    let result = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &[],
        &[],
        None,
        &["test-plat".to_string()],
        "project",
        None,
    );
    assert!(
        result.is_err(),
        "plan with project scope but no project_id must fail"
    );
    match result.unwrap_err() {
        skillforge_lib::error::AppError::DistributionInvalid(msg) => {
            assert!(
                msg.contains("project_id"),
                "error message must mention project_id"
            );
        }
        other => panic!("Expected DistributionInvalid, got: {:?}", other),
    }
}

/// Finding 1+2 fix: project path is TempDir; plan must NOT create directories.
#[test]
fn test_plan_project_scope_empty_dir() {
    let conn = init_db();

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
        rusqlite::params!["test-scene", "Test Scene", "A test scene", now, now],
    )
    .unwrap();

    // Use TempDir for project path — NOT /tmp
    let project_dir = tempfile::tempdir().expect("project tempdir");
    let project_path = project_dir.path().join("my-app");

    conn.execute(
        "INSERT INTO projects (id, name, path, scene_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            "test-project",
            "Test Project",
            project_path.to_string_lossy().to_string(),
            "test-scene",
            now,
            now
        ],
    )
    .unwrap();

    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    let plugins: Vec<Box<dyn skillforge_lib::plugins::platform::PlatformPlugin>> =
        vec![Box::new(plugin)];

    let plan = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &[],
        &[],
        None,
        &["test-plat".to_string()],
        "project",
        Some("test-project"),
    )
    .expect("plan with missing target dir should succeed");

    assert_eq!(plan.platforms.len(), 1);
    let plat = &plan.platforms[0];
    assert!(
        plat.skills_to_add.is_empty(),
        "no skills desired, so nothing to add"
    );
    assert!(plat.skills_to_update.is_empty());
    assert!(
        plat.skills_to_remove.is_empty(),
        "target dir doesn't exist, so nothing to remove"
    );
    assert!(!plan.has_removals);

    // Verify NO directory was created by the plan
    assert!(!project_path.exists(), "plan must NOT create directories");
}

/// Finding 1+2 fix: uses TempDir for both local_path and skills dir.
#[test]
fn test_plan_global_scope_add_remove_without_updates() {
    let conn = init_db();

    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");

    // Create skills in DB with TempDir-isolated local_path values
    let now = chrono::Utc::now().to_rfc3339();
    for (id, name) in &[
        ("skill-a", "Skill A"),
        ("skill-b", "Skill B"),
        ("skill-c", "Skill C"),
    ] {
        let skill = plugin.create_source_skill(id, name, "# content");
        conn.execute(
            "INSERT INTO skills (id, name, source_type, installed_at, local_path)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, name, "test", now, &skill.local_path],
        )
        .unwrap();
    }

    // Pre-populate the temp skills dir — create dirs for skill-a, skill-b, skill-old
    let skills_dir = plugin.default_paths().global_skills_dir.clone();
    std::fs::create_dir_all(&skills_dir).unwrap();
    std::fs::create_dir(std::path::Path::new(&skills_dir).join("skill-a")).unwrap();
    std::fs::create_dir(std::path::Path::new(&skills_dir).join("skill-b")).unwrap();
    std::fs::create_dir(std::path::Path::new(&skills_dir).join("skill-old")).unwrap();

    let plugins: Vec<Box<dyn skillforge_lib::plugins::platform::PlatformPlugin>> =
        vec![Box::new(plugin)];

    let desired = vec![
        "skill-a".to_string(),
        "skill-b".to_string(),
        "skill-c".to_string(),
    ];

    let plan = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &desired,
        &[],
        None,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .expect("plan should succeed");

    assert_eq!(plan.platforms.len(), 1);
    let plat = &plan.platforms[0];

    // skill-c is desired but NOT on disk → add
    assert_eq!(plat.skills_to_add, vec!["skill-c"]);
    assert!(
        plat.skills_to_update.is_empty(),
        "matching on-disk skills are not updates without a checksum contract"
    );
    assert!(plat.skills_to_remove.is_empty());
    assert!(!plan.has_removals);
}

#[test]
fn undetected_global_tilde_path_is_consistent_between_plan_and_execute() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_undetected_tilde_global("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "managed-skill");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let source = conn
        .query_row(
            "SELECT local_path FROM skills WHERE id = 'managed-skill'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    std::os::unix::fs::symlink(source, plugin.skills_dir().join("managed-skill")).unwrap();
    let skills_dir = plugin.skills_dir();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = distribution_request(
        intent(DistributionIntentMode::RemoveSelected, &["managed-skill"]),
        intent(DistributionIntentMode::Preserve, &[]),
    );

    let plan = dist_engine::build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

    assert_eq!(plan.platforms.len(), 1);
    assert_eq!(plan.platforms[0].skills_to_remove, vec!["managed-skill"]);
    dist_engine::execute_distribution_request(&conn, &plugins, &request, &plan).unwrap();
    assert!(!skills_dir.join("managed-skill").exists());
}

#[test]
fn strict_switch_validates_all_detected_global_instances_before_mutation() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("UPDATE platforms SET enabled = 0", [])
        .unwrap();
    conn.execute(
        "INSERT INTO platforms (id, name, adapter, enabled) VALUES ('test-plat', 'Test Platform', 'test', 1)",
        [],
    )
    .unwrap();
    for scene_id in ["old-scene", "new-scene"] {
        conn.execute(
            "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
             VALUES (?1, ?2, 0, 0, ?3, ?4)",
            rusqlite::params![scene_id, scene_id, now, now],
        )
        .unwrap();
    }
    let plugin =
        support::TestPlatformPlugin::with_two_global_instances("test-plat", "Test Platform");
    let source_skill =
        plugin.create_source_skill("old-skill", "old-skill", "---\nname: old-skill\n---\n");
    conn.execute(
        "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![source_skill.id, source_skill.name, source_skill.source_type, source_skill.installed_at, source_skill.local_path],
    )
    .unwrap();
    insert_rule(&conn, "old-rule", "managed content");
    conn.execute(
        "INSERT INTO scene_skills (scene_id, skill_id, enabled, sort_order) VALUES ('old-scene', 'old-skill', 1, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO scene_rules (scene_id, rule_id, enabled, sort_order) VALUES ('old-scene', 'old-rule', 1, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE app_config SET value = 'old-scene' WHERE key = 'global_scene_id'",
        [],
    )
    .unwrap();

    let source = conn
        .query_row(
            "SELECT local_path FROM skills WHERE id = 'old-skill'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    let instances = plugin.detect().unwrap();
    for instance in &instances {
        let target = std::path::Path::new(&instance.path).join("old-skill");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&source, target).unwrap();
    }
    let second_rules = plugin.rules_file();
    let invalid = b"<!-- SKILLFORGE:rule:old-rule -->\ninvalid<!-- /SKILLFORGE:rule:old-rule -->\n";
    std::fs::write(&second_rules, invalid).unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_engine::switch_global_scene(&conn, &plugins, "new-scene");

    assert!(result.is_err());
    assert!(std::path::Path::new(&instances[0].path)
        .join("old-skill")
        .exists());
    assert!(std::path::Path::new(&instances[1].path)
        .join("old-skill")
        .exists());
    assert_eq!(std::fs::read(&second_rules).unwrap(), invalid);
    let current_scene: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'global_scene_id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(current_scene.as_deref(), Some("old-scene"));
}

#[test]
fn legacy_preview_empty_ids_preserve_existing_content() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    let skills_dir = plugin.skills_dir();
    let rules_dir = plugin.rules_dir();
    std::fs::create_dir_all(skills_dir.join("stale-skill")).unwrap();
    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(rules_dir.join("stale-rule.md"), "# stale\n").unwrap();

    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let plan = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &[],
        &[],
        None,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .unwrap();

    let platform = &plan.platforms[0];
    assert!(platform.skills_to_remove.is_empty());
    assert!(platform.rules_to_remove.is_empty());
    assert!(!plan.has_removals);
}

#[test]
fn legacy_preview_partial_ids_preserve_omitted_content() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    let skills_dir = plugin.skills_dir();
    let rules_dir = plugin.rules_dir();
    std::fs::create_dir_all(skills_dir.join("selected-skill")).unwrap();
    std::fs::create_dir_all(skills_dir.join("omitted-skill")).unwrap();
    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(rules_dir.join("selected-rule.md"), "# selected\n").unwrap();
    std::fs::write(rules_dir.join("omitted-rule.md"), "# omitted\n").unwrap();

    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let plan = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &["selected-skill".to_string()],
        &["selected-rule".to_string()],
        None,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .unwrap();

    let platform = &plan.platforms[0];
    assert!(platform.skills_to_remove.is_empty());
    assert!(platform.rules_to_remove.is_empty());
}

#[test]
fn add_or_update_existing_selected_items_have_no_checksum_update() {
    let request = distribution_request(
        intent(DistributionIntentMode::AddOrUpdate, &["skill-a"]),
        intent(DistributionIntentMode::AddOrUpdate, &["rule-a"]),
    );
    let plan = dist_engine::calculate_distribution_plan(
        "test-plat",
        "Test Platform",
        &["skill-a".to_string()],
        &["rule-a".to_string()],
        &request,
    )
    .unwrap();

    assert!(plan.skills_to_add.is_empty());
    assert!(plan.skills_to_update.is_empty());
    assert!(plan.rules_to_add.is_empty());
    assert!(plan.rules_to_update.is_empty());
}

#[test]
fn legacy_sync_empty_ids_does_not_remove_existing_skills_or_rules() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    let skills_dir = plugin.skills_dir();
    let rules_dir = plugin.rules_dir();
    std::fs::create_dir_all(skills_dir.join("stale-skill")).unwrap();
    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(rules_dir.join("stale-rule.md"), "# stale\n").unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_engine::sync_scene(
        &conn,
        &plugins,
        &[],
        &[],
        None,
        Some(&["test-plat".to_string()]),
        "global",
        None,
    )
    .unwrap();

    assert!(result.removed.is_empty());
}

#[test]
fn legacy_sync_partial_ids_preserves_omitted_skills_and_rules() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    let selected_skill =
        plugin.create_source_skill("selected-skill", "Selected Skill", "# selected\n");
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO skills (id, name, source_type, installed_at, local_path)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            "selected-skill",
            "Selected Skill",
            "test",
            now,
            &selected_skill.local_path
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["selected-rule", "Selected Rule", "md", "# selected\n", now],
    )
    .unwrap();

    let skills_dir = plugin.skills_dir();
    let rules_dir = plugin.rules_dir();
    std::fs::create_dir_all(skills_dir.join("omitted-skill")).unwrap();
    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(rules_dir.join("omitted-rule.md"), "# omitted\n").unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = dist_engine::sync_scene(
        &conn,
        &plugins,
        &["selected-skill".to_string()],
        &["selected-rule".to_string()],
        None,
        Some(&["test-plat".to_string()]),
        "global",
        None,
    )
    .unwrap();

    assert!(result.removed.is_empty());
    assert!(skills_dir.join("omitted-skill").exists());
    assert!(rules_dir.join("omitted-rule.md").exists());
    assert!(skills_dir.join("selected-skill").exists());
    assert!(rules_dir.join("selected-rule.md").exists());
}

#[test]
fn strict_scene_switch_shared_directory_rules_preserves_overlap() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO platforms (id, name, adapter, enabled) VALUES (?1, ?2, ?3, 1)",
        rusqlite::params!["test-plat", "Test Platform", "test"],
    )
    .unwrap();
    for scene_id in ["old-scene", "new-scene"] {
        conn.execute(
            "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
             VALUES (?1, ?2, 0, 0, ?3, ?4)",
            rusqlite::params![scene_id, scene_id, now, now],
        )
        .unwrap();
    }
    for (id, content) in [
        ("rule-old", "# old\n"),
        ("rule-kept", "# kept\n"),
        ("rule-new", "# new\n"),
    ] {
        conn.execute(
            "INSERT INTO rules (id, name, format, content, version, updated_at)
             VALUES (?1, ?2, 'md', ?3, 1, ?4)",
            rusqlite::params![id, id, content, now],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO scene_rules (scene_id, rule_id, enabled, sort_order)
         VALUES ('old-scene', 'rule-old', 1, 0), ('old-scene', 'rule-kept', 1, 1),
                 ('new-scene', 'rule-kept', 1, 0), ('new-scene', 'rule-new', 1, 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE app_config SET value = 'old-scene' WHERE key = 'global_scene_id'",
        [],
    )
    .unwrap();

    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    let rules_dir = plugin.rules_dir();
    std::fs::create_dir_all(&rules_dir).unwrap();
    for (id, content) in [("rule-old", "# old\n"), ("rule-kept", "# kept\n")] {
        std::fs::write(rules_dir.join(format!("{}.md", id)), content).unwrap();
    }
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    dist_engine::switch_global_scene(&conn, &plugins, "new-scene").unwrap();

    assert!(!rules_dir.join("rule-old.md").exists());
    assert_eq!(
        std::fs::read_to_string(rules_dir.join("rule-kept.md")).unwrap(),
        "# kept\n"
    );
    assert_eq!(
        std::fs::read_to_string(rules_dir.join("rule-new.md")).unwrap(),
        "# new\n"
    );
}

/// Finding 2 fix: Directory rules use TempDir paths.
#[test]
fn test_plan_directory_rules_add_remove_without_updates() {
    let conn = init_db();

    let now = chrono::Utc::now().to_rfc3339();
    for (id, name) in &[("rule-x", "Rule X"), ("rule-y", "Rule Y")] {
        conn.execute(
            "INSERT INTO rules (id, name, format, content, version, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            rusqlite::params![id, name, "md", format!("# {}", name), now],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["rule-old", "Rule Old", "mdc", "# Old", now],
    )
    .unwrap();

    let plugin = support::TestPlatformPlugin::with_rules(
        "test-plat",
        "Test Platform",
        false, // Directory mode
        "",
    );
    let paths = plugin.default_paths();
    let rules_dir = paths.global_rules_dir.as_ref().unwrap().clone();
    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(
        std::path::Path::new(&rules_dir).join("rule-x.md"),
        "# Rule X\n",
    )
    .unwrap();
    std::fs::write(
        std::path::Path::new(&rules_dir).join("rule-old.mdc"),
        "# Old\n",
    )
    .unwrap();

    let plugins: Vec<Box<dyn skillforge_lib::plugins::platform::PlatformPlugin>> =
        vec![Box::new(plugin)];

    let desired = vec!["rule-x".to_string(), "rule-y".to_string()];

    let plan = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &[],
        &desired,
        None,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .expect("plan should succeed");

    assert_eq!(plan.platforms.len(), 1);
    let plat = &plan.platforms[0];

    // rule-y is desired but NOT on disk → add
    assert_eq!(plat.rules_to_add, vec!["rule-y"]);
    assert!(
        plat.rules_to_update.is_empty(),
        "matching on-disk rules are not updates without a checksum contract"
    );
    assert!(plat.rules_to_remove.is_empty());
}

/// Finding 2 fix: SingleFile rules use TempDir paths.
#[test]
fn test_plan_single_file_rules_boundary_without_updates() {
    let conn = init_db();

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["rule-active", "Active Rule", "md", "# Active", now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["rule-old", "Rule Old", "md", "# Old", now],
    )
    .unwrap();

    let plugin = support::TestPlatformPlugin::with_rules(
        "test-plat",
        "Test Platform",
        true, // SingleFile mode
        "AGENTS.md",
    );
    let paths = plugin.default_paths();
    let rules_file = paths.global_rules_dir.as_ref().unwrap().clone();
    std::fs::create_dir_all(std::path::Path::new(&rules_file).parent().unwrap()).unwrap();
    std::fs::write(
        &rules_file,
        "# User content\n\n<!-- SKILLFORGE:rule:rule-active -->\n# Active\n<!-- /SKILLFORGE:rule:rule-active -->\n\n<!-- SKILLFORGE:rule:rule-old -->\n# Old\n<!-- /SKILLFORGE:rule:rule-old -->\n",
    )
    .unwrap();

    let plugins: Vec<Box<dyn skillforge_lib::plugins::platform::PlatformPlugin>> =
        vec![Box::new(plugin)];

    let desired = vec!["rule-active".to_string()];

    let plan = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &[],
        &desired,
        None,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .expect("plan should succeed");

    assert_eq!(plan.platforms.len(), 1);
    let plat = &plan.platforms[0];

    assert!(
        plat.rules_to_add.is_empty(),
        "all desired rules already exist on disk"
    );
    assert!(
        plat.rules_to_update.is_empty(),
        "matching on-disk rules are not updates without a checksum contract"
    );
    assert!(plat.rules_to_remove.is_empty());
    assert!(!plan.has_removals);
}

/// Finding 1+2 fix: source files are inside TempDir; plan never modifies them.
#[test]
fn test_plan_does_not_modify_source_files() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");

    // Create source skill inside the plugin's TempDir
    let skill = plugin.create_source_skill("test-skill", "Test Skill", "# Original Content\n");
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO skills (id, name, source_type, installed_at, local_path)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params!["test-skill", "Test Skill", "test", now, &skill.local_path],
    )
    .unwrap();

    let skill_dir = std::path::Path::new(&skill.local_path);
    let source_file = skill_dir.join("SKILL.md");
    let before = std::fs::read_to_string(&source_file).unwrap();

    let plugins: Vec<Box<dyn skillforge_lib::plugins::platform::PlatformPlugin>> =
        vec![Box::new(plugin)];

    let desired = vec!["test-skill".to_string()];

    let _plan = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &desired,
        &[],
        None,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .expect("plan should succeed");

    let after = std::fs::read_to_string(&source_file).unwrap();
    assert_eq!(before, after, "source file must not be modified by plan");
}

// ── Finding 3 regression: detect() failure → AppError ────────────────

/// A platform plugin whose detect() always returns an error.
mod failing_detect {
    use skillforge_lib::error::AppError;
    use skillforge_lib::plugins::platform::PlatformPlugin;
    use skillforge_lib::types::{
        PlatformCapabilities, PlatformInstance, PlatformPaths, Skill, SkillPlatformStatus,
        SyncResult,
    };
    use std::sync::Mutex;

    pub struct FailingDetectPlugin {
        id: &'static str,
        name: &'static str,
        temp_dir: Mutex<tempfile::TempDir>,
    }

    impl FailingDetectPlugin {
        pub fn new(id: &'static str, name: &'static str) -> Self {
            Self {
                id,
                name,
                temp_dir: Mutex::new(tempfile::tempdir().expect("tempdir")),
            }
        }
    }

    impl PlatformPlugin for FailingDetectPlugin {
        fn platform_name(&self) -> &'static str {
            self.id
        }
        fn display_name(&self) -> &'static str {
            self.name
        }
        fn detect(&self) -> Result<Vec<PlatformInstance>, AppError> {
            Err(AppError::Platform("deliberate test failure".to_string()))
        }
        fn install(&self, _skill: &Skill, _instance: &PlatformInstance) -> Result<(), AppError> {
            Ok(())
        }
        fn sync(
            &self,
            _skill: &Skill,
            _instance: &PlatformInstance,
        ) -> Result<SyncResult, AppError> {
            Ok(SyncResult {
                installed: vec![],
                updated: vec![],
                removed: vec![],
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
            let p = self
                .temp_dir
                .lock()
                .unwrap()
                .path()
                .join("skills")
                .to_string_lossy()
                .to_string();
            PlatformPaths {
                global_skills_dir: p,
                project_skills_pattern: "{project}/.test/skills".to_string(),
                global_rules_dir: None,
                project_rules_pattern: None,
                global_rules_format: None,
                project_rules_format: None,
            }
        }
        fn capabilities(&self) -> PlatformCapabilities {
            PlatformCapabilities {
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
}

#[test]
fn test_plan_detect_failure_surfaces_error() {
    let conn = init_db();
    let plugin = failing_detect::FailingDetectPlugin::new("fail-plat", "Failing Platform");
    let plugins: Vec<Box<dyn skillforge_lib::plugins::platform::PlatformPlugin>> =
        vec![Box::new(plugin)];

    let result = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &[],
        &[],
        None,
        &["fail-plat".to_string()],
        "global",
        None,
    );
    assert!(result.is_err(), "plan must fail when detect() fails");
    match result.unwrap_err() {
        skillforge_lib::error::AppError::Platform(msg) => {
            assert!(
                msg.contains("test failure"),
                "error must contain detect message"
            );
        }
        other => panic!("Expected AppError::Platform, got: {:?}", other),
    }
}

// ── Finding 4 regression: project-scope rules path resolution ────────

#[test]
fn test_plan_project_scope_rules_path_resolution_without_updates() {
    let conn = init_db();

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["proj-rule", "Project Rule", "md", "# Project Rule", now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["stale-rule", "Stale Rule", "mdc", "# Stale", now],
    )
    .unwrap();

    conn.execute(
        "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
         VALUES (?1, ?2, 0, 0, ?3, ?4)",
        rusqlite::params!["proj-scene", "Project Scene", now, now],
    )
    .unwrap();

    let project_dir = tempfile::tempdir().expect("project tempdir");
    let project_base = project_dir.path().join("my-app");
    // Create project dir with rules subdirectory
    std::fs::create_dir_all(project_base.join(".test/rules")).unwrap();
    std::fs::write(
        project_base.join(".test/rules/proj-rule.md"),
        "# Project Rule\n",
    )
    .unwrap();
    std::fs::write(project_base.join(".test/rules/stale-rule.mdc"), "# Stale\n").unwrap();

    conn.execute(
        "INSERT INTO projects (id, name, path, scene_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            "proj",
            "My Project",
            project_base.to_string_lossy().to_string(),
            "proj-scene",
            now,
            now
        ],
    )
    .unwrap();

    let plugin = support::TestPlatformPlugin::with_rules(
        "test-plat",
        "Test Platform",
        false, // Directory mode
        "",
    );
    let plugins: Vec<Box<dyn skillforge_lib::plugins::platform::PlatformPlugin>> =
        vec![Box::new(plugin)];

    let desired = vec!["proj-rule".to_string()];

    let plan = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &[],
        &desired,
        None,
        &["test-plat".to_string()],
        "project",
        Some("proj"),
    )
    .expect("project-scope plan should succeed");

    assert_eq!(plan.platforms.len(), 1);
    let plat = &plan.platforms[0];

    assert!(plat.rules_to_add.is_empty(), "proj-rule is already on disk");
    assert!(plat.rules_to_update.is_empty());
    assert!(
        plat.rules_to_remove.is_empty(),
        "legacy project preview must not infer rule removals"
    );
    assert!(!plan.has_removals);
}

#[test]
fn sync_scene_project_scope_rules_target_uses_project_base() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params![
            "project-rule",
            "Project Rule",
            "md",
            "# Project Rule\n",
            now
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
         VALUES (?1, ?2, 0, 0, ?3, ?4)",
        rusqlite::params!["project-scene", "Project Scene", now, now],
    )
    .unwrap();

    let project_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().join("app");
    conn.execute(
        "INSERT INTO projects (id, name, path, scene_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            "project",
            "Project",
            project_path.to_string_lossy().to_string(),
            "project-scene",
            now,
            now
        ],
    )
    .unwrap();

    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    dist_engine::sync_scene(
        &conn,
        &plugins,
        &[],
        &["project-rule".to_string()],
        None,
        Some(&["test-plat".to_string()]),
        "project",
        Some("project"),
    )
    .expect("project-scoped rules sync should succeed");

    let expected = project_path.join(".test/rules/project-rule.md");
    let incorrect = project_path.join(".test/.test/rules/project-rule.md");
    assert!(
        expected.exists(),
        "rule must be written under the project base"
    );
    assert!(
        !incorrect.exists(),
        "rule must not be nested under a duplicated .test path"
    );
}

#[test]
fn build_distribution_plan_preserves_unknown_directory_rules() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["stale-rule", "Stale Rule", "md", "# Stale\n", now],
    )
    .unwrap();

    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    let rules_dir = plugin.rules_dir();
    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(rules_dir.join("user-note.md"), "# User note\n").unwrap();
    std::fs::write(rules_dir.join("stale-rule.md"), "# Stale\n").unwrap();

    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let plan = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &[],
        &[],
        None,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .expect("directory rules plan should succeed");

    let platform = &plan.platforms[0];
    assert!(!platform.rules_to_remove.contains(&"user-note".to_string()));
    assert!(platform.rules_to_remove.is_empty());
}

// ── Task 4A.1: sync_scene idempotency contract ──────────────────────

/// Prove that sync_scene violates DistributionPlan-level idempotency.
///
/// Expected contract (from DistributionPlan semantics):
///   1. First sync with [skill-a] → skill-a is installed
///   2. Second sync with [skill-a] → NO changes (installed/updated/removed all empty)
///   3. Inject stale-skill on disk → third sync only removes stale-skill
///
/// All paths use TempDir isolation.
#[test]
fn sync_scene_plan_idempotency() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");

    let now = chrono::Utc::now().to_rfc3339();

    // ── Register prerequisites in DB (FK constraints) ───────────
    conn.execute(
        "INSERT OR IGNORE INTO platforms (id, name, adapter, enabled)
         VALUES ('test-plat', 'Test Platform', 'test', 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO scenes (id, name, is_template, is_system, created_at, updated_at)
         VALUES ('test-scene', 'Test Scene', 0, 0, ?1, ?2)",
        rusqlite::params![now, now],
    )
    .unwrap();

    // Create one source skill inside the plugin's TempDir
    let skill = plugin.create_source_skill("skill-a", "Skill A", "# Skill A\n");
    conn.execute(
        "INSERT INTO skills (id, name, source_type, installed_at, local_path)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params!["skill-a", "Skill A", "test", now, &skill.local_path],
    )
    .unwrap();

    // Capture skills_dir BEFORE plugin is moved into the vec
    let skills_dir = plugin.skills_dir();

    let plugins: Vec<Box<dyn skillforge_lib::plugins::platform::PlatformPlugin>> =
        vec![Box::new(plugin)];

    // ── Phase 1: First sync ────────────────────────────────────
    let r1 = dist_engine::sync_scene(
        &conn,
        &plugins,
        &["skill-a".to_string()],
        &[],
        Some("test-scene"),
        Some(&["test-plat".to_string()]),
        "global",
        None,
    )
    .expect("first sync should succeed");

    assert_eq!(
        r1.installed,
        vec!["skill-a"],
        "phase 1: must install skill-a"
    );
    assert!(r1.updated.is_empty(), "phase 1: no updates expected");
    assert!(r1.removed.is_empty(), "phase 1: no removals expected");
    assert!(r1.errors.is_empty(), "phase 1: no errors");

    // ── Phase 2: Second sync with identical inputs → must be NO-OP ──
    let r2 = dist_engine::sync_scene(
        &conn,
        &plugins,
        &["skill-a".to_string()],
        &[],
        None,
        Some(&["test-plat".to_string()]),
        "global",
        None,
    )
    .expect("second sync should succeed");

    assert!(
        r2.installed.is_empty() && r2.updated.is_empty() && r2.removed.is_empty(),
        "phase 2: second sync with identical inputs must produce zero changes \
         (idempotency violation: installed={:?}, updated={:?}, removed={:?})",
        r2.installed,
        r2.updated,
        r2.removed,
    );
    assert!(r2.errors.is_empty(), "phase 2: no errors");

    // ── Phase 3: Inject stale item on disk, then re-sync ───────────
    std::fs::create_dir_all(skills_dir.join("stale-skill")).unwrap();

    let r3 = dist_engine::sync_scene(
        &conn,
        &plugins,
        &["skill-a".to_string()],
        &[],
        None,
        Some(&["test-plat".to_string()]),
        "global",
        None,
    )
    .expect("third sync should succeed");

    assert!(r3.installed.is_empty(), "phase 3: no installs expected");
    assert!(r3.updated.is_empty(), "phase 3: no updates expected");
    assert!(r3.removed.is_empty());
    assert!(r3.errors.is_empty(), "phase 3: no errors");
}

#[test]
fn sync_scene_rules_idempotency() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["rule-a", "Rule A", "md", "# Rule A\n", now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["stale-rule", "Stale Rule", "md", "# Stale\n", now],
    )
    .unwrap();

    let rules_dir = plugin.rules_dir();
    let plugins: Vec<Box<dyn skillforge_lib::plugins::platform::PlatformPlugin>> =
        vec![Box::new(plugin)];
    let rule_ids = vec!["rule-a".to_string()];
    let platform_ids = vec!["test-plat".to_string()];

    let first = dist_engine::sync_scene(
        &conn,
        &plugins,
        &[],
        &rule_ids,
        None,
        Some(&platform_ids),
        "global",
        None,
    )
    .expect("first rules sync should succeed");
    assert_eq!(first.installed, vec!["rule:rule-a"]);
    assert!(first.updated.is_empty());
    assert!(first.removed.is_empty());

    let second = dist_engine::sync_scene(
        &conn,
        &plugins,
        &[],
        &rule_ids,
        None,
        Some(&platform_ids),
        "global",
        None,
    )
    .expect("second rules sync should succeed");
    assert!(
        second.installed.is_empty() && second.updated.is_empty() && second.removed.is_empty(),
        "second identical rules sync must be a no-op: installed={:?}, updated={:?}, removed={:?}",
        second.installed,
        second.updated,
        second.removed,
    );

    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(rules_dir.join("stale-rule.md"), "# Stale\n").unwrap();

    let third = dist_engine::sync_scene(
        &conn,
        &plugins,
        &[],
        &rule_ids,
        None,
        Some(&platform_ids),
        "global",
        None,
    )
    .expect("third rules sync should succeed");
    assert!(third.installed.is_empty());
    assert!(third.updated.is_empty());
    assert!(third.removed.is_empty());
}

#[test]
fn sync_scene_rules_preserves_unknown_files() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["rule-a", "Rule A", "md", "# Rule A\n", now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["stale-rule", "Stale Rule", "md", "# Stale\n", now],
    )
    .unwrap();

    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    let rules_dir = plugin.rules_dir();
    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(rules_dir.join("user-note.md"), "# User note\n").unwrap();
    std::fs::write(rules_dir.join("stale-rule.md"), "# Stale\n").unwrap();

    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let result = dist_engine::sync_scene(
        &conn,
        &plugins,
        &[],
        &["rule-a".to_string()],
        None,
        Some(&["test-plat".to_string()]),
        "global",
        None,
    )
    .expect("rules sync should succeed");

    assert!(rules_dir.join("user-note.md").exists());
    assert!(!result.removed.contains(&"rule:user-note".to_string()));
    assert!(rules_dir.join("stale-rule.md").exists());
    assert!(result.removed.is_empty());
}

mod project_only_rules {
    use super::*;
    use skillforge_lib::error::AppError;
    use skillforge_lib::types::{
        PlatformCapabilities, PlatformInstance, PlatformPaths, RulesFormat, Skill,
        SkillPlatformStatus, SyncResult,
    };
    use std::sync::Mutex;

    pub struct Plugin {
        temp_dir: Mutex<tempfile::TempDir>,
    }

    impl Plugin {
        pub fn new() -> Self {
            Self {
                temp_dir: Mutex::new(tempfile::tempdir().unwrap()),
            }
        }
    }

    impl PlatformPlugin for Plugin {
        fn platform_name(&self) -> &'static str {
            "project-only"
        }
        fn display_name(&self) -> &'static str {
            "Project Only"
        }
        fn detect(&self) -> Result<Vec<PlatformInstance>, AppError> {
            Ok(vec![])
        }
        fn install(&self, _skill: &Skill, _instance: &PlatformInstance) -> Result<(), AppError> {
            Ok(())
        }
        fn sync(
            &self,
            _skill: &Skill,
            _instance: &PlatformInstance,
        ) -> Result<SyncResult, AppError> {
            Ok(SyncResult {
                installed: vec![],
                updated: vec![],
                removed: vec![],
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
            let root = self.temp_dir.lock().unwrap().path().to_path_buf();
            PlatformPaths {
                global_skills_dir: root.join("skills").to_string_lossy().to_string(),
                project_skills_pattern: "{project}/.test/skills".to_string(),
                global_rules_dir: None,
                project_rules_pattern: Some("{project}/.test/rules".to_string()),
                global_rules_format: None,
                project_rules_format: Some(RulesFormat::Directory),
            }
        }
        fn capabilities(&self) -> PlatformCapabilities {
            PlatformCapabilities {
                skills_global: true,
                skills_project: true,
                rules_global: false,
                rules_project: true,
                rules_format_global: None,
                rules_format_project: Some(RulesFormat::Directory),
                limitation_notes: vec![],
            }
        }
    }
}

#[test]
fn build_distribution_plan_supports_project_only_rules() {
    let conn = init_db();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params![
            "project-rule",
            "Project Rule",
            "md",
            "# Project Rule\n",
            now
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params!["stale-rule", "Stale Rule", "md", "# Stale\n", now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
         VALUES ('project-scene', 'Project Scene', 0, 0, ?1, ?2)",
        rusqlite::params![now, now],
    )
    .unwrap();
    let project_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().join("app");
    let rules_dir = project_path.join(".test/rules");
    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(rules_dir.join("stale-rule.md"), "# Stale\n").unwrap();
    conn.execute(
        "INSERT INTO projects (id, name, path, scene_id, created_at, updated_at)
         VALUES ('project', 'Project', ?1, 'project-scene', ?2, ?3)",
        rusqlite::params![project_path.to_string_lossy().to_string(), now, now],
    )
    .unwrap();

    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(project_only_rules::Plugin::new())];
    let plan = dist_engine::build_distribution_plan(
        &conn,
        &plugins,
        &[],
        &["project-rule".to_string()],
        None,
        &["project-only".to_string()],
        "project",
        Some("project"),
    )
    .expect("project-only rules plan should succeed");

    let platform = &plan.platforms[0];
    assert_eq!(platform.rules_to_add, vec!["project-rule"]);
    assert!(platform.rules_to_update.is_empty());
    assert!(platform.rules_to_remove.is_empty());
}
