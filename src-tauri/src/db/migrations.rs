use crate::error::AppError;

#[cfg(test)]
const CURRENT_VERSION: u32 = 6;

pub fn run_migrations(conn: &mut rusqlite::Connection) -> Result<(), AppError> {
    // Create schema_version tracking table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )?;

    let current: u32 = conn
        .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
            row.get::<_, Option<u32>>(0)
        })
        .unwrap_or(None)
        .unwrap_or(0);

    if current < 1 {
        apply_v1(conn)?;
    }

    if current < 2 {
        apply_v2(conn)?;
    }

    if current < 3 {
        apply_v3(conn)?;
    }

    if current < 4 {
        apply_v4(conn)?;
    }

    if current < 5 {
        apply_v5(conn)?;
    }

    if current < 6 {
        apply_v6(conn)?;
    }

    Ok(())
}

fn apply_v1(conn: &rusqlite::Connection) -> Result<(), AppError> {
    crate::db::schema::create_tables(conn)?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![1, now],
    )?;

    Ok(())
}

fn apply_v2(conn: &rusqlite::Connection) -> Result<(), AppError> {
    let columns: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(skills)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    if !columns.contains(&"content_hash".to_string()) {
        conn.execute("ALTER TABLE skills ADD COLUMN content_hash TEXT", [])?;
    }
    if !columns.contains(&"sync_status".to_string()) {
        conn.execute(
            "ALTER TABLE skills ADD COLUMN sync_status TEXT DEFAULT 'synced'",
            [],
        )?;
    }

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS watcher_events (
             id          INTEGER PRIMARY KEY AUTOINCREMENT,
             event_type  TEXT NOT NULL,
             capability  TEXT NOT NULL,
             path        TEXT NOT NULL,
             platform    TEXT,
             old_hash    TEXT,
             new_hash    TEXT,
             handled     INTEGER DEFAULT 0,
             created_at  TEXT DEFAULT (datetime('now'))
         );",
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![2, now],
    )?;
    Ok(())
}

fn apply_v3(conn: &rusqlite::Connection) -> Result<(), AppError> {
    conn.execute_batch("DROP TABLE IF EXISTS scene_platforms;")?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![3, now],
    )?;
    Ok(())
}

fn apply_v4(conn: &rusqlite::Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "DELETE FROM platforms WHERE id IN ('antigravity', 'windsurf');
         DELETE FROM watcher_events WHERE platform IN ('antigravity', 'windsurf');",
    )?;
    // sync_logs 表在 v6 已删除；旧库升级时若存在则清理，新库直接跳过
    let sync_logs_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sync_logs'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);
    if sync_logs_exists {
        conn.execute(
            "DELETE FROM sync_logs WHERE platform_id IN ('antigravity', 'windsurf')",
            [],
        )?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![4, now],
    )?;
    Ok(())
}

fn apply_v5(conn: &rusqlite::Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "DELETE FROM scenes WHERE id = '__all_skills__';
         UPDATE scenes SET is_system = 0 WHERE is_system = 1;",
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![5, now],
    )?;
    Ok(())
}

