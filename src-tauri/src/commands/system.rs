use crate::error::AppError;
use crate::types::{AppConfig, DashboardStats, Platform, SyncLog};
use crate::AppState;

use rusqlite::params;
use crate::types::FileTreeNode;

// ── Global distribution status types ──────────────────────────────

#[derive(serde::Serialize)]
pub struct GlobalDistStatus {
    pub platforms: Vec<PlatformDistInfo>,
}

#[derive(serde::Serialize)]
pub struct PlatformDistInfo {
    pub platform_id: String,
    pub platform_name: String,
    #[serde(default)]
    pub synced_skill_count: u32,
    #[serde(default)]
    pub synced_rule_count: u32,
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
pub fn get_dashboard_stats(state: tauri::State<'_, AppState>) -> Result<DashboardStats, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    let skill_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM skills", [], |row| row.get(0))
        .unwrap_or(0);

    let rule_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM rules", [], |row| row.get(0))
        .unwrap_or(0);

    let scene_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM scenes", [], |row| row.get(0))
        .unwrap_or(0);

    let user_scene_count: i64 = scene_count;

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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut stmt =
        conn.prepare("SELECT id, name, adapter, enabled, icon FROM platforms ORDER BY name ASC")?;
    let platforms = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let adapter: String = row.get(2)?;
            let enabled: bool = row.get::<_, i32>(3)? != 0;
            let icon: Option<String> = row.get(4)?;

            // Merge with compile-time constant for paths
            let paths = crate::plugins::platform::definitions::find_platform_def(&id)
                .map(crate::types::PlatformPaths::from)
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut stmt = conn.prepare(
        "SELECT p.id, p.name,
                COALESCE(SUM(CASE WHEN d.scope = 'global' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN d.scope = 'project' THEN 1 ELSE 0 END), 0)
         FROM platforms p
         LEFT JOIN distributions d ON p.id = d.platform_id
         WHERE p.enabled != 0
         GROUP BY p.id, p.name
         ORDER BY p.name ASC",
    )?;

    let platforms: Vec<PlatformDistInfo> = stmt
        .query_map([], |row| {
            Ok(PlatformDistInfo {
                platform_id: row.get(0)?,
                platform_name: row.get(1)?,
                synced_skill_count: row.get(2)?,
                synced_rule_count: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(GlobalDistStatus { platforms })
}

#[tauri::command]
pub fn toggle_platform_enabled(
    id: String,
    enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
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

// ── Platform entry count ───────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct PlatformEntryCount {
    pub platform_id: String,
    pub skills: i64,
    pub rules: i64,
    pub dir_exists: bool,
}

fn count_entries_fs(
    skills_dir: &std::path::Path,
    rules_path: Option<&std::path::Path>,
    rules_single_file: bool,
) -> (i64, i64) {
    let skills = crate::engine::dist_engine::count_fs_subdirs(skills_dir);
    let rules = match rules_path {
        // SingleFile 模式：rules 路径指向单个文件，存在即 1 条
        Some(p) if rules_single_file => i64::from(p.is_file()),
        Some(p) => crate::engine::dist_engine::count_fs_files(p),
        None => 0,
    };
    (skills, rules)
}

#[tauri::command]
pub fn count_platform_entries(
    platform_id: String,
    project_path: Option<String>,
) -> Result<PlatformEntryCount, AppError> {
    let plugin = crate::plugins::platform::create_platform_plugin(&platform_id)?;
    let paths = plugin.default_paths();

    let (skills_dir, rules_path, rules_single_file, base_dir) =
        if let Some(ref pp) = project_path {
            // Project-scoped: resolve patterns with project path
            let skills_dir_str = paths.project_skills_pattern.replace("{project}", pp);
            let skills_dir = std::path::PathBuf::from(&skills_dir_str);
            let base_dir = skills_dir.parent().unwrap_or(&skills_dir).to_path_buf();
            let rules_path = paths
                .project_rules_pattern
                .as_ref()
                .map(|p| std::path::PathBuf::from(p.replace("{project}", pp)));
            let rules_single_file = matches!(
                paths.project_rules_format,
                Some(crate::types::RulesFormat::SingleFile { .. })
            );
            (skills_dir, rules_path, rules_single_file, base_dir)
        } else {
            let skills_dir = crate::plugins::platform::expand_home(&paths.global_skills_dir);
            let base_dir = skills_dir.parent().unwrap_or(&skills_dir).to_path_buf();
            let rules_path = paths
                .global_rules_dir
                .as_ref()
                .map(|p| crate::plugins::platform::expand_home(p));
            let rules_single_file = matches!(
                paths.global_rules_format,
                Some(crate::types::RulesFormat::SingleFile { .. })
            );
            (skills_dir, rules_path, rules_single_file, base_dir)
        };

    let dir_exists = base_dir.is_dir();
    let (skills, rules) = count_entries_fs(&skills_dir, rules_path.as_deref(), rules_single_file);
    Ok(PlatformEntryCount {
        platform_id,
        skills,
        rules,
        dir_exists,
    })
}

// ── Watcher commands ──

#[tauri::command]
pub fn get_watcher_events() -> Result<serde_json::Value, AppError> {
    let events = crate::engine::fs_watcher::get_pending_events();
    let result: Vec<serde_json::Value> = events
        .iter()
        .map(|(id, event_type, path)| {
            serde_json::json!({
                "id": id,
                "event_type": event_type,
                "path": path,
            })
        })
        .collect();
    Ok(serde_json::json!({
        "unhandled_count": result.len(),
        "events": result,
    }))
}

#[tauri::command]
pub fn handle_watcher_event(_event_id: i64, _action: i32) -> Result<(), AppError> {
    crate::engine::fs_watcher::clear_pending_events();
    Ok(())
}

// ── File system (distribution) ─────────────────────────────────────

/// 递归读取目录树，max_depth=0 表示仅当前层
fn read_dir_tree(path: &std::path::Path, max_depth: u32) -> Vec<FileTreeNode> {
    let mut nodes = Vec::new();
    if !path.exists() {
        return nodes;
    }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            // 跳过隐藏文件/夹
            if name.starts_with('.') {
                continue;
            }
            if entry_path.is_dir() {
                let children = if max_depth > 0 {
                    read_dir_tree(&entry_path, max_depth - 1)
                } else {
                    Vec::new()
                };
                nodes.push(FileTreeNode {
                    name,
                    path: entry_path.to_string_lossy().to_string(),
                    is_dir: true,
                    children,
                });
            } else {
                nodes.push(FileTreeNode {
                    name,
                    path: entry_path.to_string_lossy().to_string(),
                    is_dir: false,
                    children: Vec::new(),
                });
            }
        }
    }
    nodes.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir) // 目录在前
        } else {
            a.name.cmp(&b.name)
        }
    });
    nodes
}

