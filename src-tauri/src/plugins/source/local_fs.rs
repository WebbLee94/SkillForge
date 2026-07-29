use crate::engine::parser;
use crate::error::AppError;
use crate::types::{SkillBundle, SkillMeta, ValidationResult, VersionInfo};

use super::SourcePlugin;

/// Local filesystem source plugin.
/// Scans a local directory for skill subdirectories containing SKILL.md files.
pub struct LocalFsSource {
    base_dir: std::path::PathBuf,
}

impl LocalFsSource {
    pub fn new() -> Self {
        let base_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".skillforge")
            .join("sources")
            .join("local");
        Self { base_dir }
    }

    pub fn with_dir(base_dir: std::path::PathBuf) -> Self {
        Self { base_dir }
    }
}

impl Default for LocalFsSource {
    fn default() -> Self {
        Self::new()
    }
}

impl SourcePlugin for LocalFsSource {
    fn name(&self) -> &'static str {
        "local-fs"
    }

    fn display_name(&self) -> &'static str {
        "Local Filesystem"
    }

    fn list_skills(&self) -> Result<Vec<SkillMeta>, AppError> {
        let mut skills = Vec::new();

        if !self.base_dir.exists() {
            return Ok(skills);
        }

        let entries = std::fs::read_dir(&self.base_dir)
            .map_err(|e| AppError::Source(format!("读取来源目录失败: {}", e)))?;

        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }

            let skill_md_path = entry.path().join("SKILL.md");
            if !skill_md_path.exists() {
                continue;
            }

            let content = std::fs::read_to_string(&skill_md_path).map_err(|e| {
                AppError::Source(format!(
                    "读取 {} 中的 SKILL.md 失败: {}",
                    entry.path().display(),
                    e
                ))
            })?;

            match parser::parse_skill_md(&content) {
                Ok(bundle) => {
                    let mut meta = bundle.meta;
                    meta.source_type = "local-fs".to_string();
                    meta.source_url = Some(entry.path().to_string_lossy().to_string());
                    skills.push(meta);
                }
                Err(_) => {
                    // error handled silently
                }
            }
        }

        Ok(skills)
    }

    fn fetch(&self, skill_id: &str, _version: Option<&str>) -> Result<SkillBundle, AppError> {
        let skill_dir = self.base_dir.join(skill_id);
        if !skill_dir.exists() {
            return Err(AppError::SkillNotFound(format!(
                "技能目录未找到: {}",
                skill_dir.display()
            )));
        }

        let skill_md_path = skill_dir.join("SKILL.md");
        let content = std::fs::read_to_string(&skill_md_path)
            .map_err(|e| AppError::Source(format!("读取 SKILL.md 失败: {}", e)))?;

        let mut bundle = parser::parse_skill_md(&content)?;
        bundle.meta.source_type = "local-fs".to_string();
        bundle.meta.source_url = Some(skill_dir.to_string_lossy().to_string());

        // Dynamically detect all subdirectories (excluding hidden dirs)
        if let Ok(entries) = std::fs::read_dir(&skill_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !name.starts_with('.') && !bundle.subdirs.contains(&name) {
                        bundle.subdirs.push(name);
                    }
                }
            }
        }

        Ok(bundle)
    }

    fn get_versions(&self, skill_id: &str) -> Result<Vec<VersionInfo>, AppError> {
        // Local FS doesn't have version history; return current version
        let skill_dir = self.base_dir.join(skill_id);
        if !skill_dir.exists() {
            return Err(AppError::SkillNotFound(skill_id.to_string()));
        }

        let skill_md_path = skill_dir.join("SKILL.md");
        let content = std::fs::read_to_string(&skill_md_path)?;
        let bundle = parser::parse_skill_md(&content)?;

        Ok(vec![VersionInfo {
            version: bundle.meta.version.unwrap_or_else(|| "latest".to_string()),
            source_ref: Some(skill_dir.to_string_lossy().to_string()),
            checksum: None,
            fetched_at: chrono::Utc::now().to_rfc3339(),
        }])
    }

    fn validate(&self, skill_id: &str) -> Result<ValidationResult, AppError> {
        let skill_dir = self.base_dir.join(skill_id);
        if !skill_dir.exists() {
            return Ok(ValidationResult {
                valid: false,
                errors: vec![format!("技能目录未找到: {}", skill_id)],
            });
        }

        let skill_md_path = skill_dir.join("SKILL.md");
        if !skill_md_path.exists() {
            return Ok(ValidationResult {
                valid: false,
                errors: vec![format!("{} 中未找到 SKILL.md", skill_id)],
            });
        }

        let content = std::fs::read_to_string(&skill_md_path)?;
        match parser::parse_skill_md(&content) {
            Ok(_) => Ok(ValidationResult {
                valid: true,
                errors: vec![],
            }),
            Err(e) => Ok(ValidationResult {
                valid: false,
                errors: vec![e.to_string()],
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_list_skills_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let source = LocalFsSource::with_dir(tmp.path().to_path_buf());
        let skills = source.list_skills().unwrap();
        assert!(skills.is_empty());
    }

    #[test]
    fn test_list_skills_with_valid_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = tmp.path().join("test-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: test-skill\ndescription: A test skill\n---\n\n# Test Skill\n",
        )
        .unwrap();

        let source = LocalFsSource::with_dir(tmp.path().to_path_buf());
        let skills = source.list_skills().unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "test-skill");
    }

    #[test]
    fn test_validate_missing_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let source = LocalFsSource::with_dir(tmp.path().to_path_buf());
        let result = source.validate("nonexistent").unwrap();
        assert!(!result.valid);
    }
}
