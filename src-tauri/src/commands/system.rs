use crate::error::AppError;
use crate::types::{AppConfig, DashboardStats, Platform, SyncLog};
use crate::AppState;

use rusqlite::params;

// ── Global distribution status types ──────────────────────────────

#[derive(serde::Serialize)]
pub struct GlobalDistStatus {
    scene_id: Option<String>,
    scene_name: Option<String>,
    skill_count: u32,
    rule_count: u32,
    platforms: Vec<PlatformDistInfo>,
    last_synced_at: Option<String>,
}

#[derive(serde::Serialize)]
pub struct PlatformDistInfo {
    platform_id: String,
    platform_name: String,
    synced_count: u32,
    total_count: u32,
    last_synced_at: Option<String>,
    skills_dir: Option<String>,
    rules_dir: Option<String>,
}

#[tauri::command]
pub fn get_app_config() -> Result<AppConfig, AppError> {
    let data_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Io("无法找到用户主目录".to_string()))?
        .join(".skillforge");

    Ok(AppConfig {
        data_dir: data_dir.to_string_lossy().to_string(),
        db_path: data_dir.join("skillforge.db").to_string_lossy().to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tauri::command]
pub fn get_dashboard_stats(
    state: tauri::State<'_, AppState>,
) -> Result<DashboardStats, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let skill_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM skills", [], |row| row.get(0))
        .unwrap_or(0);

    let rule_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM rules", [], |row| row.get(0))
        .unwrap_or(0);

    let scene_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM scenes",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let user_scene_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM scenes WHERE is_system = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let project_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .unwrap_or(0);

    Ok(DashboardStats {
        skill_count,
        rule_count,
        scene_count,
        user_scene_count,
        project_count,
    })
}

