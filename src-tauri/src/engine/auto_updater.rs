use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

const POLL_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const INITIAL_DELAY: Duration = Duration::from_secs(60);

fn normalize_branch_name(branch: &str) -> Option<String> {
    branch
        .strip_prefix("refs/heads/")
        .map(str::to_string)
        .or_else(|| (!branch.is_empty()).then(|| branch.to_string()))
}

fn resolve_default_branch(repo: &git2::Repository) -> Option<String> {
    // Priority: try remote default_branch (requires network)
    if let Ok(mut remote) = repo.find_remote("origin") {
        if remote.connect(git2::Direction::Fetch).is_ok() {
            if let Ok(buf) = remote.default_branch() {
                let s = std::str::from_utf8(&buf).ok()?;
                let result = normalize_branch_name(s);
                if result.is_some() {
                    return result;
                }
            }
        }
    }

    // Fallback: check local remote HEAD symref (set during clone/fetch)
    if let Ok(r) = repo.find_reference("refs/remotes/origin/HEAD") {
        if let Some(target) = r.symbolic_target() {
            if let Some(name) = target.strip_prefix("refs/remotes/origin/") {
                return Some(name.to_string());
            }
        }
    }

    // Fallback: check common local branch names
    for candidate in &["main", "master"] {
        if repo
            .find_reference(&format!("refs/heads/{candidate}"))
            .is_ok()
        {
            return Some(candidate.to_string());
        }
    }

    None
}

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
                let branch = match resolve_default_branch(&repo) {
                    Some(branch) => branch,
                    None => continue,
                };
                if let Ok(mut remote) = repo.find_remote("origin") {
                    let callbacks = git2::RemoteCallbacks::new();
                    let mut opts = git2::FetchOptions::new();
                    opts.remote_callbacks(callbacks);
                    if remote.fetch(&[&branch], Some(&mut opts), None).is_err() {
                        continue;
                    }
                }
                let head_id = repo.head().and_then(|r| r.peel_to_commit()).map(|c| c.id());
                let origin_ref = format!("refs/remotes/origin/{branch}");
                let origin_id = repo
                    .find_reference(&origin_ref)
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

#[cfg(test)]
mod tests {
    use super::resolve_default_branch;
    use git2::{Repository, Signature};

    fn repo_with_commit_on_branch(branch: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let sig = Signature::now("test", "test@test.com").unwrap();
        let tree = {
            let mut idx = repo.index().unwrap();
            idx.write_tree().unwrap()
        };
        let tree_obj = repo.find_tree(tree).unwrap();
        repo.commit(
            Some(&format!("refs/heads/{branch}")),
            &sig,
            &sig,
            "init",
            &tree_obj,
            &[],
        )
        .unwrap();
        dir
    }

    #[test]
    fn resolve_master_when_local_branch_is_master() {
        let dir = repo_with_commit_on_branch("master");
        let repo = Repository::open(dir.path()).unwrap();
        assert_eq!(resolve_default_branch(&repo).unwrap(), "master");
    }

    #[test]
    fn resolve_main_when_local_branch_is_main() {
        let dir = repo_with_commit_on_branch("main");
        let repo = Repository::open(dir.path()).unwrap();
        assert_eq!(resolve_default_branch(&repo).unwrap(), "main");
    }

    #[test]
    fn resolve_none_when_no_branches_exist() {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        assert!(resolve_default_branch(&repo).is_none());
    }

    #[test]
    fn resolve_main_preferred_over_master() {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let sig = Signature::now("test", "test@test.com").unwrap();
        let tree = {
            let mut idx = repo.index().unwrap();
            idx.write_tree().unwrap()
        };
        let tree_obj = repo.find_tree(tree).unwrap();
        repo.commit(Some("refs/heads/main"), &sig, &sig, "init", &tree_obj, &[])
            .unwrap();
        repo.commit(
            Some("refs/heads/master"),
            &sig,
            &sig,
            "init",
            &tree_obj,
            &[],
        )
        .unwrap();
        assert_eq!(resolve_default_branch(&repo).unwrap(), "main");
    }
}