/// 可预览的文本扩展名白名单
const TEXT_EXTENSIONS: &[&str] = &[
    "md", "ts", "tsx", "js", "jsx", "json", "xml", "yaml", "yml",
    "toml", "ini", "cfg", "conf", "rs", "py", "sh", "bash", "zsh",
    "bat", "ps1", "txt", "env", "gitignore", "editorconfig", "prettierrc",
    "css", "scss", "less", "html", "sql", "rb", "go", "java", "kt",
    "vue", "svelte", "astro", "gradle", "properties",
];

#[tauri::command]
pub fn list_directory_tree(
    path: String,
    max_depth: Option<u32>,
) -> Result<Vec<FileTreeNode>, AppError> {
    let p = crate::plugins::platform::expand_home(&path);
    if !p.exists() {
        return Ok(Vec::new());
    }
    Ok(read_dir_tree(&p, max_depth.unwrap_or(3)))
}

#[tauri::command]
pub fn read_file_content(path: String) -> Result<serde_json::Value, AppError> {
    let p = crate::plugins::platform::expand_home(&path);
    if !p.exists() || !p.is_file() {
        return Ok(serde_json::json!({ "content": null, "is_text": false }));
    }

    // 检查扩展名
    let ext = p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let is_text = TEXT_EXTENSIONS.contains(&ext.as_str());

    if !is_text {
        return Ok(serde_json::json!({ "content": null, "is_text": false }));
    }

    let content = std::fs::read_to_string(p)
        .map_err(|e| AppError::Io(format!("读取文件失败: {}", e)))?;

    Ok(serde_json::json!({ "content": content, "is_text": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_entries_fs_counts_subdirs_and_files() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_dir = tmp.path().join("skills");
        let rules_dir = tmp.path().join("rules");
        std::fs::create_dir_all(&skills_dir).unwrap();
        std::fs::create_dir_all(&rules_dir).unwrap();

        // skills: 3 个可见子目录 + 1 个隐藏子目录 + 1 个文件 → 3
        for d in ["skill-a", "skill-b", "skill-c"] {
            std::fs::create_dir(skills_dir.join(d)).unwrap();
        }
        std::fs::create_dir(skills_dir.join(".hidden")).unwrap();
        std::fs::write(skills_dir.join("notes.md"), "x").unwrap();

        // rules: 2 个可见文件 + 1 个隐藏文件 + 1 个子目录 → 2
        std::fs::write(rules_dir.join("rules-a.md"), "x").unwrap();
        std::fs::write(rules_dir.join("rules-b.md"), "x").unwrap();
        std::fs::write(rules_dir.join(".hidden.md"), "x").unwrap();
        std::fs::create_dir(rules_dir.join("sub")).unwrap();

        let (skills, rules) = count_entries_fs(&skills_dir, Some(&rules_dir), false);
        assert_eq!(skills, 3);
        assert_eq!(rules, 2);
    }

    #[test]
    fn count_entries_fs_single_file_rules() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_dir = tmp.path().join("skills");
        std::fs::create_dir_all(&skills_dir).unwrap();

        let rules_file = tmp.path().join("CLAUDE.md");
        std::fs::write(&rules_file, "x").unwrap();
        let (_, rules) = count_entries_fs(&skills_dir, Some(&rules_file), true);
        assert_eq!(rules, 1);

        let missing = tmp.path().join("missing.md");
        let (_, rules) = count_entries_fs(&skills_dir, Some(&missing), true);
        assert_eq!(rules, 0);
    }

    #[test]
    fn count_entries_fs_missing_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let (skills, rules) = count_entries_fs(
            &tmp.path().join("no-skills"),
            Some(&tmp.path().join("no-rules")),
            false,
        );
        assert_eq!(skills, 0);
        assert_eq!(rules, 0);
    }

    #[test]
    fn count_entries_fs_no_rules_path() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_dir = tmp.path().join("skills");
        std::fs::create_dir_all(&skills_dir).unwrap();
        std::fs::create_dir(skills_dir.join("skill-a")).unwrap();

        let (skills, rules) = count_entries_fs(&skills_dir, None, false);
        assert_eq!(skills, 1);
        assert_eq!(rules, 0);
    }
}
