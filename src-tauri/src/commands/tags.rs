use crate::error::AppError;
use crate::types::Tag;
use crate::AppState;

use rusqlite::params;

#[tauri::command]
pub fn list_tags(
    category: Option<String>,
    tag_type: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Tag>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    // Build SQL based on filters
    let (sql, use_category, use_tag_type) = match (&category, &tag_type) {
        (Some(_), Some(_)) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    CASE WHEN t.tag_type = 'skill' THEN (SELECT COUNT(*) FROM skill_tags WHERE tag_id = t.id)
                         WHEN t.tag_type = 'rule' THEN (SELECT COUNT(*) FROM rule_tags WHERE tag_id = t.id)
                         ELSE 0 END as count
             FROM tags t WHERE t.category = ?1 AND t.tag_type = ?2 ORDER BY t.name ASC",
            true, true,
        ),
        (Some(_), None) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    CASE WHEN t.tag_type = 'skill' THEN (SELECT COUNT(*) FROM skill_tags WHERE tag_id = t.id)
                         WHEN t.tag_type = 'rule' THEN (SELECT COUNT(*) FROM rule_tags WHERE tag_id = t.id)
                         ELSE 0 END as count
             FROM tags t WHERE t.category = ?1 ORDER BY t.name ASC",
            true, false,
        ),
        (None, Some(_)) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    CASE WHEN t.tag_type = 'skill' THEN (SELECT COUNT(*) FROM skill_tags WHERE tag_id = t.id)
                         WHEN t.tag_type = 'rule' THEN (SELECT COUNT(*) FROM rule_tags WHERE tag_id = t.id)
                         ELSE 0 END as count
             FROM tags t WHERE t.tag_type = ?1 ORDER BY t.name ASC",
            false, true,
        ),
        (None, None) => (
            "SELECT t.id, t.name, t.color, t.category, t.tag_type,
                    CASE WHEN t.tag_type = 'skill' THEN (SELECT COUNT(*) FROM skill_tags WHERE tag_id = t.id)
                         WHEN t.tag_type = 'rule' THEN (SELECT COUNT(*) FROM rule_tags WHERE tag_id = t.id)
                         ELSE 0 END as count
             FROM tags t ORDER BY t.name ASC",
            false, false,
        ),
    };

    let mut stmt = conn.prepare(sql)?;

    let tags: Vec<Tag> = match (use_category, use_tag_type) {
        (true, true) => stmt.query_map(params![category, tag_type], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                category: row.get(3)?,
                tag_type: row.get(4)?,
                count: row.get(5)?,
            })
        })?.filter_map(|r| r.ok()).collect(),
        (true, false) => stmt.query_map(params![category], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                category: row.get(3)?,
                tag_type: row.get(4)?,
                count: row.get(5)?,
            })
        })?.filter_map(|r| r.ok()).collect(),
        (false, true) => stmt.query_map(params![tag_type], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                category: row.get(3)?,
                tag_type: row.get(4)?,
                count: row.get(5)?,
            })
        })?.filter_map(|r| r.ok()).collect(),
        (false, false) => stmt.query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                category: row.get(3)?,
                tag_type: row.get(4)?,
                count: row.get(5)?,
            })
        })?.filter_map(|r| r.ok()).collect(),
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
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

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
pub fn delete_tag(
    id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

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
    conn.execute("DELETE FROM skill_tags WHERE tag_id = ?1", params![id])?;
    conn.execute("DELETE FROM rule_tags WHERE tag_id = ?1", params![id])?;
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
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

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
            return Err(AppError::DuplicateTag(format!("{}({})", new_name, tag_type)));
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
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

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
                    "SELECT COUNT(*) FROM skills WHERE id = ?1",
                    params![target_id],
                    |row| row.get::<_, i64>(0),
                )
                .map(|c| c > 0)?;

            if !skill_exists {
                return Err(AppError::SkillNotFound(target_id));
            }

            conn.execute(
                "INSERT OR IGNORE INTO skill_tags (skill_id, tag_id) VALUES (?1, ?2)",
                params![target_id, tag_id],
            )?;
        }
        "rule" => {
            let rule_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM rules WHERE id = ?1",
                    params![target_id],
                    |row| row.get::<_, i64>(0),
                )
                .map(|c| c > 0)?;

            if !rule_exists {
                return Err(AppError::RuleNotFound(target_id));
            }

            conn.execute(
                "INSERT OR IGNORE INTO rule_tags (rule_id, tag_id) VALUES (?1, ?2)",
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
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    match target_type.as_str() {
        "skill" => {
            conn.execute(
                "DELETE FROM skill_tags WHERE skill_id = ?1 AND tag_id = ?2",
                params![target_id, tag_id],
            )?;
        }
        "rule" => {
            conn.execute(
                "DELETE FROM rule_tags WHERE rule_id = ?1 AND tag_id = ?2",
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
