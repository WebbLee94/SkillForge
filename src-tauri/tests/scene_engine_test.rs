use skillforge_lib::db::migrations;
/// Integration test for scene_engine CRUD operations and platform associations.
use skillforge_lib::engine::scene_engine;
use skillforge_lib::error::AppError;
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

    let icons = ["box", "star", "shield", "zap"];
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

#[test]
fn test_set_scene_member_enabled_persists() {
    let conn = init_db();

    // Insert a skill first
    conn.execute(
        "INSERT INTO resources (id, kind, name, source_type, installed_at, updated_at, local_path) VALUES (?1, 'skill', ?2, 'test', datetime('now'), datetime('now'), ?1)",
        rusqlite::params!["test-skill", "Test Skill"],
    )
    .unwrap();

    let dto = CreateSceneDTO {
        name: "Toggle Scene".to_string(),
        description: None,
        icon: None,
        skill_ids: Some(vec!["test-skill".to_string()]),
        rule_ids: None,
    };
    let scene = scene_engine::create_scene(&conn, &dto).unwrap();

    // 初始 enabled=true
    let detail = scene_engine::get_scene_detail(&conn, &scene.id).unwrap();
    assert!(detail.skills[0].enabled);
    assert_eq!(detail.skills.len(), 1);

    // 禁用后：详情返回 enabled=false 且成员行保留（不删除）
    scene_engine::set_scene_member_enabled(&conn, &scene.id, "skill", "test-skill", false).unwrap();
    let detail = scene_engine::get_scene_detail(&conn, &scene.id).unwrap();
    assert!(!detail.skills[0].enabled);
    assert_eq!(detail.skills.len(), 1, "禁用后成员行应保留");

    // 重新启用后：详情返回 enabled=true（刷新保持）
    scene_engine::set_scene_member_enabled(&conn, &scene.id, "skill", "test-skill", true).unwrap();
    let detail = scene_engine::get_scene_detail(&conn, &scene.id).unwrap();
    assert!(detail.skills[0].enabled);
}

#[test]
fn test_set_scene_member_enabled_rule_persists() {
    let conn = init_db();

    // Insert a rule first
    conn.execute(
        "INSERT INTO resources (id, kind, name, description, source_type, format, content, version, updated_at, installed_at) VALUES (?1, 'rule', ?2, ?3, 'manual', 'directory', ?4, 1, datetime('now'), datetime('now'))",
        rusqlite::params!["test-rule", "Test Rule", "A test", "rule content"],
    )
    .unwrap();

    let dto = CreateSceneDTO {
        name: "Rule Toggle Scene".to_string(),
        description: None,
        icon: None,
        skill_ids: None,
        rule_ids: Some(vec!["test-rule".to_string()]),
    };
    let scene = scene_engine::create_scene(&conn, &dto).unwrap();

    let detail = scene_engine::get_scene_detail(&conn, &scene.id).unwrap();
    assert!(detail.rules[0].enabled);

    scene_engine::set_scene_member_enabled(&conn, &scene.id, "rule", "test-rule", false).unwrap();
    let detail = scene_engine::get_scene_detail(&conn, &scene.id).unwrap();
    assert!(!detail.rules[0].enabled);
    assert_eq!(detail.rules.len(), 1, "禁用后规则成员行应保留");

    scene_engine::set_scene_member_enabled(&conn, &scene.id, "rule", "test-rule", true).unwrap();
    let detail = scene_engine::get_scene_detail(&conn, &scene.id).unwrap();
    assert!(detail.rules[0].enabled);
}

#[test]
fn test_set_scene_member_enabled_invalid_member_type() {
    let conn = init_db();

    let dto = CreateSceneDTO {
        name: "Invalid Type Scene".to_string(),
        description: None,
        icon: None,
        skill_ids: None,
        rule_ids: None,
    };
    let scene = scene_engine::create_scene(&conn, &dto).unwrap();

    let result = scene_engine::set_scene_member_enabled(&conn, &scene.id, "bogus", "x", true);
    match result {
        Err(AppError::Validation(msg)) => assert!(msg.contains("member_type")),
        other => panic!("expected Validation error, got: {:?}", other),
    }
}

// ── CL-032 事务性场景保存回归测试 ──────────────────────────────────

fn count_rows(conn: &rusqlite::Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get::<_, i64>(0)).unwrap()
}

#[test]
fn test_create_scene_rolls_back_on_missing_skill() {
    let conn = init_db();

    // 插入一个有效技能，第二个技能不存在 → 循环中途失败
    conn.execute(
        "INSERT INTO resources (id, kind, name, source_type, installed_at, updated_at, local_path) VALUES (?1, 'skill', ?2, 'test', datetime('now'), datetime('now'), ?1)",
        rusqlite::params!["valid-skill", "Valid Skill"],
    )
    .unwrap();

    let dto = CreateSceneDTO {
        name: "Rollback Skill".to_string(),
        description: None,
        icon: None,
        skill_ids: Some(vec!["valid-skill".to_string(), "missing-skill".to_string()]),
        rule_ids: None,
    };

    let result = scene_engine::create_scene(&conn, &dto);
    match result {
        Err(AppError::SkillNotFound(id)) => assert_eq!(id, "missing-skill"),
        other => panic!("expected SkillNotFound, got: {:?}", other),
    }

    // 整体回滚：场景行与成员关联均不得残留
    assert_eq!(
        count_rows(
            &conn,
            "SELECT COUNT(*) FROM scenes WHERE id = 'rollback-skill'"
        ),
        0,
        "失败后不应残留半初始化的场景行"
    );
    assert_eq!(
        count_rows(&conn, "SELECT COUNT(*) FROM scene_items si JOIN resources r ON si.resource_id = r.id WHERE r.kind = 'skill'"),
        0,
        "失败后不应残留已插入的技能关联"
    );
}

