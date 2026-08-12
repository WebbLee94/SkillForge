use crate::error::AppError;

pub fn create_tables(conn: &rusqlite::Connection) -> Result<(), AppError> {
    // ── skills ─────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skills (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            source_type TEXT NOT NULL,
            source_url  TEXT,
            current_ver TEXT,
            installed_at TEXT NOT NULL,
            local_path  TEXT NOT NULL,
            metadata    TEXT,
            content_hash TEXT,
            sync_status  TEXT DEFAULT 'synced'
        );",
    )?;

    // ── tags ───────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tags (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            name     TEXT NOT NULL,
            color    TEXT,
            category TEXT,
            tag_type TEXT NOT NULL DEFAULT 'skill' CHECK(tag_type IN ('skill','rule'))
        );",
    )?;

    // ── skill_tags ─────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skill_tags (
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (skill_id, tag_id)
        );",
    )?;

    // ── rules ──────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS rules (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            format      TEXT NOT NULL,
            content     TEXT NOT NULL,
            platform    TEXT,
            scope       TEXT,
            version     INTEGER NOT NULL DEFAULT 1,
            updated_at  TEXT NOT NULL
        );",
    )?;

    // ── rule_tags ──────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS rule_tags (
            rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
            tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (rule_id, tag_id)
        );",
    )?;

    // ── scenes ─────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scenes (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            icon        TEXT,
            is_template INTEGER NOT NULL DEFAULT 0,
            is_system   INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );",
    )?;

    // ── scene_skills ───────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scene_skills (
            scene_id   TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
            skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            version    TEXT,
            enabled    INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            config     TEXT,
            PRIMARY KEY (scene_id, skill_id)
        );",
    )?;

    // ── scene_rules ────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scene_rules (
            scene_id   TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
            rule_id    TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
            enabled    INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (scene_id, rule_id)
        );",
    )?;

    // ── projects ───────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS projects (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            path        TEXT UNIQUE NOT NULL,
            description TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );",
    )?;

    // ── platforms ──────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS platforms (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            adapter      TEXT NOT NULL,
            enabled      INTEGER NOT NULL DEFAULT 1,
            icon         TEXT
        );",
    )?;

    // ── watcher_events ──────────────────────────────────────────────
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

    // ── Indexes ────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_skills_source_type ON skills(source_type);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_type ON tags(name, tag_type);
         CREATE INDEX IF NOT EXISTS idx_scene_skills_scene ON scene_skills(scene_id);",
    )?;

    // ── Built-in data: platforms ───────────────────────────────────
    let platforms = [
        ("claude-code", "Claude Code", "claude-code"),
        ("opencode", "OpenCode", "opencode"),
        ("cursor", "Cursor", "cursor"),
        ("trae", "Trae", "trae"),
        ("trae-cn", "Trae CN", "trae-cn"),
        ("codebuddy", "CodeBuddy", "codebuddy"),
        ("codebuddy-cn", "CodeBuddy CN", "codebuddy-cn"),
        ("codex", "Codex", "codex"),
        ("hermes", "Hermes Agent", "hermes"),
        ("openclaw", "OpenClaw", "openclaw"),
    ];

    for (id, name, adapter) in &platforms {
        conn.execute(
            "INSERT OR IGNORE INTO platforms (id, name, adapter, enabled, icon) VALUES (?1, ?2, ?3, 1, NULL)",
            rusqlite::params![id, name, adapter],
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_tables() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();

        // Verify tables exist
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
        assert!(tables.contains(&"skill_tags".to_string()));
        assert!(tables.contains(&"rule_tags".to_string()));
        assert!(tables.contains(&"scene_skills".to_string()));
        assert!(tables.contains(&"scene_rules".to_string()));

        for table in [
            "skill_versions",
            "rule_history",
            "distributions",
            "sync_logs",
            "app_config",
        ] {
            assert!(
                !tables.contains(&table.to_string()),
                "表 {table} 不应存在于 v6 schema"
            );
        }

        let mut stmt = conn.prepare("PRAGMA table_info(projects)").unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(
            !columns.contains(&"scene_id".to_string()),
            "projects.scene_id 不应存在于 v6 schema"
        );

        // Verify built-in platforms
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 10);
    }
}
