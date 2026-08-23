//! v1.1.0 发布级冷启动与公开基线验证测试（实施计划 Task 4）：
//! fresh 数据库经 `run_migrations` 应直接得到 v1 公开基线 ——
//! 表结构、索引、10 平台 seed、版本号与幂等性均按当前 schema 事实核对。
//!
//! 注意：`CURRENT_VERSION` 仅在 `#[cfg(test)]` 下可见，
//! 集成测试一律使用字面量 `1` 断言版本，不改变生产代码可见性。

use skillforge_lib::db::migrations;

const BASELINE_VERSION: u32 = 1;

const BASELINE_TABLES: [&str; 12] = [
    "schema_version",
    "skills",
    "tags",
    "skill_tags",
    "rules",
    "rule_tags",
    "scenes",
    "scene_skills",
    "scene_rules",
    "projects",
    "platforms",
    "watcher_events",
];

const SQLITE_INTERNAL_TABLES: [&str; 1] = ["sqlite_sequence"];

const REMOVED_LEGACY_TABLES: [&str; 6] = [
    "skill_versions",
    "rule_history",
    "distributions",
    "sync_logs",
    "app_config",
    "scene_platforms",
];

const BASELINE_PLATFORM_IDS: [&str; 10] = [
    "claude-code",
    "opencode",
    "cursor",
    "trae",
    "trae-cn",
    "codebuddy",
    "codebuddy-cn",
    "codex",
    "hermes",
    "openclaw",
];

const BASELINE_INDEXES: [&str; 3] = [
    "idx_skills_source_type",
    "idx_tags_name_type",
    "idx_scene_skills_scene",
];

fn cold_start_in_memory() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    migrations::run_migrations(&mut conn).unwrap();
    conn
}

fn object_names(conn: &rusqlite::Connection, object_type: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT name FROM sqlite_master WHERE type='{object_type}' ORDER BY name"
        ))
        .unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

fn baseline_version(conn: &rusqlite::Connection) -> u32 {
    conn.query_row("SELECT MAX(version) FROM schema_version", [], |row| {
        row.get(0)
    })
    .unwrap()
}

#[test]
fn cold_start_creates_public_v1_baseline() {
    let conn = cold_start_in_memory();

    let tables = object_names(&conn, "table");
    for table in ["skills", "rules", "scenes", "projects", "platforms"] {
        assert!(
            tables.contains(&table.to_string()),
            "冷启动后应存在表 {table}"
        );
    }
    assert_eq!(
        baseline_version(&conn),
        BASELINE_VERSION,
        "空库 run_migrations 后应报告 schema_version=1"
    );
}

#[test]
fn baseline_contains_full_current_schema() {
    let conn = cold_start_in_memory();

    let tables = object_names(&conn, "table");
    for table in BASELINE_TABLES {
        assert!(tables.contains(&table.to_string()), "基线应包含表 {table}");
    }
    for internal in SQLITE_INTERNAL_TABLES {
        assert!(
            tables.contains(&internal.to_string()),
            "{internal} 由 AUTOINCREMENT 隐式创建，应存在于基线中"
        );
    }

    let indexes = object_names(&conn, "index");
    for index in BASELINE_INDEXES {
        assert!(
            indexes.contains(&index.to_string()),
            "基线应包含索引 {index}"
        );
    }
}

#[test]
fn baseline_excludes_removed_legacy_tables() {
    let conn = cold_start_in_memory();

    let tables = object_names(&conn, "table");
    for table in REMOVED_LEGACY_TABLES {
        assert!(
            !tables.contains(&table.to_string()),
            "基线不应包含遗留表 {table}"
        );
    }

    assert_eq!(
        tables.len(),
        BASELINE_TABLES.len() + SQLITE_INTERNAL_TABLES.len(),
        "基线表数量应与公开 schema 完全一致，实际表：{tables:?}"
    );
}

#[test]
fn baseline_seeds_exactly_10_builtin_platforms() {
    let conn = cold_start_in_memory();

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 10);

    let mut ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM platforms ORDER BY id")
            .unwrap();
        stmt.query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    };
    ids.sort();

    let mut expected: Vec<String> = BASELINE_PLATFORM_IDS
        .iter()
        .map(|s| s.to_string())
        .collect();
    expected.sort();
    assert_eq!(ids, expected, "内置平台 seed 应与基线定义完全一致");

    let disabled: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM platforms WHERE enabled != 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(disabled, 0, "全部内置平台默认应处于启用状态");
}

#[test]
fn rerun_migrations_is_release_baseline_noop() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    migrations::run_migrations(&mut conn).unwrap();
    migrations::run_migrations(&mut conn).unwrap();

    assert_eq!(baseline_version(&conn), BASELINE_VERSION);

    let applied_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM schema_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(applied_rows, 1, "重复迁移不得追加新的版本记录");

    let platform_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0))
        .unwrap();
    assert_eq!(platform_count, 10, "重复迁移不得重复 seed 平台");

    let legacy_leftovers: i64 = REMOVED_LEGACY_TABLES
        .iter()
        .map(|t| {
            object_names(&conn, "table")
                .iter()
                .filter(|name| name == t)
                .count() as i64
        })
        .sum();
    assert_eq!(legacy_leftovers, 0);
}

#[test]
fn cold_start_on_disk_persists_v1_baseline_across_restart() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("skillforge.db");

    {
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        migrations::run_migrations(&mut conn).unwrap();
    }

    let mut conn = rusqlite::Connection::open(&db_path).unwrap();
    migrations::run_migrations(&mut conn).unwrap();

    assert_eq!(baseline_version(&conn), BASELINE_VERSION);
    let applied_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM schema_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(applied_rows, 1, "重启后再次迁移不得追加版本记录");

    let platform_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0))
        .unwrap();
    assert_eq!(platform_count, 10);
}
