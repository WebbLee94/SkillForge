use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

const POLL_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const INITIAL_DELAY: Duration = Duration::from_secs(60);

pub fn start_auto_updater<R: Runtime>(app: AppHandle<R>, conn: Arc<Mutex<rusqlite::Connection>>) {
    std::thread::spawn(move || {
        std::thread::sleep(INITIAL_DELAY);

        loop {
            let skills: Vec<(String, String)> = {
                let db = conn.lock().unwrap();
                let mut stmt = match db
                    .prepare("SELECT id, local_path FROM skills WHERE source_type = 'git'")
                {
                    Ok(s) => s,
                    Err(_) => {
                        std::thread::sleep(POLL_INTERVAL);
                        continue;
                    }
                };
                stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                    .ok()
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default()
            };

            let mut updated = 0u32;
            for (_id, local_path) in &skills {
                let repo = match git2::Repository::open(local_path) {
                    Ok(r) => r,
                    Err(_) => continue,
                };
                if let Ok(mut remote) = repo.find_remote("origin") {
                    let callbacks = git2::RemoteCallbacks::new();
                    let mut opts = git2::FetchOptions::new();
                    opts.remote_callbacks(callbacks);
                    if remote.fetch(&["main"], Some(&mut opts), None).is_err() {
                        continue;
                    }
                }
                let head_id = repo.head().and_then(|r| r.peel_to_commit()).map(|c| c.id());
                let origin_id = repo
                    .find_reference("refs/remotes/origin/main")
                    .and_then(|r| r.peel_to_commit())
                    .map(|c| c.id());
                drop(repo);
                if let (Ok(h), Ok(o)) = (head_id, origin_id) {
                    if h != o {
                        updated += 1;
                    }
                }
            }

            if updated > 0 {
                log::info!("自动更新检测: {updated} 个技能有新版本");
                let _ = app.emit("app-fs-changed", ());
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    });
}
