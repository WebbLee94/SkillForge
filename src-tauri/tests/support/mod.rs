//! Test support: `TestPlatformPlugin` — minimal `PlatformPlugin` impl backed by
//! `tempfile::TempDir`. All paths are isolated; never touches HOME or real agent dirs.

use skillforge_lib::error::AppError;
use skillforge_lib::plugins::platform::PlatformPlugin;
use skillforge_lib::types::{
    PlatformCapabilities, PlatformInstance, PlatformPaths, RulesFormat, Skill, SkillPlatformStatus,
    SyncResult,
};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Minimal PlatformPlugin implementation backed by tempfile::TempDir.
///
/// - `detect()` returns a single global instance pointing to the temp dir.
/// - `install()` creates a symlink (unix) or recursive copy from skill source to the skills dir.
/// - `default_paths()` returns paths within the temp dir.
///
/// Supports both Directory and SingleFile rules depending on constructor.
pub struct TestPlatformPlugin {
    id: &'static str,
    name: &'static str,
    temp_dir: Mutex<tempfile::TempDir>,
    with_rules: bool,
    single_file: bool,
    project_single_file: bool,
    project_rules_pattern: Option<String>,
    file_name: String,
    detect_global: bool,
    tilde_global: bool,
    extra_global_instances: bool,
}

#[allow(dead_code)]
impl TestPlatformPlugin {
    pub fn new(id: &'static str, name: &'static str) -> Self {
        Self {
            id,
            name,
            temp_dir: Mutex::new(tempfile::tempdir().expect("tempdir creation")),
            with_rules: false,
            single_file: false,
            project_single_file: false,
            project_rules_pattern: None,
            file_name: String::new(),
            detect_global: true,
            tilde_global: false,
            extra_global_instances: false,
        }
    }

    pub fn with_rules(
        id: &'static str,
        name: &'static str,
        single_file: bool,
        file_name: &str,
    ) -> Self {
        Self {
            id,
            name,
            temp_dir: Mutex::new(tempfile::tempdir().expect("tempdir creation")),
            with_rules: true,
            single_file,
            project_single_file: false,
            project_rules_pattern: None,
            file_name: file_name.to_string(),
            detect_global: true,
            tilde_global: false,
            extra_global_instances: false,
        }
    }

    pub fn with_undetected_tilde_global(id: &'static str, name: &'static str) -> Self {
        let home = dirs::home_dir().expect("home directory");
        Self {
            id,
            name,
            temp_dir: Mutex::new(tempfile::tempdir_in(home).expect("home tempdir creation")),
            with_rules: false,
            single_file: false,
            project_single_file: false,
            project_rules_pattern: None,
            file_name: String::new(),
            detect_global: false,
            tilde_global: true,
            extra_global_instances: false,
        }
    }

    pub fn with_two_global_instances(id: &'static str, name: &'static str) -> Self {
        Self {
            id,
            name,
            temp_dir: Mutex::new(tempfile::tempdir().expect("tempdir creation")),
            with_rules: true,
            single_file: true,
            project_single_file: false,
            project_rules_pattern: None,
            file_name: "AGENTS.md".to_string(),
            detect_global: true,
            tilde_global: false,
            extra_global_instances: true,
        }
    }

    pub fn with_project_single_file_rules(id: &'static str, name: &'static str) -> Self {
        Self {
            id,
            name,
            temp_dir: Mutex::new(tempfile::tempdir().expect("tempdir creation")),
            with_rules: true,
            single_file: false,
            project_single_file: true,
            project_rules_pattern: None,
            file_name: "AGENTS.md".to_string(),
            detect_global: true,
            tilde_global: false,
            extra_global_instances: false,
        }
    }

    pub fn with_project_single_file_rules_pattern(
        id: &'static str,
        name: &'static str,
        pattern: &str,
    ) -> Self {
        let mut plugin = Self::with_project_single_file_rules(id, name);
        plugin.project_rules_pattern = Some(pattern.to_string());
        plugin
    }

    /// Path to the "skills" subdirectory within the temp dir.
    pub fn skills_dir(&self) -> PathBuf {
        self.temp_dir.lock().unwrap().path().join("skills")
    }

    /// Path to the "rules" subdirectory within the temp dir (Directory mode).
    pub fn rules_dir(&self) -> PathBuf {
        self.temp_dir.lock().unwrap().path().join("rules")
    }

    /// Path to the single rules file (SingleFile mode).
    pub fn rules_file(&self) -> PathBuf {
        self.temp_dir.lock().unwrap().path().join(&self.file_name)
    }

    /// Create a source directory with SKILL.md and return a Skill struct
    /// pointing to it. All paths live inside the TempDir.
    pub fn create_source_skill(&self, skill_id: &str, name: &str, content: &str) -> Skill {
        let dir = self
            .temp_dir
            .lock()
            .unwrap()
            .path()
            .join("sources")
            .join(skill_id);
        std::fs::create_dir_all(&dir).expect("create source dir");
        std::fs::write(dir.join("SKILL.md"), content).expect("write SKILL.md");
        Skill {
            id: skill_id.to_string(),
            name: name.to_string(),
            description: Some(name.to_string()),
            source_type: "test".to_string(),
            source_url: None,
            current_ver: Some("1.0.0".to_string()),
            installed_at: chrono::Utc::now().to_rfc3339(),
            local_path: dir.to_string_lossy().to_string(),
            metadata: None,
            tags: vec![],
        }
    }

    /// Path helper: return the project skills directory for a given project path.
    pub fn project_skills_dir(&self, project_path: &str) -> PathBuf {
        PathBuf::from(
            self.default_paths()
                .project_skills_pattern
                .replace("{project}", project_path),
        )
    }

