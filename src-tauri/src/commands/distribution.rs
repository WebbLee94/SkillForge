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
    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> = vec![
        Box::new(crate::plugins::platform::claude_code::ClaudeCodeAdapter::new()),
        Box::new(crate::plugins::platform::open_code::OpenCodeAdapter::new()),
        Box::new(crate::plugins::platform::cursor::CursorAdapter::new()),
    ];

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
    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> = vec![
        Box::new(crate::plugins::platform::claude_code::ClaudeCodeAdapter::new()),
        Box::new(crate::plugins::platform::open_code::OpenCodeAdapter::new()),
        Box::new(crate::plugins::platform::cursor::CursorAdapter::new()),
    ];
    engine::dist_engine::switch_global_scene(&conn, &all_plugins, &new_scene_id)
}

// ── Verify & Repair types ─────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct VerifyReport {
    pub total: u32,
    pub ok: u32,
    pub drifted: Vec<DriftedItem>,
}

#[derive(serde::Serialize)]
pub struct DriftedItem {
    pub item_type: String,
    pub item_id: String,
    pub platform_id: String,
    pub issue: String,
}

#[tauri::command]
pub fn verify_distribution(
    scene_id: String,
    scope: String,
    state: tauri::State<'_, AppState>,
) -> Result<VerifyReport, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> = vec![
        Box::new(crate::plugins::platform::claude_code::ClaudeCodeAdapter::new()),
        Box::new(crate::plugins::platform::open_code::OpenCodeAdapter::new()),
        Box::new(crate::plugins::platform::cursor::CursorAdapter::new()),
    ];
    engine::dist_engine::verify_distribution(&conn, &all_plugins, &scene_id, &scope)
}

#[tauri::command]
pub fn repair_drift(
    item_type: String,
    item_id: String,
    platform_id: String,
    action: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let plugin = crate::plugins::platform::create_platform_plugin(&platform_id)?;
    engine::dist_engine::repair_drift(&conn, plugin.as_ref(), &item_type, &item_id, &platform_id, &action)
}
