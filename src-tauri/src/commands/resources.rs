use crate::engine;
use crate::error::AppError;
use crate::AppState;

/// Resolve the managed-copy path of a skill or rule.
/// Returns `Some(path)` only when the managed copy physically exists on disk
/// (filesystem-as-truth); `None` when the DB row points at a missing copy.
#[tauri::command]
pub fn get_managed_copy_path(
    resource_type: String,
    resource_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    match resource_type.as_str() {
        "skill" => engine::skill_engine::managed_copy_path(&conn, &resource_id),
        "rule" => engine::rule_engine::managed_copy_path(&conn, &resource_id),
        other => Err(AppError::Validation(format!(
            "不支持的资源类型 '{}'（仅支持 skill / rule）",
            other
        ))),
    }
}

/// Count how many scenes reference a skill or rule (for delete confirmation).
#[tauri::command]
pub fn count_scene_references(
    resource_type: String,
    resource_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<i32, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    match resource_type.as_str() {
        "skill" => engine::scene_engine::count_skill_scene_references(&conn, &resource_id),
        "rule" => engine::scene_engine::count_rule_scene_references(&conn, &resource_id),
        other => Err(AppError::Validation(format!(
            "不支持的资源类型 '{}'（仅支持 skill / rule）",
            other
        ))),
    }
}
