use crate::error::AppError;

#[cfg(test)]
const CURRENT_VERSION: u32 = 5;

pub fn run_migrations(conn: &mut rusqlite::Connection) -> Result<(), AppError> {
    // Create schema_version tracking table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );"
    )?;

    let current: u32 = conn
        .query_row(
            "SELECT MAX(version) FROM schema_version",
            [],
            |row| row.get::<_, Option<u32>>(0),
        )
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
    // Add is_system column to scenes if not exists
    let has_is_system: bool = {
        let mut stmt = conn.prepare("PRAGMA table_info(scenes)")?;
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        columns.iter().any(|c| c == "is_system")
    };

    if !has_is_system {
        conn.execute_batch(
            "ALTER TABLE scenes ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;"
        )?;
    }

    // Ensure __all_skills__ scene has is_system = 1
    conn.execute(
        "UPDATE scenes SET is_system = 1 WHERE id = '__all_skills__'",
        [],
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![2, now],
    )?;

    Ok(())
}

fn apply_v3(conn: &rusqlite::Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        INSERT OR IGNORE INTO app_config (key, value) VALUES ('global_scene_id', NULL);"
    )?;

    // Auto-migrate: if skills exist but no user scene, create "默认场景" with all skills
    let skill_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM skills", [], |r| r.get(0))
        .unwrap_or(0);
    let user_scene_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM scenes WHERE is_system = 0", [], |r| r.get(0))
        .unwrap_or(0);

    if skill_count > 0 && user_scene_count == 0 {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at)
             VALUES ('default-scene', '默认场景', '自动创建的默认场景，包含所有已安装技能', 0, 0, ?1, ?2)",
            rusqlite::params![now, now],
        )?;
        // Add all skills to default scene
        conn.execute(
            "INSERT OR IGNORE INTO scene_skills (scene_id, skill_id, version, enabled, sort_order)
             SELECT 'default-scene', id, current_ver, 1, 0 FROM skills",
            [],
        )?;
        conn.execute(
            "UPDATE app_config SET value = 'default-scene' WHERE key = 'global_scene_id'",
            [],
        )?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![3, now],
    )?;

    Ok(())
}

fn apply_v4(conn: &rusqlite::Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scene_platforms (
            scene_id    TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
            platform_id TEXT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
            PRIMARY KEY (scene_id, platform_id)
        );"
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![4, now],
    )?;

    Ok(())
}

fn apply_v5(conn: &rusqlite::Connection) -> Result<(), AppError> {
    // Add enabled column to platforms if not exists
    let has_enabled: bool = {
        let mut stmt = conn.prepare("PRAGMA table_info(platforms)")?;
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        columns.iter().any(|c| c == "enabled")
    };

    if !has_enabled {
        conn.execute_batch(
            "ALTER TABLE platforms ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;"
        )?;
    }

    // Add icon column to platforms if not exists
    let has_icon: bool = {
        let mut stmt = conn.prepare("PRAGMA table_info(platforms)")?;
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        columns.iter().any(|c| c == "icon")
    };

    if !has_icon {
        conn.execute_batch(
            "ALTER TABLE platforms ADD COLUMN icon TEXT;"
        )?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![5, now],
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
            .query_row(
                "SELECT MAX(version) FROM schema_version",
                [],
                |row| row.get(0),
            )
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
            .query_row(
                "SELECT MAX(version) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, CURRENT_VERSION);
    }
}
