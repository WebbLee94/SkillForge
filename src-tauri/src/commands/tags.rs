use crate::error::AppError;
use crate::types::Tag;
use crate::AppState;

use rusqlite::params;

#[tauri::command]
pub fn list_tags(
    category: Option<String>,
    tag_type: Option<String>,
    search: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Tag>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    // Build SQL based on filters
    let (sql, use_category, use_tag_type, use_search) = match (&category, &tag_type, &search) {
        (Some(_), Some(_), Some(_)) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    (SELECT COUNT(*) FROM resource_tags rt
                          JOIN resources r ON rt.resource_id = r.id
                          WHERE rt.tag_id = t.id AND r.kind = t.tag_type) as count
             FROM tags t WHERE t.category = ?1 AND t.tag_type = ?2 AND t.name LIKE '%' || ?3 || '%' COLLATE NOCASE ORDER BY t.name ASC",
            true, true, true,
        ),
        (Some(_), Some(_), None) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    (SELECT COUNT(*) FROM resource_tags rt
                          JOIN resources r ON rt.resource_id = r.id
                          WHERE rt.tag_id = t.id AND r.kind = t.tag_type) as count
             FROM tags t WHERE t.category = ?1 AND t.tag_type = ?2 ORDER BY t.name ASC",
            true, true, false,
        ),
        (Some(_), None, Some(_)) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    (SELECT COUNT(*) FROM resource_tags rt
                          JOIN resources r ON rt.resource_id = r.id
                          WHERE rt.tag_id = t.id AND r.kind = t.tag_type) as count
             FROM tags t WHERE t.category = ?1 AND t.name LIKE '%' || ?2 || '%' COLLATE NOCASE ORDER BY t.name ASC",
            true, false, true,
        ),
        (Some(_), None, None) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    (SELECT COUNT(*) FROM resource_tags rt
                          JOIN resources r ON rt.resource_id = r.id
                          WHERE rt.tag_id = t.id AND r.kind = t.tag_type) as count
             FROM tags t WHERE t.category = ?1 ORDER BY t.name ASC",
            true, false, false,
        ),
        (None, Some(_), Some(_)) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    (SELECT COUNT(*) FROM resource_tags rt
                          JOIN resources r ON rt.resource_id = r.id
                          WHERE rt.tag_id = t.id AND r.kind = t.tag_type) as count
             FROM tags t WHERE t.tag_type = ?1 AND t.name LIKE '%' || ?2 || '%' COLLATE NOCASE ORDER BY t.name ASC",
            false, true, true,
        ),
        (None, Some(_), None) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    (SELECT COUNT(*) FROM resource_tags rt
                          JOIN resources r ON rt.resource_id = r.id
                          WHERE rt.tag_id = t.id AND r.kind = t.tag_type) as count
             FROM tags t WHERE t.tag_type = ?1 ORDER BY t.name ASC",
            false, true, false,
        ),
        (None, None, Some(_)) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    (SELECT COUNT(*) FROM resource_tags rt
                          JOIN resources r ON rt.resource_id = r.id
                          WHERE rt.tag_id = t.id AND r.kind = t.tag_type) as count
             FROM tags t WHERE t.name LIKE '%' || ?1 || '%' COLLATE NOCASE ORDER BY t.name ASC",
            false, false, true,
        ),
        (None, None, None) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    (SELECT COUNT(*) FROM resource_tags rt
                          JOIN resources r ON rt.resource_id = r.id
                          WHERE rt.tag_id = t.id AND r.kind = t.tag_type) as count
             FROM tags t ORDER BY t.name ASC",
            false, false, false,
        ),
    };

    let mut stmt = conn.prepare(sql)?;

    let row_mapper = |row: &rusqlite::Row| -> Result<Tag, rusqlite::Error> {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            category: row.get(3)?,
            tag_type: row.get(4)?,
            count: row.get(5)?,
        })
    };

    let tags: Vec<Tag> = match (use_category, use_tag_type, use_search) {
        (true, true, true) => stmt
            .query_map(params![category, tag_type, search], row_mapper)?
            .filter_map(|r| r.ok())
            .collect(),
        (true, true, false) => stmt
            .query_map(params![category, tag_type], row_mapper)?
            .filter_map(|r| r.ok())
            .collect(),
        (true, false, true) => stmt
            .query_map(params![category, search], row_mapper)?
            .filter_map(|r| r.ok())
            .collect(),
        (true, false, false) => stmt
            .query_map(params![category], row_mapper)?
            .filter_map(|r| r.ok())
            .collect(),
        (false, true, true) => stmt
            .query_map(params![tag_type, search], row_mapper)?
            .filter_map(|r| r.ok())
            .collect(),
        (false, true, false) => stmt
            .query_map(params![tag_type], row_mapper)?
            .filter_map(|r| r.ok())
            .collect(),
        (false, false, true) => stmt
            .query_map(params![search], row_mapper)?
            .filter_map(|r| r.ok())
            .collect(),
        (false, false, false) => stmt
            .query_map([], row_mapper)?
            .filter_map(|r| r.ok())
            .collect(),
    };

    Ok(tags)
}

