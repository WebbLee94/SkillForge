//! Distribution plan generation / preview — the read-only half of the
//! distribution engine (Phase 5 TASK-032).
//!
//! Owns:
//! - `build_distribution_plan` / `build_distribution_plan_for_request`
//!   (preview + `DistributionPlan` calculation)
//! - `read_current_skills_on_disk` (filesystem-as-truth reader)
//! - scene resolution helpers (`resolve_scene_skills` / `resolve_scene_rules`)
//! - shared read-only helpers reused by `dist_execute` / `dist_managed`
//!   (`get_skill`, `get_project_path`, instance resolution)
//!
//! 纯 diff 计算与请求校验已迁移至 `domain::distribution::{plan, validation}`，
//! preview 只读编排已迁移至 `application::distribution::preview`；
//! 此处保留同名入口作为兼容 facade，并继续持有被
//! `dist_execute` / `dist_managed` 共用的只读 helper。
//!
//! Plan generation is strictly read-only: it must never create directories.

use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::types::{
    DistributionPlan, DistributionRequest, PlatformDistributionPlan, PlatformInstance, Skill,
};
use rusqlite::params;

/// Read currently deployed skill IDs from the filesystem (directory listing).
/// Does NOT create directories. Returns empty vec if target dir doesn't exist.
pub fn read_current_skills_on_disk(instance: &PlatformInstance) -> Vec<String> {
    let skills_dir = std::path::Path::new(&instance.path);
    if !skills_dir.exists() {
        return vec![];
    }
    let mut current = Vec::new();
    if let Ok(entries) = std::fs::read_dir(skills_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    if !name.starts_with('.') {
                        current.push(name.to_string());
                    }
                }
            }
        }
    }
    current
}

pub fn calculate_distribution_plan(
    platform_id: &str,
    platform_name: &str,
    current_skills: &[String],
    current_rules: &[String],
    request: &DistributionRequest,
) -> Result<PlatformDistributionPlan, AppError> {
    crate::domain::distribution::plan::calculate_distribution_plan(
        platform_id,
        platform_name,
        current_skills,
        current_rules,
        request,
    )
}

// ── Public plan API ─────────────────────────────────────────────────

/// Build a read-only distribution plan comparing desired vs current state.
///
/// - `skill_ids` / `rule_ids` are the explicit desired sets (scene_id is informational only)
/// - `scene_id` does NOT override explicit IDs
/// - Project scope resolves `project_id` from DB to filesystem path
/// - Missing target directories are treated as empty (no directories created)
/// - Returns classified add/update/remove per platform
#[allow(clippy::too_many_arguments)]
pub fn build_distribution_plan(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    skill_ids: &[String],
    rule_ids: &[String],
    _scene_id: Option<&str>,
    platform_ids: &[String],
    scope: &str,
    project_id: Option<&str>,
) -> Result<DistributionPlan, AppError> {
    let repo = crate::adapters::db::SqliteDistributionRepository::new(conn);
    let fs = crate::adapters::filesystem::EngineDistributionFileSystem;
    crate::application::distribution::preview::build_distribution_plan(
        &repo,
        &fs,
        platform_plugins,
        skill_ids,
        rule_ids,
        _scene_id,
        platform_ids,
        scope,
        project_id,
    )
}

pub fn build_distribution_plan_for_request(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    request: &DistributionRequest,
) -> Result<DistributionPlan, AppError> {
    let repo = crate::adapters::db::SqliteDistributionRepository::new(conn);
    let fs = crate::adapters::filesystem::EngineDistributionFileSystem;
    crate::application::distribution::preview::build_distribution_plan_for_request(
        &repo,
        &fs,
        platform_plugins,
        request,
    )
}

// ── Shared read-only helpers (also used by dist_execute / dist_managed) ──

/// Resolve a distribution instance for the given scope.
pub(crate) fn resolve_distribution_instance(
    plugin: &dyn PlatformPlugin,
    scope: &str,
    project_path: Option<&str>,
) -> PlatformInstance {
    if scope == "global" {
        resolve_global_distribution_instance(plugin)
    } else {
        let base_path = project_path
            .map(|path| {
                plugin
                    .default_paths()
                    .project_skills_pattern
                    .replace("{project}", path)
            })
            .unwrap_or_default();
        PlatformInstance {
            platform_id: plugin.platform_name().to_string(),
            platform_name: plugin.display_name().to_string(),
            path: base_path,
            scope: "project".to_string(),
        }
    }
}

pub(crate) fn resolve_global_distribution_instance(
    plugin: &dyn PlatformPlugin,
) -> PlatformInstance {
    PlatformInstance {
        platform_id: plugin.platform_name().to_string(),
        platform_name: plugin.display_name().to_string(),
        path: crate::plugins::platform::expand_home(&plugin.default_paths().global_skills_dir)
            .to_string_lossy()
            .to_string(),
        scope: "global".to_string(),
    }
}