#[tauri::command]
pub fn get_recent_activity(
    limit: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SyncLog>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let limit = limit.unwrap_or(50);

    let mut stmt = conn.prepare(
        "SELECT id, action, target_type, target_id, platform_id, status, message, created_at
         FROM sync_logs
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;

    let logs = stmt
        .query_map(params![limit], |row| {
            Ok(SyncLog {
                id: row.get(0)?,
                action: row.get(1)?,
                target_type: row.get(2)?,
                target_id: row.get(3)?,
                platform_id: row.get(4)?,
                status: row.get(5)?,
                message: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(logs)
}

#[tauri::command]
pub fn list_platforms(state: tauri::State<'_, AppState>) -> Result<Vec<Platform>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, name, adapter, enabled, icon FROM platforms ORDER BY name ASC",
    )?;
    let platforms = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let adapter: String = row.get(2)?;
            let enabled: bool = row.get::<_, i32>(3)? != 0;
            let icon: Option<String> = row.get(4)?;

            // Merge with compile-time constant for paths
            let paths = crate::plugins::platform::definitions::find_platform_def(&id)
                .map(|def| crate::types::PlatformPaths::from(def))
                .unwrap_or_else(|| crate::types::PlatformPaths {
                    global_skills_dir: String::new(),
                    project_skills_pattern: String::new(),
                    global_rules_dir: None,
                    project_rules_pattern: None,
                    global_rules_format: None,
                    project_rules_format: None,
                });

            Ok(Platform {
                id,
                name,
                adapter,
                enabled,
                icon,
                paths,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(platforms)
}

#[tauri::command]
pub fn get_global_config(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'global_scene_id'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(None);
    Ok(serde_json::json!({ "global_scene_id": value }))
}

#[tauri::command]
pub fn set_global_config(
    key: String,
    value: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    if let Some(v) = value {
        conn.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, v],
        )?;
    } else {
        conn.execute(
            "UPDATE app_config SET value = NULL WHERE key = ?1",
            rusqlite::params![key],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_global_distribution_status(
    state: tauri::State<'_, AppState>,
) -> Result<GlobalDistStatus, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    // Get global_scene_id
    let scene_id: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'global_scene_id'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(None);

    let mut status = GlobalDistStatus {
        scene_id: None,
        scene_name: None,
        skill_count: 0,
        rule_count: 0,
        platforms: Vec::new(),
        last_synced_at: None,
    };

    if let Some(ref sid) = scene_id {
        status.scene_id = Some(sid.clone());

        // Get scene name
        status.scene_name = conn
            .query_row(
                "SELECT name FROM scenes WHERE id = ?1",
                params![sid],
                |row| row.get(0),
            )
            .unwrap_or(None);

        // Count enabled skills
        status.skill_count = conn
            .query_row(
                "SELECT COUNT(*) FROM scene_skills WHERE scene_id = ?1 AND enabled = 1",
                params![sid],
                |row| row.get::<_, u32>(0),
            )
            .unwrap_or(0);

        // Count enabled rules
        status.rule_count = conn
            .query_row(
                "SELECT COUNT(*) FROM scene_rules WHERE scene_id = ?1 AND enabled = 1",
                params![sid],
                |row| row.get::<_, u32>(0),
            )
            .unwrap_or(0);

        // Get per-platform status (only scene-associated, enabled platforms)
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, COALESCE(d.synced_count, 0), ?2, d.synced_at
             FROM platforms p
             INNER JOIN scene_platforms sp ON sp.platform_id = p.id AND sp.scene_id = ?1
             LEFT JOIN (
                SELECT platform_id, COUNT(*) as synced_count, MAX(synced_at) as synced_at
                FROM distributions WHERE scene_id = ?1 AND scope = 'global' GROUP BY platform_id
             ) d ON p.id = d.platform_id
             WHERE p.enabled != 0",
        )?;
        let platforms: Vec<PlatformDistInfo> = stmt
            .query_map(params![sid, status.skill_count], |row| {
                let pid: String = row.get(0)?;
                // Resolve paths from platform plugin
                let (skills_dir, rules_dir) = match crate::plugins::platform::create_platform_plugin(&pid) {
                    Ok(p) => {
                        let paths = p.default_paths();
                        (Some(paths.global_skills_dir), paths.global_rules_dir)
                    }
                    Err(_) => (None, None),
                };
                Ok(PlatformDistInfo {
                    platform_id: pid,
                    platform_name: row.get(1)?,
                    synced_count: row.get(2)?,
                    total_count: row.get(3)?,
                    last_synced_at: row.get(4)?,
                    skills_dir,
                    rules_dir,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        status.platforms = platforms;

        // Last synced
        status.last_synced_at = conn
            .query_row(
                "SELECT MAX(synced_at) FROM distributions WHERE scene_id = ?1 AND scope = 'global'",
                params![sid],
                |row| row.get(0),
            )
            .unwrap_or(None);
    }

    Ok(status)
}

#[tauri::command]
pub fn toggle_platform_enabled(
    id: String,
    enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    conn.execute(
        "UPDATE platforms SET enabled = ?1 WHERE id = ?2",
        params![enabled as i32, id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_db_size(_state: tauri::State<'_, AppState>) -> Result<String, AppError> {
    let data_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Io("无法找到用户主目录".to_string()))?
        .join(".skillforge");

    let mut total_size: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(&data_dir) {
        fn dir_size(path: &std::path::Path) -> u64 {
            let mut size = 0u64;
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() {
                            size += meta.len();
                        } else if meta.is_dir() {
                            size += dir_size(&entry.path());
                        }
                    }
                }
            }
            size
        }
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total_size += meta.len();
                } else if meta.is_dir() {
                    total_size += dir_size(&entry.path());
                }
            }
        }
    }

    if total_size >= 1_073_741_824 {
        Ok(format!("{:.1} GB", total_size as f64 / 1_073_741_824.0))
    } else if total_size >= 1_048_576 {
        Ok(format!("{:.1} MB", total_size as f64 / 1_048_576.0))
    } else {
        Ok(format!("{:.1} KB", total_size as f64 / 1024.0))
    }
}
