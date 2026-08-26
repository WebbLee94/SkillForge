//! 统一资源表（resources / resource_tags / scene_items）读写实现。
//!
//! 按 47 号方案 §5.1 投影策略：存储层六表→三表统一，
//! `Skill`/`Rule` 结构体与 IPC DTO 作为 `WHERE kind=?` 的双投影保留——
//! 本模块是按 kind 过滤的唯一新增读写入口；SELECT 投影（JOIN tags、
//! 场景条目等）仍留在各 engine 内，因为二者产出的 DTO 形状不同。
//!
//! 不变式（§5.2，DDL CHECK 强制 + 本模块测试锁定）：
//! - skill 行必有 local_path 且无 content/format；
//! - rule 行必有 content+format 且无 local_path。

use crate::error::AppError;
use rusqlite::{params, Connection};

/// 资源种类：技能
pub const KIND_SKILL: &str = "skill";
/// 资源种类：规则
pub const KIND_RULE: &str = "rule";

/// 规则行 source_type 投影默认值。
///
/// 旧 rules 表无 source_type 列且 Rule DTO 不含该字段；
/// 统一表要求 NOT NULL，规则创建/导入路径统一落 'manual'。
pub const RULE_SOURCE_TYPE: &str = "manual";

/// 检查指定种类的资源是否存在。
pub fn kind_exists(conn: &Connection, id: &str, kind: &str) -> Result<bool, AppError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM resources WHERE id = ?1 AND kind = ?2",
        params![id, kind],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count > 0)
}

/// 插入一条 skill 行（kind='skill' 投影）。
///
/// `updated_at` 与 `installed_at` 同值起步：旧 skills 表仅有 installed_at，
/// Skill DTO 不暴露 updated_at；后续更新路径会单独推进 updated_at。
#[allow(clippy::too_many_arguments)]
pub fn insert_skill_row(
    conn: &Connection,
    id: &str,
    name: &str,
    description: Option<&str>,
    source_type: &str,
    source_url: Option<&str>,
    current_ver: Option<&str>,
    installed_at: &str,
    local_path: &str,
    metadata: Option<&str>,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO resources (id, kind, name, description, source_type, source_url, current_ver, installed_at, updated_at, local_path, metadata)
         VALUES (?1, 'skill', ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9)",
        params![
            id,
            name,
            description,
            source_type,
            source_url,
            current_ver,
            installed_at,
            local_path,
            metadata
        ],
    )?;
    Ok(())
}

/// 插入一条 rule 行（kind='rule' 投影）。
///
/// `installed_at` 取 `updated_at` 同值：旧 rules 表仅含 updated_at，
/// Rule DTO 不暴露 installed_at。
#[allow(clippy::too_many_arguments)]
pub fn insert_rule_row(
    conn: &Connection,
    id: &str,
    name: &str,
    description: Option<&str>,
    format: &str,
    content: &str,
    platform: Option<&str>,
    scope: Option<&str>,
    updated_at: &str,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO resources (id, kind, name, description, source_type, source_url, current_ver, installed_at, updated_at, format, content, platform, scope, version)
         VALUES (?1, 'rule', ?2, ?3, 'manual', NULL, NULL, ?4, ?4, ?5, ?6, ?7, ?8, 1)",
        params![id, name, description, updated_at, format, content, platform, scope],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::create_tables(&conn).unwrap();
        conn
    }

    #[test]
    fn skill_row_projection_requires_local_path_and_rejects_content() {
        let conn = setup_db();
        insert_skill_row(
            &conn, "s1", "S1", None, "local-fs", None, None, "t", "/tmp/s1", None,
        )
        .unwrap();

        let err = conn
            .execute(
                "INSERT INTO resources (id, kind, name, source_type, installed_at, updated_at, local_path, content)
                 VALUES ('bad', 'skill', 'B', 'local-fs', 't', 't', '/tmp/b', '# leaked')",
                [],
            )
            .unwrap_err();
        assert!(
            err.to_string().contains("CHECK"),
            "skill 行携带 content 必须被 DDL CHECK 拒绝: {err}"
        );
    }

    #[test]
    fn rule_row_projection_requires_content_and_rejects_local_path() {
        let conn = setup_db();
        insert_rule_row(&conn, "r1", "R1", None, "md", "# c", None, None, "t").unwrap();

        let err = conn
            .execute(
                "INSERT INTO resources (id, kind, name, source_type, installed_at, updated_at, local_path, format, content)
                 VALUES ('bad', 'rule', 'B', 'manual', 't', 't', '/tmp/leak', 'md', '# c')",
                [],
            )
            .unwrap_err();
        assert!(
            err.to_string().contains("CHECK"),
            "rule 行携带 local_path 必须被 DDL CHECK 拒绝: {err}"
        );
    }

    #[test]
    fn kind_exists_distinguishes_kinds() {
        let conn = setup_db();
        insert_skill_row(
            &conn, "s1", "S1", None, "local-fs", None, None, "t", "/tmp/s1", None,
        )
        .unwrap();
        insert_rule_row(&conn, "r1", "R1", None, "md", "# c", None, None, "t").unwrap();

        assert!(kind_exists(&conn, "s1", KIND_SKILL).unwrap());
        assert!(!kind_exists(&conn, "s1", KIND_RULE).unwrap());
        assert!(kind_exists(&conn, "r1", KIND_RULE).unwrap());
        assert!(!kind_exists(&conn, "missing", KIND_SKILL).unwrap());
    }

    #[test]
    fn deleting_resource_cascades_to_tags_and_scene_items() {
        let conn = setup_db();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        insert_skill_row(
            &conn, "s1", "S1", None, "local-fs", None, None, "t", "/tmp/s1", None,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO scenes (id, name, is_template, is_system, created_at, updated_at)
             VALUES ('sc1', 'SC', 0, 0, 't', 't')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tags (name, tag_type) VALUES ('rust', 'skill')",
            [],
        )
        .unwrap();
        let tag_id: i64 = conn
            .query_row("SELECT last_insert_rowid()", [], |r| r.get(0))
            .unwrap();
        conn.execute(
            "INSERT INTO resource_tags (resource_id, tag_id) VALUES ('s1', ?1)",
            params![tag_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO scene_items (scene_id, resource_id) VALUES ('sc1', 's1')",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM resources WHERE id = 's1'", [])
            .unwrap();

        let orphan_tags: i64 = conn
            .query_row("SELECT COUNT(*) FROM resource_tags", [], |r| r.get(0))
            .unwrap();
        let orphan_items: i64 = conn
            .query_row("SELECT COUNT(*) FROM scene_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            (orphan_tags, orphan_items),
            (0, 0),
            "级联删除必须清空两侧关联"
        );
    }
}
