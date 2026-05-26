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
            metadata    TEXT
        );"
    )?;

    // ── skill_versions ─────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skill_versions (
            skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            version    TEXT NOT NULL,
            source_ref TEXT,
            checksum   TEXT,
            fetched_at TEXT NOT NULL,
            PRIMARY KEY (skill_id, version)
        );"
    )?;

    // ── tags ───────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tags (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            name     TEXT UNIQUE NOT NULL,
            color    TEXT,
            category TEXT
        );"
    )?;

    // ── skill_tags ─────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skill_tags (
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (skill_id, tag_id)
        );"
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
        );"
    )?;

    // ── rule_history ───────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS rule_history (
            rule_id    TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
            version    INTEGER NOT NULL,
            content    TEXT NOT NULL,
            changed_at TEXT NOT NULL,
            PRIMARY KEY (rule_id, version)
        );"
    )?;

    // ── rule_tags ──────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS rule_tags (
            rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
            tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (rule_id, tag_id)
        );"
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
        );"
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
        );"
    )?;

    // ── scene_rules ────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scene_rules (
            scene_id   TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
            rule_id    TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
            enabled    INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (scene_id, rule_id)
        );"
    )?;

    // ── projects ───────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS projects (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            path        TEXT UNIQUE NOT NULL,
            scene_id    TEXT REFERENCES scenes(id) ON DELETE SET NULL,
            description TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );"
    )?;

    // ── platforms ──────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS platforms (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            adapter      TEXT NOT NULL,
            global_path  TEXT,
            project_path TEXT,
            enabled      INTEGER NOT NULL DEFAULT 1,
            icon         TEXT
        );"
    )?;

    // ── distributions ──────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS distributions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            scene_id     TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
            platform_id  TEXT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
            scope        TEXT NOT NULL,
            project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
            project_path TEXT,
            status       TEXT NOT NULL,
            synced_at    TEXT,
            checksum     TEXT
        );"
    )?;

    // ── sync_logs ──────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            action      TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id   TEXT NOT NULL,
            platform_id TEXT,
            status      TEXT NOT NULL,
            message     TEXT,
            created_at  TEXT NOT NULL
        );"
    )?;

    // ── app_config ──────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        INSERT OR IGNORE INTO app_config (key, value) VALUES ('global_scene_id', NULL);"
    )?;

    // ── Indexes ────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_skills_source_type ON skills(source_type);
         CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
         CREATE INDEX IF NOT EXISTS idx_scene_skills_scene ON scene_skills(scene_id);
         CREATE INDEX IF NOT EXISTS idx_distributions_project ON distributions(project_id, platform_id);
         CREATE INDEX IF NOT EXISTS idx_distributions_scene ON distributions(scene_id, platform_id, scope);
         CREATE INDEX IF NOT EXISTS idx_sync_logs_time ON sync_logs(created_at DESC);"
    )?;

    // ── Built-in data: platforms ───────────────────────────────────
    let platforms = [
        ("claude-code", "Claude Code", "claude-code", "~/.claude/skills", ".claude/skills"),
        ("opencode", "OpenCode", "opencode", "~/.config/opencode/skills", ".opencode/skills"),
        ("cursor", "Cursor", "cursor", "~/.cursor/skills", ".cursor/skills"),
    ];

    for (id, name, adapter, global_path, project_path) in &platforms {
        conn.execute(
            "INSERT OR IGNORE INTO platforms (id, name, adapter, global_path, project_path, enabled, icon) VALUES (?1, ?2, ?3, ?4, ?5, 1, NULL)",
            rusqlite::params![id, name, adapter, global_path, project_path],
        )?;
    }

    // ── Built-in data: __all_skills__ system scene ────────────────
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO scenes (id, name, description, icon, is_template, is_system, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            "__all_skills__",
            "All Skills",
            "Virtual scene containing all installed skills",
            "grid",
            0,
            1,
            now,
            now,
        ],
    )?;

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

        // Verify built-in platforms
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 3);

        // Verify __all_skills__ scene
        let scene_name: String = conn
            .query_row(
                "SELECT name FROM scenes WHERE id = '__all_skills__'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(scene_name, "All Skills");
    }
}