#[tauri::command]
pub fn create_tag(
    name: String,
    color: Option<String>,
    category: Option<String>,
    tag_type: String,
    state: tauri::State<'_, AppState>,
) -> Result<Tag, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    // Validate tag_type
    if tag_type != "skill" && tag_type != "rule" {
        return Err(AppError::Validation(format!(
            "无效的标签类型 '{}': 必须为 'skill' 或 'rule'",
            tag_type
        )));
    }

    // Check for duplicate (name + tag_type)
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM tags WHERE name = ?1 AND tag_type = ?2",
            params![name, tag_type],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if exists {
        return Err(AppError::DuplicateTag(format!("{}({})", name, tag_type)));
    }

    conn.execute(
        "INSERT INTO tags (name, color, category, tag_type) VALUES (?1, ?2, ?3, ?4)",
        params![name, color, category, tag_type],
    )?;

    let id = conn.last_insert_rowid();

    Ok(Tag {
        id,
        name,
        color,
        category,
        tag_type,
        count: Some(0),
    })
}

#[tauri::command]
pub fn delete_tag(id: i64, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    // Verify tag exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM tags WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::TagNotFound(id));
    }

    // Delete associations
    conn.execute("DELETE FROM resource_tags WHERE tag_id = ?1", params![id])?;
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;

    Ok(())
}

#[tauri::command]
pub fn update_tag(
    id: i64,
    name: Option<String>,
    color: Option<String>,
    category: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    // Verify tag exists and get its tag_type
    let tag_info: Option<(String,)> = conn
        .query_row(
            "SELECT tag_type FROM tags WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?,)),
        )
        .ok();

    let (tag_type,) = match tag_info {
        Some(info) => info,
        None => return Err(AppError::TagNotFound(id)),
    };

    // If renaming, check uniqueness within the same tag_type
    if let Some(ref new_name) = name {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE name = ?1 AND tag_type = ?2 AND id != ?3",
                params![new_name, tag_type, id],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)?;

        if exists {
            return Err(AppError::DuplicateTag(format!(
                "{}({})",
                new_name, tag_type
            )));
        }
    }

    conn.execute(
        "UPDATE tags SET name = COALESCE(?1, name), color = COALESCE(?2, color), category = COALESCE(?3, category) WHERE id = ?4",
        params![name, color, category, id],
    )?;

    Ok(())
}

#[tauri::command]
pub fn assign_tag(
    target_type: String,
    target_id: String,
    tag_id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    // Verify tag exists and get its tag_type
    let tag_info: Option<(String,)> = conn
        .query_row(
            "SELECT tag_type FROM tags WHERE id = ?1",
            params![tag_id],
            |row| Ok((row.get(0)?,)),
        )
        .ok();

    let (tag_type_val,) = match tag_info {
        Some(info) => info,
        None => return Err(AppError::TagNotFound(tag_id)),
    };

    // Validate tag_type matches target_type
    if target_type != tag_type_val {
        let msg = if target_type == "skill" {
            "不能将规则标签分配给技能"
        } else {
            "不能将技能标签分配给规则"
        };
        return Err(AppError::Validation(msg.to_string()));
    }

    match target_type.as_str() {
        "skill" => {
            let skill_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM resources WHERE id = ?1 AND kind = 'skill'",
                    params![target_id],
                    |row| row.get::<_, i64>(0),
                )
                .map(|c| c > 0)?;

            if !skill_exists {
                return Err(AppError::SkillNotFound(target_id));
            }

            conn.execute(
                "INSERT OR IGNORE INTO resource_tags (resource_id, tag_id) VALUES (?1, ?2)",
                params![target_id, tag_id],
            )?;
        }
        "rule" => {
            let rule_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM resources WHERE id = ?1 AND kind = 'rule'",
                    params![target_id],
                    |row| row.get::<_, i64>(0),
                )
                .map(|c| c > 0)?;

            if !rule_exists {
                return Err(AppError::RuleNotFound(target_id));
            }

            conn.execute(
                "INSERT OR IGNORE INTO resource_tags (resource_id, tag_id) VALUES (?1, ?2)",
                params![target_id, tag_id],
            )?;
        }
        _ => {
            return Err(AppError::Validation(format!(
                "无效的目标类型 '{}': 必须为 'skill' 或 'rule'",
                target_type
            )));
        }
    }

    Ok(())
}

#[tauri::command]
pub fn remove_tag(
    target_type: String,
    target_id: String,
    tag_id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    remove_tag_row(&conn, &target_type, &target_id, tag_id)
}

