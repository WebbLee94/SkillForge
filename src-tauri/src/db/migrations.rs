use crate::error::AppError;

/// v1.1.0 为首个公开基线（依据 SkillForge-docs/05-决策记录/008 决策）：
/// schema 版本从 1 重新计数，历史 v2–v6 运行时迁移链已移除，
/// 旧开发数据库不保证兼容，允许删除后由本初始化器重建。
#[cfg(test)]
const CURRENT_VERSION: u32 = 1;

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
        initialize_baseline(conn)?;
    }

    Ok(())
}

/// v1 公开基线：一次性创建当前完整 schema（全部表、索引、10 个内置平台 seed）
/// 并记录版本 1；重复调用为 no-op。
fn initialize_baseline(conn: &rusqlite::Connection) -> Result<(), AppError> {
    crate::db::schema::create_tables(conn)?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![1, now],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_database_initializes_as_version_one_baseline() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let version: u32 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 1);
    }

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

        for table in [
            "resources",
            "resource_tags",
            "scene_items",
            "tags",
            "scenes",
            "projects",
            "platforms",
        ] {
            assert!(tables.contains(&table.to_string()), "基线应包含表 {table}");
        }
        assert!(!tables.contains(&"distributions".to_string()));
        assert!(!tables.contains(&"app_config".to_string()));
        assert!(!tables.contains(&"sync_logs".to_string()));
        assert!(!tables.contains(&"skill_versions".to_string()));
        assert!(!tables.contains(&"rule_history".to_string()));
        assert!(!tables.contains(&"scene_platforms".to_string()));
        assert!(!tables.contains(&"watcher_events".to_string()));
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
    fn test_fresh_db_baseline_has_current_resource_columns() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // 统一资源模型（47 号 §四附）：content_hash / sync_status 死列不入 resources
        let mut stmt = conn.prepare("PRAGMA table_info(resources)").unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(columns.contains(&"kind".to_string()));
        assert!(columns.contains(&"local_path".to_string()));
        assert!(!columns.contains(&"content_hash".to_string()));
        assert!(!columns.contains(&"sync_status".to_string()));

        let mut stmt = conn.prepare("PRAGMA table_info(projects)").unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(!columns.contains(&"scene_id".to_string()));
    }
}
