use crate::error::AppError;
use crate::types::{
    PlatformInstance, PlatformPaths, Skill, SkillPlatformStatus, SyncResult,
};

/// Trait for Agent platform adapter plugins.
/// Each platform (Claude Code, OpenCode, Cursor, etc.) implements this.
pub trait PlatformPlugin: Send + Sync {
    /// Unique identifier for this platform
    fn platform_name(&self) -> &'static str;

    /// Human-readable display name
    fn display_name(&self) -> &'static str;

    /// Detect installed instances of this platform on the system
    fn detect(&self) -> Result<Vec<PlatformInstance>, AppError>;

    /// Install a skill to a platform instance
    fn install(&self, skill: &Skill, instance: &PlatformInstance) -> Result<(), AppError>;

    /// Sync a skill to a platform instance (update if changed)
    fn sync(&self, skill: &Skill, instance: &PlatformInstance) -> Result<SyncResult, AppError>;

    /// Remove a skill from a platform instance
    fn remove(&self, skill_id: &str, instance: &PlatformInstance) -> Result<(), AppError>;

    /// Check the installation status of a skill on a platform instance
    fn status(&self, skill_id: &str, instance: &PlatformInstance) -> Result<SkillPlatformStatus, AppError>;

    /// Get the default installation paths for this platform
    fn default_paths(&self) -> PlatformPaths;
}

/// Macro to define a symlink-based platform adapter.
///
/// Generates a struct with `new()` + `Default` impl + full `PlatformPlugin` trait impl.
/// The install/sync/remove/status logic is symlink-based, identical across all adapters.
///
/// Parameters:
/// - `$struct_name`:       Name of the adapter struct (e.g. `ClaudeCodeAdapter`)
/// - `$platform_id`:       Unique platform identifier string (e.g. `"claude-code"`)
/// - `$display_name`:      Human-readable name string (e.g. `"Claude Code"`)
/// - `$global_skills_dir`: Global skills directory path (e.g. `"~/.claude/skills"`)
/// - `$project_skills_pattern`: Project-level skills dir without `{project}/` prefix (e.g. `".claude/skills"`)
/// - `$global_rules_dir`:  Optional global rules directory (e.g. `Some("~/.claude/rules")` or `None`)
macro_rules! define_symlink_adapter {
    (
        $struct_name:ident,
        $platform_id:literal,
        $display_name:literal,
        $global_skills_dir:literal,
        $project_skills_pattern:literal,
        $global_rules_dir:expr
    ) => {
        pub struct $struct_name;

        impl $struct_name {
            pub fn new() -> Self {
                Self
            }

            fn global_skills_dir() -> std::path::PathBuf {
                expand_home($global_skills_dir)
            }

            fn skill_target_path(skill_id: &str, instance: &PlatformInstance) -> std::path::PathBuf {
                if instance.scope == "global" {
                    Self::global_skills_dir().join(skill_id)
                } else {
                    std::path::PathBuf::from(&instance.path).join(skill_id)
                }
            }

            fn skill_source_path(skill: &Skill) -> std::path::PathBuf {
                std::path::PathBuf::from(&skill.local_path)
            }
        }

        impl Default for $struct_name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl PlatformPlugin for $struct_name {
            fn platform_name(&self) -> &'static str {
                $platform_id
            }

            fn display_name(&self) -> &'static str {
                $display_name
            }

            fn detect(&self) -> Result<Vec<PlatformInstance>, AppError> {
                let mut instances = Vec::new();

                let global_dir = Self::global_skills_dir();
                let detect_dir = expand_home($global_skills_dir)
                    .parent()
                    .map(|p| p.to_path_buf())
                    .unwrap_or_else(|| global_dir.clone());

                if global_dir.exists() || detect_dir.exists() {
                    instances.push(PlatformInstance {
                        platform_id: $platform_id.to_string(),
                        platform_name: $display_name.to_string(),
                        path: global_dir.to_string_lossy().to_string(),
                        scope: "global".to_string(),
                    });
                }

                Ok(instances)
            }

            fn install(&self, skill: &Skill, instance: &PlatformInstance) -> Result<(), AppError> {
                let target = Self::skill_target_path(&skill.id, instance);
                let source = Self::skill_source_path(skill);

                // Ensure target directory exists
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)?;
                }

                // Remove existing symlink or directory if present
                if target.exists() || target.symlink_metadata().is_ok() {
                    if target.is_symlink() {
                        std::fs::remove_file(&target)?;
                    } else if target.is_dir() {
                        std::fs::remove_dir_all(&target)?;
                    }
                }

                // Create symlink: target -> source
                #[cfg(unix)]
                {
                    std::os::unix::fs::symlink(&source, &target).map_err(|e| {
                        AppError::Platform(format!(
                            "创建符号链接 {} -> {} 失败: {}",
                            target.display(),
                            source.display(),
                            e
                        ))
                    })?;
                }

                #[cfg(not(unix))]
                {
                    copy_dir_recursive(&source, &target)?;
                }

                Ok(())
            }

            fn sync(&self, skill: &Skill, instance: &PlatformInstance) -> Result<SyncResult, AppError> {
                let mut result = SyncResult {
                    installed: Vec::new(),
                    updated: Vec::new(),
                    removed: Vec::new(),
                    errors: Vec::new(),
                };

                let target = Self::skill_target_path(&skill.id, instance);

                if target.exists() {
                    // Check if symlink points to correct target
                    let current_target = target.read_link().ok();
                    let source = Self::skill_source_path(skill);

                    if current_target.as_ref() != Some(&source) {
                        // Re-install with correct symlink
                        self.install(skill, instance)?;
                        result.updated.push(skill.id.clone());
                    }
                } else {
                    // Fresh install
                    self.install(skill, instance)?;
                    result.installed.push(skill.id.clone());
                }

                Ok(result)
            }

            fn remove(&self, skill_id: &str, instance: &PlatformInstance) -> Result<(), AppError> {
                let target = Self::skill_target_path(skill_id, instance);

                if !target.exists() && target.symlink_metadata().is_err() {
                    return Ok(()); // Already removed
                }

                if target.is_symlink() {
                    std::fs::remove_file(&target)?;
                } else if target.is_dir() {
                    std::fs::remove_dir_all(&target)?;
                } else {
                    std::fs::remove_file(&target)?;
                }

                Ok(())
            }

            fn status(&self, skill_id: &str, instance: &PlatformInstance) -> Result<SkillPlatformStatus, AppError> {
                let target = Self::skill_target_path(skill_id, instance);

                if !target.exists() && target.symlink_metadata().is_err() {
                    return Ok(SkillPlatformStatus {
                        installed: false,
                        path: None,
                        version: None,
                        checksum: None,
                    });
                }

                let is_valid_symlink = target.is_symlink()
                    && target
                        .read_link()
                        .map(|link| link.exists())
                        .unwrap_or(false);

                Ok(SkillPlatformStatus {
                    installed: is_valid_symlink || (target.exists() && target.is_dir()),
                    path: Some(target.to_string_lossy().to_string()),
                    version: None,
                    checksum: None,
                })
            }

            fn default_paths(&self) -> PlatformPaths {
                PlatformPaths {
                    global_skills_dir: $global_skills_dir.to_string(),
                    project_skills_pattern: concat!("{project}/", $project_skills_pattern).to_string(),
                    global_rules_dir: $global_rules_dir.map(|s: &str| s.to_string()),
                    project_rules_pattern: Some($project_skills_pattern.replace("skills", "rules")),
                }
            }
        }
    };
}