/// Resolve the set of skills that belong to a scene (or all skills when
/// `scene_id` is empty, matching the `__all_skills__` virtual scene).
pub fn resolve_scene_skills(
    conn: &rusqlite::Connection,
    scene_id: &str,
) -> Result<Vec<String>, AppError> {
    if scene_id.is_empty() {
        let mut stmt = conn.prepare("SELECT id FROM resources WHERE kind = 'skill' ORDER BY id")?;
        let result: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(result)
    } else {
        let mut stmt = conn.prepare(
            "SELECT si.resource_id FROM scene_items si \
             JOIN resources r ON si.resource_id = r.id \
             WHERE si.scene_id = ?1 AND si.enabled = 1 AND r.kind = 'skill'",
        )?;
        let result: Vec<String> = stmt
            .query_map(params![scene_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(result)
    }
}

/// Resolve the set of rules that belong to a scene (or all rules when
/// `scene_id` is empty).
pub fn resolve_scene_rules(
    conn: &rusqlite::Connection,
    scene_id: &str,
) -> Result<Vec<String>, AppError> {
    if scene_id.is_empty() {
        let mut stmt = conn.prepare("SELECT id FROM resources WHERE kind = 'rule' ORDER BY id")?;
        let result: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(result)
    } else {
        let mut stmt = conn.prepare(
            "SELECT si.resource_id FROM scene_items si \
             JOIN resources r ON si.resource_id = r.id \
             WHERE si.scene_id = ?1 AND si.enabled = 1 AND r.kind = 'rule'",
        )?;
        let result: Vec<String> = stmt
            .query_map(params![scene_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(result)
    }
}

pub(crate) fn get_skill(conn: &rusqlite::Connection, skill_id: &str) -> Result<Skill, AppError> {
    conn.query_row(
        "SELECT id, name, description, source_type, source_url, current_ver, installed_at, local_path, metadata
         FROM resources WHERE id = ?1 AND kind = 'skill'",
        params![skill_id],
        |row| {
            Ok(Skill {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                source_type: row.get(3)?,
                source_url: row.get(4)?,
                current_ver: row.get(5)?,
                installed_at: row.get(6)?,
                local_path: row.get(7)?,
                metadata: row.get(8)?,
                tags: vec![],
            })
        },
    )
    .map_err(|_| AppError::SkillNotFound(skill_id.to_string()))
}

pub(crate) fn get_project_path(conn: &rusqlite::Connection, project_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT path FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::plugins::platform::PlatformPlugin;
    use crate::types::{
        DistributionIntent, DistributionIntentMode, PlatformCapabilities, PlatformPaths, SyncResult,
    };

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        schema::create_tables(&conn).unwrap();
        conn
    }

    fn insert_skill(conn: &rusqlite::Connection, id: &str, local_path: &str) {
        crate::db::resources_repo::insert_skill_row(
            conn,
            id,
            id,
            None,
            "local",
            None,
            Some("1.0.0"),
            &chrono::Utc::now().to_rfc3339(),
            local_path,
            None,
        )
        .unwrap();
    }

    fn insert_project(conn: &rusqlite::Connection, id: &str, path: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?1, ?1, ?2, NULL, ?3, ?3)",
            params![id, path, now],
        )
        .unwrap();
    }

    fn preview_plugin(project_skills_pattern: &str) -> Box<dyn PlatformPlugin> {
        struct P {
            pattern: String,
        }
        impl PlatformPlugin for P {
            fn platform_name(&self) -> &'static str {
                "test"
            }
            fn display_name(&self) -> &'static str {
                "Test"
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
            fn status(
                &self,
                _: &str,
                _: &PlatformInstance,
            ) -> Result<crate::types::SkillPlatformStatus, AppError> {
                Ok(crate::types::SkillPlatformStatus {
                    installed: false,
                    path: None,
                    version: None,
                    checksum: None,
                })
            }
            fn default_paths(&self) -> PlatformPaths {
                PlatformPaths {
                    global_skills_dir: String::new(),
                    project_skills_pattern: self.pattern.clone(),
                    global_rules_dir: None,
                    project_rules_pattern: None,
                    global_rules_format: None,
                    project_rules_format: None,
                }
            }
            fn capabilities(&self) -> PlatformCapabilities {
                PlatformCapabilities {
                    skills_global: true,
                    skills_project: true,
                    rules_global: false,
                    rules_project: false,
                    rules_format_global: None,
                    rules_format_project: None,
                    limitation_notes: vec![],
                }
            }
        }
        Box::new(P {
            pattern: project_skills_pattern.to_string(),
        })
    }

    #[test]
    fn preview_rejects_scope_and_project_id_mismatch() {
        let conn = setup_db();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![preview_plugin("{project}/skills")];

        let mut request = DistributionRequest {
            scene_id: None,
            platform_ids: vec!["test".to_string()],
            scope: "project".to_string(),
            project_id: None,
            skills: DistributionIntent {
                mode: DistributionIntentMode::AddOrUpdate,
                ids: vec!["skill-1".to_string()],
            },
            rules: DistributionIntent {
                mode: DistributionIntentMode::Preserve,
                ids: vec![],
            },
        };
        let err = build_distribution_plan_for_request(&conn, &plugins, &request).unwrap_err();
        assert!(
            err.to_string().contains("project 范围必须提供 project_id"),
            "got: {err}"
        );

        request.scope = "global".to_string();
        request.project_id = Some("p1".to_string());
        let err = build_distribution_plan_for_request(&conn, &plugins, &request).unwrap_err();
        assert!(
            err.to_string().contains("global 范围不能携带 project_id"),
            "got: {err}"
        );
    }

    #[test]
    fn preview_project_scope_requires_resolvable_project_path() {
        let conn = setup_db();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![preview_plugin("{project}/skills")];
        let request = DistributionRequest {
            scene_id: None,
            platform_ids: vec!["test".to_string()],
            scope: "project".to_string(),
            project_id: Some("ghost-project".to_string()),
            skills: DistributionIntent {
                mode: DistributionIntentMode::AddOrUpdate,
                ids: vec!["skill-1".to_string()],
            },
            rules: DistributionIntent {
                mode: DistributionIntentMode::Preserve,
                ids: vec![],
            },
        };

        let err = build_distribution_plan_for_request(&conn, &plugins, &request).unwrap_err();
        match err {
            AppError::ProjectNotFound(msg) => assert!(msg.contains("项目ID"), "got: {msg}"),
            other => panic!("expected ProjectNotFound, got: {other:?}"),
        }
    }

    #[test]
    fn preview_is_read_only_and_resolves_project_scoped_path() {
        let conn = setup_db();
        let base = tempfile::tempdir().unwrap();
        let project_root = base.path().join("myproj");
        let project_path = project_root.to_string_lossy().to_string();
        insert_project(&conn, "p1", &project_path);
        insert_skill(&conn, "skill-1", "/tmp/sources/skill-1");
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![preview_plugin("{project}/skills")];
        let request = DistributionRequest {
            scene_id: None,
            platform_ids: vec!["test".to_string()],
            scope: "project".to_string(),
            project_id: Some("p1".to_string()),
            skills: DistributionIntent {
                mode: DistributionIntentMode::AddOrUpdate,
                ids: vec!["skill-1".to_string()],
            },
            rules: DistributionIntent {
                mode: DistributionIntentMode::Preserve,
                ids: vec![],
            },
        };

        let plan = build_distribution_plan_for_request(&conn, &plugins, &request).unwrap();

        assert_eq!(plan.platforms.len(), 1);
        assert_eq!(plan.platforms[0].platform_id, "test");
        assert_eq!(plan.platforms[0].skills_to_add, vec!["skill-1".to_string()]);
        assert!(plan.platforms[0].skills_to_remove.is_empty());
        assert!(!plan.has_removals);
        assert!(
            !project_root.join("skills").exists(),
            "preview must not create target directories"
        );
    }

    #[test]
    fn calculate_distribution_plan_locks_intent_diff_semantics() {
        let make_request = |mode, skill_ids: &[&str]| DistributionRequest {
            scene_id: None,
            platform_ids: vec!["test".to_string()],
            scope: "global".to_string(),
            project_id: None,
            skills: DistributionIntent {
                mode,
                ids: skill_ids.iter().map(|id| id.to_string()).collect(),
            },
            rules: DistributionIntent {
                mode: DistributionIntentMode::Preserve,
                ids: vec![],
            },
        };
        let current = vec!["b".to_string()];

        let err = calculate_distribution_plan(
            "test",
            "Test",
            &current,
            &[],
            &make_request(DistributionIntentMode::Preserve, &["a"]),
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("preserve 时不能携带 IDs"),
            "Preserve + 非空 IDs 必须被拒绝: {err}"
        );

        let preserve = calculate_distribution_plan(
            "test",
            "Test",
            &current,
            &[],
            &make_request(DistributionIntentMode::Preserve, &[]),
        )
        .unwrap();
        assert!(preserve.skills_to_add.is_empty() && preserve.skills_to_remove.is_empty());

        let add_or_update = calculate_distribution_plan(
            "test",
            "Test",
            &current,
            &[],
            &make_request(DistributionIntentMode::AddOrUpdate, &["a", "b"]),
        )
        .unwrap();
        assert_eq!(add_or_update.skills_to_add, vec!["a".to_string()]);
        assert!(add_or_update.skills_to_remove.is_empty());

        let remove_selected = calculate_distribution_plan(
            "test",
            "Test",
            &current,
            &[],
            &make_request(DistributionIntentMode::RemoveSelected, &["a", "b", "ghost"]),
        )
        .unwrap();
        assert!(remove_selected.skills_to_add.is_empty());
        assert_eq!(remove_selected.skills_to_remove, vec!["b".to_string()]);
    }
}
