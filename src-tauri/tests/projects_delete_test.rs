//! Integration tests for Phase 7 confirmed batch project deletion semantics.
//!
//! Confirmed semantics (docs `04-方案设计/12-v1.1.0三大工作区交互规格.md` §2.6 / closeout A21):
//! - Project deletion is **batch-only** — the command accepts a list of ids and
//!   reports per-id outcomes (`deleted` vs `not_found`), never a hard error for
//!   a stale id mid-batch.
//! - Deletion only removes the SkillForge `projects` row. It must **not** delete
//!   the project directory on disk, and must **not** delete / cascade into
//!   skills, rules, or scenes.
//!
//! The core logic (`commands::projects::delete_projects_inner`) is tested
//! directly against an in-memory migrated DB, matching the pattern used by
//! `tests/resource_queries_test.rs`.

use skillforge_lib::commands::projects::delete_projects_inner;
use skillforge_lib::db::migrations;

fn init_db() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok();
    migrations::run_migrations(&mut conn).unwrap();
    conn
}

fn insert_project(conn: &rusqlite::Connection, id: &str, path: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO projects (id, name, path, description, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, id, path, "a project", now, now],
    )
    .unwrap();
}

fn project_count(conn: &rusqlite::Connection, id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM projects WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get::<_, i64>(0),
    )
    .unwrap()
}

fn insert_skill(conn: &rusqlite::Connection, id: &str, local_path: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO resources (id, kind, name, description, source_type, installed_at, updated_at, local_path)
         VALUES (?1, 'skill', ?2, ?3, ?4, ?5, ?5, ?6)",
        rusqlite::params![id, id, "a skill", "local-fs", now, local_path],
    )
    .unwrap();
}

fn insert_rule(conn: &rusqlite::Connection, id: &str) {
    conn.execute(
        "INSERT INTO resources (id, kind, name, description, source_type, format, content, platform, scope, version, updated_at, installed_at)
         VALUES (?1, 'rule', ?2, ?3, 'manual', 'md', '# content', 'claude-code', 'global', 1, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
        rusqlite::params![id, id, "a rule"],
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

// ── core semantics: per-id result reporting ─────────────────────────

#[test]
fn delete_projects_deletes_all_existing_ids() {
    let conn = init_db();
    insert_project(&conn, "proj-a", "/tmp/proj-a");
    insert_project(&conn, "proj-b", "/tmp/proj-b");

    let result = delete_projects_inner(&conn, vec!["proj-a".into(), "proj-b".into()])
        .expect("batch delete must succeed");

    assert_eq!(result.deleted, vec!["proj-a", "proj-b"]);
    assert!(result.not_found.is_empty(), "all ids existed");
    assert_eq!(project_count(&conn, "proj-a"), 0);
    assert_eq!(project_count(&conn, "proj-b"), 0);
}

#[test]
fn delete_projects_reports_missing_ids_in_not_found_without_failing() {
    let conn = init_db();
    insert_project(&conn, "proj-a", "/tmp/proj-a");

    let result = delete_projects_inner(&conn, vec!["proj-a".into(), "ghost".into()])
        .expect("a stale id must not fail the whole batch");

    assert_eq!(result.deleted, vec!["proj-a"]);
    assert_eq!(result.not_found, vec!["ghost"]);
    assert_eq!(project_count(&conn, "proj-a"), 0);
}

#[test]
fn delete_projects_with_only_missing_ids_reports_all_not_found() {
    let conn = init_db();

    let result = delete_projects_inner(&conn, vec!["ghost-1".into(), "ghost-2".into()])
        .expect("missing-only batch must still succeed");

    assert!(result.deleted.is_empty());
    assert_eq!(result.not_found, vec!["ghost-1", "ghost-2"]);
}

#[test]
fn delete_projects_empty_input_returns_empty_result() {
    let conn = init_db();

    let result = delete_projects_inner(&conn, vec![]).expect("empty batch must succeed");
    assert!(result.deleted.is_empty());
    assert!(result.not_found.is_empty());
}

#[test]
fn delete_projects_deduplicates_input_ids() {
    let conn = init_db();
    insert_project(&conn, "proj-a", "/tmp/proj-a");

    let result = delete_projects_inner(&conn, vec!["proj-a".into(), "proj-a".into()])
        .expect("batch must succeed");
    assert_eq!(result.deleted, vec!["proj-a"]);
}

#[test]
fn delete_projects_leaves_unrelated_projects_untouched() {
    let conn = init_db();
    insert_project(&conn, "proj-a", "/tmp/proj-a");
    insert_project(&conn, "proj-b", "/tmp/proj-b");

    let result = delete_projects_inner(&conn, vec!["proj-a".into()]).expect("batch must succeed");
    assert_eq!(result.deleted, vec!["proj-a"]);
    assert_eq!(
        project_count(&conn, "proj-b"),
        1,
        "unrelated project must survive"
    );
}

// ── confirmed boundaries: no fs deletion, no resource deletion ──────

#[test]
fn delete_projects_never_touches_the_filesystem() {
    let conn = init_db();
    let dir = tempfile::tempdir().unwrap();
    let project_dir = dir.path().join("proj-on-disk");
    std::fs::create_dir_all(&project_dir).unwrap();
    std::fs::write(project_dir.join("README.md"), "# project").unwrap();

    insert_project(&conn, "proj-a", project_dir.to_string_lossy().as_ref());

    delete_projects_inner(&conn, vec!["proj-a".into()]).expect("batch must succeed");

    assert!(
        project_dir.exists(),
        "deleting the SkillForge record must NOT delete the project directory"
    );
    assert!(
        project_dir.join("README.md").exists(),
        "project files must survive record deletion"
    );
}

#[test]
fn delete_projects_does_not_delete_skills_rules_or_scenes() {
    let conn = init_db();
    insert_project(&conn, "proj-a", "/tmp/proj-a");
    insert_skill(&conn, "keep-skill", "/tmp/keep-skill");
    insert_rule(&conn, "keep-rule");
    insert_scene(&conn, "keep-scene");

    delete_projects_inner(&conn, vec!["proj-a".into()]).expect("batch must succeed");

    let skill_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM resources WHERE id = 'keep-skill' AND kind = 'skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let rule_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM resources WHERE id = 'keep-rule' AND kind = 'rule'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let scene_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM scenes WHERE id = 'keep-scene'",
            [],
            |r| r.get(0),
        )
        .unwrap();

    assert_eq!(skill_count, 1, "skill must survive project deletion");
    assert_eq!(rule_count, 1, "rule must survive project deletion");
    assert_eq!(scene_count, 1, "scene must survive project deletion");
}

#[test]
fn delete_projects_is_atomic_across_the_batch() {
    let conn = init_db();
    insert_project(&conn, "proj-a", "/tmp/proj-a");

    let result = delete_projects_inner(&conn, vec!["proj-a".into(), "ghost".into()])
        .expect("batch must succeed");
    assert_eq!(result.deleted, vec!["proj-a"]);
    assert_eq!(result.not_found, vec!["ghost"]);
}