// ── Platform adapter instances ──────────────────────────────────────

define_symlink_adapter!(ClaudeCodeAdapter, "claude-code", "Claude Code", "~/.claude/skills", ".claude/skills", Some("~/.claude/rules"));
define_symlink_adapter!(OpenCodeAdapter, "opencode", "OpenCode", "~/.config/opencode/skills", ".opencode/skills", Some("~/.config/opencode/rules"));
define_symlink_adapter!(CursorAdapter, "cursor", "Cursor", "~/.cursor/skills", ".cursor/skills", Some("~/.cursor/rules"));
define_symlink_adapter!(TraeAdapter, "trae", "Trae", "~/.trae/skills", ".trae/skills", None);
define_symlink_adapter!(TraeCnAdapter, "trae-cn", "Trae CN", "~/.trae-cn/skills", ".trae-cn/skills", None);
define_symlink_adapter!(CodebuddyAdapter, "codebuddy", "CodeBuddy", "~/.codebuddy/skills", ".codebuddy/skills", None);
define_symlink_adapter!(CodebuddyCnAdapter, "codebuddy-cn", "CodeBuddy CN", "~/.codebuddy-cn/skills", ".codebuddy-cn/skills", None);
define_symlink_adapter!(CodexAdapter, "codex", "Codex", "~/.codex/skills", ".codex/skills", None);
define_symlink_adapter!(HermesAdapter, "hermes", "Hermes Agent", "~/.hermes/skills", ".hermes/skills", None);
define_symlink_adapter!(OpenclawAdapter, "openclaw", "OpenClaw", "~/.openclaw/skills", ".openclaw/skills", None);
define_symlink_adapter!(AntigravityAdapter, "antigravity", "Antigravity", "~/.antigravity/skills", ".antigravity/skills", None);
define_symlink_adapter!(WindsurfAdapter, "windsurf", "Windsurf", "~/.windsurf/skills", ".windsurf/skills", None);

// ── Registry ────────────────────────────────────────────────────────

/// Registry that holds all registered platform plugins
pub struct PlatformRegistry {
    plugins: std::collections::HashMap<String, Box<dyn PlatformPlugin>>,
}

impl PlatformRegistry {
    pub fn new() -> Self {
        Self {
            plugins: std::collections::HashMap::new(),
        }
    }

    pub fn register(&mut self, plugin: Box<dyn PlatformPlugin>) {
        self.plugins
            .insert(plugin.platform_name().to_string(), plugin);
    }

    pub fn get(&self, name: &str) -> Option<&dyn PlatformPlugin> {
        self.plugins.get(name).map(|p| p.as_ref())
    }

