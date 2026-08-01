use skillforge_lib::db::migrations;
use skillforge_lib::engine::{dist_engine, scene_engine, skill_engine};
use skillforge_lib::types::{CreateSceneDTO, SkillFilter};

fn init_db() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok();
    migrations::run_migrations(&mut conn).unwrap();
    conn
}

fn insert_skill(conn: &rusqlite::Connection, id: &str, name: &str) {
    conn.execute(
        "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, 'test', datetime('now'), ?1)",
        rusqlite::params![id, name],
    ).unwrap();
}

#[test]
fn test_full_pipeline_skills_to_scene_to_resolve() {
    let conn = init_db();

    // ── Step 1: Insert skills directly (bypass source plugin) ──
    insert_skill(&conn, "skill-a", "Skill A");
    insert_skill(&conn, "skill-b", "Skill B");

    // Verify skills are listable
    let filter = SkillFilter { source_type: None, tag: None };
    let skills = skill_engine::list_skills(&conn, &filter).unwrap();
    assert_eq!(skills.len(), 2);

    // ── Step 2: Create scene ──
    let dto = CreateSceneDTO {
        name: "Test Scene".to_string(),
        description: Some("Integration test scene".to_string()),
        icon: Some("zap".to_string()),
        skill_ids: None,
        rule_ids: None,
    };
    let scene = scene_engine::create_scene(&conn, &dto).unwrap();
    assert_eq!(scene.name, "Test Scene");

    // ── Step 3: Add skills to scene ──
    scene_engine::add_skill_to_scene(&conn, &scene.id, "skill-a").unwrap();
    scene_engine::add_skill_to_scene(&conn, &scene.id, "skill-b").unwrap();

    // ── Step 4: Verify scene detail ──
    let detail = scene_engine::get_scene_detail(&conn, &scene.id).unwrap();
    assert_eq!(detail.skills.len(), 2);
    assert!(detail.skills.iter().any(|s| s.skill_id == "skill-a"));

    // ── Step 5: Resolve scene skills ──
    let resolved = dist_engine::resolve_scene_skills(&conn, &scene.id).unwrap();
    assert_eq!(resolved.len(), 2);
    assert!(resolved.contains(&"skill-a".to_string()));
    assert!(resolved.contains(&"skill-b".to_string()));
}

#[test]
fn test_scene_with_no_skills_resolves_empty() {
    let conn = init_db();

    let dto = CreateSceneDTO {
        name: "Empty Scene".to_string(),
        description: None,
        icon: None,
        skill_ids: None,
        rule_ids: None,
    };
    let scene = scene_engine::create_scene(&conn, &dto).unwrap();

    let resolved = dist_engine::resolve_scene_skills(&conn, &scene.id).unwrap();
    assert!(resolved.is_empty(), "empty scene should resolve no skills");
}

#[test]
fn test_empty_scene_id_resolves_all_skills() {
    let conn = init_db();
    insert_skill(&conn, "s1", "Skill 1");
    insert_skill(&conn, "s2", "Skill 2");

    // Passing "" scene_id returns all installed skills
    let resolved = dist_engine::resolve_scene_skills(&conn, "").unwrap();
    assert_eq!(resolved.len(), 2);
}

#[test]
fn test_switch_scene_changes_skill_resolution() {
    let conn = init_db();
    insert_skill(&conn, "skill-a", "Skill A");
    insert_skill(&conn, "skill-b", "Skill B");

    // Scene A has skill-a
    let dto_a = CreateSceneDTO {
        name: "Scene A".to_string(),
        description: None, icon: None, skill_ids: None, rule_ids: None,
    };
    let scene_a = scene_engine::create_scene(&conn, &dto_a).unwrap();
    scene_engine::add_skill_to_scene(&conn, &scene_a.id, "skill-a").unwrap();

    // Scene B has skill-b
    let dto_b = CreateSceneDTO {
        name: "Scene B".to_string(),
        description: None, icon: None, skill_ids: None, rule_ids: None,
    };
    let scene_b = scene_engine::create_scene(&conn, &dto_b).unwrap();
    scene_engine::add_skill_to_scene(&conn, &scene_b.id, "skill-b").unwrap();

    // Verify scene isolation
    let resolved_a = dist_engine::resolve_scene_skills(&conn, &scene_a.id).unwrap();
    assert_eq!(resolved_a, vec!["skill-a"]);

    let resolved_b = dist_engine::resolve_scene_skills(&conn, &scene_b.id).unwrap();
    assert_eq!(resolved_b, vec!["skill-b"]);
}

#[test]
fn test_distribution_status_no_skills() {
    let conn = init_db();
    let status = dist_engine::get_sync_status(&conn).unwrap();
    assert!(!status.platforms.is_empty(), "sync status should have platforms");
}