/// v6: 删除五张未闭环表（skill_versions/rule_history/distributions/sync_logs/app_config），
/// projects 移除 scene_id（Scene 不再绑定项目，仅作临时分发组合）。
/// 依据：SkillForge-docs 04-方案设计/11-v1.1.0-极简正确Schema与分发状态基线设计.md（设计已确认）。
fn apply_v6(conn: &rusqlite::Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS skill_versions;
         DROP TABLE IF EXISTS rule_history;
         DROP TABLE IF EXISTS distributions;
         DROP TABLE IF EXISTS sync_logs;
         DROP TABLE IF EXISTS app_config;",
    )?;
    // projects.scene_id 在 v6 schema 中已不存在；旧库升级时若存在则删除，新库跳过
    let has_scene_id: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name = 'scene_id'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);
    if has_scene_id {
        conn.execute("ALTER TABLE projects DROP COLUMN scene_id", [])?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![6, now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_fresh_db() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let version: u32 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, CURRENT_VERSION);
    }

    #[test]
    fn test_migrations_idempotent() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();
        // Run again - should be no-op
        run_migrations(&mut conn).unwrap();

        let version: u32 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, CURRENT_VERSION);
    }

    #[test]
    fn test_fresh_db_has_all_tables() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"skills".to_string()));
        assert!(tables.contains(&"scenes".to_string()));
        assert!(tables.contains(&"platforms".to_string()));
        assert!(tables.contains(&"projects".to_string()));
        assert!(tables.contains(&"tags".to_string()));
        assert!(!tables.contains(&"distributions".to_string()));
        assert!(!tables.contains(&"app_config".to_string()));
        assert!(!tables.contains(&"sync_logs".to_string()));
        assert!(!tables.contains(&"skill_versions".to_string()));
        assert!(!tables.contains(&"rule_history".to_string()));
    }

    #[test]
    fn test_fresh_db_has_10_platforms() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 10);
    }

    #[test]
    fn test_v2_migration_adds_columns_and_watcher_table() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // Verify skills table has new columns
        let mut stmt = conn.prepare("PRAGMA table_info(skills)").unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(columns.contains(&"content_hash".to_string()));
        assert!(columns.contains(&"sync_status".to_string()));

        // Verify watcher_events table exists
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='watcher_events'")
            .unwrap();
        let table: String = stmt.query_row([], |row| row.get(0)).unwrap();
        assert_eq!(table, "watcher_events");

        // Verify migration version is 2
        let version: u32 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(version >= 2);
    }

    #[test]
    fn test_v3_migration_drops_scene_platforms() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scene_platforms'")
            .unwrap();
        let exists: bool = stmt.query_row([], |row| row.get::<_, String>(0)).is_ok();
        assert!(!exists, "scene_platforms table should be dropped by v3");
    }

    #[test]
    fn test_v4_migration_removes_deprecated_platforms() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        // Simulate a v3-era DB: tables + legacy platform rows + version rows
        crate::db::schema::create_tables(&conn).unwrap();
        conn.execute(
            "INSERT INTO platforms (id, name, adapter, enabled, icon) VALUES (?1, ?2, ?3, 1, NULL)",
            rusqlite::params!["antigravity", "Antigravity", "antigravity"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO platforms (id, name, adapter, enabled, icon) VALUES (?1, ?2, ?3, 1, NULL)",
            rusqlite::params!["windsurf", "Windsurf", "windsurf"],
        )
        .unwrap();
        // 模拟 v3-era sync_logs 表（create_tables 现在是 v6 schema，测试里显式重建）
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                platform_id TEXT,
                status TEXT NOT NULL,
                message TEXT,
                created_at TEXT NOT NULL
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sync_logs (action, target_type, target_id, platform_id, status, created_at) VALUES ('install', 'skill', 'x', 'windsurf', 'ok', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );",
        )
        .unwrap();
        for v in [1u32, 2, 3] {
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![v, now],
            )
            .unwrap();
        }

        run_migrations(&mut conn).unwrap();

        let platform_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM platforms WHERE id IN ('antigravity','windsurf')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(platform_count, 0);
        // v6 后 sync_logs 表整体删除，不再有逐行清理断言
        let sync_logs_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sync_logs'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
            > 0;
        assert!(!sync_logs_exists, "sync_logs 表应在 v6 被删除");
        let version: u32 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 6);
    }

    #[test]
    fn test_v5_migration_removes_system_scenes() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::schema::create_tables(&conn).unwrap();

        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 1, ?4, ?5)",
            rusqlite::params!["__all_skills__", "All Skills", "Virtual", now, now],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 1, ?4, ?5)",
            rusqlite::params!["old-system", "Old System", "Desc", now, now],
        ).unwrap();

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
        ).unwrap();
        for v in [1u32, 2, 3, 4] {
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![v, now],
            )
            .unwrap();
        }

        super::run_migrations(&mut conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scenes WHERE id = '__all_skills__'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);

        let is_system: i32 = conn
            .query_row(
                "SELECT is_system FROM scenes WHERE id = 'old-system'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(is_system, 0);

        let version: u32 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 6);
    }

    #[test]
    fn test_v6_migration_drops_unclosed_tables() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::schema::create_tables(&conn).unwrap();

        let now = chrono::Utc::now().to_rfc3339();
        // 模拟 v5 DB：恢复五张表与 projects.scene_id（create_tables 现在是 v6 schema，测试里显式重建旧结构）
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS skill_versions (skill_id TEXT NOT NULL, version TEXT NOT NULL, PRIMARY KEY (skill_id, version));
             CREATE TABLE IF NOT EXISTS rule_history (rule_id TEXT NOT NULL, version INTEGER NOT NULL, content TEXT NOT NULL, changed_at TEXT NOT NULL, PRIMARY KEY (rule_id, version));
             CREATE TABLE IF NOT EXISTS distributions (id INTEGER PRIMARY KEY AUTOINCREMENT, scene_id TEXT NOT NULL, platform_id TEXT NOT NULL, scope TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS sync_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT);",
        )
        .unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES ('s1', 'Scene', '', 0, 0, ?1, ?2)",
            rusqlite::params![now, now],
        ).unwrap();
        conn.execute_batch(
            "ALTER TABLE projects ADD COLUMN scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL;",
        )
        .unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, path, scene_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params!["p1", "Proj", "/tmp/p1", "s1", now, now],
        ).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
        ).unwrap();
        for v in [1u32, 2, 3, 4, 5] {
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![v, now],
            )
            .unwrap();
        }

        super::run_migrations(&mut conn).unwrap();

        for table in [
            "skill_versions",
            "rule_history",
            "distributions",
            "sync_logs",
            "app_config",
        ] {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'"
                ))
                .unwrap();
            let exists = stmt.query_row([], |row| row.get::<_, String>(0)).is_ok();
            assert!(!exists, "表 {table} 应在 v6 被删除");
        }

        let mut stmt = conn.prepare("PRAGMA table_info(projects)").unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(
            !columns.contains(&"scene_id".to_string()),
            "projects.scene_id 应在 v6 被删除"
        );

        let version: u32 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 6);
    }
}
