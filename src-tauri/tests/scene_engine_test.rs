use skillforge_lib::db::migrations;
/// Integration test for scene_engine CRUD operations and platform associations.
use skillforge_lib::engine::scene_engine;
use skillforge_lib::types::{CreateSceneDTO, UpdateSceneDTO};

fn init_db() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok();
    migrations::run_migrations(&mut conn).unwrap();
    conn
}

#[test]
fn test_scene_crud_cycle() {
    let conn = init_db();

    // ── Create ──
    let dto = CreateSceneDTO {
        name: "CRUD Test".to_string(),
        description: Some("Testing CRUD".to_string()),
        icon: Some("box".to_string()),
        skill_ids: None,
        rule_ids: None,
    };
    let scene = scene_engine::create_scene(&conn, &dto).expect("create should succeed");
    assert_eq!(scene.name, "CRUD Test");
    assert!(!scene.id.is_empty());

    // ── Read ──
    let detail =
        scene_engine::get_scene_detail(&conn, &scene.id).expect("get_scene_detail should succeed");
    assert_eq!(detail.scene.name, "CRUD Test");
    assert_eq!(detail.scene.description, Some("Testing CRUD".to_string()));

    // ── List ──
    let scenes = scene_engine::list_scenes(&conn).expect("list_scenes should succeed");
    assert!(
        scenes.iter().any(|s| s.id == scene.id),
        "scene should appear in list"
    );

    // ── Update ──
    let update = UpdateSceneDTO {
        name: Some("CRUD Updated".to_string()),
        description: Some("Updated description".to_string()),
        icon: Some("star".to_string()),
    };
    scene_engine::update_scene(&conn, &scene.id, &update).expect("update should succeed");
    let updated = scene_engine::get_scene_detail(&conn, &scene.id).unwrap();
    assert_eq!(updated.scene.name, "CRUD Updated");

    // ── Delete ──
    scene_engine::delete_scene(&conn, &scene.id).expect("delete should succeed");
    let result = scene_engine::get_scene_detail(&conn, &scene.id);
    assert!(result.is_err(), "deleted scene should not be found");
}

#[test]
fn test_get_scene_platforms_returns_all_enabled() {
    let conn = init_db();

    // After scene_platforms removal, get_scene_platforms returns all enabled platforms
    let platforms = scene_engine::get_scene_platforms(&conn, "any-scene").unwrap();
    assert_eq!(
        platforms.len(),
        10,
        "should return all 10 built-in enabled platforms"
    );
    assert!(platforms.contains(&"claude-code".to_string()));
    assert!(platforms.contains(&"cursor".to_string()));

    // Calling with different scene_id returns the same result (all enabled)
    let platforms2 = scene_engine::get_scene_platforms(&conn, "different-scene").unwrap();
    assert_eq!(platforms2, platforms);
}

#[test]
fn test_scene_deduplication() {
    let conn = init_db();

    let dto = CreateSceneDTO {
        name: "Duplicate Test".to_string(),
        description: None,
        icon: None,
        skill_ids: None,
        rule_ids: None,
    };
    scene_engine::create_scene(&conn, &dto).expect("first create should succeed");

    // Second create with same name should fail (slug collision)
    let dto2 = CreateSceneDTO {
        name: "Duplicate Test".to_string(),
        description: None,
        icon: None,
        skill_ids: None,
        rule_ids: None,
    };
    let result = scene_engine::create_scene(&conn, &dto2);
    assert!(result.is_err(), "duplicate scene name should fail");
}

#[test]
fn test_create_scene_with_various_icons() {
    let conn = init_db();

    let icons = vec!["box", "star", "shield", "zap"];
    for (i, icon) in icons.iter().enumerate() {
        let name = format!("Icon Scene {}", i);
        let dto = CreateSceneDTO {
            name,
            description: Some(format!("Scene with icon {}", icon)),
            icon: Some(icon.to_string()),
            skill_ids: None,
            rule_ids: None,
        };
        let scene = scene_engine::create_scene(&conn, &dto).unwrap();
        let detail = scene_engine::get_scene_detail(&conn, &scene.id).unwrap();
        assert_eq!(detail.scene.icon, Some(icon.to_string()));
    }
}
