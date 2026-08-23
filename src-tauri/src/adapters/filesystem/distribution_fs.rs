//! [`DistributionFileSystem`] 的直通实现，委托到 engine 既有磁盘读取函数。

use crate::engine::{content_hash, dist_plan, rule_distribution};
use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::ports::filesystem::DistributionFileSystem;
use crate::types::{PlatformInstance, RulesFormat};

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

    fn deployed_skill_digest(
        &self,
        instance: &PlatformInstance,
        skill_id: &str,
    ) -> Option<String> {
        let dir = std::path::Path::new(&instance.path).join(skill_id);
        if !dir.exists() {
            return None;
        }
        content_hash::hash_directory(&dir).ok()
    }

    fn deployed_rule_digest(
        &self,
        plugin: &dyn PlatformPlugin,
        instance: &PlatformInstance,
        project_base: Option<&str>,
        rule_id: &str,
    ) -> Result<Option<String>, AppError> {
        let Some(path) = rule_distribution::resolve_rules_path(plugin, instance, project_base)?
        else {
            return Ok(None);
        };
        let rules_format = if instance.scope == "global" {
            plugin.default_paths().global_rules_format.clone()
        } else {
            plugin.default_paths().project_rules_format.clone()
        }
        .unwrap_or(RulesFormat::Directory);
        match rules_format {
            RulesFormat::Directory => Ok(find_directory_entry_by_stem(&path, rule_id)
                .and_then(|file| std::fs::read_to_string(file).ok())
                .map(|text| content_hash::rule_content_digest(&text))),
            RulesFormat::SingleFile { .. } => {
                rule_distribution::read_managed_rule_block_content(&path, rule_id)
                    .map(|block| block.map(|content| content_hash::rule_content_digest(&content)))
            }
        }
    }
}

fn find_directory_entry_by_stem(dir: &std::path::Path, stem: &str) -> Option<std::path::PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|entry| entry.file_type().ok().is_some_and(|t| t.is_file()))
        .find(|entry| {
            entry
                .path()
                .file_stem()
                .is_some_and(|entry_stem| entry_stem == stem)
        })
        .map(|entry| entry.path())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::content_hash;
    use crate::error::AppError;
    use crate::types::{
        PlatformCapabilities, PlatformPaths, RulesFormat, Skill, SkillPlatformStatus, SyncResult,
    };

    /// 最小 mock 平台插件：仅用于驱动 rules 路径解析。
    struct MockPlugin {
        global_rules_dir: Option<String>,
        single_file: bool,
    }

    impl MockPlugin {
        fn directory(global_rules_dir: Option<String>) -> Self {
            Self {
                global_rules_dir,
                single_file: false,
            }
        }
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
                global_rules_format: Some(if self.single_file {
                    RulesFormat::SingleFile {
                        file_name: "AGENTS.md".to_string(),
                    }
                } else {
                    RulesFormat::Directory
                }),
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

    fn mock_instance(base: &std::path::Path) -> PlatformInstance {
        PlatformInstance {
            platform_id: "mock".to_string(),
            platform_name: "Mock".to_string(),
            path: base.to_string_lossy().to_string(),
            scope: "global".to_string(),
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

        let plugin = MockPlugin::directory(Some(rules_dir.to_string_lossy().to_string()));
        let instance = mock_instance(tmp.path());

        let fs = EngineDistributionFileSystem;
        let ids = fs
            .read_current_rules_on_disk(&plugin, &instance, None)
            .unwrap();
        assert_eq!(ids, vec!["rule-one"]);
    }

    #[test]
    fn read_current_rules_missing_target_is_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let plugin = MockPlugin::directory(Some(
            tmp.path().join("nope").to_string_lossy().to_string(),
        ));
        let instance = mock_instance(tmp.path());

        let fs = EngineDistributionFileSystem;
        let ids = fs
            .read_current_rules_on_disk(&plugin, &instance, None)
            .unwrap();
        assert!(ids.is_empty());
    }

    #[test]
    fn deployed_skill_digest_matches_directory_hash_and_none_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("skill-a")).unwrap();
        std::fs::write(tmp.path().join("skill-a").join("SKILL.md"), "v1").unwrap();

        let instance = mock_instance(tmp.path());
        let fs = EngineDistributionFileSystem;

        assert_eq!(
            fs.deployed_skill_digest(&instance, "skill-a"),
            content_hash::hash_directory(&tmp.path().join("skill-a")).ok()
        );
        assert_eq!(fs.deployed_skill_digest(&instance, "ghost"), None);
    }

    #[test]
    fn deployed_rule_digest_normalizes_trailing_newline_in_directory_mode() {
        let tmp = tempfile::tempdir().unwrap();
        let rules_dir = tmp.path().join("rules");
        std::fs::create_dir_all(&rules_dir).unwrap();
        std::fs::write(rules_dir.join("r1.md"), "# R1\n").unwrap();

        let plugin = MockPlugin::directory(Some(rules_dir.to_string_lossy().to_string()));
        let instance = mock_instance(tmp.path());
        let fs = EngineDistributionFileSystem;

        assert_eq!(
            fs.deployed_rule_digest(&plugin, &instance, None, "r1").unwrap(),
            Some(content_hash::rule_content_digest("# R1"))
        );
        assert_eq!(
            fs.deployed_rule_digest(&plugin, &instance, None, "ghost")
                .unwrap(),
            None
        );
    }

    #[test]
    fn deployed_rule_digest_extracts_managed_block_in_single_file_mode() {
        let tmp = tempfile::tempdir().unwrap();
        let rules_file = tmp.path().join("AGENTS.md");
        std::fs::write(
            &rules_file,
            "# User\n<!-- SKILLFORGE:rule:r1 -->\n# R1\n<!-- /SKILLFORGE:rule:r1 -->\n",
        )
        .unwrap();

        let plugin = MockPlugin {
            global_rules_dir: Some(rules_file.to_string_lossy().to_string()),
            single_file: true,
        };
        let instance = mock_instance(tmp.path());
        let fs = EngineDistributionFileSystem;

        assert_eq!(
            fs.deployed_rule_digest(&plugin, &instance, None, "r1").unwrap(),
            Some(content_hash::rule_content_digest("# R1"))
        );
        assert_eq!(
            fs.deployed_rule_digest(&plugin, &instance, None, "ghost")
                .unwrap(),
            None
        );

        std::fs::remove_file(&rules_file).unwrap();
        assert_eq!(
            fs.deployed_rule_digest(&plugin, &instance, None, "r1").unwrap(),
            None,
            "单文件缺失时返回 Ok(None)"
        );
    }
}
