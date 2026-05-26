use crate::error::AppError;
use crate::types::Tag;
use crate::AppState;

use rusqlite::params;

#[tauri::command]
pub fn list_tags(
    category: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Tag>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let sql = if category.is_some() {
        "SELECT t.id, t.name, t.color, t.category,
                (SELECT COUNT(*) FROM skill_tags WHERE tag_id = t.id) as skill_count,
                (SELECT COUNT(*) FROM rule_tags WHERE tag_id = t.id) as rule_count
         FROM tags t WHERE t.category = ?1 ORDER BY t.name ASC"
    } else {
        "SELECT t.id, t.name, t.color, t.category,
                (SELECT COUNT(*) FROM skill_tags WHERE tag_id = t.id) as skill_count,
                (SELECT COUNT(*) FROM rule_tags WHERE tag_id = t.id) as rule_count
         FROM tags t ORDER BY t.name ASC"
    };

    let mut stmt = conn.prepare(sql)?;

    let tags: Vec<Tag> = if let Some(ref cat) = category {
        stmt.query_map(params![cat], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                category: row.get(3)?,
                skill_count: row.get(4)?,
                rule_count: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                category: row.get(3)?,
                skill_count: row.get(4)?,
                rule_count: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(tags)
}

#[tauri::command]
pub fn create_tag(
    name: String,
    color: Option<String>,
    category: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Tag, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    // Check for duplicate
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM tags WHERE name = ?1",
            params![name],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if exists {
        return Err(AppError::DuplicateTag(name));
    }

    conn.execute(
        "INSERT INTO tags (name, color, category) VALUES (?1, ?2, ?3)",
        params![name, color, category],
    )?;

    let id = conn.last_insert_rowid();

    Ok(Tag {
        id,
        name,
        color,
        category,
        skill_count: Some(0),
        rule_count: Some(0),
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

    // Verify tag exists
    let tag_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM tags WHERE id = ?1",
            params![tag_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !tag_exists {
        return Err(AppError::TagNotFound(tag_id));
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
