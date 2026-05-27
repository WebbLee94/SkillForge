use crate::engine;
use crate::error::AppError;
use crate::types::{Distribution, SyncResult, SyncStatusDTO};
use crate::AppState;

#[tauri::command]
pub fn sync_scene(
    scene_id: String,
    platforms: Option<Vec<String>>,
    scope: String,
    project_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<SyncResult, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    // Create platform plugin instances
    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> = crate::plugins::platform::create_all_platform_plugins_vec();

    engine::dist_engine::sync_scene(
        &conn,
        &all_plugins,
        &scene_id,
        platforms.as_deref(),
        &scope,
        project_id.as_deref(),
    )
}

#[tauri::command]
pub fn get_sync_status(
    state: tauri::State<'_, AppState>,
) -> Result<SyncStatusDTO, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::dist_engine::get_sync_status(&conn)
}

#[tauri::command]
pub fn get_distributions(
    scene_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Distribution>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::dist_engine::get_distributions(&conn, scene_id.as_deref())
}

#[tauri::command]
pub fn switch_global_scene(
    new_scene_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<SyncResult, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> = crate::plugins::platform::create_all_platform_plugins_vec();
    engine::dist_engine::switch_global_scene(&conn, &all_plugins, &new_scene_id)
}