#[test]
fn test_create_scene_rolls_back_on_missing_rule() {
    let conn = init_db();

    // 技能阶段全部成功，规则阶段中途失败 → 前面所有写入必须整体回滚
    conn.execute(
        "INSERT INTO resources (id, kind, name, source_type, installed_at, updated_at, local_path) VALUES (?1, 'skill', ?2, 'test', datetime('now'), datetime('now'), ?1)",
        rusqlite::params!["valid-skill", "Valid Skill"],
    )
    .unwrap();

    let dto = CreateSceneDTO {
        name: "Rollback Rule".to_string(),
        description: None,
        icon: None,
        skill_ids: Some(vec!["valid-skill".to_string()]),
        rule_ids: Some(vec!["missing-rule".to_string()]),
    };

    let result = scene_engine::create_scene(&conn, &dto);
    match result {
        Err(AppError::RuleNotFound(id)) => assert_eq!(id, "missing-rule"),
        other => panic!("expected RuleNotFound, got: {:?}", other),
    }

    assert_eq!(
        count_rows(
            &conn,
            "SELECT COUNT(*) FROM scenes WHERE id = 'rollback-rule'"
        ),
        0,
        "失败后不应残留场景行"
    );
    assert_eq!(
        count_rows(&conn, "SELECT COUNT(*) FROM scene_items si JOIN resources r ON si.resource_id = r.id WHERE r.kind = 'skill'"),
        0,
        "技能关联应随事务一起回滚"
    );
    assert_eq!(
        count_rows(&conn, "SELECT COUNT(*) FROM scene_items si JOIN resources r ON si.resource_id = r.id WHERE r.kind = 'rule'"),
        0,
        "失败后不应残留规则关联"
    );

    // 回滚不污染后续写入：同名场景仍可成功创建
    let retry = CreateSceneDTO {
        name: "Rollback Rule".to_string(),
        description: None,
        icon: None,
        skill_ids: Some(vec!["valid-skill".to_string()]),
        rule_ids: None,
    };
    let scene = scene_engine::create_scene(&conn, &retry).expect("回滚后同名创建应不受污染");
    assert_eq!(scene.id, "rollback-rule");
}

#[test]
fn test_delete_scene_rolls_back_on_midway_failure() {
    let conn = init_db();

    conn.execute(
        "INSERT INTO resources (id, kind, name, source_type, installed_at, updated_at, local_path) VALUES (?1, 'skill', ?2, 'test', datetime('now'), datetime('now'), ?1)",
        rusqlite::params!["s1", "Skill One"],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO resources (id, kind, name, description, source_type, format, content, version, updated_at, installed_at) VALUES (?1, 'rule', ?2, ?3, 'manual', 'directory', ?4, 1, datetime('now'), datetime('now'))",
        rusqlite::params!["r1", "Rule One", "A test", "rule content"],
    )
    .unwrap();
    // 场景须含规则成员：空表的 DELETE 不触发 BEFORE DELETE 触发器
    let dto = CreateSceneDTO {
        name: "Doomed Delete".to_string(),
        description: None,
        icon: None,
        skill_ids: Some(vec!["s1".to_string()]),
        rule_ids: Some(vec!["r1".to_string()]),
    };
    let scene = scene_engine::create_scene(&conn, &dto).unwrap();

    // 用触发器注入故障：DELETE scene_items 时中止（模拟删除序列第 1 步失败）
    conn.execute(
        "CREATE TRIGGER fail_item_delete BEFORE DELETE ON scene_items
         BEGIN SELECT RAISE(ABORT, 'simulated midway failure'); END;",
        [],
    )
    .unwrap();

    let result = scene_engine::delete_scene(&conn, &scene.id);
    assert!(result.is_err(), "触发器中止应使 delete_scene 失败");

    // 整体回滚：场景行与成员关联都必须原样保留
    assert_eq!(
        count_rows(
            &conn,
            &format!("SELECT COUNT(*) FROM scenes WHERE id = '{}'", scene.id)
        ),
        1,
        "失败后场景行必须仍然存在"
    );
    assert_eq!(
        count_rows(&conn, "SELECT COUNT(*) FROM scene_items si JOIN resources r ON si.resource_id = r.id WHERE r.kind = 'skill'"),
        1,
        "失败后技能关联必须仍然存在"
    );

    // 清除故障后可正常删除，库状态未损坏
    conn.execute("DROP TRIGGER fail_item_delete", []).unwrap();
    scene_engine::delete_scene(&conn, &scene.id).expect("清除触发器后删除应成功");
    assert_eq!(count_rows(&conn, "SELECT COUNT(*) FROM scenes"), 0);
    assert_eq!(count_rows(&conn, "SELECT COUNT(*) FROM scene_items si JOIN resources r ON si.resource_id = r.id WHERE r.kind = 'skill'"), 0);
    assert_eq!(count_rows(&conn, "SELECT COUNT(*) FROM scene_items si JOIN resources r ON si.resource_id = r.id WHERE r.kind = 'rule'"), 0);
}
