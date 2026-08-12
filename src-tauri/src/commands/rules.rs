use crate::engine;
use crate::error::AppError;
use crate::types::{CreateRuleDTO, Rule, UpdateRuleDTO};
use crate::AppState;

#[tauri::command]
pub fn list_rules(
    platform: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Rule>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::rule_engine::list_rules(&conn, platform.as_deref())
}

#[tauri::command]
pub fn create_rule(
    data: CreateRuleDTO,
    state: tauri::State<'_, AppState>,
) -> Result<Rule, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::rule_engine::create_rule(&conn, &data)
}

#[tauri::command]
pub fn update_rule(
    id: String,
    data: UpdateRuleDTO,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::rule_engine::update_rule(&conn, &id, &data)
}

#[tauri::command]
pub fn delete_rule(id: String, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::rule_engine::delete_rule(&conn, &id)
}