    /// Path helper: return the project rules directory for a given project path.
    pub fn project_rules_dir(&self, project_path: &str) -> Option<PathBuf> {
        self.default_paths()
            .project_rules_pattern
            .as_ref()
            .map(|p| PathBuf::from(p.replace("{project}", project_path)))
    }

    pub fn project_rules_file(&self, project_path: &str) -> PathBuf {
        self.project_rules_dir(project_path)
            .expect("project rules path")
    }
}

impl PlatformPlugin for TestPlatformPlugin {
    fn platform_name(&self) -> &'static str {
        self.id
    }

    fn display_name(&self) -> &'static str {
        self.name
    }

    fn detect(&self) -> Result<Vec<PlatformInstance>, AppError> {
        if !self.detect_global {
            return Ok(vec![]);
        }
        let path = self
            .temp_dir
            .lock()
            .unwrap()
            .path()
            .join("skills")
            .to_string_lossy()
            .to_string();
        let mut instances = vec![PlatformInstance {
            platform_id: self.id.to_string(),
            platform_name: self.name.to_string(),
            path,
            scope: "global".to_string(),
        }];
        if self.extra_global_instances {
            let second_path = self.temp_dir.lock().unwrap().path().join("skills-second");
            instances.push(PlatformInstance {
                platform_id: self.id.to_string(),
                platform_name: self.name.to_string(),
                path: second_path.to_string_lossy().to_string(),
                scope: "global".to_string(),
            });
        }
        Ok(instances)
    }

    fn install(&self, skill: &Skill, _instance: &PlatformInstance) -> Result<(), AppError> {
        let target = self.skills_dir().join(&skill.id);
        let source = Path::new(&skill.local_path);
        if target.exists() {
            std::fs::remove_dir_all(&target)?;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(source, &target)?;
        #[cfg(not(unix))]
        crate::plugins::platform::copy_dir_recursive(source, &target)?;
        Ok(())
    }

    fn sync(&self, skill: &Skill, instance: &PlatformInstance) -> Result<SyncResult, AppError> {
        let target = self.skills_dir().join(&skill.id);
        let source = Path::new(&skill.local_path);
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            skipped: 0,
            errors: vec![],
        };
        if target.exists() || target.symlink_metadata().is_ok() {
            let current = target.read_link().ok();
            if current.as_deref() != Some(source) {
                self.install(skill, instance)?;
                result.updated.push(skill.id.clone());
            }
        } else {
            self.install(skill, instance)?;
            result.installed.push(skill.id.clone());
        }
        Ok(result)
    }

    fn remove(&self, skill_id: &str, _instance: &PlatformInstance) -> Result<(), AppError> {
        let target = self.skills_dir().join(skill_id);
        if target.exists() || target.symlink_metadata().is_ok() {
            if target.is_symlink() || target.is_file() {
                std::fs::remove_file(&target)?;
            } else {
                std::fs::remove_dir_all(&target)?;
            }
        }
        Ok(())
    }

    fn status(
        &self,
        skill_id: &str,
        _instance: &PlatformInstance,
    ) -> Result<SkillPlatformStatus, AppError> {
        let target = self.skills_dir().join(skill_id);
        Ok(SkillPlatformStatus {
            installed: target.exists() || target.symlink_metadata().is_ok(),
            path: Some(target.to_string_lossy().to_string()),
            version: None,
            checksum: None,
        })
    }

    fn default_paths(&self) -> PlatformPaths {
        let tmp = self.temp_dir.lock().unwrap().path().to_path_buf();
        let skills_path = tmp.join("skills");
        let skills = if self.tilde_global {
            let home = dirs::home_dir().expect("home directory");
            format!("~/{}", skills_path.strip_prefix(home).unwrap().display())
        } else {
            skills_path.to_string_lossy().to_string()
        };
        if self.with_rules {
            if self.single_file {
                let rf = tmp.join(&self.file_name);
                PlatformPaths {
                    global_skills_dir: skills,
                    project_skills_pattern: "{project}/.test/skills".to_string(),
                    global_rules_dir: Some(rf.to_string_lossy().to_string()),
                    project_rules_pattern: Some("{project}/.test/rules".to_string()),
                    global_rules_format: Some(RulesFormat::SingleFile {
                        file_name: self.file_name.clone(),
                    }),
                    project_rules_format: Some(RulesFormat::Directory),
                }
            } else {
                let rd = tmp.join("rules").to_string_lossy().to_string();
                PlatformPaths {
                    global_skills_dir: skills,
                    project_skills_pattern: "{project}/.test/skills".to_string(),
                    global_rules_dir: Some(rd),
                    project_rules_pattern: Some(if self.project_single_file {
                        self.project_rules_pattern
                            .clone()
                            .unwrap_or_else(|| "{project}/AGENTS.md".to_string())
                    } else {
                        "{project}/.test/rules".to_string()
                    }),
                    global_rules_format: None,
                    project_rules_format: self.project_single_file.then(|| {
                        RulesFormat::SingleFile {
                            file_name: self.file_name.clone(),
                        }
                    }),
                }
            }
        } else {
            PlatformPaths {
                global_skills_dir: skills,
                project_skills_pattern: "{project}/.test/skills".to_string(),
                global_rules_dir: None,
                project_rules_pattern: None,
                global_rules_format: None,
                project_rules_format: None,
            }
        }
    }

    fn capabilities(&self) -> PlatformCapabilities {
        let paths = self.default_paths();
        PlatformCapabilities {
            skills_global: true,
            skills_project: true,
            rules_global: paths.global_rules_dir.is_some(),
            rules_project: paths.project_rules_pattern.is_some(),
            rules_format_global: paths.global_rules_format,
            rules_format_project: paths.project_rules_format,
            limitation_notes: vec![],
        }
    }
}
