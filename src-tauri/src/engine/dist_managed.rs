//! Managed distribution state — ownership checks and RemoveSelected
//! validations (Phase 5 TASK-034).
//!
//! Owns:
//! - `get_managed_distribution_state` (managed vs local entries)
//! - ownership checks (`read_managed_skills`: only symlinks whose target
//!   equals the SkillForge source are "managed")
//! - `validate_removal_targets` (RemoveSelected validation, reused by
//!   `dist_execute` before any mutation)
//! - filesystem-derived sync status (`get_sync_status` +
//!   `count_fs_subdirs` / `count_fs_files`)

use crate::engine::dist_plan::{
    get_project_path, get_skill, read_current_skills_on_disk, resolve_distribution_instance,
};
use crate::engine::rule_distribution;
use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::types::{
    LocalDistributionEntry, ManagedDistributionEntry, ManagedDistributionState,
    ManagedPlatformState, PlatformInstance, PlatformSyncStatus, RulesFormat, SyncStatusDTO,
};

pub fn get_managed_distribution_state(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    platform_ids: &[String],
    scope: &str,
    project_id: Option<&str>,
) -> Result<ManagedDistributionState, AppError> {
    let validation_request = crate::types::DistributionRequest {
        scene_id: None,
        platform_ids: platform_ids.to_vec(),
        scope: scope.to_string(),
        project_id: project_id.map(str::to_string),
        skills: crate::types::DistributionIntent {
            mode: crate::types::DistributionIntentMode::Preserve,
            ids: vec![],
        },
        rules: crate::types::DistributionIntent {
            mode: crate::types::DistributionIntentMode::Preserve,
            ids: vec![],
        },
    };
    validation_request.validate()?;
    let project_path = project_id.and_then(|id| get_project_path(conn, id));
    if scope == "project" && project_path.is_none() {
        return Err(AppError::ProjectNotFound(
            "项目范围查询需要提供项目ID".to_string(),
        ));
    }
    let mut platforms = Vec::new();
    for platform_id in platform_ids {
        let plugin = platform_plugins
            .iter()
            .find(|plugin| plugin.platform_name() == platform_id)
            .ok_or_else(|| AppError::Platform(format!("未找到平台插件: {}", platform_id)))?;
        let instance =
            resolve_distribution_instance(plugin.as_ref(), scope, project_path.as_deref());
        let skills = read_managed_skills(&instance, conn)?;
        let rules = rule_distribution::read_managed_rules(
            conn,
            plugin.as_ref(),
            &instance,
            project_path.as_deref(),
        )?;
        let local_skills = read_local_skills(&instance, &skills)?;
        let local_rules =
            read_local_rules(plugin.as_ref(), &instance, project_path.as_deref(), &rules)?;
        platforms.push(ManagedPlatformState {
            platform_id: platform_id.clone(),
            platform_name: plugin.display_name().to_string(),
            scope: scope.to_string(),
            project_path: project_path.clone(),
            skills,
            rules,
            local_skills,
            local_rules,
        });
    }
    Ok(ManagedDistributionState { platforms })
}

