use crate::error::AppError;
use crate::types::{CreateRuleDTO, Rule, RuleHistory, Tag, UpdateRuleDTO};
use crate::AppState;

use rusqlite::params;

/// Parse the JSON string produced by `json_group_array` into `Vec<Tag>`.
/// Handles the edge case where LEFT JOIN yields `[""]` (no matching tags).
fn parse_tags_json(json: &str) -> Vec<Tag> {
    if json == "[\"\"]" || json == "[]" {
        return Vec::new();
    }
    let tags: Vec<Tag> = serde_json::from_str(json).unwrap_or_default();
    // Filter out null-id entries from LEFT JOIN with no matching tags
    tags.into_iter().filter(|t| t.id != 0).collect()
}

#[tauri::command]
pub fn list_rules(
    platform: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Rule>, AppError> {
    eprintln!("[DIAG] list_rules called: platform={:?}", platform);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let sql = if platform.is_some() {
        "SELECT r.id, r.name, r.description, r.format, r.content, r.platform, r.scope, r.version, r.updated_at, \
         IFNULL(json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color, 'tag_type', t.tag_type)), '[]') \
         FROM rules r \
         LEFT JOIN rule_tags rt ON r.id = rt.rule_id \
         LEFT JOIN tags t ON rt.tag_id = t.id \
         WHERE r.platform = ?1 \
         GROUP BY r.id \
         ORDER BY r.name ASC"
    } else {
        "SELECT r.id, r.name, r.description, r.format, r.content, r.platform, r.scope, r.version, r.updated_at, \
         IFNULL(json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color, 'tag_type', t.tag_type)), '[]') \
         FROM rules r \
         LEFT JOIN rule_tags rt ON r.id = rt.rule_id \
         LEFT JOIN tags t ON rt.tag_id = t.id \
         GROUP BY r.id \
         ORDER BY r.name ASC"
    };

    let mut stmt = conn.prepare(sql)?;

    let rules: Vec<Rule> = if let Some(ref p) = platform {
        stmt.query_map(params![p], |row| {
            let tags_json: String = row.get(9)?;
            Ok(Rule {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                format: row.get(3)?,
                content: row.get(4)?,
                platform: row.get(5)?,
                scope: row.get(6)?,
                version: row.get(7)?,
                updated_at: row.get(8)?,
                tags: parse_tags_json(&tags_json),
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map([], |row| {
            let tags_json: String = row.get(9)?;
            Ok(Rule {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                format: row.get(3)?,
                content: row.get(4)?,
                platform: row.get(5)?,
                scope: row.get(6)?,
                version: row.get(7)?,
                updated_at: row.get(8)?,
                tags: parse_tags_json(&tags_json),
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };

    eprintln!("[DIAG] list_rules OK: {} rules", rules.len());
    Ok(rules)
}

#[tauri::command]
pub fn create_rule(
    data: CreateRuleDTO,
    state: tauri::State<'_, AppState>,
) -> Result<Rule, AppError> {
    eprintln!("[DIAG] create_rule called: data={:?}", data);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let id = slugify(&data.name);
    let now = chrono::Utc::now().to_rfc3339();

    // Check for duplicate
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM rules WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if exists {
        eprintln!("[DIAG] create_rule FAILED: rule '{}' already exists", id);
        return Err(AppError::Validation(format!(
            "规则标识 '{}' 已存在",
            id
        )));
    }

    conn.execute(
        "INSERT INTO rules (id, name, description, format, content, platform, scope, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)",
        params![id, data.name, data.description, data.format, data.content, data.platform, data.scope, now],
    )?;

    // Record initial version in history
    conn.execute(
        "INSERT INTO rule_history (rule_id, version, content, changed_at) VALUES (?1, 1, ?2, ?3)",
        params![id, data.content, now],
    )?;

    // Also write rule file to disk
    let data_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Io("无法找到用户主目录".to_string()))?
        .join(".skillforge");
    let rules_dir = data_dir.join("rules");
    std::fs::create_dir_all(&rules_dir)?;
    let rule_file = rules_dir.join(format!("{}.{}", id, data.format));
    std::fs::write(&rule_file, &data.content)?;

    // Read back
    conn.query_row(
        "SELECT id, name, description, format, content, platform, scope, version, updated_at FROM rules WHERE id = ?1",
        params![id],
        |row| {
            Ok(Rule {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                format: row.get(3)?,
                content: row.get(4)?,
                platform: row.get(5)?,
                scope: row.get(6)?,
                version: row.get(7)?,
                updated_at: row.get(8)?,
                tags: Vec::new(),
            })
        },
    )
    .map_err(|e| {
        eprintln!("[DIAG] create_rule FAILED: {:?}", e);
        AppError::RuleNotFound(id)
    })
    .inspect(|rule| eprintln!("[DIAG] create_rule OK: id={}", rule.id))
}

#[tauri::command]
pub fn update_rule(
    id: String,
    data: UpdateRuleDTO,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    eprintln!("[DIAG] update_rule called: id={}, data={:?}", id, data);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    // Get current rule
    let current: Rule = conn
        .query_row(
            "SELECT id, name, description, format, content, platform, scope, version, updated_at FROM rules WHERE id = ?1",
            params![id],
            |row| {
                Ok(Rule {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    format: row.get(3)?,
                    content: row.get(4)?,
                    platform: row.get(5)?,
                    scope: row.get(6)?,
                    version: row.get(7)?,
                    updated_at: row.get(8)?,
                    tags: Vec::new(),
                })
            },
        )
        .map_err(|e| {
            eprintln!("[DIAG] update_rule FAILED: rule not found {:?}", e);
            AppError::RuleNotFound(id.clone())
        })?;

    let now = chrono::Utc::now().to_rfc3339();
    let new_version = current.version + 1;

    // Update fields
    let new_name = data.name.unwrap_or(current.name);
    let new_description = data.description.or(current.description);
    let new_content = data.content.unwrap_or(current.content);
    let new_platform = data.platform.or(current.platform);
    let new_scope = data.scope.or(current.scope);

    conn.execute(
        "UPDATE rules SET name = ?1, description = ?2, content = ?3, platform = ?4, scope = ?5, version = ?6, updated_at = ?7 WHERE id = ?8",
        params![new_name, new_description, new_content, new_platform, new_scope, new_version, now, id],
    )?;

    // Record in history
    conn.execute(
        "INSERT INTO rule_history (rule_id, version, content, changed_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, new_version, new_content, now],
    )?;

    // Update file on disk
    let data_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Io("无法找到用户主目录".to_string()))?
        .join(".skillforge");
    let rule_file = data_dir.join("rules").join(format!("{}.{}", id, current.format));
    if rule_file.exists() {
        std::fs::write(&rule_file, &new_content)?;
    }

    eprintln!("[DIAG] update_rule OK: id={}, version={}", id, new_version);
    Ok(())
}

#[tauri::command]
pub fn delete_rule(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    eprintln!("[DIAG] delete_rule called: id={}", id);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    // Verify rule exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM rules WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        eprintln!("[DIAG] delete_rule FAILED: rule not found");
        return Err(AppError::RuleNotFound(id));
    }

    // Delete associations and records
    conn.execute("DELETE FROM scene_rules WHERE rule_id = ?1", params![id])?;
    conn.execute("DELETE FROM rule_tags WHERE rule_id = ?1", params![id])?;
    conn.execute("DELETE FROM rule_history WHERE rule_id = ?1", params![id])?;
    conn.execute("DELETE FROM rules WHERE id = ?1", params![id])?;

    // Delete file from disk
    let data_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Io("无法找到用户主目录".to_string()))?
        .join(".skillforge");
    let rules_dir = data_dir.join("rules");
    if let Ok(entries) = std::fs::read_dir(&rules_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with(&format!("{}.", id)) {
                    std::fs::remove_file(entry.path()).ok();
                    break;
                }
            }
        }
    }

    eprintln!("[DIAG] delete_rule OK: id={}", id);
    Ok(())
}

#[tauri::command]
pub fn get_rule_history(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RuleHistory>, AppError> {
    eprintln!("[DIAG] get_rule_history called: id={}", id);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let mut stmt = conn.prepare(
        "SELECT rule_id, version, content, changed_at
         FROM rule_history WHERE rule_id = ?1
         ORDER BY version DESC",
    )?;

    let history: Vec<RuleHistory> = stmt
        .query_map(params![id], |row| {
            Ok(RuleHistory {
                rule_id: row.get(0)?,
                version: row.get(1)?,
                content: row.get(2)?,
                changed_at: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    eprintln!("[DIAG] get_rule_history OK: {} entries", history.len());
    Ok(history)
}

fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
