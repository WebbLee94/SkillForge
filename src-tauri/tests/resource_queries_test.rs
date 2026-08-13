//! Integration tests for the Phase 7 resource-library query support:
//!
//! 1. `skill_engine::managed_copy_path` — reveal path of a skill's managed
//!    copy under `~/.skillforge/skills/{id}`, with **filesystem-as-truth**
//!    semantics: returns `Some(path)` only when the copy physically exists,
//!    `None` when the DB row still points at a missing directory. Never
//!    fabricates a distribution status.
//! 2. `scene_engine::count_skill_scene_references` /
//!    `scene_engine::count_rule_scene_references` — scene reference counts
//!    used for accurate delete confirmation.

use skillforge_lib::db::migrations;
use skillforge_lib::engine::{scene_engine, skill_engine};
use skillforge_lib::error::AppError;

fn init_db() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok();
    migrations::run_migrations(&mut conn).unwrap();
    conn
}

fn insert_skill(
    conn: &rusqlite::Connection,
    id: &str,
    local_path: &std::path::Path,
) {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO skills (id, name, description, source_type, installed_at, local_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            id,
            id,
            "a skill",
            "local-fs",
            now,
            local_path.to_string_lossy().to_string()
        ],
    )
    .unwrap();
}

fn insert_scene(conn: &rusqlite::Connection, id: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
        rusqlite::params![id, id, "a scene", now, now],
    )
    .unwrap();
}

// ── skill_engine::managed_copy_path ─────────────────────────────────

#[test]
fn skill_managed_copy_path_returns_path_when_managed_dir_exists() {
    let conn = init_db();
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("my-skill")).unwrap();
    std::fs::write(dir.path().join("my-skill/SKILL.md"), "# skill").unwrap();

    insert_skill(&conn, "my-skill", &dir.path().join("my-skill"));

    let path = skill_engine::managed_copy_path(&conn, "my-skill")
        .expect("query should succeed")
        .expect("managed copy exists on disk, so a path must be returned");
    assert_eq!(
        std::path::Path::new(&path),
        dir.path().join("my-skill"),
        "returned path must be the skill's managed copy directory"
    );
}

#[test]
fn skill_managed_copy_path_returns_none_when_managed_dir_is_missing() {
    let conn = init_db();
    let dir = tempfile::tempdir().unwrap();

    // DB row points at a managed copy that does NOT exist on disk.
    insert_skill(&conn, "ghost-skill", &dir.path().join("ghost-skill"));

    let path = skill_engine::managed_copy_path(&conn, "ghost-skill")
        .expect("query should succeed");
    assert!(
        path.is_none(),
        "filesystem-as-truth: a missing managed copy must yield None, not a fake path"
    );
}

#[test]
fn skill_managed_copy_path_unknown_skill_errors() {
    let conn = init_db();
    let err = skill_engine::managed_copy_path(&conn, "missing-skill").unwrap_err();
    assert!(
        matches!(err, AppError::SkillNotFound(_)),
        "unknown skill must be reported as not found, got: {err:?}"
    );
}

// ── scene reference counts ──────────────────────────────────────────

#[test]
fn skill_scene_reference_count_counts_all_referencing_scenes() {
    let conn = init_db();
    let dir = tempfile::tempdir().unwrap();
    insert_skill(&conn, "shared-skill", &dir.path().join("shared-skill"));

    for scene_id in ["scene-a", "scene-b", "scene-c"] {
        insert_scene(&conn, scene_id);
        conn.execute(
            "INSERT INTO scene_skills (scene_id, skill_id, enabled, sort_order)
             VALUES (?1, ?2, 1, 0)",
            rusqlite::params![scene_id, "shared-skill"],
        )
        .unwrap();
    }

    let count = scene_engine::count_skill_scene_references(&conn, "shared-skill")
        .expect("query should succeed");
    assert_eq!(count, 3, "skill referenced by 3 scenes must report 3");
}

#[test]
fn skill_scene_reference_count_zero_when_unreferenced() {
    let conn = init_db();
    let dir = tempfile::tempdir().unwrap();
    insert_skill(&conn, "unused-skill", &dir.path().join("unused-skill"));

    let count = scene_engine::count_skill_scene_references(&conn, "unused-skill")
        .expect("query should succeed");
    assert_eq!(count, 0, "unreferenced skill must report 0");
}

#[test]
fn rule_scene_reference_count_counts_all_referencing_scenes() {
    let conn = init_db();
    conn.execute(
        "INSERT INTO rules (id, name, description, format, content, platform, scope, version, updated_at)
         VALUES ('my-rule', 'My Rule', 'desc', 'md', '# content', 'claude-code', 'global', 1, '2024-01-01T00:00:00Z')",
        [],
    )
    .unwrap();

    for scene_id in ["scene-x", "scene-y"] {
        insert_scene(&conn, scene_id);
        conn.execute(
            "INSERT INTO scene_rules (scene_id, rule_id, enabled, sort_order)
             VALUES (?1, ?2, 1, 0)",
            rusqlite::params![scene_id, "my-rule"],
        )
        .unwrap();
    }

    let count = scene_engine::count_rule_scene_references(&conn, "my-rule")
        .expect("query should succeed");
    assert_eq!(count, 2, "rule referenced by 2 scenes must report 2");
}

#[test]
fn rule_scene_reference_count_zero_when_unreferenced() {
    let conn = init_db();
    conn.execute(
        "INSERT INTO rules (id, name, description, format, content, platform, scope, version, updated_at)
         VALUES ('solo-rule', 'Solo', 'desc', 'md', '# content', 'claude-code', 'global', 1, '2024-01-01T00:00:00Z')",
        [],
    )
    .unwrap();

    let count = scene_engine::count_rule_scene_references(&conn, "solo-rule")
        .expect("query should succeed");
    assert_eq!(count, 0, "unreferenced rule must report 0");
}
