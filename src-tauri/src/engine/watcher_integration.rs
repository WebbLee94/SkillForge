use std::path::Path;

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
