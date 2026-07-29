use crate::engine;
use crate::error::AppError;
use crate::types::{CreateSceneDTO, Scene, SceneDetail, UpdateSceneDTO};
use crate::AppState;

#[tauri::command]
pub fn list_scenes(state: tauri::State<'_, AppState>) -> Result<Vec<Scene>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::list_scenes(&conn)
}

#[tauri::command]
pub fn create_scene(
    data: CreateSceneDTO,
    state: tauri::State<'_, AppState>,
) -> Result<Scene, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::create_scene(&conn, &data)
}

#[tauri::command]
pub fn update_scene(
    id: String,
    data: UpdateSceneDTO,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::update_scene(&conn, &id, &data)
}

#[tauri::command]
pub fn delete_scene(id: String, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::delete_scene(&conn, &id)
}

#[tauri::command]
pub fn add_skill_to_scene(
    scene_id: String,
    skill_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::add_skill_to_scene(&conn, &scene_id, &skill_id)
}

#[tauri::command]
pub fn remove_skill_from_scene(
    scene_id: String,
    skill_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::remove_skill_from_scene(&conn, &scene_id, &skill_id)
}

#[tauri::command]
pub fn add_rule_to_scene(
    scene_id: String,
    rule_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::add_rule_to_scene(&conn, &scene_id, &rule_id)
}

#[tauri::command]
pub fn remove_rule_from_scene(
    scene_id: String,
    rule_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::remove_rule_from_scene(&conn, &scene_id, &rule_id)
}

#[tauri::command]
pub fn get_scene_detail(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<SceneDetail, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::get_scene_detail(&conn, &id)
}

#[tauri::command]
pub fn get_scene_platforms(
    scene_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::get_scene_platforms(&conn, &scene_id)
}

#[tauri::command]
pub fn set_scene_platforms(
    scene_id: String,
    platform_ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::set_scene_platforms(&conn, &scene_id, &platform_ids)
}
