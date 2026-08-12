use crate::engine::rule_distribution;
use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::types::{
    DistributionIntent, DistributionIntentMode, DistributionPlan, DistributionRequest,
    LocalDistributionEntry, ManagedDistributionEntry, ManagedDistributionState,
    ManagedPlatformState, PlatformDistributionPlan, PlatformInstance, PlatformSyncStatus,
    RulesFormat, Skill, SyncResult, SyncStatusDTO,
};
use rusqlite::params;

/// Sync skills and rules to one or more platforms.
///
/// This is the core distribution operation:
/// 1. Use directly provided skill/rule IDs (or resolve from scene if scene_id given)
/// 2. Auto-resolve platforms to all enabled platforms if not specified
/// 3. For each platform, compute diff and execute install/update/remove
/// 4. Record sync logs
#[allow(clippy::too_many_arguments)]
pub fn sync_scene(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    skill_ids: &[String],
    rule_ids: &[String],
    scene_id: Option<&str>,
    platform_ids: Option<&[String]>,
    scope: &str,
    project_id: Option<&str>,
) -> Result<SyncResult, AppError> {
    // If no platforms specified, auto-resolve to all enabled platforms
    let resolved_platform_ids: Vec<String>;
    let platform_ids = match platform_ids {
        Some(ids) if !ids.is_empty() => ids,
        _ => {
            resolved_platform_ids = crate::engine::scene_engine::get_scene_platforms(conn, "")?;
            if resolved_platform_ids.is_empty() {
                return Err(AppError::Platform("没有已启用的平台".to_string()));
            }
            &resolved_platform_ids
        }
    };
    let mut result = SyncResult {
        installed: Vec::new(),
        updated: Vec::new(),
        removed: Vec::new(),
        errors: Vec::new(),
    };
    // Legacy sync is additive/preserving: omitted IDs never imply removal.
    let skill_ids: Vec<String> = skill_ids.to_vec();
    let rule_ids: Vec<String> = rule_ids.to_vec();
    // Get project path if project-scoped
    let project_path: Option<String> = if scope == "project" {
        Some(
            project_id
                .and_then(|pid| get_project_path(conn, pid))
                .ok_or_else(|| {
                    AppError::ProjectNotFound("项目范围同步需要提供项目ID".to_string())
                })?,
        )
    } else {
        None
    };
    // For each target platform
    for platform_id in platform_ids {
        let plugin = platform_plugins
            .iter()
            .find(|p| p.platform_name() == platform_id)
            .ok_or_else(|| AppError::Platform(format!("未找到平台插件: {}", platform_id)))?;
        // Detect platform instances
        let instances = match plugin.detect() {
            Ok(instances) => instances,
            Err(e) => {
                result
                    .errors
                    .push(format!("检测平台 '{}' 失败: {}", platform_id, e));
                continue;
            }
        };
        // Find matching instance for the requested scope
        let instance = if scope == "global" {
            instances
                .into_iter()
                .find(|i| i.scope == "global")
                .unwrap_or_else(|| resolve_global_distribution_instance(plugin.as_ref()))
        } else {
            // Project scope: construct instance path
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
        // Ensure instance directory exists
        if let Some(parent) = std::path::Path::new(&instance.path).parent() {
            crate::engine::fs_watcher::mute_self_writes(parent);
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!("无法创建平台目录 '{}': {}", parent.display(), e))
            })?;
        }
        // Compute diff: what's currently on disk vs what should be
        let current_skill_ids = match scene_id {
            Some(id) => get_distributed_skills(
                conn,
                id,
                platform_id,
                scope,
                project_id,
                &**plugin,
                &instance,
            )?,
            None => read_current_skills_on_disk(&instance),
        };
        // Skills to install (in scene but not in current distribution)
        let to_install: Vec<&String> = skill_ids
            .iter()
            .filter(|id| !current_skill_ids.contains(id))
            .collect();
        let to_remove: Vec<&String> = Vec::new();
        // Execute installs
        for skill_id in &to_install {
            match get_skill(conn, skill_id) {
                Ok(skill) => match plugin.install(&skill, &instance) {
                    Ok(_) => {
                        result.installed.push(skill_id.to_string());
                    }
                    Err(e) => {
                        result.errors.push(format!(
                            "安装技能 '{}' 到 {} 失败: {}",
                            skill_id, platform_id, e
                        ));
                    }
                },
                Err(e) => {
                    result
                        .errors
                        .push(format!("技能 '{}' 未在数据库中找到: {}", skill_id, e));
                }
            }
        }
        // Execute removes
        for skill_id in &to_remove {
            match plugin.remove(skill_id, &instance) {
                Ok(_) => {
                    result.removed.push(skill_id.to_string());
                }
                Err(e) => {
                    result.errors.push(format!(
                        "从 {} 移除技能 '{}' 失败: {}",
                        platform_id, skill_id, e
                    ));
                }
            }
        }
        // Sync rules for platforms that support rules
        let rules_supported = if instance.scope == "global" {
            plugin.default_paths().global_rules_dir.is_some()
        } else {
            plugin.default_paths().project_rules_pattern.is_some()
        };
        if rules_supported {
            let rules_format = if instance.scope == "global" {
                plugin.default_paths().global_rules_format.clone()
            } else {
                plugin.default_paths().project_rules_format.clone()
            }
            .unwrap_or(RulesFormat::Directory);
            rule_distribution::sync_rules_to_platform(
                conn,
                &**plugin,
                &instance,
                &rule_ids,
                &rules_format,
                project_path.as_deref(),
                false,
                &mut result,
            )?;
        }
    }
    Ok(result)
}

