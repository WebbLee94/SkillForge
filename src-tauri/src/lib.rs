pub mod commands;
pub mod db;
pub mod engine;
pub mod error;
pub mod plugins;
pub mod types;

use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Application state shared across Tauri commands
pub struct AppState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    // Test-only plugins: only registered in debug builds so production binaries stay lean
    #[cfg(debug_assertions)]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![
            commands::skills::list_skills,
            commands::skills::install_skill,
            commands::skills::install_skills_batch,
            commands::skills::uninstall_skill,
            commands::skills::update_skill,
            commands::skills::search_skills,
            commands::scenes::list_scenes,
            commands::scenes::create_scene,
            commands::scenes::update_scene,
            commands::scenes::delete_scene,
            commands::scenes::add_skill_to_scene,
            commands::scenes::remove_skill_from_scene,
            commands::scenes::add_rule_to_scene,
            commands::scenes::remove_rule_from_scene,
            commands::scenes::get_scene_detail,
            commands::distribution::sync_scene,
            commands::distribution::get_sync_status,
            commands::distribution::get_distributions,
            commands::distribution::switch_global_scene,
            commands::distribution::preview_sync,
            commands::distribution::preview_distribution,
            commands::distribution::get_managed_distribution_state,
            commands::distribution::execute_distribution,
            commands::projects::list_projects,
            commands::projects::add_project,
            commands::projects::bind_scene_to_project,
            commands::projects::remove_project,
            commands::projects::rename_project,
            commands::rules::list_rules,
            commands::rules::create_rule,
            commands::rules::update_rule,
            commands::rules::delete_rule,
            commands::rules::get_rule_history,
            commands::tags::list_tags,
            commands::tags::create_tag,
            commands::tags::update_tag,
            commands::tags::delete_tag,
            commands::tags::assign_tag,
            commands::tags::remove_tag,
            commands::system::get_app_config,
            commands::system::get_dashboard_stats,
            commands::system::get_recent_activity,
            commands::system::list_platforms,
            commands::system::get_global_config,
            commands::system::set_global_config,
            commands::system::get_global_distribution_status,
            commands::system::toggle_platform_enabled,
            commands::system::count_platform_entries,
            commands::system::get_db_size,
            commands::system::get_watcher_events,
            commands::system::handle_watcher_event,
            commands::system::list_directory_tree,
            commands::system::read_file_content,
            commands::platform::get_platform_capabilities,
            commands::import::scan_for_import,
            commands::import::import_scanned,
        ])
        .setup(|app| {
            // Initialize database on startup
            let data_dir = dirs::home_dir()
                .expect("无法找到用户主目录")
                .join(".skillforge");
            std::fs::create_dir_all(&data_dir).ok();
            let db_path = data_dir.join("skillforge.db");
            let mut conn = rusqlite::Connection::open(&db_path).expect("无法打开数据库");
            conn.busy_timeout(std::time::Duration::from_secs(5)).ok();
            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
            db::migrations::run_migrations(&mut conn).expect("无法运行数据库迁移");

            let skills_dir = data_dir.join("skills");
            let rules_dir = data_dir.join("rules");
            let cache_dir = data_dir.join("cache/git");
            std::fs::create_dir_all(&skills_dir).ok();
            std::fs::create_dir_all(&rules_dir).ok();
            std::fs::create_dir_all(&cache_dir).ok();

            let conn = Arc::new(Mutex::new(conn));
            app.manage(AppState { db: conn.clone() });

            let watch_paths = {
                let db = conn.lock().unwrap();
                let mut stmt = db
                    .prepare("SELECT id FROM platforms WHERE enabled != 0")
                    .unwrap();
                let ids: Vec<String> = stmt
                    .query_map([], |r| r.get(0))
                    .unwrap()
                    .filter_map(|r| r.ok())
                    .collect();
                engine::fs_watcher::build_watch_paths(&ids)
            };

            let watcher_app = app.handle().clone();
            engine::fs_watcher::start_file_watcher(watcher_app, watch_paths);

            let updater_app = app.handle().clone();
            engine::auto_updater::start_auto_updater(updater_app, conn.clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时出错");
}
