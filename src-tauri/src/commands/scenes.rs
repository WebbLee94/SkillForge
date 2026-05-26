use crate::engine;
use crate::error::AppError;
use crate::types::{CreateSceneDTO, Scene, SceneDetail, UpdateSceneDTO};
use crate::AppState;

#[tauri::command]
pub fn list_scenes(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Scene>, AppError> {
    eprintln!("[DIAG] list_scenes called");
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::list_scenes(&conn)
        .inspect(|scenes| eprintln!("[DIAG] list_scenes OK: {} scenes", scenes.len()))
}

#[tauri::command]
pub fn create_scene(
    data: CreateSceneDTO,
    state: tauri::State<'_, AppState>,
) -> Result<Scene, AppError> {
    eprintln!("[DIAG] create_scene called: data={:?}", data);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::create_scene(&conn, &data)
        .map_err(|e| {
            eprintln!("[DIAG] create_scene FAILED: {:?}", e);
            e
        })
        .inspect(|scene| eprintln!("[DIAG] create_scene OK: id={}", scene.id))
}

#[tauri::command]
pub fn update_scene(
    id: String,
    data: UpdateSceneDTO,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    eprintln!("[DIAG] update_scene called: id={}, data={:?}", id, data);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::update_scene(&conn, &id, &data)
        .map_err(|e| {
            eprintln!("[DIAG] update_scene FAILED: {:?}", e);
            e
        })
        .inspect(|_| eprintln!("[DIAG] update_scene OK"))
}

#[tauri::command]
pub fn delete_scene(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    eprintln!("[DIAG] delete_scene called: id={}", id);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::delete_scene(&conn, &id)
        .map_err(|e| {
            eprintln!("[DIAG] delete_scene FAILED: {:?}", e);
            e
        })
        .inspect(|_| eprintln!("[DIAG] delete_scene OK"))
}

#[tauri::command]
pub fn add_skill_to_scene(
    scene_id: String,
    skill_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    eprintln!("[DIAG] add_skill_to_scene called: scene_id={}, skill_id={}", scene_id, skill_id);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::add_skill_to_scene(&conn, &scene_id, &skill_id)
        .map_err(|e| {
            eprintln!("[DIAG] add_skill_to_scene FAILED: {:?}", e);
            e
        })
        .inspect(|_| eprintln!("[DIAG] add_skill_to_scene OK"))
}

#[tauri::command]
pub fn remove_skill_from_scene(
    scene_id: String,
    skill_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    eprintln!("[DIAG] remove_skill_from_scene called: scene_id={}, skill_id={}", scene_id, skill_id);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::remove_skill_from_scene(&conn, &scene_id, &skill_id)
        .map_err(|e| {
            eprintln!("[DIAG] remove_skill_from_scene FAILED: {:?}", e);
            e
        })
        .inspect(|_| eprintln!("[DIAG] remove_skill_from_scene OK"))
}

#[tauri::command]
pub fn add_rule_to_scene(
    scene_id: String,
    rule_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    eprintln!("[DIAG] add_rule_to_scene called: scene_id={}, rule_id={}", scene_id, rule_id);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::add_rule_to_scene(&conn, &scene_id, &rule_id)
        .map_err(|e| {
            eprintln!("[DIAG] add_rule_to_scene FAILED: {:?}", e);
            e
        })
        .inspect(|_| eprintln!("[DIAG] add_rule_to_scene OK"))
}

#[tauri::command]
pub fn remove_rule_from_scene(
    scene_id: String,
    rule_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    eprintln!("[DIAG] remove_rule_from_scene called: scene_id={}, rule_id={}", scene_id, rule_id);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::remove_rule_from_scene(&conn, &scene_id, &rule_id)
        .map_err(|e| {
            eprintln!("[DIAG] remove_rule_from_scene FAILED: {:?}", e);
            e
        })
        .inspect(|_| eprintln!("[DIAG] remove_rule_from_scene OK"))
}

#[tauri::command]
pub fn get_scene_detail(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<SceneDetail, AppError> {
    eprintln!("[DIAG] get_scene_detail called: id={}", id);
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::get_scene_detail(&conn, &id)
        .map_err(|e| {
            eprintln!("[DIAG] get_scene_detail FAILED: {:?}", e);
            e
        })
        .inspect(|_| eprintln!("[DIAG] get_scene_detail OK"))
}

#[tauri::command]
pub fn get_scene_platforms(
    scene_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::get_scene_platforms(&conn, &scene_id)
}

#[tauri::command]
pub fn set_scene_platforms(
    scene_id: String,
    platform_ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    engine::scene_engine::set_scene_platforms(&conn, &scene_id, &platform_ids)
}
