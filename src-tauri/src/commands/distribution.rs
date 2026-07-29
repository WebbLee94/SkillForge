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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    // Create platform plugin instances
    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> =
        crate::plugins::platform::create_all_platform_plugins_vec();

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
pub fn get_sync_status(state: tauri::State<'_, AppState>) -> Result<SyncStatusDTO, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::dist_engine::get_sync_status(&conn)
}

#[tauri::command]
pub fn get_distributions(
    scene_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Distribution>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::dist_engine::get_distributions(&conn, scene_id.as_deref())
}

#[tauri::command]
pub fn switch_global_scene(
    new_scene_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<SyncResult, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> =
        crate::plugins::platform::create_all_platform_plugins_vec();
    engine::dist_engine::switch_global_scene(&conn, &all_plugins, &new_scene_id)
}

#[derive(serde::Serialize)]
pub struct SyncPreviewResult {
    pub platforms: Vec<PlatformSyncPreview>,
    pub has_removals: bool,
}

#[derive(serde::Serialize)]
pub struct PlatformSyncPreview {
    pub platform_id: String,
    pub platform_name: String,
    pub skills_to_add: Vec<String>,
    pub skills_to_remove: Vec<String>,
    pub rules_to_add: Vec<String>,
    pub rules_to_remove: Vec<String>,
}

#[tauri::command]
pub fn preview_sync(
    scene_id: String,
    platform_ids: Vec<String>,
    _scope: String,
    _project_id: Option<String>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<SyncPreviewResult, crate::error::AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| crate::error::AppError::Database(e.to_string()))?;

    let scene_skills =
        crate::engine::dist_engine::resolve_scene_skills_for_preview(&conn, &scene_id)?;
    let scene_rules =
        crate::engine::dist_engine::resolve_scene_rules_for_preview(&conn, &scene_id)?;

    let mut platforms = Vec::new();
    let mut has_removals = false;

    for pid in &platform_ids {
        let pname = conn
            .query_row(
                "SELECT name FROM platforms WHERE id = ?1",
                rusqlite::params![pid],
                |r| r.get::<_, String>(0),
            )
            .unwrap_or_else(|_| pid.clone());

        let mut skills_to_add = Vec::new();
        let mut skills_to_remove = Vec::new();
        let mut rules_to_add = Vec::new();
        let mut rules_to_remove = Vec::new();

        if let Ok(plugin) = crate::plugins::platform::create_platform_plugin(pid) {
            let paths = plugin.default_paths();
            let skills_dir = crate::plugins::platform::expand_home(&paths.global_skills_dir);

            // Read current skills on platform
            let mut current_skills = Vec::new();
            if skills_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&skills_dir) {
                    for entry in entries.flatten() {
                        if entry.path().is_dir() {
                            if let Some(name) = entry.file_name().to_str() {
                                if !name.starts_with('.') {
                                    current_skills.push(name.to_string());
                                }
                            }
                        }
                    }
                }
            }

            // Compute skill diff
            for sid in &scene_skills {
                if !current_skills.contains(sid) {
                    skills_to_add.push(sid.clone());
                }
            }
            for sid in &current_skills {
                if !scene_skills.contains(sid) {
                    skills_to_remove.push(sid.clone());
                }
            }

            // Rules: Directory mode only
            if let Some(rules_dir_str) = &paths.global_rules_dir {
                let rules_dir = crate::plugins::platform::expand_home(rules_dir_str);
                if rules_dir.is_dir() {
                    let mut current_rules = Vec::new();
                    if let Ok(entries) = std::fs::read_dir(&rules_dir) {
                        for entry in entries.flatten() {
                            if entry.path().is_file() {
                                let ext = std::path::Path::new(&entry.file_name())
                                    .extension()
                                    .map(|e| e.to_string_lossy().to_string())
                                    .unwrap_or_default();
                                if ["md", "mdc", "yaml"].contains(&ext.as_str()) {
                                    if let Some(stem) =
                                        std::path::Path::new(&entry.file_name()).file_stem()
                                    {
                                        current_rules.push(stem.to_string_lossy().to_string());
                                    }
                                }
                            }
                        }
                    }

                    for rid in &scene_rules {
                        if !current_rules.contains(rid) {
                            rules_to_add.push(rid.clone());
                        }
                    }
                    for rid in &current_rules {
                        if !scene_rules.contains(rid) {
                            rules_to_remove.push(rid.clone());
                        }
                    }
                }
            }

            if !skills_to_remove.is_empty() || !rules_to_remove.is_empty() {
                has_removals = true;
            }

            platforms.push(PlatformSyncPreview {
                platform_id: pid.clone(),
                platform_name: pname,
                skills_to_add,
                skills_to_remove,
                rules_to_add,
                rules_to_remove,
            });
        }
    }

    Ok(SyncPreviewResult {
        platforms,
        has_removals,
    })
}
