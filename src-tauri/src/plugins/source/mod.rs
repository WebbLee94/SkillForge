pub mod local_fs;
pub mod git_repo;

use crate::error::AppError;
use crate::types::{SkillBundle, SkillMeta, ValidationResult, VersionInfo};

/// Trait for skill source plugins.
/// Each source type (local filesystem, git repo, etc.) implements this.
pub trait SourcePlugin: Send + Sync {
    /// Unique identifier for this source plugin
    fn name(&self) -> &'static str;

    /// Human-readable display name
    fn display_name(&self) -> &'static str;

    /// List all available skills from this source
    fn list_skills(&self) -> Result<Vec<SkillMeta>, AppError>;

    /// Fetch a complete skill bundle by ID
    fn fetch(&self, skill_id: &str, version: Option<&str>) -> Result<SkillBundle, AppError>;

    /// Get all available versions for a skill
    fn get_versions(&self, skill_id: &str) -> Result<Vec<VersionInfo>, AppError>;

    /// Validate a skill's integrity
    fn validate(&self, skill_id: &str) -> Result<ValidationResult, AppError>;
}

/// Registry that holds all registered source plugins
pub struct SourceRegistry {
    plugins: std::collections::HashMap<String, Box<dyn SourcePlugin>>,
}

impl SourceRegistry {
    pub fn new() -> Self {
        Self {
            plugins: std::collections::HashMap::new(),
        }
    }

    pub fn register(&mut self, plugin: Box<dyn SourcePlugin>) {
        self.plugins.insert(plugin.name().to_string(), plugin);
    }

    pub fn get(&self, name: &str) -> Option<&dyn SourcePlugin> {
        self.plugins.get(name).map(|p| p.as_ref())
    }

    pub fn list_all(&self) -> Vec<&dyn SourcePlugin> {
        self.plugins.values().map(|p| p.as_ref()).collect()
    }
}

impl Default for SourceRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Create a source plugin instance by name
pub fn create_source_plugin(name: &str) -> Result<Box<dyn SourcePlugin>, AppError> {
    match name {
        "local-fs" => Ok(Box::new(local_fs::LocalFsSource::new())),
        "git-repo" => Ok(Box::new(git_repo::GitRepoSource::new())),
        _ => Err(AppError::Source(format!("未知的来源插件: {}", name))),
    }
}

/// Create a source plugin instance by name, with an optional source_url override.
/// For local-fs, if source_url is a directory containing SKILL.md, use its parent as base_dir.
/// For local-fs, if source_url is a directory containing a skill subdirectory, use it as base_dir.
/// For git-repo, source_url is used as the repo URL.
pub fn create_source_plugin_with_url(
    name: &str,
    source_url: Option<&str>,
) -> Result<Box<dyn SourcePlugin>, AppError> {
    match name {
        "local-fs" => {
            if let Some(url) = source_url {
                let path = std::path::Path::new(url);
                // If the source_url points to a directory with SKILL.md inside, use its parent
                // If the source_url points to a directory that IS the skill dir, use it directly
                if path.join("SKILL.md").exists() {
                    // source_url is the skill directory itself, use its parent as base_dir
                    if let Some(parent) = path.parent() {
                        return Ok(Box::new(local_fs::LocalFsSource::with_dir(parent.to_path_buf())));
                    }
                }
                // Otherwise use the url as base_dir directly
                Ok(Box::new(local_fs::LocalFsSource::with_dir(path.to_path_buf())))
            } else {
                Ok(Box::new(local_fs::LocalFsSource::new()))
            }
        }
        "git-repo" => {
            if let Some(url) = source_url {
                Ok(Box::new(git_repo::GitRepoSource::with_url(url.to_string())))
            } else {
                Ok(Box::new(git_repo::GitRepoSource::new()))
            }
        }
        _ => Err(AppError::Source(format!("未知的来源插件: {}", name))),
    }
}
