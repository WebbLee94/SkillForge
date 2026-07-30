use crate::error::AppError;

#[cfg(test)]
const CURRENT_VERSION: u32 = 3;

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
        assert!(tables.contains(&"distributions".to_string()));
        assert!(tables.contains(&"tags".to_string()));
        assert!(tables.contains(&"app_config".to_string()));
    }

    #[test]
    fn test_fresh_db_has_12_platforms() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 12);
    }

    #[test]
    fn test_distributions_has_last_synced_at() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let mut stmt = conn.prepare("PRAGMA table_info(distributions)").unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(columns.contains(&"last_synced_at".to_string()));
        assert!(!columns.contains(&"synced_at".to_string()));
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
        let exists: bool = stmt
            .query_row([], |row| Ok(row.get::<_, String>(0)?))
            .is_ok();
        assert!(!exists, "scene_platforms table should be dropped by v3");
    }
}