/// Read the set of SkillForge-managed skills on disk: only entries whose
/// symlink target equals the skill's source `local_path` are owned.
fn read_managed_skills(
    instance: &PlatformInstance,
    conn: &rusqlite::Connection,
) -> Result<Vec<ManagedDistributionEntry>, AppError> {
    let mut entries = Vec::new();
    for id in read_current_skills_on_disk(instance) {
        let skill = match get_skill(conn, &id) {
            Ok(skill) => skill,
            Err(_) => continue,
        };
        let path = std::path::Path::new(&instance.path).join(&id);
        if path.read_link().ok() == Some(std::path::PathBuf::from(skill.local_path)) {
            entries.push(ManagedDistributionEntry {
                id,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    Ok(entries)
}

fn read_local_skills(
    instance: &PlatformInstance,
    managed_entries: &[ManagedDistributionEntry],
) -> Result<Vec<LocalDistributionEntry>, AppError> {
    let managed_paths: std::collections::HashSet<&str> = managed_entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();
    read_local_directory_entries(std::path::Path::new(&instance.path), &managed_paths, false)
}

fn read_local_rules(
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    project_path: Option<&str>,
    managed_entries: &[ManagedDistributionEntry],
) -> Result<Vec<LocalDistributionEntry>, AppError> {
    let Some(path) = rule_distribution::resolve_rules_path(plugin, instance, project_path)? else {
        return Ok(vec![]);
    };
    let format = if instance.scope == "global" {
        plugin.default_paths().global_rules_format.clone()
    } else {
        plugin.default_paths().project_rules_format.clone()
    }
    .unwrap_or(RulesFormat::Directory);
    if matches!(format, RulesFormat::SingleFile { .. }) {
        return Ok(vec![]);
    }
    let managed_paths: std::collections::HashSet<&str> = managed_entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();
    read_local_directory_entries(&path, &managed_paths, true)
}

fn read_local_directory_entries(
    directory: &std::path::Path,
    managed_paths: &std::collections::HashSet<&str>,
    files_only: bool,
) -> Result<Vec<LocalDistributionEntry>, AppError> {
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(AppError::Io(error.to_string())),
    };
    let mut local_entries = Vec::new();
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if managed_paths.contains(path.to_string_lossy().as_ref()) {
            continue;
        }
        let file_type = entry.file_type()?;
        if files_only && !file_type.is_file() {
            continue;
        }
        if !files_only && !file_type.is_dir() && !file_type.is_symlink() {
            continue;
        }
        local_entries.push(LocalDistributionEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
        });
    }
    local_entries.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(local_entries)
}

/// Validate that every RemoveSelected target is owned by SkillForge before
/// any mutation happens. Returns `DistributionInvalid` if a target is not a
/// SkillForge-managed symlink or contains an unknown/modified managed block.
pub(crate) fn validate_removal_targets(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    request: &crate::types::DistributionRequest,
    plan: &crate::types::DistributionPlan,
) -> Result<(), AppError> {
    let project_path = request
        .project_id
        .as_deref()
        .and_then(|id| get_project_path(conn, id));
    for platform in &plan.platforms {
        let plugin = platform_plugins
            .iter()
            .find(|plugin| plugin.platform_name() == platform.platform_id)
            .ok_or_else(|| {
                AppError::Platform(format!("未找到平台插件: {}", platform.platform_id))
            })?;
        let instance = resolve_distribution_instance(
            plugin.as_ref(),
            request.scope.as_str(),
            project_path.as_deref(),
        );
        if matches!(
            request.skills.mode,
            crate::types::DistributionIntentMode::RemoveSelected
        ) {
            for id in &platform.skills_to_remove {
                let skill = get_skill(conn, id)?;
                let target = std::path::Path::new(&instance.path).join(id);
                if !target.exists() && target.symlink_metadata().is_err() {
                    continue;
                }
                let link = target.read_link().map_err(|_| {
                    AppError::DistributionInvalid(format!(
                        "技能 '{}' 不是 SkillForge 管理的符号链接",
                        id
                    ))
                })?;
                if link.to_string_lossy() != skill.local_path {
                    return Err(AppError::DistributionInvalid(format!(
                        "技能 '{}' 的符号链接目标不是 SkillForge 来源",
                        id
                    )));
                }
            }
        }
        if matches!(
            request.rules.mode,
            crate::types::DistributionIntentMode::RemoveSelected
        ) {
            let rules_format = if request.scope == "global" {
                plugin.default_paths().global_rules_format.clone()
            } else {
                plugin.default_paths().project_rules_format.clone()
            }
            .unwrap_or(RulesFormat::Directory);
            if matches!(rules_format, RulesFormat::SingleFile { .. }) {
                let rules_path = rule_distribution::resolve_rules_path(
                    plugin.as_ref(),
                    &instance,
                    project_path.as_deref(),
                )?;
                if let Some(path) = rules_path {
                    if path.exists() {
                        let content = std::fs::read_to_string(&path).map_err(|error| {
                            AppError::DistributionInvalid(format!(
                                "无法读取规则文件 '{}': {}",
                                path.display(),
                                error
                            ))
                        })?;
                        let blocks = rule_distribution::parse_managed_rule_blocks(&content)?;
                        rule_distribution::validate_single_file_rule_blocks(conn, &blocks)?;
                    }
                }
            }
            rule_distribution::validate_rule_removal_targets(
                conn,
                plugin.as_ref(),
                &instance,
                &platform.rules_to_remove,
                &rules_format,
                project_path.as_deref(),
            )?;
        }
    }
    Ok(())
}

/// Get the current sync status across all enabled platforms.
///
/// Distribution status is derived from the target filesystem scan
/// (filesystem-as-truth; Plan / ExecutionResult / ManagedState three-segment
/// model per the v1.1.0 baseline design — no `distributions` table).
pub fn get_sync_status(conn: &rusqlite::Connection) -> Result<SyncStatusDTO, AppError> {
    let mut stmt =
        conn.prepare("SELECT id, name FROM platforms WHERE enabled != 0 ORDER BY name ASC")?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let platforms: Vec<PlatformSyncStatus> = rows
        .into_iter()
        .map(|(pid, pname)| {
            let (fs_skills, fs_rules) = match crate::plugins::platform::create_platform_plugin(&pid)
            {
                Ok(p) => {
                    let paths = p.default_paths();
                    let skills_dir_path =
                        crate::plugins::platform::expand_home(&paths.global_skills_dir);
                    let fs_skill_count = count_fs_subdirs(&skills_dir_path);
                    let fs_rule_count = paths
                        .global_rules_dir
                        .as_ref()
                        .map(|d| count_fs_files(&crate::plugins::platform::expand_home(d)))
                        .unwrap_or(0);
                    (fs_skill_count, fs_rule_count)
                }
                Err(_) => (0, 0),
            };
            let total_count = fs_skills + fs_rules;
            let status = if total_count > 0 {
                "synced"
            } else {
                "never_synced"
            };
            PlatformSyncStatus {
                platform_id: pid,
                platform_name: pname,
                status: status.to_string(),
                synced_count: total_count,
                total_count,
                scene_skill_count: 0,
                synced_skill_count: 0,
                scene_rule_count: 0,
                synced_rule_count: 0,
            }
        })
        .collect();

    Ok(SyncStatusDTO { platforms })
}

pub(crate) fn count_fs_subdirs(path: &std::path::Path) -> i64 {
    if !path.exists() {
        return 0;
    }
    let mut count = 0i64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    if !name.starts_with('.') {
                        count += 1;
                    }
                }
            }
        }
    }
    count
}

/// Count files in a directory (non-hidden, one level).
pub(crate) fn count_fs_files(path: &std::path::Path) -> i64 {
    if !path.exists() {
        return 0;
    }
    let mut count = 0i64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    if !name.starts_with('.') {
                        count += 1;
                    }
                }
            }
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        schema::create_tables(&conn).unwrap();
        conn
    }

    #[test]
    fn test_get_sync_status() {
        let conn = setup_db();
        let status = get_sync_status(&conn).unwrap();
        assert_eq!(status.platforms.len(), 10); // 10 built-in platforms
    }
}
