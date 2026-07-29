use skillforge_lib::db::migrations;
/// Integration test for dist_engine resolution and status pipeline.
use skillforge_lib::engine::{dist_engine, scene_engine};
use skillforge_lib::types::CreateSceneDTO;

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
    let scene = scene_engine::create_scene(&conn, &dto).unwrap();

    let resolved = dist_engine::resolve_scene_skills(&conn, &scene.id)
        .expect("resolve_scene_skills should succeed for empty scene");
    assert!(resolved.is_empty(), "empty scene should resolve no skills");
}

#[test]
fn test_get_sync_status_initial_state() {
    let conn = init_db();

    let status = dist_engine::get_sync_status(&conn).expect("get_sync_status should succeed");
    // Initial state: platforms array has entries (12 built-in platforms)
    assert!(
        !status.platforms.is_empty(),
        "sync status should have platforms"
    );
}

// Note: resolve_scene_skills/rules for nonexistent scenes panic internally.
// This is a known behavior — future refactoring should convert these to proper errors.