// ── Read-only helpers for plan generation ────────────────────────────

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

pub fn execute_distribution_request(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    request: &DistributionRequest,
    submitted_plan: &DistributionPlan,
) -> Result<SyncResult, AppError> {
    request.validate()?;
    let recomputed_plan = build_distribution_plan_for_request(conn, platform_plugins, request)?;
    if submitted_plan != &recomputed_plan {
        return Err(AppError::DistributionInvalid(
            "分发计划已过期或与当前状态不匹配，请重新预览".to_string(),
        ));
    }
    validate_existing_single_file_targets(conn, platform_plugins, request, &recomputed_plan)?;
    validate_removal_targets(conn, platform_plugins, request, &recomputed_plan)?;

    let project_path = request
        .project_id
        .as_deref()
        .and_then(|id| get_project_path(conn, id));
    let mut result = SyncResult {
        installed: vec![],
        updated: vec![],
        removed: vec![],
        errors: vec![],
    };
    for platform in &recomputed_plan.platforms {
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
        if matches!(request.skills.mode, DistributionIntentMode::AddOrUpdate) {
            for id in &request.skills.ids {
                let skill = get_skill(conn, id)?;
                let sync_result = plugin.sync(&skill, &instance)?;
                result.installed.extend(sync_result.installed);
                result.updated.extend(sync_result.updated);
            }
        }
        if matches!(request.skills.mode, DistributionIntentMode::RemoveSelected) {
            for id in &platform.skills_to_remove {
                plugin.remove(id, &instance)?;
                result.removed.push(id.clone());
            }
        }
        let rules_format = if request.scope == "global" {
            plugin.default_paths().global_rules_format.clone()
        } else {
            plugin.default_paths().project_rules_format.clone()
        }
        .unwrap_or(RulesFormat::Directory);
        match request.rules.mode {
            DistributionIntentMode::Preserve => {}
            DistributionIntentMode::AddOrUpdate => {
                rule_distribution::sync_rules_to_platform(
                    conn,
                    plugin.as_ref(),
                    &instance,
                    &request.rules.ids,
                    &rules_format,
                    project_path.as_deref(),
                    false,
                    &mut result,
                )?;
            }
            DistributionIntentMode::RemoveSelected => {
                rule_distribution::remove_selected_rules(
                    conn,
                    plugin.as_ref(),
                    &instance,
                    &platform.rules_to_remove,
                    &rules_format,
                    project_path.as_deref(),
                    &mut result,
                )?;
            }
        }
    }
    Ok(result)
}

fn resolve_global_distribution_instance(plugin: &dyn PlatformPlugin) -> PlatformInstance {
    PlatformInstance {
        platform_id: plugin.platform_name().to_string(),
        platform_name: plugin.display_name().to_string(),
        path: crate::plugins::platform::expand_home(&plugin.default_paths().global_skills_dir)
            .to_string_lossy()
            .to_string(),
        scope: "global".to_string(),
    }
}

