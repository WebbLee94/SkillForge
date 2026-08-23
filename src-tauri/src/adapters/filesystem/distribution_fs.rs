//! [`DistributionFileSystem`] 的直通实现，委托到 engine 既有磁盘读取函数。

use crate::engine::{dist_plan, rule_distribution};
use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::ports::filesystem::DistributionFileSystem;
use crate::types::PlatformInstance;

/// 无状态适配器：直接复用 engine 层的磁盘读取实现。
#[derive(Debug, Default, Clone, Copy)]
pub struct EngineDistributionFileSystem;

impl DistributionFileSystem for EngineDistributionFileSystem {
    fn read_current_skills_on_disk(&self, instance: &PlatformInstance) -> Vec<String> {
        dist_plan::read_current_skills_on_disk(instance)
    }

    fn read_current_rules_on_disk(
        &self,
        plugin: &dyn PlatformPlugin,
        instance: &PlatformInstance,
        project_base: Option<&str>,
    ) -> Result<Vec<String>, AppError> {
        rule_distribution::read_current_rules_on_disk(plugin, instance, project_base)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use crate::types::{
        PlatformCapabilities, PlatformPaths, Skill, SkillPlatformStatus, SyncResult,
    };

    /// 最小 mock 平台插件：仅用于驱动 rules 路径解析。
    struct MockPlugin {
        global_rules_dir: Option<String>,
    }

    impl PlatformPlugin for MockPlugin {
        fn platform_name(&self) -> &'static str {
            "mock"
        }
        fn display_name(&self) -> &'static str {
            "Mock"
        }
        fn detect(&self) -> Result<Vec<PlatformInstance>, AppError> {
            Ok(vec![])
        }
        fn install(&self, _: &Skill, _: &PlatformInstance) -> Result<(), AppError> {
            Ok(())
        }
        fn sync(&self, _: &Skill, _: &PlatformInstance) -> Result<SyncResult, AppError> {
            Ok(SyncResult {
                installed: vec![],
                updated: vec![],
                removed: vec![],
                skipped: 0,
                errors: vec![],
            })
        }
        fn remove(&self, _: &str, _: &PlatformInstance) -> Result<(), AppError> {
            Ok(())
        }
        fn status(&self, _: &str, _: &PlatformInstance) -> Result<SkillPlatformStatus, AppError> {
            Ok(SkillPlatformStatus {
                installed: false,
                path: None,
                version: None,
                checksum: None,
            })
        }
        fn default_paths(&self) -> PlatformPaths {
            PlatformPaths {
                global_skills_dir: String::new(),
                project_skills_pattern: String::new(),
                global_rules_dir: self.global_rules_dir.clone(),
                project_rules_pattern: None,
                global_rules_format: None,
                project_rules_format: None,
            }
        }
        fn capabilities(&self) -> PlatformCapabilities {
            PlatformCapabilities {
                skills_global: true,
                skills_project: false,
                rules_global: true,
                rules_project: false,
                rules_format_global: None,
                rules_format_project: None,
                limitation_notes: vec![],
            }
        }
    }

    #[test]
    fn read_current_skills_passthrough_lists_dirs_only() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("skill-a")).unwrap();
        std::fs::create_dir_all(tmp.path().join(".hidden")).unwrap();
        std::fs::write(tmp.path().join("loose-file.txt"), "x").unwrap();

        let instance = PlatformInstance {
            platform_id: "mock".to_string(),
            platform_name: "Mock".to_string(),
            path: tmp.path().to_string_lossy().to_string(),
            scope: "global".to_string(),
        };

        let fs = EngineDistributionFileSystem;
        assert_eq!(fs.read_current_skills_on_disk(&instance), vec!["skill-a"]);
    }

    #[test]
    fn read_current_rules_directory_mode_returns_stems() {
        let tmp = tempfile::tempdir().unwrap();
        let rules_dir = tmp.path().join("rules");
        std::fs::create_dir_all(&rules_dir).unwrap();
        std::fs::write(rules_dir.join("rule-one.md"), "# one").unwrap();
        std::fs::write(rules_dir.join(".dotfile.md"), "# hidden").unwrap();

        let plugin = MockPlugin {
            global_rules_dir: Some(rules_dir.to_string_lossy().to_string()),
        };
        let instance = PlatformInstance {
            platform_id: "mock".to_string(),
            platform_name: "Mock".to_string(),
            path: tmp.path().to_string_lossy().to_string(),
            scope: "global".to_string(),
        };

        let fs = EngineDistributionFileSystem;
        let ids = fs
            .read_current_rules_on_disk(&plugin, &instance, None)
            .unwrap();
        assert_eq!(ids, vec!["rule-one"]);
    }

    #[test]
    fn read_current_rules_missing_target_is_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let plugin = MockPlugin {
            global_rules_dir: Some(tmp.path().join("nope").to_string_lossy().to_string()),
        };
        let instance = PlatformInstance {
            platform_id: "mock".to_string(),
            platform_name: "Mock".to_string(),
            path: tmp.path().to_string_lossy().to_string(),
            scope: "global".to_string(),
        };

        let fs = EngineDistributionFileSystem;
        let ids = fs
            .read_current_rules_on_disk(&plugin, &instance, None)
            .unwrap();
        assert!(ids.is_empty());
    }
}
