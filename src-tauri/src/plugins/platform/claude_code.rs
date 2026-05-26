use crate::error::AppError;
use crate::types::{PlatformInstance, PlatformPaths, Skill, SkillPlatformStatus, SyncResult};

use super::{expand_home, PlatformPlugin};

/// Claude Code platform adapter.
/// Manages skills via symlinks in ~/.claude/skills/ (global) and .claude/skills/ (project).
pub struct ClaudeCodeAdapter;

impl ClaudeCodeAdapter {
    pub fn new() -> Self {
        Self
    }

    fn global_skills_dir() -> std::path::PathBuf {
        expand_home("~/.claude/skills")
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

impl Default for ClaudeCodeAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl PlatformPlugin for ClaudeCodeAdapter {
    fn platform_name(&self) -> &'static str {
        "claude-code"
    }

    fn display_name(&self) -> &'static str {
        "Claude Code"
    }

    fn detect(&self) -> Result<Vec<PlatformInstance>, AppError> {
        let mut instances = Vec::new();

        // Check global installation
        let global_dir = Self::global_skills_dir();
        if global_dir.exists() || expand_home("~/.claude").exists() {
            instances.push(PlatformInstance {
                platform_id: "claude-code".to_string(),
                platform_name: "Claude Code".to_string(),
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
            // Fallback: copy directory on non-Unix systems
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
            global_skills_dir: "~/.claude/skills".to_string(),
            project_skills_pattern: "{project}/.claude/skills".to_string(),
            global_rules_dir: Some("~/.claude/rules".to_string()),
            project_rules_pattern: Some(".claude/rules".to_string()),
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_paths() {
        let adapter = ClaudeCodeAdapter::new();
        let paths = adapter.default_paths();
        assert_eq!(paths.global_skills_dir, "~/.claude/skills");
        assert_eq!(paths.global_rules_dir, Some("~/.claude/rules".to_string()));
    }

    #[test]
    fn test_detect() {
        let adapter = ClaudeCodeAdapter::new();
        // Detection depends on local environment; just ensure no error
        let _ = adapter.detect();
    }
}
