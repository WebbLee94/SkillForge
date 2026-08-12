//! Distribution plan generation / preview — the read-only half of the
//! distribution engine (Phase 5 TASK-032).
//!
//! Owns:
//! - `build_distribution_plan` / `build_distribution_plan_for_request`
//!   (preview + `DistributionPlan` calculation)
//! - `calculate_distribution_plan` / `calculate_intent_diff` (pure diff)
//! - `read_current_skills_on_disk` (filesystem-as-truth reader)
//! - scene resolution helpers (`resolve_scene_skills` / `resolve_scene_rules`)
//! - shared read-only helpers reused by `dist_execute` / `dist_managed`
//!   (`get_skill`, `get_project_path`, instance resolution)
//!
//! Plan generation is strictly read-only: it must never create directories.

use crate::engine::rule_distribution;
use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::types::{
    DistributionIntent, DistributionIntentMode, DistributionPlan, DistributionRequest,
    PlatformDistributionPlan, PlatformInstance, Skill,
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
    request.validate()?;

    let (skills_to_add, skills_to_remove) = calculate_intent_diff(&request.skills, current_skills);
    let (rules_to_add, rules_to_remove) = calculate_intent_diff(&request.rules, current_rules);

    Ok(PlatformDistributionPlan {
        platform_id: platform_id.to_string(),
        platform_name: platform_name.to_string(),
        skills_to_add,
        skills_to_update: vec![],
        skills_to_remove,
        rules_to_add,
        rules_to_update: vec![],
        rules_to_remove,
    })
}

fn calculate_intent_diff(
    intent: &DistributionIntent,
    current: &[String],
) -> (Vec<String>, Vec<String>) {
    match intent.mode {
        DistributionIntentMode::Preserve => (vec![], vec![]),
        DistributionIntentMode::AddOrUpdate => (
            intent
                .ids
                .iter()
                .filter(|id| !current.contains(id))
                .cloned()
                .collect(),
            vec![],
        ),
        DistributionIntentMode::RemoveSelected => (
            vec![],
            intent
                .ids
                .iter()
                .filter(|id| current.contains(id))
                .cloned()
                .collect(),
        ),
    }
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
    let request = DistributionRequest {
        scene_id: _scene_id.map(str::to_string),
        platform_ids: platform_ids.to_vec(),
        scope: scope.to_string(),
        project_id: project_id.map(str::to_string),
        skills: legacy_distribution_intent(skill_ids),
        rules: legacy_distribution_intent(rule_ids),
    };
    build_distribution_plan_for_request(conn, platform_plugins, &request)
}

