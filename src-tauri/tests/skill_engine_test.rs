use skillforge_lib::db::migrations;
/// Integration test for skill_engine core operations.
use skillforge_lib::engine::skill_engine;
use skillforge_lib::types::SkillFilter;

fn init_db() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok();
    migrations::run_migrations(&mut conn).unwrap();
    conn
}

#[test]
fn test_list_skills_empty_on_fresh_db() {
    let conn = init_db();
    let filter = SkillFilter {
        source_type: None,
        tag: None,
    };
    let skills =
        skill_engine::list_skills(&conn, &filter).expect("list_skills should succeed on fresh DB");
    assert!(skills.is_empty(), "fresh DB should have no skills");
}

#[test]
fn test_search_skills_empty() {
    let conn = init_db();
    let results = skill_engine::search_skills(&conn, "nonexistent")
        .expect("search_skills should succeed on fresh DB");
    assert!(results.is_empty());
}

#[test]
fn test_uninstall_nonexistent_skill_errors() {
    let conn = init_db();
    let result = skill_engine::uninstall_skill(&conn, "nonexistent-skill");
    assert!(
        result.is_err(),
        "uninstalling nonexistent skill should fail"
    );
}

// Note: update_skill requires a SourcePlugin, which is complex to set up
// in integration tests. It is covered by unit tests in the engine module.
