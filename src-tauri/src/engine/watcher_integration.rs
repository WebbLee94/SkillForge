use crate::error::AppError;
use rusqlite::params;
use std::path::Path;

/// Watcher event as persisted to DB
#[derive(Debug, Clone, serde::Serialize)]
pub struct WatcherEvent {
    pub id: i64,
    pub event_type: String,
    pub capability: String,
    pub path: String,
    pub platform: Option<String>,
    pub old_hash: Option<String>,
    pub new_hash: Option<String>,
    pub handled: i32,
    pub created_at: String,
}

/// Resolve a filesystem path to (platform_key, capability_type)
/// Uses ALL_PLATFORMS as the single source of truth for platform paths.
pub fn resolve_path_to_capability(path: &Path) -> Option<(String, String)> {
    let home = dirs::home_dir()?;

    // Central repository
    let sf_skills = home.join(".skillforge").join("skills");
    let sf_rules = home.join(".skillforge").join("rules");
    if path.starts_with(&sf_skills) {
        return Some((String::new(), "skill".into()));
    }
    if path.starts_with(&sf_rules) {
        return Some((String::new(), "rule".into()));
    }

    // Platform paths from single source of truth
    for def in crate::plugins::platform::definitions::ALL_PLATFORMS {
        let expanded_skills = crate::engine::fs_watcher::expand_home(def.skills_global);
        if path.starts_with(&expanded_skills) {
            return Some((def.id.to_string(), "skill".into()));
        }
        if let Some(rules_global) = def.rules_global {
            let expanded_rules = crate::engine::fs_watcher::expand_home(rules_global);
            if (def.rules_single_file_global && path == expanded_rules)
                || (!def.rules_single_file_global && path.starts_with(&expanded_rules))
            {
                return Some((def.id.to_string(), "rule".into()));
            }
        }
    }

    None
}

/// Persist a filesystem event into watcher_events and update skills.sync_status
pub fn handle_fs_event(
    conn: &rusqlite::Connection,
    event_path: &str,
    event_kind: &str,
) -> Result<(), AppError> {
    let (platform, capability) = match resolve_path_to_capability(Path::new(event_path)) {
        Some(p) => p,
        None => return Ok(()),
    };

    let platform_opt: Option<&str> = if platform.is_empty() {
        None
    } else {
        Some(&platform)
    };

    match event_kind {
        "NEW" => {
            conn.execute(
                "INSERT INTO watcher_events (event_type, capability, path, platform)
                 VALUES ('NEW', ?1, ?2, ?3)",
                params![capability, event_path, platform_opt],
            )?;
        }
        "DELETED" => {
            conn.execute(
                "INSERT INTO watcher_events (event_type, capability, path, platform)
                 VALUES ('DELETED', ?1, ?2, ?3)",
                params![capability, event_path, platform_opt],
            )?;
            conn.execute(
                "UPDATE skills SET sync_status = 'missing' WHERE local_path = ?1",
                params![event_path],
            )?;
        }
        "MODIFIED" => {
            conn.execute(
                "INSERT INTO watcher_events (event_type, capability, path, platform)
                 VALUES ('MODIFIED', ?1, ?2, ?3)",
                params![capability, event_path, platform_opt],
            )?;
            conn.execute(
                "UPDATE skills SET sync_status = 'modified' WHERE local_path = ?1",
                params![event_path],
            )?;
        }
        _ => {}
    }

    Ok(())
}

pub fn get_unhandled_events(conn: &rusqlite::Connection) -> Result<Vec<WatcherEvent>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, event_type, capability, path, platform, old_hash, new_hash, handled, created_at
         FROM watcher_events WHERE handled = 0 ORDER BY created_at DESC LIMIT 50",
    )?;
    let events = stmt
        .query_map([], |row| {
            Ok(WatcherEvent {
                id: row.get(0)?,
                event_type: row.get(1)?,
                capability: row.get(2)?,
                path: row.get(3)?,
                platform: row.get(4)?,
                old_hash: row.get(5)?,
                new_hash: row.get(6)?,
                handled: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(events)
}

pub fn mark_event_handled(
    conn: &rusqlite::Connection,
    event_id: i64,
    action: i32,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE watcher_events SET handled = ?1 WHERE id = ?2",
        params![action, event_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_claude_code_skill_path() {
        let home = dirs::home_dir().unwrap();
        let path = home.join(".claude").join("skills").join("my-skill");
        let result = resolve_path_to_capability(&path);
        assert_eq!(result, Some(("claude-code".into(), "skill".into())));
    }

    #[test]
    fn test_resolve_central_skill_path() {
        let home = dirs::home_dir().unwrap();
        let path = home.join(".skillforge").join("skills").join("my-skill");
        let result = resolve_path_to_capability(&path);
        assert_eq!(result, Some((String::new(), "skill".into())));
    }

    #[test]
    fn test_resolve_actual_platform_paths() {
        let home = dirs::home_dir().unwrap();

        let opencode_skill = home
            .join(".config")
            .join("opencode")
            .join("skills")
            .join("my-skill");
        assert_eq!(
            resolve_path_to_capability(&opencode_skill),
            Some(("opencode".into(), "skill".into()))
        );

        let claude_rules = home.join(".claude").join("CLAUDE.md");
        assert_eq!(
            resolve_path_to_capability(&claude_rules),
            Some(("claude-code".into(), "rule".into()))
        );

        let trae_rules = home.join(".trae").join("user_rules");
        assert_eq!(
            resolve_path_to_capability(&trae_rules),
            Some(("trae".into(), "rule".into()))
        );

        let hermes_rules = home.join(".hermes").join("AGENTS.md");
        assert_eq!(
            resolve_path_to_capability(&hermes_rules),
            Some(("hermes".into(), "rule".into()))
        );

        let openclaw_rules = home.join(".openclaw").join("rules");
        assert_eq!(resolve_path_to_capability(&openclaw_rules), None);
    }
}