/// 解除资源与标签的关联（T2 命名空间守卫，与 `assign_tag` 对称）：
/// 标签不存在 → 静默成功（维持既有语义）；跨命名空间 → Validation 错误；
/// 目标资源 kind 不符 → DELETE 经 EXISTS 守卫影响 0 行。
fn remove_tag_row(
    conn: &rusqlite::Connection,
    target_type: &str,
    target_id: &str,
    tag_id: i64,
) -> Result<(), AppError> {
    match target_type {
        "skill" | "rule" => {}
        _ => {
            return Err(AppError::Validation(format!(
                "无效的目标类型 '{target_type}': 必须为 'skill' 或 'rule'"
            )));
        }
    }

    // 守卫一：标签存在时其 tag_type 必须与目标类型一致（镜像 assign_tag）
    let tag_type: Option<String> = conn
        .query_row(
            "SELECT tag_type FROM tags WHERE id = ?1",
            params![tag_id],
            |row| row.get(0),
        )
        .ok();
    if let Some(actual) = tag_type {
        if actual != target_type {
            return Err(AppError::Validation(if target_type == "skill" {
                "不能将规则标签从技能上移除".to_string()
            } else {
                "不能将技能标签从规则上移除".to_string()
            }));
        }
    }

    // 守卫二：目标资源必须为对应 kind
    conn.execute(
        "DELETE FROM resource_tags
         WHERE resource_id = ?1 AND tag_id = ?2
           AND EXISTS (SELECT 1 FROM resources r
                        WHERE r.id = resource_tags.resource_id AND r.kind = ?3)",
        params![target_id, tag_id, target_type],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::create_tables(&conn).unwrap();
        conn
    }

    fn insert_skill(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO resources (id, kind, name, source_type, installed_at, updated_at, local_path)
             VALUES (?1, 'skill', 'S', 'local-fs', 't', 't', '/tmp/s')",
            params![id],
        )
        .unwrap();
    }

    fn insert_rule(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO resources (id, kind, name, source_type, installed_at, updated_at, format, content)
             VALUES (?1, 'rule', 'R', 'manual', 't', 't', 'md', '# c')",
            params![id],
        )
        .unwrap();
    }

    fn insert_tag(conn: &Connection, name: &str, tag_type: &str) -> i64 {
        conn.execute(
            "INSERT INTO tags (name, tag_type) VALUES (?1, ?2)",
            params![name, tag_type],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn link(conn: &Connection, resource_id: &str, tag_id: i64) {
        conn.execute(
            "INSERT INTO resource_tags (resource_id, tag_id) VALUES (?1, ?2)",
            params![resource_id, tag_id],
        )
        .unwrap();
    }

    fn association_count(conn: &Connection, resource_id: &str, tag_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM resource_tags WHERE resource_id = ?1 AND tag_id = ?2",
            params![resource_id, tag_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn remove_tag_deletes_same_namespace_association() {
        let conn = setup_db();
        insert_skill(&conn, "s1");
        let tag_id = insert_tag(&conn, "rust", "skill");
        link(&conn, "s1", tag_id);

        remove_tag_row(&conn, "skill", "s1", tag_id).unwrap();

        assert_eq!(association_count(&conn, "s1", tag_id), 0);
    }

    #[test]
    fn remove_tag_rejects_cross_namespace_tag() {
        let conn = setup_db();
        insert_skill(&conn, "s1");
        let rule_tag = insert_tag(&conn, "rust-rule", "rule");
        link(&conn, "s1", rule_tag); // 模拟越权历史数据

        let err = remove_tag_row(&conn, "skill", "s1", rule_tag).unwrap_err();
        assert!(
            matches!(err, AppError::Validation(ref m) if m.contains("移除")),
            "跨命名空间移除必须报 Validation 错误: {err}"
        );
        assert_eq!(association_count(&conn, "s1", rule_tag), 1);
    }

    #[test]
    fn remove_tag_kind_guard_spares_mismatched_resource() {
        // 同名 id 跨 kind 场景：kind='rule' 的资源挂着 skill 标签，
        // 以 target_type='skill' 移除不得误删（守卫二）
        let conn = setup_db();
        insert_rule(&conn, "dup");
        let skill_tag = insert_tag(&conn, "shared-name", "skill");
        link(&conn, "dup", skill_tag);

        remove_tag_row(&conn, "skill", "dup", skill_tag).unwrap();

        assert_eq!(
            association_count(&conn, "dup", skill_tag),
            1,
            "kind 守卫必须阻止对 rule 资源的删除"
        );
    }

    #[test]
    fn remove_tag_missing_target_or_tag_is_silent_noop() {
        let conn = setup_db();
        insert_skill(&conn, "s1");
        let tag_id = insert_tag(&conn, "rust", "skill");

        // 标签不存在：静默成功（维持既有语义）
        remove_tag_row(&conn, "skill", "s1", 9999).unwrap();

        // 资源不存在：0 行受影响，同样静默成功
        remove_tag_row(&conn, "skill", "ghost", tag_id).unwrap();

        // 无效目标类型：显式错误
        let err = remove_tag_row(&conn, "scene", "s1", tag_id).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