pub fn build_distribution_plan_for_request(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    request: &DistributionRequest,
) -> Result<DistributionPlan, AppError> {
    request.validate()?;

    // Resolve project path if project-scoped
    let project_path: Option<String> = if request.scope == "project" {
        Some(
            request
                .project_id
                .as_deref()
                .and_then(|pid| get_project_path(conn, pid))
                .ok_or_else(|| {
                    AppError::ProjectNotFound("项目范围计划需要提供项目ID".to_string())
                })?,
        )
    } else {
        None
    };
    let mut plan_platforms = Vec::new();
    for platform_id in &request.platform_ids {
        let plugin = platform_plugins
            .iter()
            .find(|p| p.platform_name() == *platform_id)
            .ok_or_else(|| AppError::Platform(format!("未找到平台插件: {}", platform_id)))?;
        let instances = match plugin.detect() {
            Ok(instances) => instances,
            Err(e) => {
                return Err(AppError::Platform(format!(
                    "检测平台 '{}' 失败: {}",
                    platform_id, e
                )));
            }
        };
        // Find matching instance for the requested scope
        let instance = if request.scope == "global" {
            instances
                .into_iter()
                .find(|i| i.scope == "global")
                .unwrap_or_else(|| PlatformInstance {
                    platform_id: platform_id.to_string(),
                    platform_name: platform_id.to_string(),
                    path: crate::plugins::platform::expand_home(
                        &plugin.default_paths().global_skills_dir,
                    )
                    .to_string_lossy()
                    .to_string(),
                    scope: "global".to_string(),
                })
        } else {
            let base_path = project_path
                .as_ref()
                .map(|p| {
                    let pattern = plugin.default_paths().project_skills_pattern.clone();
                    pattern.replace("{project}", p)
                })
                .unwrap_or_default();
            PlatformInstance {
                platform_id: platform_id.to_string(),
                platform_name: platform_id.to_string(),
                path: base_path,
                scope: "project".to_string(),
            }
        };
        // Read current state from disk (read-only — NO directory creation)
        let current_skills = read_current_skills_on_disk(&instance);
        let mut platform_request = request.clone();
        platform_request.platform_ids = vec![platform_id.to_string()];
        // Compute rule diff (if platform supports rules)
        let current_rules = rule_distribution::read_current_rules_on_disk(
            &**plugin,
            &instance,
            project_path.as_deref(),
        )?;
        let mut platform_plan = calculate_distribution_plan(
            platform_id,
            plugin.display_name(),
            &current_skills,
            &current_rules,
            &platform_request,
        )?;
        let rules_supported = if instance.scope == "global" {
            plugin.default_paths().global_rules_dir.is_some()
        } else {
            plugin.default_paths().project_rules_pattern.is_some()
        };
        if !rules_supported {
            platform_plan.rules_to_add.clear();
            platform_plan.rules_to_update.clear();
            platform_plan.rules_to_remove.clear();
        }
        let platform_name = plugin.display_name().to_string();
        platform_plan.platform_name = platform_name;
        plan_platforms.push(platform_plan);
    }
    let overall_has_removals = plan_platforms
        .iter()
        .any(|p| !p.skills_to_remove.is_empty() || !p.rules_to_remove.is_empty());
    Ok(DistributionPlan {
        platforms: plan_platforms,
        has_removals: overall_has_removals,
    })
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

fn legacy_distribution_intent(ids: &[String]) -> DistributionIntent {
    if ids.is_empty() {
        DistributionIntent {
            mode: DistributionIntentMode::Preserve,
            ids: vec![],
        }
    } else {
        DistributionIntent {
            mode: DistributionIntentMode::AddOrUpdate,
            ids: ids.to_vec(),
        }
    }
}

/// Resolve the set of skills that belong to a scene (or all skills when
/// `scene_id` is empty, matching the `__all_skills__` virtual scene).
pub fn resolve_scene_skills(
    conn: &rusqlite::Connection,
    scene_id: &str,
) -> Result<Vec<String>, AppError> {
    if scene_id.is_empty() {
        let mut stmt = conn.prepare("SELECT id FROM skills")?;
        let result: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(result)
    } else {
        let mut stmt =
            conn.prepare("SELECT skill_id FROM scene_skills WHERE scene_id = ?1 AND enabled = 1")?;
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
        let mut stmt = conn.prepare("SELECT id FROM rules")?;
        let result: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(result)
    } else {
        let mut stmt =
            conn.prepare("SELECT rule_id FROM scene_rules WHERE scene_id = ?1 AND enabled = 1")?;
        let result: Vec<String> = stmt
            .query_map(params![scene_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(result)
    }
}

// Public wrappers for preview_sync command
pub fn resolve_scene_skills_for_preview(
    conn: &rusqlite::Connection,
    scene_id: &str,
) -> Result<Vec<String>, crate::error::AppError> {
    resolve_scene_skills(conn, scene_id)
}

pub fn resolve_scene_rules_for_preview(
    conn: &rusqlite::Connection,
    scene_id: &str,
) -> Result<Vec<String>, crate::error::AppError> {
    resolve_scene_rules(conn, scene_id)
}

pub(crate) fn get_skill(conn: &rusqlite::Connection, skill_id: &str) -> Result<Skill, AppError> {
    conn.query_row(
        "SELECT id, name, description, source_type, source_url, current_ver, installed_at, local_path, metadata
         FROM skills WHERE id = ?1",
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
