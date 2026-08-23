//! Distribution use cases.
//!
//! - [`preview`] — read-only planning (`DistributionPlan` generation)
//! - [`managed`] — managed vs local entry classification + filesystem-derived
//!   sync status
//! - [`remove`] — fail-closed RemoveSelected ownership validation
//! - [`execute`] — side-effecting execution flows (`sync_scene`,
//!   `execute_distribution_request`, `execute_remove_distributed`)
//!
//! `engine/dist_*` modules remain their compatibility facades.

pub mod execute;
pub mod managed;
pub mod preview;
pub mod remove;

pub use preview::{build_distribution_plan, build_distribution_plan_for_request};

#[cfg(test)]
pub(crate) mod test_fakes {
    //! 端口 fake：让用例测试可在无 DB / 无真实磁盘的条件下运行。

    use crate::error::AppError;
    use crate::plugins::platform::PlatformPlugin;
    use crate::ports::distribution::DistributionRepository;
    use crate::ports::filesystem::DistributionFileSystem;
    use crate::types::{PlatformInstance, Rule, Skill};

    #[derive(Debug, Default)]
    pub struct FakeDistributionRepository {
        skills: std::collections::HashMap<String, Skill>,
        rules: std::collections::HashMap<String, Rule>,
        project_paths: std::collections::HashMap<String, String>,
    }

    impl FakeDistributionRepository {
        pub fn insert_project_path(&mut self, id: &str, path: &str) {
            self.project_paths.insert(id.to_string(), path.to_string());
        }

        pub fn insert_rule(&mut self, id: &str, format: &str, content: &str) {
            self.rules.insert(
                id.to_string(),
                Rule {
                    id: id.to_string(),
                    name: id.to_string(),
                    description: None,
                    format: format.to_string(),
                    content: content.to_string(),
                    platform: None,
                    scope: None,
                    version: 1,
                    updated_at: String::new(),
                    tags: vec![],
                },
            );
        }
    }

    impl DistributionRepository for FakeDistributionRepository {
        fn get_skill(&self, skill_id: &str) -> Result<Skill, AppError> {
            self.skills
                .get(skill_id)
                .cloned()
                .ok_or_else(|| AppError::SkillNotFound(skill_id.to_string()))
        }

        fn get_rule(&self, rule_id: &str) -> Result<Rule, AppError> {
            self.rules
                .get(rule_id)
                .cloned()
                .ok_or_else(|| AppError::RuleNotFound(rule_id.to_string()))
        }

        fn get_project_path(&self, project_id: &str) -> Option<String> {
            self.project_paths.get(project_id).cloned()
        }
    }

    #[derive(Debug, Default)]
    pub struct FakeDistributionFileSystem {
        skills_by_path: std::collections::HashMap<String, Vec<String>>,
        rules_by_resolved_target: std::collections::HashMap<String, Vec<String>>,
        skill_digests: std::collections::HashMap<(String, String), String>,
        rule_digests: std::collections::HashMap<(String, String), String>,
    }

    impl FakeDistributionFileSystem {
        pub fn with_skills_at(mut self, path: &str, ids: &[&str]) -> Self {
            self.skills_by_path.insert(
                path.to_string(),
                ids.iter().map(|s| s.to_string()).collect(),
            );
            self
        }

        pub fn with_rules_at(mut self, resolved_target: &str, ids: &[&str]) -> Self {
            self.rules_by_resolved_target.insert(
                resolved_target.to_string(),
                ids.iter().map(|s| s.to_string()).collect(),
            );
            self
        }

        pub fn with_skill_digest_at(mut self, path: &str, skill_id: &str, digest: &str) -> Self {
            self.skill_digests
                .insert((path.to_string(), skill_id.to_string()), digest.to_string());
            self
        }

        pub fn with_rule_digest_at(
            mut self,
            resolved_target: &str,
            rule_id: &str,
            digest: &str,
        ) -> Self {
            self.rule_digests.insert(
                (resolved_target.to_string(), rule_id.to_string()),
                digest.to_string(),
            );
            self
        }
    }

    impl DistributionFileSystem for FakeDistributionFileSystem {
        fn read_current_skills_on_disk(&self, instance: &PlatformInstance) -> Vec<String> {
            self.skills_by_path
                .get(&instance.path)
                .cloned()
                .unwrap_or_default()
        }

        fn read_current_rules_on_disk(
            &self,
            plugin: &dyn PlatformPlugin,
            instance: &PlatformInstance,
            project_base: Option<&str>,
        ) -> Result<Vec<String>, AppError> {
            let key = self.resolved_rules_key(plugin, instance, project_base);
            Ok(self
                .rules_by_resolved_target
                .get(&key)
                .cloned()
                .unwrap_or_default())
        }

        fn deployed_skill_digest(
            &self,
            instance: &PlatformInstance,
            skill_id: &str,
        ) -> Option<String> {
            self.skill_digests
                .get(&(instance.path.clone(), skill_id.to_string()))
                .cloned()
        }

        fn deployed_rule_digest(
            &self,
            plugin: &dyn PlatformPlugin,
            instance: &PlatformInstance,
            project_base: Option<&str>,
            rule_id: &str,
        ) -> Result<Option<String>, AppError> {
            let key = self.resolved_rules_key(plugin, instance, project_base);
            Ok(self
                .rule_digests
                .get(&(key, rule_id.to_string()))
                .cloned())
        }
    }

    impl FakeDistributionFileSystem {
        fn resolved_rules_key(
            &self,
            plugin: &dyn PlatformPlugin,
            instance: &PlatformInstance,
            project_base: Option<&str>,
        ) -> String {
            let paths = plugin.default_paths();
            if instance.scope == "global" {
                paths.global_rules_dir.unwrap_or_default()
            } else {
                paths
                    .project_rules_pattern
                    .map(|pattern| pattern.replace("{project}", project_base.unwrap_or("")))
                    .unwrap_or_default()
            }
        }
    }
}
