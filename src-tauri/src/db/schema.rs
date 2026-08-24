use crate::error::AppError;

/// v1.1.0 统一资源模型基线（47 号方案 §四终稿）：
/// 六表（skills/rules/skill_tags/rule_tags/scene_skills/scene_rules）合并为
/// resources/resource_tags/scene_items 三表；Skill/Rule 结构体作为
/// `WHERE kind=?` 的双投影保留（§5.1），对外签名与 IPC DTO 零变化。
///
/// 死列随表消亡（47 号 §四附）：
/// - skills.content_hash / skills.sync_status：全仓零读写，不入 resources；
/// - scene_skills.version / config：全仓零引用，scene_items 不纳入。
pub fn create_tables(conn: &rusqlite::Connection) -> Result<(), AppError> {
    // ── resources（统一资源表；FS-as-Truth：skill 正文仍在 local_path 文件，不入库）──
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS resources (
            id           TEXT PRIMARY KEY,
            kind         TEXT NOT NULL CHECK (kind IN ('skill','rule')),
            name         TEXT NOT NULL,
            description  TEXT,
            source_type  TEXT NOT NULL,
            source_url   TEXT,
            current_ver  TEXT,
            installed_at TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            local_path   TEXT,
            metadata     TEXT,
            format       TEXT,
            content      TEXT,
            platform     TEXT,
            scope        TEXT,
            version      INTEGER NOT NULL DEFAULT 1,
            CHECK ((kind='skill' AND content IS NULL AND format IS NULL AND local_path IS NOT NULL)
                OR (kind='rule'  AND content IS NOT NULL AND local_path IS NULL))
        );",
    )?;

    // ── tags ───────────────────────────────────────────────────────
    // T2 裁决：tag_type 列保留并继续使用——技能打标签选 tag_type='skill'，
    // 规则选 'rule'，两套标签场景独立、互不可见。
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tags (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            name     TEXT NOT NULL,
            color    TEXT,
            category TEXT,
            tag_type TEXT NOT NULL DEFAULT 'skill' CHECK(tag_type IN ('skill','rule'))
        );",
    )?;

    // ── resource_tags（统一资源标签关联）────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS resource_tags (
            resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
            tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (resource_id, tag_id)
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

    // ── scene_items（统一场景成员；T3 裁决不纳入 version/config）─────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scene_items (
            scene_id    TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
            resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
            enabled     INTEGER NOT NULL DEFAULT 1,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (scene_id, resource_id)
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

    // ── Indexes ────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_resources_source_type ON resources(source_type);
         CREATE INDEX IF NOT EXISTS idx_resources_kind ON resources(kind);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_type ON tags(name, tag_type);
         CREATE INDEX IF NOT EXISTS idx_scene_items_scene ON scene_items(scene_id);",
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

        assert!(tables.contains(&"resources".to_string()));
        assert!(tables.contains(&"resource_tags".to_string()));
        assert!(tables.contains(&"scene_items".to_string()));
        assert!(tables.contains(&"scenes".to_string()));
        assert!(tables.contains(&"platforms".to_string()));
        assert!(tables.contains(&"projects".to_string()));
        assert!(tables.contains(&"tags".to_string()));

        for table in [
            "skills",
            "rules",
            "skill_tags",
            "rule_tags",
            "scene_skills",
            "scene_rules",
            "skill_versions",
            "rule_history",
            "distributions",
            "sync_logs",
            "app_config",
        ] {
            assert!(
                !tables.contains(&table.to_string()),
                "表 {table} 不应存在于统一资源模型基线 schema"
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
            "projects.scene_id 不应存在于 v1 基线 schema"
        );

        // Verify built-in platforms
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 10);
    }
}