fn validate_existing_single_file_targets(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    request: &DistributionRequest,
    plan: &DistributionPlan,
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
        let rules_format = if request.scope == "global" {
            plugin.default_paths().global_rules_format.clone()
        } else {
            plugin.default_paths().project_rules_format.clone()
        }
        .unwrap_or(RulesFormat::Directory);
        if !matches!(rules_format, RulesFormat::SingleFile { .. }) {
            continue;
        }
        let Some(path) = rule_distribution::resolve_rules_path(
            plugin.as_ref(),
            &instance,
            project_path.as_deref(),
        )?
        else {
            continue;
        };
        if !path.exists() {
            continue;
        }
        let content = std::fs::read_to_string(&path).map_err(|error| {
            AppError::DistributionInvalid(format!(
                "无法读取规则文件 '{}': {}",
                path.display(),
                error
            ))
        })?;
        rule_distribution::validate_single_file_rule_blocks(
            conn,
            &rule_distribution::parse_managed_rule_blocks(&content)?,
        )?;
    }
    Ok(())
}

pub fn get_managed_distribution_state(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    platform_ids: &[String],
    scope: &str,
    project_id: Option<&str>,
) -> Result<ManagedDistributionState, AppError> {
    let validation_request = DistributionRequest {
        scene_id: None,
        platform_ids: platform_ids.to_vec(),
        scope: scope.to_string(),
        project_id: project_id.map(str::to_string),
        skills: DistributionIntent {
            mode: DistributionIntentMode::Preserve,
            ids: vec![],
        },
        rules: DistributionIntent {
            mode: DistributionIntentMode::Preserve,
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

fn resolve_distribution_instance(
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

fn validate_removal_targets(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    request: &DistributionRequest,
    plan: &DistributionPlan,
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
        if matches!(request.skills.mode, DistributionIntentMode::RemoveSelected) {
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
        if matches!(request.rules.mode, DistributionIntentMode::RemoveSelected) {
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

/// Get the current sync status across all enabled platforms.
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
            // 分发状态从目标文件系统扫描派生（11 号设计基线：Plan / ExecutionResult / ManagedState 三段模型）
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
// ── Internal helpers ───────────────────────────────────────────────
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
fn get_distributed_skills(
    _conn: &rusqlite::Connection,
    _scene_id: &str,
    _platform_id: &str,
    _scope: &str,
    _project_id: Option<&str>,
    _plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
) -> Result<Vec<String>, AppError> {
    Ok(read_current_skills_on_disk(instance))
}
fn get_skill(conn: &rusqlite::Connection, skill_id: &str) -> Result<Skill, AppError> {
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

fn get_project_path(conn: &rusqlite::Connection, project_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT path FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )
    .ok()
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
    #[test]
    fn test_sync_to_missing_directory() {
        // Test that syncing to a non-existent directory auto-creates it
        let test_dir = format!("/tmp/skillforge-test-sync-{}", std::process::id());
        let _ = std::fs::remove_dir_all(&test_dir); // cleanup from previous runs
                                                    // Verify the directory doesn't exist yet
        assert!(!std::path::Path::new(&test_dir).exists());
        // Simulate the directory creation logic from sync_scene
        let path = std::path::Path::new(&test_dir);
        if let Some(parent) = path.parent() {
            let result = std::fs::create_dir_all(parent);
            assert!(result.is_ok(), "Should be able to create parent directory");
        }
        // Verify directory was created
        assert!(path.parent().unwrap().exists());
        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }
    #[test]
    fn test_sync_scene_no_platforms() {
        let conn = setup_db();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];
        // sync_scene with empty skill/rule lists and no scene_id should succeed
        // (no skills to install, nothing to fail on)
        // With no platforms explicitly specified, it auto-resolves to 10 enabled platforms
        // but since plugins list is empty, each platform will fail with "platform not found"
        let result = sync_scene(&conn, &plugins, &[], &[], None, None, "global", None);
        assert!(result.is_err());
    }
    #[test]
    fn test_sync_project_scope_without_project() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();
        // Create a scene with a platform association
        conn.execute(
            "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
            params!["test-scene", "Test Scene", "A test", now, now],
        ).unwrap();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];
        // Sync with project scope but no project_id should fail
        let result = sync_scene(&conn, &plugins, &[], &[], None, None, "project", None);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::ProjectNotFound(msg) => assert!(msg.contains("项目ID")),
            other => panic!("Expected ProjectNotFound error, got: {:?}", other),
        }
    }
}
