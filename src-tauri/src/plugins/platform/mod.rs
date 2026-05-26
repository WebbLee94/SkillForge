pub mod claude_code;
pub mod open_code;
pub mod cursor;

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
        "claude-code" => Ok(Box::new(claude_code::ClaudeCodeAdapter::new())),
        "opencode" => Ok(Box::new(open_code::OpenCodeAdapter::new())),
        "cursor" => Ok(Box::new(cursor::CursorAdapter::new())),
        _ => Err(AppError::Platform(format!(
            "未知的平台插件: {}",
            name
        ))),
    }
}

/// Create all built-in platform plugins
pub fn create_all_platform_plugins() -> PlatformRegistry {
    let mut registry = PlatformRegistry::new();
    registry.register(Box::new(claude_code::ClaudeCodeAdapter::new()));
    registry.register(Box::new(open_code::OpenCodeAdapter::new()));
    registry.register(Box::new(cursor::CursorAdapter::new()));
    registry
}

/// Expand tilde (~) in paths to home directory
pub fn expand_home(path: &str) -> std::path::PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&path[2..]);
        }
    }
    std::path::PathBuf::from(path)
}