    pub fn list_all(&self) -> Vec<&dyn PlatformPlugin> {
        self.plugins.values().map(|p| p.as_ref()).collect()
    }
}

impl Default for PlatformRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Create a platform plugin instance by name
pub fn create_platform_plugin(name: &str) -> Result<Box<dyn PlatformPlugin>, AppError> {
    match name {
        "claude-code" => Ok(Box::new(ClaudeCodeAdapter::new())),
        "opencode" => Ok(Box::new(OpenCodeAdapter::new())),
        "cursor" => Ok(Box::new(CursorAdapter::new())),
        "trae" => Ok(Box::new(TraeAdapter::new())),
        "trae-cn" => Ok(Box::new(TraeCnAdapter::new())),
        "codebuddy" => Ok(Box::new(CodebuddyAdapter::new())),
        "codebuddy-cn" => Ok(Box::new(CodebuddyCnAdapter::new())),
        "codex" => Ok(Box::new(CodexAdapter::new())),
        "hermes" => Ok(Box::new(HermesAdapter::new())),
        "openclaw" => Ok(Box::new(OpenclawAdapter::new())),
        "antigravity" => Ok(Box::new(AntigravityAdapter::new())),
        "windsurf" => Ok(Box::new(WindsurfAdapter::new())),
        _ => Err(AppError::Platform(format!(
            "未知的平台插件: {}",
            name
        ))),
    }
}

/// Create all built-in platform plugins
pub fn create_all_platform_plugins() -> PlatformRegistry {
    let mut registry = PlatformRegistry::new();
    registry.register(Box::new(ClaudeCodeAdapter::new()));
    registry.register(Box::new(OpenCodeAdapter::new()));
    registry.register(Box::new(CursorAdapter::new()));
    registry.register(Box::new(TraeAdapter::new()));
    registry.register(Box::new(TraeCnAdapter::new()));
    registry.register(Box::new(CodebuddyAdapter::new()));
    registry.register(Box::new(CodebuddyCnAdapter::new()));
    registry.register(Box::new(CodexAdapter::new()));
    registry.register(Box::new(HermesAdapter::new()));
    registry.register(Box::new(OpenclawAdapter::new()));
    registry.register(Box::new(AntigravityAdapter::new()));
    registry.register(Box::new(WindsurfAdapter::new()));
    registry
}

/// Create all built-in platform plugins as a Vec (convenience for command handlers)
pub fn create_all_platform_plugins_vec() -> Vec<Box<dyn PlatformPlugin>> {
    vec![
        Box::new(ClaudeCodeAdapter::new()),
        Box::new(OpenCodeAdapter::new()),
        Box::new(CursorAdapter::new()),
        Box::new(TraeAdapter::new()),
        Box::new(TraeCnAdapter::new()),
        Box::new(CodebuddyAdapter::new()),
        Box::new(CodebuddyCnAdapter::new()),
        Box::new(CodexAdapter::new()),
        Box::new(HermesAdapter::new()),
        Box::new(OpenclawAdapter::new()),
        Box::new(AntigravityAdapter::new()),
        Box::new(WindsurfAdapter::new()),
    ]
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Expand tilde (~) in paths to home directory
pub fn expand_home(path: &str) -> std::path::PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&path[2..]);
        }
    }
    std::path::PathBuf::from(path)
}

/// Recursively copy a directory (fallback for non-Unix systems or when symlink fails)
pub fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_code_default_paths() {
        let adapter = ClaudeCodeAdapter::new();
        let paths = adapter.default_paths();
        assert_eq!(paths.global_skills_dir, "~/.claude/skills");
        assert_eq!(paths.project_skills_pattern, "{project}/.claude/skills");
        assert_eq!(paths.global_rules_dir, Some("~/.claude/rules".to_string()));
        assert_eq!(paths.project_rules_pattern, Some(".claude/rules".to_string()));
    }

    #[test]
    fn test_opencode_default_paths() {
        let adapter = OpenCodeAdapter::new();
        let paths = adapter.default_paths();
        assert_eq!(paths.global_skills_dir, "~/.config/opencode/skills");
        assert_eq!(paths.project_skills_pattern, "{project}/.opencode/skills");
        assert_eq!(paths.global_rules_dir, Some("~/.config/opencode/rules".to_string()));
        assert_eq!(paths.project_rules_pattern, Some(".opencode/rules".to_string()));
    }

    #[test]
    fn test_cursor_default_paths() {
        let adapter = CursorAdapter::new();
        let paths = adapter.default_paths();
        assert_eq!(paths.global_skills_dir, "~/.cursor/skills");
        assert_eq!(paths.project_skills_pattern, "{project}/.cursor/skills");
        assert_eq!(paths.global_rules_dir, Some("~/.cursor/rules".to_string()));
        assert_eq!(paths.project_rules_pattern, Some(".cursor/rules".to_string()));
    }

    #[test]
    fn test_detect() {
        let adapter = ClaudeCodeAdapter::new();
        // Detection depends on local environment; just ensure no error
        let _ = adapter.detect();
    }
}
