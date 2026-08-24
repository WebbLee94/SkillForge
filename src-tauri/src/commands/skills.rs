use crate::engine;
use crate::error::AppError;
use crate::plugins::source;
use crate::types::{Skill, SkillFilter};
use crate::AppState;

#[tauri::command]
pub fn list_skills(
    source_type: Option<String>,
    tag: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Skill>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let filter = SkillFilter { source_type, tag };
    engine::skill_engine::list_skills(&conn, &filter)
}

#[tauri::command]
pub fn install_skill(
    source: String,
    skill_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Skill, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let source_plugin = source::create_source_plugin(&source)?;
    engine::skill_engine::install_skill(&conn, source_plugin.as_ref(), &skill_id)
}

#[tauri::command]
pub fn install_skills_batch(
    source: String,
    skill_ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Skill>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let source_plugin = source::create_source_plugin(&source)?;
    let mut results = Vec::new();
    for skill_id in &skill_ids {
        match engine::skill_engine::install_skill(&conn, source_plugin.as_ref(), skill_id) {
            Ok(skill) => results.push(skill),
            Err(_) => continue, // skip failed installs
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn uninstall_skill(
    skill_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Skill, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::skill_engine::uninstall_skill(&conn, &skill_id)
}

#[tauri::command]
pub fn update_skill(
    skill_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Skill, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    // Read both source_type and source_url from DB
    let (source_type, source_url): (String, Option<String>) = conn
        .query_row(
            "SELECT source_type, source_url FROM resources WHERE id = ?1 AND kind = 'skill'",
            rusqlite::params![skill_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| AppError::SkillNotFound(skill_id.clone()))?;

    let source_plugin = source::create_source_plugin_with_url(&source_type, source_url.as_deref())?;
    engine::skill_engine::update_skill(&conn, source_plugin.as_ref(), &skill_id)
}

#[tauri::command]
pub fn search_skills(
    query: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Skill>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::skill_engine::search_skills(&conn, &query)
}
