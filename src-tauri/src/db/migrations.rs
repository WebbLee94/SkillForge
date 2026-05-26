use crate::error::AppError;

#[cfg(test)]
const CURRENT_VERSION: u32 = 7;

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
    if current < 6 {
        apply_v6(conn)?;
    }
    if current < 7 {
        apply_v7(conn)?;
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

fn apply_v6(conn: &rusqlite::Connection) -> Result<(), AppError> {
    // Full refresh of all 12 built-in platforms using INSERT OR REPLACE
    // to ensure old data is overwritten and new platforms are added
    let platforms = [
        ("claude-code", "Claude Code", "claude-code", "~/.claude/skills", ".claude/skills"),
        ("opencode", "OpenCode", "opencode", "~/.config/opencode/skills", ".opencode/skills"),
        ("cursor", "Cursor", "cursor", "~/.cursor/skills", ".cursor/skills"),
        ("trae", "Trae", "trae", "~/.trae/skills", ".trae/skills"),
        ("trae-cn", "Trae CN", "trae-cn", "~/.trae-cn/skills", ".trae-cn/skills"),
        ("codebuddy", "CodeBuddy", "codebuddy", "~/.codebuddy/skills", ".codebuddy/skills"),
        ("codebuddy-cn", "CodeBuddy CN", "codebuddy-cn", "~/.codebuddy-cn/skills", ".codebuddy-cn/skills"),
        ("codex", "Codex", "codex", "~/.codex/skills", ".codex/skills"),
        ("hermes", "Hermes Agent", "hermes", "~/.hermes/skills", ".hermes/skills"),
        ("openclaw", "OpenClaw", "openclaw", "~/.openclaw/skills", ".openclaw/skills"),
        ("antigravity", "Antigravity", "antigravity", "~/.antigravity/skills", ".antigravity/skills"),
        ("windsurf", "Windsurf", "windsurf", "~/.windsurf/skills", ".windsurf/skills"),
    ];

    for (id, name, adapter, global_path, project_path) in &platforms {
        conn.execute(
            "INSERT OR REPLACE INTO platforms (id, name, adapter, global_path, project_path, enabled, icon) VALUES (?1, ?2, ?3, ?4, ?5, 1, NULL)",
            rusqlite::params![id, name, adapter, global_path, project_path],
        )?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![6, now],
    )?;

    Ok(())
}

fn apply_v7(conn: &rusqlite::Connection) -> Result<(), AppError> {
    // v7: Add tag_type column to tags table, split mixed tags
    // SQLite requires table recreation to drop the UNIQUE constraint on `name`

    // 1. Create new tags table without UNIQUE on name, with tag_type
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tags_new (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            name     TEXT NOT NULL,
            color    TEXT,
            category TEXT,
            tag_type TEXT NOT NULL DEFAULT 'skill' CHECK(tag_type IN ('skill','rule'))
        );"
    )?;

    // 2. Copy existing data, defaulting tag_type to 'skill'
    conn.execute_batch(
        "INSERT INTO tags_new (id, name, color, category, tag_type)
         SELECT id, name, color, category, 'skill' FROM tags;"
    )?;

    // 3. Drop old table and rename
    conn.execute_batch(
        "DROP TABLE tags;
         ALTER TABLE tags_new RENAME TO tags;"
    )?;

    // 4. For tags referenced by both skill_tags and rule_tags (mixed tags),
    //    create a duplicate row with tag_type = 'rule'
    conn.execute_batch(
        "INSERT INTO tags (name, color, category, tag_type)
         SELECT t.name, t.color, t.category, 'rule'
         FROM tags t
         WHERE t.tag_type = 'skill'
           AND EXISTS (SELECT 1 FROM skill_tags st WHERE st.tag_id = t.id)
           AND EXISTS (SELECT 1 FROM rule_tags rt WHERE rt.tag_id = t.id)
           AND NOT EXISTS (SELECT 1 FROM tags t2 WHERE t2.name = t.name AND t2.tag_type = 'rule');"
    )?;

    // 5. Update rule_tags to point to the new rule-type tag for mixed tags
    conn.execute_batch(
        "UPDATE rule_tags SET tag_id = (
           SELECT t2.id FROM tags t2
           WHERE t2.name = (SELECT t1.name FROM tags t1 WHERE t1.id = rule_tags.tag_id)
             AND t2.tag_type = 'rule'
         )
         WHERE EXISTS (
           SELECT 1 FROM tags t WHERE t.id = rule_tags.tag_id AND t.tag_type = 'skill'
         )
         AND EXISTS (
           SELECT 1 FROM skill_tags st WHERE st.tag_id = rule_tags.tag_id
         )
         AND EXISTS (
           SELECT 1 FROM tags t2 WHERE t2.name = (SELECT t1.name FROM tags t1 WHERE t1.id = rule_tags.tag_id) AND t2.tag_type = 'rule'
         );"
    )?;

    // 6. For tags only referenced by rule_tags, update tag_type to 'rule'
    conn.execute_batch(
        "UPDATE tags SET tag_type = 'rule'
         WHERE tag_type = 'skill'
           AND NOT EXISTS (SELECT 1 FROM skill_tags st WHERE st.tag_id = tags.id)
           AND EXISTS (SELECT 1 FROM rule_tags rt WHERE rt.tag_id = tags.id);"
    )?;

    // 7. Create composite unique index on (name, tag_type)
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_type ON tags(name, tag_type);"
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![7, now],
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

    #[test]
    fn test_v6_migration_overwrites_old_platforms() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();

        // Simulate an old database with only 3 platforms and stale data
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS platforms (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                adapter      TEXT NOT NULL,
                global_path  TEXT,
                project_path TEXT,
                enabled      INTEGER NOT NULL DEFAULT 1,
                icon         TEXT
            );
            CREATE TABLE IF NOT EXISTS tags (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                name     TEXT UNIQUE NOT NULL,
                color    TEXT,
                category TEXT
            );
            CREATE TABLE IF NOT EXISTS skill_tags (
                skill_id TEXT NOT NULL,
                tag_id   INTEGER NOT NULL,
                PRIMARY KEY (skill_id, tag_id)
            );
            CREATE TABLE IF NOT EXISTS rule_tags (
                rule_id TEXT NOT NULL,
                tag_id  INTEGER NOT NULL,
                PRIMARY KEY (rule_id, tag_id)
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );"
        ).unwrap();

        // Insert old/stale platform data
        conn.execute(
            "INSERT INTO platforms (id, name, adapter, global_path, project_path, enabled, icon) VALUES (?1, ?2, ?3, ?4, ?5, 1, NULL)",
            rusqlite::params!["claude-code", "Claude Code Old", "claude-code", "~/.claude/old-skills", ".claude/old-skills"],
        ).unwrap();
        conn.execute(
            "INSERT INTO platforms (id, name, adapter, global_path, project_path, enabled, icon) VALUES (?1, ?2, ?3, ?4, ?5, 1, NULL)",
            rusqlite::params!["opencode", "OpenCode", "opencode", "~/.config/opencode/skills", ".opencode/skills"],
        ).unwrap();
        conn.execute(
            "INSERT INTO platforms (id, name, adapter, global_path, project_path, enabled, icon) VALUES (?1, ?2, ?3, ?4, ?5, 1, NULL)",
            rusqlite::params!["cursor", "Cursor", "cursor", "~/.cursor/skills", ".cursor/skills"],
        ).unwrap();

        // Mark schema as version 5 (old user)
        let now = chrono::Utc::now().to_rfc3339();
        for v in 1..=5 {
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![v, now],
            ).unwrap();
        }

        // Run migrations — should apply v6
        run_migrations(&mut conn).unwrap();

        // Assert: 12 platforms total
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 12);

        // Assert: claude-code name overwritten from "Claude Code Old" to "Claude Code"
        let name: String = conn
            .query_row(
                "SELECT name FROM platforms WHERE id = 'claude-code'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(name, "Claude Code");

        // Assert: claude-code global_path overwritten
        let global_path: String = conn
            .query_row(
                "SELECT global_path FROM platforms WHERE id = 'claude-code'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(global_path, "~/.claude/skills");

        // Assert: new platforms exist
        let trae_name: String = conn
            .query_row(
                "SELECT name FROM platforms WHERE id = 'trae'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(trae_name, "Trae");

        let windsurf_name: String = conn
            .query_row(
                "SELECT name FROM platforms WHERE id = 'windsurf'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(windsurf_name, "Windsurf");

        // Assert: schema_version max is 7 (v6 + v7 both applied)
        let version: u32 = conn
            .query_row(
                "SELECT MAX(version) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 7);
    }

    #[test]
    fn test_v7_tag_separation() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();

        // Simulate an old database with tags, skill_tags, and rule_tags
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS tags (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                name     TEXT UNIQUE NOT NULL,
                color    TEXT,
                category TEXT
            );
            CREATE TABLE IF NOT EXISTS skill_tags (
                skill_id TEXT NOT NULL,
                tag_id   INTEGER NOT NULL,
                PRIMARY KEY (skill_id, tag_id)
            );
            CREATE TABLE IF NOT EXISTS rule_tags (
                rule_id TEXT NOT NULL,
                tag_id  INTEGER NOT NULL,
                PRIMARY KEY (rule_id, tag_id)
            );
            CREATE TABLE IF NOT EXISTS skills (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
                source_type TEXT NOT NULL, source_url TEXT, current_ver TEXT,
                installed_at TEXT NOT NULL, local_path TEXT NOT NULL, metadata TEXT
            );
            CREATE TABLE IF NOT EXISTS rules (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
                format TEXT NOT NULL, content TEXT NOT NULL, platform TEXT,
                scope TEXT, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );"
        ).unwrap();

        // Insert test data: skill, rule, and tags
        conn.execute("INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES ('s1', 'Skill1', 'local', '2024-01-01', '/tmp')", []).unwrap();
        conn.execute("INSERT INTO rules (id, name, format, content, updated_at) VALUES ('r1', 'Rule1', 'mdc', 'content', '2024-01-01')", []).unwrap();

        // Tag only used by skills
        conn.execute("INSERT INTO tags (name, color) VALUES ('python', '#3B82F6')", []).unwrap();
        // Tag only used by rules
        conn.execute("INSERT INTO tags (name, color) VALUES ('security', '#EF4444')", []).unwrap();
        // Tag used by both (mixed)
        conn.execute("INSERT INTO tags (name, color) VALUES ('common', '#22C55E')", []).unwrap();

        // python -> skill only
        conn.execute("INSERT INTO skill_tags (skill_id, tag_id) VALUES ('s1', 1)", []).unwrap();
        // security -> rule only
        conn.execute("INSERT INTO rule_tags (rule_id, tag_id) VALUES ('r1', 2)", []).unwrap();
        // common -> both
        conn.execute("INSERT INTO skill_tags (skill_id, tag_id) VALUES ('s1', 3)", []).unwrap();
        conn.execute("INSERT INTO rule_tags (rule_id, tag_id) VALUES ('r1', 3)", []).unwrap();

        // Mark schema as version 6
        let now = chrono::Utc::now().to_rfc3339();
        for v in 1..=6 {
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![v, now],
            ).unwrap();
        }

        // Run migrations — should apply v7
        run_migrations(&mut conn).unwrap();

        // Assert: python tag should be skill type (only used by skills)
        let python_type: String = conn
            .query_row("SELECT tag_type FROM tags WHERE name = 'python'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(python_type, "skill");

        // Assert: security tag should be rule type (only used by rules)
        let security_type: String = conn
            .query_row("SELECT tag_type FROM tags WHERE name = 'security'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(security_type, "rule");

        // Assert: common tag should be split into two rows
        let common_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags WHERE name = 'common'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(common_count, 2);

        // Assert: common skill tag exists
        let common_skill: String = conn
            .query_row("SELECT tag_type FROM tags WHERE name = 'common' AND tag_type = 'skill'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(common_skill, "skill");

        // Assert: common rule tag exists
        let common_rule: String = conn
            .query_row("SELECT tag_type FROM tags WHERE name = 'common' AND tag_type = 'rule'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(common_rule, "rule");

        // Assert: rule_tags now points to the rule-type common tag
        let rule_tag_type: String = conn
            .query_row(
                "SELECT t.tag_type FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.rule_id = 'r1' AND t.name = 'common'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rule_tag_type, "rule");

        // Assert: skill_tags still points to the skill-type common tag
        let skill_tag_type: String = conn
            .query_row(
                "SELECT t.tag_type FROM skill_tags st JOIN tags t ON t.id = st.tag_id WHERE st.skill_id = 's1' AND t.name = 'common'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(skill_tag_type, "skill");

        // Assert: composite unique index works
        let result = conn.execute(
            "INSERT INTO tags (name, color, tag_type) VALUES ('common', '#000', 'skill')",
            [],
        );
        assert!(result.is_err(), "Should fail due to unique index on (name, tag_type)");

        // Assert: same name different type is allowed
        let result = conn.execute(
            "INSERT INTO tags (name, color, tag_type) VALUES ('python', '#000', 'rule')",
            [],
        );
        assert!(result.is_ok(), "Should succeed: same name with different tag_type");

        // Assert: schema_version max is 7
        let version: u32 = conn
            .query_row(
                "SELECT MAX(version) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 7);
    }
}
