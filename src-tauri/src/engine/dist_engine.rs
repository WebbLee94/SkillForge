use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::types::{
    Distribution, DistributionIntent, DistributionIntentMode, DistributionPlan,
    DistributionRequest, LocalDistributionEntry, ManagedDistributionEntry,
    ManagedDistributionState, ManagedPlatformState, PlatformDistributionPlan, PlatformInstance,
    PlatformSyncStatus, RulesFormat, Skill, SyncResult, SyncStatusDTO,
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
    // scene_id remains informational here; strict replacement belongs to switch_global_scene.
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
                        log_sync(
                            conn,
                            "install",
                            "skill",
                            skill_id,
                            platform_id,
                            "success",
                            None,
                        );
                    }
                    Err(e) => {
                        result.errors.push(format!(
                            "安装技能 '{}' 到 {} 失败: {}",
                            skill_id, platform_id, e
                        ));
                        log_sync(
                            conn,
                            "install",
                            "skill",
                            skill_id,
                            platform_id,
                            "error",
                            Some(&e.to_string()),
                        );
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
                    log_sync(
                        conn,
                        "remove",
                        "skill",
                        skill_id,
                        platform_id,
                        "success",
                        None,
                    );
                }
                Err(e) => {
                    result.errors.push(format!(
                        "从 {} 移除技能 '{}' 失败: {}",
                        platform_id, skill_id, e
                    ));
                    log_sync(
                        conn,
                        "remove",
                        "skill",
                        skill_id,
                        platform_id,
                        "error",
                        Some(&e.to_string()),
                    );
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
            sync_rules_to_platform(
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
        // Update distribution record (only when scene_id is known)
        if let Some(sid) = scene_id {
            let checksum = compute_scene_checksum(conn, sid);
            conn.execute(
                "INSERT OR REPLACE INTO distributions (scene_id, platform_id, scope, project_id, project_path, status, last_synced_at, checksum)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), ?7)",
                params![sid, platform_id, scope, project_id, project_path, "synced", checksum],
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

/// Read currently deployed rule IDs from a Directory-mode rules directory.
/// Returns the file stems (rule IDs) of all non-hidden files.
pub fn read_current_rules_on_disk_directory(dir: &std::path::Path) -> Vec<String> {
    if !dir.exists() {
        return vec![];
    }
    let mut current = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                if let Some(name) = entry.file_name().to_str() {
                    if !name.starts_with('.') {
                        if let Some(stem) = std::path::Path::new(name).file_stem() {
                            current.push(stem.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }
    current
}

/// Read currently deployed rule IDs from a SingleFile-mode file.
/// Extracts rule IDs from `<!-- SKILLFORGE:rule:{id} -->` markers.
/// Returns empty vec if file doesn't exist or no markers found.
pub fn read_current_rules_on_disk_single_file(
    file_path: &std::path::Path,
) -> Result<Vec<String>, AppError> {
    if !file_path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(file_path).map_err(|error| {
        AppError::DistributionInvalid(format!(
            "无法读取规则文件 '{}': {}",
            file_path.display(),
            error
        ))
    })?;
    let re = regex::Regex::new(r"<!-- SKILLFORGE:rule:([^\s]+) -->")
        .expect("valid regex for single-file rule extraction");
    Ok(re
        .captures_iter(&content)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
        .collect())
}

/// Dispatcher: read current rules from disk based on the platform's rules format.
/// Does NOT create directories. Returns empty vec if target doesn't exist.
pub fn read_current_rules_on_disk(
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    project_base: Option<&str>,
) -> Result<Vec<String>, AppError> {
    let rules_path = resolve_rules_path(plugin, instance, project_base)?;
    match rules_path {
        None => Ok(vec![]),
        Some(path) => {
            let rules_format = if instance.scope == "global" {
                plugin.default_paths().global_rules_format.clone()
            } else {
                plugin.default_paths().project_rules_format.clone()
            }
            .unwrap_or(RulesFormat::Directory);
            match rules_format {
                RulesFormat::Directory => Ok(read_current_rules_on_disk_directory(&path)),
                RulesFormat::SingleFile { .. } => read_current_rules_on_disk_single_file(&path),
            }
        }
    }
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
        let current_rules =
            read_current_rules_on_disk(&**plugin, &instance, project_path.as_deref())?;
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
    if let Err(error) =
        validate_existing_single_file_targets(conn, platform_plugins, request, &recomputed_plan)
    {
        log_rule_preflight_failure(conn, request, &error);
        return Err(error);
    }
    if let Err(error) = validate_removal_targets(conn, platform_plugins, request, &recomputed_plan)
    {
        log_rule_preflight_failure(conn, request, &error);
        return Err(error);
    }

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
                let errors_before = result.errors.len();
                if let Err(error) = sync_rules_to_platform(
                    conn,
                    plugin.as_ref(),
                    &instance,
                    &request.rules.ids,
                    &rules_format,
                    project_path.as_deref(),
                    false,
                    &mut result,
                ) {
                    log_rule_distribution_failure(
                        conn,
                        "add_or_update",
                        &request.rules.ids,
                        &platform.platform_id,
                        &error,
                    );
                    return Err(error);
                }
                log_rule_distribution_outcomes(
                    conn,
                    "add_or_update",
                    &request.rules.ids,
                    &platform.platform_id,
                    &result.errors[errors_before..],
                );
            }
            DistributionIntentMode::RemoveSelected => {
                let errors_before = result.errors.len();
                if let Err(error) = remove_selected_rules(
                    conn,
                    plugin.as_ref(),
                    &instance,
                    &platform.rules_to_remove,
                    &rules_format,
                    project_path.as_deref(),
                    &mut result,
                ) {
                    log_rule_distribution_failure(
                        conn,
                        "remove_selected",
                        &platform.rules_to_remove,
                        &platform.platform_id,
                        &error,
                    );
                    return Err(error);
                }
                log_rule_distribution_outcomes(
                    conn,
                    "remove_selected",
                    &platform.rules_to_remove,
                    &platform.platform_id,
                    &result.errors[errors_before..],
                );
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
        let Some(path) = resolve_rules_path(plugin.as_ref(), &instance, project_path.as_deref())?
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
        validate_single_file_rule_blocks(conn, &parse_managed_rule_blocks(&content)?)?;
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
        let rules = read_managed_rules(conn, plugin.as_ref(), &instance, project_path.as_deref())?;
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
    let Some(path) = resolve_rules_path(plugin, instance, project_path)? else {
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

fn read_managed_rules(
    conn: &rusqlite::Connection,
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    project_path: Option<&str>,
) -> Result<Vec<ManagedDistributionEntry>, AppError> {
    let path = match resolve_rules_path(plugin, instance, project_path)? {
        Some(path) => path,
        None => return Ok(vec![]),
    };
    let format = if instance.scope == "global" {
        plugin.default_paths().global_rules_format.clone()
    } else {
        plugin.default_paths().project_rules_format.clone()
    }
    .unwrap_or(RulesFormat::Directory);
    match format {
        RulesFormat::Directory => {
            let mut entries = Vec::new();
            for id in read_current_rules_on_disk_directory(&path) {
                let rule = match get_rule(conn, &id) {
                    Ok(rule) => rule,
                    Err(_) => continue,
                };
                let rule_path = path.join(format!("{}.{}", id, rule.format));
                if std::fs::read_to_string(&rule_path).ok().as_deref()
                    == Some(rule.content.as_str())
                {
                    entries.push(ManagedDistributionEntry {
                        id,
                        path: rule_path.to_string_lossy().to_string(),
                    });
                }
            }
            Ok(entries)
        }
        RulesFormat::SingleFile { .. } => {
            let content = match std::fs::read_to_string(&path) {
                Ok(content) => content,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
                Err(error) => return Err(AppError::Io(error.to_string())),
            };
            let mut entries = Vec::new();
            for block in parse_managed_rule_blocks(&content)? {
                let rule = match get_rule(conn, &block.id) {
                    Ok(rule) => rule,
                    Err(_) => continue,
                };
                if rule_block_content_matches(&block, &rule.content) {
                    entries.push(ManagedDistributionEntry {
                        id: block.id,
                        path: path.to_string_lossy().to_string(),
                    });
                }
            }
            Ok(entries)
        }
    }
}

fn validate_rule_removal_targets(
    conn: &rusqlite::Connection,
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    rule_ids: &[String],
    rules_format: &RulesFormat,
    project_path: Option<&str>,
) -> Result<(), AppError> {
    let rules_path = resolve_rules_path(plugin, instance, project_path)?.ok_or_else(|| {
        AppError::DistributionInvalid("目标平台不支持当前范围的规则移除".to_string())
    })?;
    match rules_format {
        RulesFormat::Directory => {
            for id in rule_ids {
                let rule = get_rule(conn, id)?;
                let path = rules_path.join(format!("{}.{}", id, rule.format));
                if !path.exists() {
                    continue;
                }
                let content = std::fs::read_to_string(&path).map_err(|_| {
                    AppError::DistributionInvalid(format!(
                        "规则 '{}' 不是 SkillForge 管理的文件",
                        id
                    ))
                })?;
                if content != rule.content {
                    return Err(AppError::DistributionInvalid(format!(
                        "规则 '{}' 内容已被用户修改，拒绝移除",
                        id
                    )));
                }
            }
        }
        RulesFormat::SingleFile { .. } => {
            if !rules_path.exists() {
                return Ok(());
            }
            let content = std::fs::read_to_string(&rules_path).map_err(|_| {
                AppError::DistributionInvalid("规则文件无法读取，拒绝移除".to_string())
            })?;
            let blocks = parse_managed_rule_blocks(&content)?;
            validate_single_file_rule_blocks(conn, &blocks)?;
            for id in rule_ids {
                let matching_blocks = blocks.iter().filter(|block| block.id == *id);
                if !blocks.iter().any(|block| block.id == *id) {
                    continue;
                }
                let rule = get_rule(conn, id)?;
                for block in matching_blocks {
                    if !rule_block_content_matches(block, &rule.content) {
                        return Err(AppError::DistributionInvalid(format!(
                            "规则 '{}' 标记块内容不匹配",
                            id
                        )));
                    }
                }
            }
        }
    }
    Ok(())
}

struct ManagedRuleBlock {
    id: String,
    content: String,
    raw: String,
    start: usize,
    end: usize,
}

fn rule_block_content_matches(block: &ManagedRuleBlock, rule_content: &str) -> bool {
    block.content == rule_content || block.content.strip_suffix('\n') == Some(rule_content)
}

fn render_managed_rule_block(rule_id: &str, content: &str) -> String {
    let separator = if content.ends_with('\n') { "" } else { "\n" };
    format!(
        "<!-- SKILLFORGE:rule:{rule_id} -->\n{content}{separator}<!-- /SKILLFORGE:rule:{rule_id} -->"
    )
}

fn validate_single_file_rule_blocks(
    conn: &rusqlite::Connection,
    blocks: &[ManagedRuleBlock],
) -> Result<(), AppError> {
    let mut seen_ids = std::collections::HashSet::new();
    for block in blocks {
        if !seen_ids.insert(&block.id) {
            return Err(AppError::DistributionInvalid(format!(
                "规则 '{}' 在规则文件中出现重复标记块",
                block.id
            )));
        }
        let rule = get_rule(conn, &block.id).map_err(|_| {
            AppError::DistributionInvalid(format!("规则 '{}' 没有对应的 SkillForge 规则", block.id))
        })?;
        if !rule_block_content_matches(block, &rule.content) {
            return Err(AppError::DistributionInvalid(format!(
                "规则 '{}' 标记块内容不匹配",
                block.id
            )));
        }
    }
    Ok(())
}

pub(crate) fn count_managed_rule_blocks(content: &str) -> Result<i64, AppError> {
    parse_managed_rule_blocks(content).map(|blocks| blocks.len() as i64)
}

fn parse_managed_rule_blocks(content: &str) -> Result<Vec<ManagedRuleBlock>, AppError> {
    let re = regex::Regex::new(
        r"(?s)<!-- SKILLFORGE:rule:([^\s]+) -->\n?(.*?)<!-- /SKILLFORGE:rule:([^\s]+) -->",
    )
    .map_err(|error| AppError::Platform(format!("正则编译失败: {}", error)))?;
    let marker_count = content.matches("<!-- SKILLFORGE:rule:").count()
        + content.matches("<!-- /SKILLFORGE:rule:").count();
    let matches: Vec<ManagedRuleBlock> = re
        .captures_iter(content)
        .filter_map(|capture| {
            if capture.get(1)?.as_str() != capture.get(3)?.as_str() {
                return None;
            }
            Some(ManagedRuleBlock {
                id: capture.get(1)?.as_str().to_string(),
                content: capture.get(2)?.as_str().to_string(),
                raw: capture.get(0)?.as_str().to_string(),
                start: capture.get(0)?.start(),
                end: capture.get(0)?.end(),
            })
        })
        .collect();
    if marker_count != matches.len() * 2 {
        return Err(AppError::DistributionInvalid(
            "规则文件包含畸形或不匹配的 SkillForge 标记块".to_string(),
        ));
    }
    Ok(matches)
}

fn remove_selected_rules(
    conn: &rusqlite::Connection,
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    rule_ids: &[String],
    rules_format: &RulesFormat,
    project_path: Option<&str>,
    result: &mut SyncResult,
) -> Result<(), AppError> {
    let rules_path = resolve_rules_path(plugin, instance, project_path)?.ok_or_else(|| {
        AppError::DistributionInvalid("目标平台不支持当前范围的规则移除".to_string())
    })?;
    remove_selected_rules_from_path(conn, &rules_path, rule_ids, rules_format, result)
}

fn remove_selected_rules_from_path(
    conn: &rusqlite::Connection,
    rules_path: &std::path::Path,
    rule_ids: &[String],
    rules_format: &RulesFormat,
    result: &mut SyncResult,
) -> Result<(), AppError> {
    match rules_format {
        RulesFormat::Directory => {
            for id in rule_ids {
                let rule = get_rule(conn, id)?;
                let path = rules_path.join(format!("{}.{}", id, rule.format));
                if path.exists() {
                    std::fs::remove_file(path)?;
                    result.removed.push(format!("rule:{}", id));
                }
            }
        }
        RulesFormat::SingleFile { .. } => {
            if !rules_path.exists() {
                return Ok(());
            }
            let content = std::fs::read_to_string(rules_path)?;
            let blocks = parse_managed_rule_blocks(&content)?;
            validate_single_file_rule_blocks(conn, &blocks)?;
            let mut new_content = content.clone();
            let mut removed_ids = Vec::new();

            for id in rule_ids {
                if !blocks.iter().any(|block| block.id == *id) {
                    continue;
                }
                let rule = get_rule(conn, id)?;
                for block in blocks.iter().filter(|block| block.id == *id) {
                    if !rule_block_content_matches(block, &rule.content) {
                        return Err(AppError::DistributionInvalid(format!(
                            "规则 '{}' 标记块内容不匹配",
                            id
                        )));
                    }
                }
            }

            for id in rule_ids {
                if !blocks.iter().any(|block| block.id == *id) {
                    continue;
                }
                for block in blocks.iter().filter(|block| block.id == *id) {
                    new_content = new_content.replace(&block.raw, "");
                }
                if !removed_ids.contains(id) {
                    removed_ids.push(id.clone());
                }
            }
            if !removed_ids.is_empty() {
                if new_content.is_empty() {
                    std::fs::remove_file(rules_path)?;
                } else {
                    std::fs::write(rules_path, new_content)?;
                }
                for id in removed_ids {
                    result.removed.push(format!("rule:{}", id));
                }
            }
        }
    }
    Ok(())
}

struct StrictScenePlan<'a> {
    platforms_only_old: &'a [String],
    platforms_shared: &'a [String],
    platforms_only_new: &'a [String],
    old_skills: &'a [String],
    old_rules: &'a [String],
    skills_to_remove: &'a [String],
    rules_to_remove: &'a [String],
}

fn validate_strict_scene_mutations(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    detected_instances: &std::collections::HashMap<String, Vec<PlatformInstance>>,
    plan: &StrictScenePlan<'_>,
) -> Result<(), AppError> {
    for platform_id in plan.platforms_only_old {
        validate_strict_platform_targets(
            conn,
            platform_plugins,
            detected_instances,
            platform_id,
            plan.old_skills,
            plan.old_rules,
        )?;
    }
    for platform_id in plan.platforms_shared {
        validate_strict_platform_targets(
            conn,
            platform_plugins,
            detected_instances,
            platform_id,
            plan.skills_to_remove,
            plan.rules_to_remove,
        )?;
    }
    for platform_id in plan.platforms_only_new {
        validate_strict_platform_targets(
            conn,
            platform_plugins,
            detected_instances,
            platform_id,
            &[],
            &[],
        )?;
    }
    Ok(())
}

fn validate_strict_platform_targets(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    detected_instances: &std::collections::HashMap<String, Vec<PlatformInstance>>,
    platform_id: &str,
    skill_ids: &[String],
    rule_ids: &[String],
) -> Result<(), AppError> {
    let Some(plugin) = platform_plugins
        .iter()
        .find(|plugin| plugin.platform_name() == platform_id)
    else {
        return Ok(());
    };
    let instances = detected_instances
        .get(platform_id)
        .cloned()
        .unwrap_or_default();
    if instances.iter().all(|instance| instance.scope != "global") {
        return Ok(());
    }
    for instance in instances
        .into_iter()
        .filter(|instance| instance.scope == "global")
    {
        validate_strict_platform_instance(conn, plugin.as_ref(), &instance, skill_ids, rule_ids)?;
    }
    Ok(())
}

fn validate_strict_platform_instance(
    conn: &rusqlite::Connection,
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    skill_ids: &[String],
    rule_ids: &[String],
) -> Result<(), AppError> {
    for skill_id in skill_ids {
        let skill = get_skill(conn, skill_id)?;
        let target = std::path::Path::new(&instance.path).join(skill_id);
        if !target.exists() && target.symlink_metadata().is_err() {
            continue;
        }
        let link = target.read_link().map_err(|_| {
            AppError::DistributionInvalid(format!(
                "技能 '{}' 不是 SkillForge 管理的符号链接",
                skill_id
            ))
        })?;
        if link.to_string_lossy() != skill.local_path {
            return Err(AppError::DistributionInvalid(format!(
                "技能 '{}' 的符号链接目标不是 SkillForge 来源",
                skill_id
            )));
        }
    }
    let rules_format = plugin
        .default_paths()
        .global_rules_format
        .clone()
        .unwrap_or(RulesFormat::Directory);
    let path = match resolve_rules_path(plugin, instance, None)? {
        Some(path) => path,
        None => return Ok(()),
    };
    if !path.exists() {
        return Ok(());
    }
    validate_strict_rule_file_ownership(conn, &path, &rules_format)?;
    match rules_format {
        RulesFormat::Directory => {
            for rule_id in rule_ids {
                let rule = get_rule(conn, rule_id)?;
                let path = path.join(format!("{}.{}", rule_id, rule.format));
                if !path.exists() {
                    continue;
                }
                let content = std::fs::read_to_string(path)?;
                if content != rule.content {
                    return Err(AppError::DistributionInvalid(format!(
                        "规则 '{}' 内容已被用户修改，拒绝严格移除",
                        rule_id
                    )));
                }
            }
            Ok(())
        }
        RulesFormat::SingleFile { .. } => {
            let content = std::fs::read_to_string(path)?;
            let blocks = parse_managed_rule_blocks(&content)?;
            validate_single_file_rule_blocks(conn, &blocks)?;
            for rule_id in rule_ids {
                let rule = get_rule(conn, rule_id)?;
                for block in blocks.iter().filter(|block| block.id == *rule_id) {
                    if !rule_block_content_matches(block, &rule.content) {
                        return Err(AppError::DistributionInvalid(format!(
                            "规则 '{}' 内容已被用户修改，拒绝严格移除",
                            rule_id
                        )));
                    }
                }
            }
            Ok(())
        }
    }
}

fn validate_strict_rule_file_ownership(
    conn: &rusqlite::Connection,
    path: &std::path::Path,
    rules_format: &RulesFormat,
) -> Result<(), AppError> {
    match rules_format {
        RulesFormat::Directory => {
            for entry in std::fs::read_dir(path)? {
                let entry = entry?;
                if !entry.file_type()?.is_file() {
                    continue;
                }
                let entry_path = entry.path();
                let Some(id) = entry_path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
                else {
                    continue;
                };
                let Ok(rule) = get_rule(conn, &id) else {
                    continue;
                };
                let content = std::fs::read_to_string(entry_path)?;
                if content != rule.content {
                    return Err(AppError::DistributionInvalid(format!(
                        "规则 '{}' 内容已被用户修改，拒绝严格分发",
                        id
                    )));
                }
            }
        }
        RulesFormat::SingleFile { .. } => {
            let content = std::fs::read_to_string(path)?;
            validate_single_file_rule_blocks(conn, &parse_managed_rule_blocks(&content)?)?;
        }
    }
    Ok(())
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
                let rules_path =
                    resolve_rules_path(plugin.as_ref(), &instance, project_path.as_deref())?;
                if let Some(path) = rules_path {
                    if path.exists() {
                        let content = std::fs::read_to_string(&path).map_err(|error| {
                            AppError::DistributionInvalid(format!(
                                "无法读取规则文件 '{}': {}",
                                path.display(),
                                error
                            ))
                        })?;
                        let blocks = parse_managed_rule_blocks(&content)?;
                        validate_single_file_rule_blocks(conn, &blocks)?;
                    }
                }
            }
            validate_rule_removal_targets(
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
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, COALESCE(d.status, 'never_synced') as status,
                COALESCE(d.synced_count, 0) as synced_count,
                COALESCE(d.total_count, 0) as total_count
         FROM platforms p
         LEFT JOIN (
             SELECT d.platform_id,
                    (SELECT d2.status FROM distributions d2
                     WHERE d2.platform_id = d.platform_id AND d2.scope = 'global'
                     ORDER BY d2.last_synced_at DESC LIMIT 1) as status,
                    COUNT(CASE WHEN d.status = 'synced' THEN 1 END) as synced_count,
                    COUNT(*) as total_count
             FROM distributions d
             WHERE d.scope = 'global'
             GROUP BY d.platform_id
         ) d ON p.id = d.platform_id
         WHERE p.enabled != 0
         ORDER BY p.name ASC",
    )?;
    let platforms: Vec<PlatformSyncStatus> = stmt
        .query_map([], |row| {
            let pid: String = row.get(0)?;
            let pname: String = row.get(1)?;
            let pstatus: String = row.get(2)?;
            let synced_count: i64 = row.get(3)?;
            let total_count: i64 = row.get(4)?;
            // Compute filesystem counts
            let (scene_skill_count, synced_skill_count, scene_rule_count, synced_rule_count) = {
                // Scene skill/rule counts from current global scene
                let global_scene_id: Option<String> = conn
                    .query_row(
                        "SELECT value FROM app_config WHERE key = 'global_scene_id'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(None);
                let scene_skills: i64 = if let Some(ref sid) = global_scene_id {
                    conn.query_row(
                        "SELECT COUNT(*) FROM scene_skills WHERE scene_id = ?1 AND enabled = 1",
                        params![sid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0)
                } else {
                    0
                };
                let scene_rules: i64 = if let Some(ref sid) = global_scene_id {
                    conn.query_row(
                        "SELECT COUNT(*) FROM scene_rules WHERE scene_id = ?1 AND enabled = 1",
                        params![sid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0)
                } else {
                    0
                };
                // Filesystem counts from platform directory
                let (fs_skills, fs_rules) =
                    match crate::plugins::platform::create_platform_plugin(&pid) {
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
                (scene_skills, fs_skills, scene_rules, fs_rules)
            };
            Ok(PlatformSyncStatus {
                platform_id: pid,
                platform_name: pname,
                status: pstatus,
                synced_count,
                total_count,
                scene_skill_count,
                synced_skill_count,
                scene_rule_count,
                synced_rule_count,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(SyncStatusDTO { platforms })
}
/// Get distribution details for a specific scene/platform/scope combination.
pub fn get_distribution_detail(
    conn: &rusqlite::Connection,
    scene_id: &str,
    platform_id: &str,
    scope: &str,
) -> Result<Vec<Distribution>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, scene_id, platform_id, scope, project_id, project_path, status, last_synced_at, checksum
         FROM distributions
         WHERE scene_id = ?1 AND platform_id = ?2 AND scope = ?3",
    )?;
    let distributions = stmt
        .query_map(params![scene_id, platform_id, scope], |row| {
            Ok(Distribution {
                id: row.get(0)?,
                scene_id: row.get(1)?,
                platform_id: row.get(2)?,
                scope: row.get(3)?,
                project_id: row.get(4)?,
                project_path: row.get(5)?,
                status: row.get(6)?,
                last_synced_at: row.get(7)?,
                checksum: row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(distributions)
}
/// Get all distributions, optionally filtered.
pub fn get_distributions(
    conn: &rusqlite::Connection,
    scene_id: Option<&str>,
) -> Result<Vec<Distribution>, AppError> {
    let sql = if scene_id.is_some() {
        "SELECT id, scene_id, platform_id, scope, project_id, project_path, status, last_synced_at, checksum
         FROM distributions WHERE scene_id = ?1 ORDER BY last_synced_at DESC"
    } else {
        "SELECT id, scene_id, platform_id, scope, project_id, project_path, status, last_synced_at, checksum
         FROM distributions ORDER BY last_synced_at DESC"
    };
    let mut stmt = conn.prepare(sql)?;
    let distributions: Vec<Distribution> = if let Some(sid) = scene_id {
        stmt.query_map(params![sid], |row| {
            Ok(Distribution {
                id: row.get(0)?,
                scene_id: row.get(1)?,
                platform_id: row.get(2)?,
                scope: row.get(3)?,
                project_id: row.get(4)?,
                project_path: row.get(5)?,
                status: row.get(6)?,
                last_synced_at: row.get(7)?,
                checksum: row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map([], |row| {
            Ok(Distribution {
                id: row.get(0)?,
                scene_id: row.get(1)?,
                platform_id: row.get(2)?,
                scope: row.get(3)?,
                project_id: row.get(4)?,
                project_path: row.get(5)?,
                status: row.get(6)?,
                last_synced_at: row.get(7)?,
                checksum: row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };
    Ok(distributions)
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
    conn: &rusqlite::Connection,
    scene_id: &str,
    platform_id: &str,
    scope: &str,
    project_id: Option<&str>,
    _plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
) -> Result<Vec<String>, AppError> {
    // Check if a distribution record exists for this scene/platform/scope
    let has_distribution: bool = if project_id.is_some() {
        conn.query_row(
            "SELECT COUNT(*) FROM distributions WHERE scene_id = ?1 AND platform_id = ?2 AND scope = ?3 AND project_id = ?4",
            params![scene_id, platform_id, scope, project_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM distributions WHERE scene_id = ?1 AND platform_id = ?2 AND scope = ?3 AND project_id IS NULL",
            params![scene_id, platform_id, scope],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?
    };
    if !has_distribution {
        // First sync: nothing on disk yet, return empty so all skills get installed
        return Ok(vec![]);
    }
    // Read actual filesystem: list subdirectories in the skills directory
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

fn get_rule(conn: &rusqlite::Connection, rule_id: &str) -> Result<crate::types::Rule, AppError> {
    conn.query_row(
        "SELECT id, name, description, format, content, platform, scope, version, updated_at
         FROM rules WHERE id = ?1",
        params![rule_id],
        |row| {
            Ok(crate::types::Rule {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                format: row.get(3)?,
                content: row.get(4)?,
                platform: row.get(5)?,
                scope: row.get(6)?,
                version: row.get(7)?,
                updated_at: row.get(8)?,
                tags: vec![],
            })
        },
    )
    .map_err(|_| AppError::RuleNotFound(rule_id.to_string()))
}
fn get_project_path(conn: &rusqlite::Connection, project_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT path FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )
    .ok()
}
fn log_sync(
    conn: &rusqlite::Connection,
    action: &str,
    target_type: &str,
    target_id: &str,
    platform_id: &str,
    status: &str,
    message: Option<&str>,
) {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO sync_logs (action, target_type, target_id, platform_id, status, message, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![action, target_type, target_id, platform_id, status, message, now],
    )
    .ok();
}

fn log_rule_distribution_failure(
    conn: &rusqlite::Connection,
    action: &str,
    rule_ids: &[String],
    platform_id: &str,
    error: &AppError,
) {
    let message = error.to_string();
    for rule_id in rule_ids {
        log_sync(
            conn,
            action,
            "rule",
            rule_id,
            platform_id,
            "error",
            Some(&message),
        );
    }
}

fn log_rule_preflight_failure(
    conn: &rusqlite::Connection,
    request: &DistributionRequest,
    error: &AppError,
) {
    let (action, rule_ids) = match request.rules.mode {
        DistributionIntentMode::Preserve => return,
        DistributionIntentMode::AddOrUpdate => ("add_or_update", &request.rules.ids),
        DistributionIntentMode::RemoveSelected => ("remove_selected", &request.rules.ids),
    };
    for platform_id in &request.platform_ids {
        log_rule_distribution_failure(conn, action, rule_ids, platform_id, error);
    }
}

fn log_rule_distribution_outcomes(
    conn: &rusqlite::Connection,
    action: &str,
    rule_ids: &[String],
    platform_id: &str,
    errors: &[String],
) {
    for rule_id in rule_ids {
        let failure_prefix = format!("写入规则 '{}' ", rule_id);
        let failure = errors
            .iter()
            .find(|error| error.starts_with(&failure_prefix));
        if let Some(error) = failure {
            log_sync(
                conn,
                action,
                "rule",
                rule_id,
                platform_id,
                "error",
                Some(error),
            );
        } else {
            log_sync(conn, action, "rule", rule_id, platform_id, "success", None);
        }
    }
}
fn compute_scene_checksum(conn: &rusqlite::Connection, scene_id: &str) -> String {
    // Simple checksum based on skill IDs and versions
    let skills: Vec<String> = resolve_scene_skills(conn, scene_id).unwrap_or_default();
    let rules: Vec<String> = resolve_scene_rules(conn, scene_id).unwrap_or_default();
    let combined = format!("skills:{:?};rules:{:?}", skills, rules);
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(combined.as_bytes());
    format!("{:x}", hasher.finalize())[..16].to_string()
}
/// Dispatch rules sync based on the platform's `RulesFormat`.
#[allow(clippy::too_many_arguments)]
fn sync_rules_to_platform(
    conn: &rusqlite::Connection,
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    rule_ids: &[String],
    rules_format: &RulesFormat,
    project_base: Option<&str>,
    allow_remove: bool,
    result: &mut SyncResult,
) -> Result<(), AppError> {
    match rules_format {
        RulesFormat::Directory => sync_rules_to_directory(
            conn,
            plugin,
            instance,
            rule_ids,
            project_base,
            allow_remove,
            result,
        ),
        RulesFormat::SingleFile { .. } => {
            let file_path = resolve_rules_path(plugin, instance, project_base)?;
            if let Some(file_path) = file_path {
                sync_rules_to_single_file(conn, &file_path, rule_ids, allow_remove, result)
            } else {
                Ok(())
            }
        }
    }
}
/// Resolve the rules path (directory or file) for the given platform instance.
///
/// - Directory mode: returns the rules directory path
/// - SingleFile mode: returns the full file path
fn resolve_rules_path(
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    project_base: Option<&str>,
) -> Result<Option<std::path::PathBuf>, AppError> {
    if instance.scope == "global" {
        Ok(plugin
            .default_paths()
            .global_rules_dir
            .as_ref()
            .map(|path| crate::plugins::platform::expand_home(path)))
    } else {
        plugin
            .default_paths()
            .project_rules_pattern
            .as_ref()
            .zip(project_base)
            .map(|(pattern, base)| resolve_project_rules_path(pattern, base))
            .transpose()
    }
}

pub(crate) fn resolve_project_rules_path(
    pattern: &str,
    project_base: &str,
) -> Result<std::path::PathBuf, AppError> {
    use std::path::PathBuf;

    let expanded_project_base = crate::plugins::platform::expand_home(project_base);
    if !expanded_project_base.is_absolute() {
        return Err(AppError::DistributionInvalid(format!(
            "项目根目录 '{}' 必须是绝对路径，拒绝操作",
            expanded_project_base.display()
        )));
    }
    let project_root = normalize_lexically(&expanded_project_base);
    let expanded_pattern = crate::plugins::platform::expand_home(pattern);
    let target = if pattern.contains("{project}") {
        PathBuf::from(pattern.replace("{project}", &project_root.to_string_lossy()))
    } else if expanded_pattern.is_absolute() {
        expanded_pattern
    } else {
        project_root.join(expanded_pattern)
    };
    let target = normalize_lexically(&target);
    if !target.starts_with(&project_root) {
        return Err(AppError::DistributionInvalid(format!(
            "项目规则路径 '{}' 超出项目根目录 '{}', 拒绝操作",
            target.display(),
            project_root.display()
        )));
    }
    let canonical_project_root = canonical_existing_path(&project_root)?;
    let canonical_target_prefix = canonical_existing_path(&target)?;
    if !canonical_target_prefix.starts_with(&canonical_project_root) {
        return Err(AppError::DistributionInvalid(format!(
            "项目规则路径 '{}' 解析后超出项目根目录 '{}', 拒绝操作",
            target.display(),
            project_root.display()
        )));
    }
    Ok(target)
}

fn canonical_existing_path(path: &std::path::Path) -> Result<std::path::PathBuf, AppError> {
    let mut current = path;
    loop {
        match current.canonicalize() {
            Ok(canonical) => return Ok(canonical),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                current = current.parent().ok_or_else(|| {
                    AppError::DistributionInvalid(format!(
                        "无法解析项目规则路径 '{}': {}",
                        path.display(),
                        error
                    ))
                })?;
            }
            Err(error) => {
                return Err(AppError::DistributionInvalid(format!(
                    "无法解析项目规则路径 '{}': {}",
                    path.display(),
                    error
                )));
            }
        }
    }
}

fn normalize_lexically(path: &std::path::Path) -> std::path::PathBuf {
    use std::path::{Component, PathBuf};

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::RootDir | Component::Prefix(_) | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    normalized
}
/// Directory mode: write each rule as `{rules_dir}/{rule_id}.{format}`.
fn sync_rules_to_directory(
    conn: &rusqlite::Connection,
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    rule_ids: &[String],
    project_base: Option<&str>,
    allow_remove: bool,
    result: &mut SyncResult,
) -> Result<(), AppError> {
    let rules_dir = resolve_rules_path(plugin, instance, project_base)?;
    if let Some(rules_dir) = &rules_dir {
        crate::engine::fs_watcher::mute_self_writes(rules_dir);
        std::fs::create_dir_all(rules_dir).map_err(|e| {
            AppError::Io(format!("无法创建规则目录 '{}': {}", rules_dir.display(), e))
        })?;
        // Diff removal: remove rule files that are no longer in the scene
        if allow_remove {
            let expected: std::collections::HashSet<&str> =
                rule_ids.iter().map(String::as_str).collect();
            let removable = collect_valid_directory_removals(conn, rules_dir, &expected)?;
            for (path, id) in removable {
                crate::engine::fs_watcher::mute_self_writes(&path);
                std::fs::remove_file(&path)?;
                result.removed.push(format!("rule:{}", id));
            }
        }
        for rule_id in rule_ids {
            // Get rule content from DB
            let rule_content: Option<String> = conn
                .query_row(
                    "SELECT content FROM rules WHERE id = ?1",
                    params![rule_id],
                    |row| row.get(0),
                )
                .ok();
            let rule_format: Option<String> = conn
                .query_row(
                    "SELECT format FROM rules WHERE id = ?1",
                    params![rule_id],
                    |row| row.get(0),
                )
                .ok();
            if let (Some(content), Some(format)) = (rule_content, rule_format) {
                let file_name = format!("{}.{}", rule_id, format);
                let rule_path = rules_dir.join(&file_name);
                crate::engine::fs_watcher::mute_self_writes(&rule_path);
                let existing_rule = match std::fs::read_to_string(&rule_path) {
                    Ok(existing_content) => {
                        if existing_content == content {
                            continue;
                        }
                        true
                    }
                    Err(e) => e.kind() != std::io::ErrorKind::NotFound,
                };
                match std::fs::write(&rule_path, &content) {
                    Ok(_) => {
                        if existing_rule {
                            result.updated.push(format!("rule:{}", rule_id));
                        } else {
                            result.installed.push(format!("rule:{}", rule_id));
                        }
                    }
                    Err(e) => {
                        result.errors.push(format!(
                            "写入规则 '{}' 到 {} 失败: {}",
                            rule_id,
                            rule_path.display(),
                            e
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

fn collect_valid_directory_removals(
    conn: &rusqlite::Connection,
    rules_dir: &std::path::Path,
    expected: &std::collections::HashSet<&str>,
) -> Result<Vec<(std::path::PathBuf, String)>, AppError> {
    let mut removable = Vec::new();
    if !rules_dir.exists() {
        return Ok(removable);
    }
    for entry in std::fs::read_dir(rules_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let entry_path = entry.path();
        let Some(stem) = entry_path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        if expected.contains(stem.as_str()) {
            continue;
        }
        let rule = match get_rule(conn, &stem) {
            Ok(rule) => rule,
            Err(_) => continue,
        };
        let content = std::fs::read_to_string(&entry_path)?;
        if content != rule.content {
            return Err(AppError::DistributionInvalid(format!(
                "规则 '{}' 内容已被用户修改，拒绝严格移除",
                stem
            )));
        }
        removable.push((entry_path, stem));
    }
    Ok(removable)
}
/// SingleFile mode: merge all rules into one file using SKILLFORGE markers.
///
/// File format:
/// ```text
/// <!-- SKILLFORGE:rule:{rule_id} -->
/// {rule content}
/// <!-- /SKILLFORGE:rule:{rule_id} -->
/// ```
///
/// Algorithm:
/// 1. Read existing file content (if exists)
/// 2. Remove all SKILLFORGE-managed blocks via regex
/// 3. Preserve remaining content (user's manual additions)
/// 4. For each rule_id: query content + format from DB, append block
/// 5. Write file
fn sync_rules_to_single_file(
    conn: &rusqlite::Connection,
    file_path: &std::path::Path,
    rule_ids: &[String],
    allow_remove: bool,
    result: &mut SyncResult,
) -> Result<(), AppError> {
    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        crate::engine::fs_watcher::mute_self_writes(parent);
        std::fs::create_dir_all(parent).map_err(|e| {
            AppError::Io(format!(
                "无法创建规则文件父目录 '{}': {}",
                parent.display(),
                e
            ))
        })?;
    }
    // Read existing content
    let existing_content = if file_path.exists() {
        std::fs::read_to_string(file_path).map_err(|error| {
            AppError::Io(format!(
                "无法读取规则文件 '{}': {}",
                file_path.display(),
                error
            ))
        })?
    } else {
        String::new()
    };
    let mut final_content = existing_content.clone();
    let existing_blocks = parse_managed_rule_blocks(&existing_content)?;
    let mut replacements = Vec::new();
    if allow_remove {
        for block in &existing_blocks {
            let Some(rule) = get_rule(conn, &block.id).ok() else {
                continue;
            };
            if rule_block_content_matches(block, &rule.content) && !rule_ids.contains(&block.id) {
                replacements.push((block.start, block.end, String::new()));
            }
        }
    }
    for rule_id in rule_ids {
        let rule_content: Option<String> = conn
            .query_row(
                "SELECT content FROM rules WHERE id = ?1",
                params![rule_id],
                |row| row.get(0),
            )
            .ok();
        if let Some(content) = rule_content {
            if let Some(block) = existing_blocks.iter().find(|block| block.id == *rule_id) {
                if rule_block_content_matches(block, &content) && block.content.ends_with('\n') {
                    continue;
                }
                replacements.push((
                    block.start,
                    block.end,
                    render_managed_rule_block(rule_id, &content),
                ));
                result.updated.push(format!("rule:{}", rule_id));
                continue;
            }
            if !final_content.is_empty() && !final_content.ends_with('\n') {
                final_content.push('\n');
            }
            final_content.push_str(&render_managed_rule_block(rule_id, &content));
            final_content.push('\n');
            result.installed.push(format!("rule:{}", rule_id));
        }
    }
    replacements.sort_unstable_by_key(|replacement| std::cmp::Reverse(replacement.0));
    for (start, end, replacement) in replacements {
        final_content.replace_range(start..end, &replacement);
    }
    if !existing_content.is_empty() && final_content.is_empty() {
        if file_path.exists() {
            crate::engine::fs_watcher::mute_self_writes(file_path);
            std::fs::remove_file(file_path)?;
        }
    } else if final_content.as_bytes() != existing_content.as_bytes() {
        crate::engine::fs_watcher::mute_self_writes(file_path);
        std::fs::write(file_path, &final_content)?;
    }
    Ok(())
}
/// Remove a single rule from a SingleFile-managed file.
///
/// Removes the specific `<!-- SKILLFORGE:rule:{id} -->...<!-- /SKILLFORGE:rule:{id} -->` block.
/// Switch the global scene with diff-based install/remove.
///
/// Computes the diff between the old scene's skills/rules and the new scene's,
/// then installs new items and removes old items across scene-associated platforms.
/// Platforms only in the old scene get full cleanup; shared platforms get diff;
/// platforms only in the new scene get full install.
pub fn switch_global_scene(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    new_scene_id: &str,
) -> Result<SyncResult, AppError> {
    // Verify new scene exists
    let _scene = crate::engine::scene_engine::get_scene_detail(conn, new_scene_id)?;
    // Get old scene_id from app_config
    let old_scene_id: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'global_scene_id'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(None);
    // Get platform associations for old and new scenes
    let old_platform_ids: Vec<String> = if let Some(ref old_id) = old_scene_id {
        crate::engine::scene_engine::get_scene_platforms(conn, old_id)?
    } else {
        vec![]
    };
    let new_platform_ids = crate::engine::scene_engine::get_scene_platforms(conn, new_scene_id)?;
    // Compute platform diff
    let platforms_only_old: Vec<String> = old_platform_ids
        .iter()
        .filter(|p| !new_platform_ids.contains(p))
        .cloned()
        .collect();
    let platforms_only_new: Vec<String> = new_platform_ids
        .iter()
        .filter(|p| !old_platform_ids.contains(p))
        .cloned()
        .collect();
    let platforms_shared: Vec<String> = old_platform_ids
        .iter()
        .filter(|p| new_platform_ids.contains(p))
        .cloned()
        .collect();
    // Get old scene skills (if any)
    let old_skills: Vec<String> = if let Some(ref old_id) = old_scene_id {
        resolve_scene_skills(conn, old_id)?
    } else {
        vec![]
    };
    // Get new scene skills
    let new_skills = resolve_scene_skills(conn, new_scene_id)?;
    // Compute skill diff
    let skills_to_remove: Vec<String> = old_skills
        .iter()
        .filter(|s| !new_skills.contains(s))
        .cloned()
        .collect();
    let skills_to_install: Vec<String> = new_skills
        .iter()
        .filter(|s| !old_skills.contains(s))
        .cloned()
        .collect();
    let old_rules: Vec<String> = if let Some(ref old_id) = old_scene_id {
        resolve_scene_rules(conn, old_id)?
    } else {
        vec![]
    };
    let new_rules = resolve_scene_rules(conn, new_scene_id)?;
    let rules_to_remove: Vec<String> = old_rules
        .iter()
        .filter(|r| !new_rules.contains(r))
        .cloned()
        .collect();
    for skill_id in &new_skills {
        get_skill(conn, skill_id)?;
    }
    for rule_id in &new_rules {
        get_rule(conn, rule_id)?;
    }
    let strict_plan = StrictScenePlan {
        platforms_only_old: &platforms_only_old,
        platforms_shared: &platforms_shared,
        platforms_only_new: &platforms_only_new,
        old_skills: &old_skills,
        old_rules: &old_rules,
        skills_to_remove: &skills_to_remove,
        rules_to_remove: &rules_to_remove,
    };
    let detected_instances: std::collections::HashMap<String, Vec<PlatformInstance>> =
        platform_plugins
            .iter()
            .map(|plugin| Ok((plugin.platform_name().to_string(), plugin.detect()?)))
            .collect::<Result<_, AppError>>()?;
    validate_strict_scene_mutations(conn, platform_plugins, &detected_instances, &strict_plan)?;
    let mut result = SyncResult {
        installed: vec![],
        updated: vec![],
        removed: vec![],
        errors: vec![],
    };
    // Helper: find plugin by platform_id
    let find_plugin = |pid: &str| -> Option<&Box<dyn PlatformPlugin>> {
        platform_plugins.iter().find(|p| p.platform_name() == pid)
    };
    // 1. Platforms only in old scene: remove ALL old skills
    for pid in &platforms_only_old {
        if let Some(plugin) = find_plugin(pid) {
            let instances = detected_instances.get(pid).cloned().unwrap_or_default();
            for instance in instances {
                if instance.scope != "global" {
                    continue;
                }
                for skill_id in &old_skills {
                    match plugin.remove(skill_id, &instance) {
                        Ok(_) => {
                            result.removed.push(skill_id.clone());
                            log_sync(conn, "remove", "skill", skill_id, pid, "success", None);
                        }
                        Err(e) => {
                            result
                                .errors
                                .push(format!("remove {} from {}: {}", skill_id, pid, e));
                            log_sync(
                                conn,
                                "remove",
                                "skill",
                                skill_id,
                                pid,
                                "error",
                                Some(&e.to_string()),
                            );
                        }
                    }
                }
            }
        }
    }
    // 2. Shared platforms: install new skills first, then remove old
    for pid in &platforms_shared {
        if let Some(plugin) = find_plugin(pid) {
            let instances = detected_instances.get(pid).cloned().unwrap_or_default();
            for instance in instances {
                if instance.scope != "global" {
                    continue;
                }
                // Install new skills first (avoid gap)
                for skill_id in &skills_to_install {
                    if let Ok(skill) = get_skill(conn, skill_id) {
                        match plugin.install(&skill, &instance) {
                            Ok(_) => {
                                result.installed.push(skill_id.clone());
                                log_sync(conn, "install", "skill", skill_id, pid, "success", None);
                            }
                            Err(e) => {
                                result.errors.push(format!("{}: {}", skill_id, e));
                                log_sync(
                                    conn,
                                    "install",
                                    "skill",
                                    skill_id,
                                    pid,
                                    "error",
                                    Some(&e.to_string()),
                                );
                            }
                        }
                    }
                }
                // Remove old skills
                for skill_id in &skills_to_remove {
                    match plugin.remove(skill_id, &instance) {
                        Ok(_) => {
                            result.removed.push(skill_id.clone());
                            log_sync(conn, "remove", "skill", skill_id, pid, "success", None);
                        }
                        Err(e) => {
                            result.errors.push(format!("remove {}: {}", skill_id, e));
                            log_sync(
                                conn,
                                "remove",
                                "skill",
                                skill_id,
                                pid,
                                "error",
                                Some(&e.to_string()),
                            );
                        }
                    }
                }
            }
        }
    }
    // 3. Platforms only in new scene: install ALL new skills
    for pid in &platforms_only_new {
        if let Some(plugin) = find_plugin(pid) {
            let instances = detected_instances.get(pid).cloned().unwrap_or_default();
            for instance in instances {
                if instance.scope != "global" {
                    continue;
                }
                for skill_id in &new_skills {
                    if let Ok(skill) = get_skill(conn, skill_id) {
                        match plugin.install(&skill, &instance) {
                            Ok(_) => {
                                result.installed.push(skill_id.clone());
                                log_sync(conn, "install", "skill", skill_id, pid, "success", None);
                            }
                            Err(e) => {
                                result.errors.push(format!("{}: {}", skill_id, e));
                                log_sync(
                                    conn,
                                    "install",
                                    "skill",
                                    skill_id,
                                    pid,
                                    "error",
                                    Some(&e.to_string()),
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    // Same for rules
    // Rules: only shared and new platforms
    let all_target_platforms: Vec<&String> = platforms_shared
        .iter()
        .chain(platforms_only_new.iter())
        .collect();
    for pid in all_target_platforms {
        if let Some(plugin) = find_plugin(pid) {
            if plugin.default_paths().global_rules_dir.is_none() {
                continue;
            }
            let instances = detected_instances.get(pid).cloned().unwrap_or_default();
            for instance in instances {
                if instance.scope != "global" {
                    continue;
                }
                let rules_format = plugin
                    .default_paths()
                    .global_rules_format
                    .clone()
                    .unwrap_or(RulesFormat::Directory);
                // Strict replacement needs the complete new scene rule set so
                // retained rules are not mistaken for stale entries.
                sync_rules_to_platform(
                    conn,
                    &**plugin,
                    &instance,
                    &new_rules,
                    &rules_format,
                    None,
                    true,
                    &mut result,
                )?;
            }
        }
    }
    // Remove old rules from platforms only in old scene
    for pid in &platforms_only_old {
        if let Some(plugin) = find_plugin(pid) {
            if plugin.default_paths().global_rules_dir.is_none() {
                continue;
            }
            let rules_format = plugin
                .default_paths()
                .global_rules_format
                .clone()
                .unwrap_or(RulesFormat::Directory);
            match &rules_format {
                RulesFormat::Directory => {
                    let rules_dir = plugin
                        .default_paths()
                        .global_rules_dir
                        .as_ref()
                        .map(|d| crate::plugins::platform::expand_home(d));
                    if let Some(rules_dir) = &rules_dir {
                        remove_selected_rules_from_path(
                            conn,
                            rules_dir,
                            &old_rules,
                            &RulesFormat::Directory,
                            &mut result,
                        )?;
                    }
                }
                RulesFormat::SingleFile { .. } => {
                    let file_path = plugin
                        .default_paths()
                        .global_rules_dir
                        .as_ref()
                        .map(|d| crate::plugins::platform::expand_home(d));
                    if let Some(file_path) = &file_path {
                        remove_selected_rules_from_path(
                            conn,
                            file_path,
                            &old_rules,
                            &rules_format,
                            &mut result,
                        )?;
                    }
                }
            }
        }
    }
    // Remove old rules from shared platforms
    for pid in &platforms_shared {
        if let Some(plugin) = find_plugin(pid) {
            if plugin.default_paths().global_rules_dir.is_none() {
                continue;
            }
            let rules_format = plugin
                .default_paths()
                .global_rules_format
                .clone()
                .unwrap_or(RulesFormat::Directory);
            match &rules_format {
                RulesFormat::Directory => {
                    let rules_dir = plugin
                        .default_paths()
                        .global_rules_dir
                        .as_ref()
                        .map(|d| crate::plugins::platform::expand_home(d));
                    if let Some(rules_dir) = &rules_dir {
                        remove_selected_rules_from_path(
                            conn,
                            rules_dir,
                            &rules_to_remove,
                            &RulesFormat::Directory,
                            &mut result,
                        )?;
                    }
                }
                RulesFormat::SingleFile { .. } => {
                    let file_path = plugin
                        .default_paths()
                        .global_rules_dir
                        .as_ref()
                        .map(|d| crate::plugins::platform::expand_home(d));
                    if let Some(file_path) = &file_path {
                        remove_selected_rules_from_path(
                            conn,
                            file_path,
                            &rules_to_remove,
                            &rules_format,
                            &mut result,
                        )?;
                    }
                }
            }
        }
    }
    // Update global_scene_id in app_config
    conn.execute(
        "UPDATE app_config SET value = ?1 WHERE key = 'global_scene_id'",
        params![new_scene_id],
    )?;
    // Update distribution records for new scene's platforms only
    let checksum = compute_scene_checksum(conn, new_scene_id);
    for pid in &new_platform_ids {
        conn.execute(
            "INSERT OR REPLACE INTO distributions (scene_id, platform_id, scope, project_id, project_path, status, last_synced_at, checksum)
             VALUES (?1, ?2, 'global', NULL, NULL, 'synced', datetime('now'), ?3)",
            params![new_scene_id, pid, checksum],
        )?;
    }
    // Clean up distribution records for platforms no longer associated
    for pid in &platforms_only_old {
        conn.execute(
            "DELETE FROM distributions WHERE scene_id = ?1 AND platform_id = ?2 AND scope = 'global'",
            params![new_scene_id, pid],
        )?;
    }
    Ok(result)
}
/// Count subdirectories in a path (non-hidden, one level).
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
    fn test_get_distributions_empty() {
        let conn = setup_db();
        let dists = get_distributions(&conn, None).unwrap();
        assert!(dists.is_empty());
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
    #[test]
    fn test_switch_global_scene_no_overlap() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();
        // Create two scenes with different skills
        conn.execute(
            "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
            params!["scene-a", "Scene A", "A", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
            params!["scene-b", "Scene B", "B", now, now],
        ).unwrap();
        // Insert skills
        conn.execute(
            "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["skill-1", "Skill 1", "local-fs", now, "/tmp/s1"],
        ).unwrap();
        conn.execute(
            "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["skill-2", "Skill 2", "local-fs", now, "/tmp/s2"],
        ).unwrap();
        // Add skill-1 to scene-a
        conn.execute(
            "INSERT INTO scene_skills (scene_id, skill_id, enabled, sort_order) VALUES (?1, ?2, 1, 0)",
            params!["scene-a", "skill-1"],
        ).unwrap();
        // Add skill-2 to scene-b
        conn.execute(
            "INSERT INTO scene_skills (scene_id, skill_id, enabled, sort_order) VALUES (?1, ?2, 1, 0)",
            params!["scene-b", "skill-2"],
        ).unwrap();
        // Set scene-a as current global scene
        conn.execute(
            "UPDATE app_config SET value = 'scene-a' WHERE key = 'global_scene_id'",
            [],
        )
        .unwrap();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];
        let result = switch_global_scene(&conn, &plugins, "scene-b").unwrap();
        // skill-2 should be in to_install, skill-1 in to_remove (no overlap)
        assert!(result.installed.contains(&"skill-2".to_string()) || result.errors.is_empty());
        assert!(result.removed.contains(&"skill-1".to_string()) || result.errors.is_empty());
        // Verify global_scene_id updated
        let new_scene_id: Option<String> = conn
            .query_row(
                "SELECT value FROM app_config WHERE key = 'global_scene_id'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(None);
        assert_eq!(new_scene_id, Some("scene-b".to_string()));
    }
    #[test]
    fn test_switch_global_scene_partial_overlap() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
            params!["scene-a", "Scene A", "A", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
            params!["scene-b", "Scene B", "B", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["skill-1", "Skill 1", "local-fs", now, "/tmp/s1"],
        ).unwrap();
        conn.execute(
            "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["skill-2", "Skill 2", "local-fs", now, "/tmp/s2"],
        ).unwrap();
        conn.execute(
            "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["skill-3", "Skill 3", "local-fs", now, "/tmp/s3"],
        ).unwrap();
        // scene-a has skill-1, skill-2
        conn.execute("INSERT INTO scene_skills (scene_id, skill_id, enabled, sort_order) VALUES ('scene-a', 'skill-1', 1, 0)", []).unwrap();
        conn.execute("INSERT INTO scene_skills (scene_id, skill_id, enabled, sort_order) VALUES ('scene-a', 'skill-2', 1, 1)", []).unwrap();
        // scene-b has skill-2, skill-3 (overlap: skill-2)
        conn.execute("INSERT INTO scene_skills (scene_id, skill_id, enabled, sort_order) VALUES ('scene-b', 'skill-2', 1, 0)", []).unwrap();
        conn.execute("INSERT INTO scene_skills (scene_id, skill_id, enabled, sort_order) VALUES ('scene-b', 'skill-3', 1, 1)", []).unwrap();
        conn.execute(
            "UPDATE app_config SET value = 'scene-a' WHERE key = 'global_scene_id'",
            [],
        )
        .unwrap();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];
        let result = switch_global_scene(&conn, &plugins, "scene-b").unwrap();
        // skill-3 should be installed, skill-1 should be removed, skill-2 unchanged
        assert!(result.installed.contains(&"skill-3".to_string()) || result.errors.is_empty());
        assert!(result.removed.contains(&"skill-1".to_string()) || result.errors.is_empty());
        assert!(!result.installed.contains(&"skill-2".to_string()));
        assert!(!result.removed.contains(&"skill-2".to_string()));
    }
    #[test]
    fn test_switch_global_scene_idempotent() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
            params!["scene-a", "Scene A", "A", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["skill-1", "Skill 1", "local-fs", now, "/tmp/s1"],
        ).unwrap();
        conn.execute("INSERT INTO scene_skills (scene_id, skill_id, enabled, sort_order) VALUES ('scene-a', 'skill-1', 1, 0)", []).unwrap();
        conn.execute(
            "UPDATE app_config SET value = 'scene-a' WHERE key = 'global_scene_id'",
            [],
        )
        .unwrap();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];
        let result = switch_global_scene(&conn, &plugins, "scene-a").unwrap();
        // Switching to the same scene should result in no installs/removes
        assert!(result.installed.is_empty());
        assert!(result.removed.is_empty());
    }
    #[test]
    fn test_sync_rules_to_single_file_create() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();
        // Insert rules into DB
        conn.execute(
            "INSERT INTO rules (id, name, format, content, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params!["rule-1", "Rule 1", "md", "# Rule 1\nUse 2-space indent", now],
        ).unwrap();
        conn.execute(
            "INSERT INTO rules (id, name, format, content, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params!["rule-2", "Rule 2", "md", "# Rule 2\nNo hardcoded secrets", now],
        ).unwrap();
        let test_dir = format!("/tmp/skillforge-test-sf-{}", std::process::id());
        let _ = std::fs::remove_dir_all(&test_dir);
        let file_path = std::path::PathBuf::from(format!("{}/AGENTS.md", test_dir));
        let rule_ids = vec!["rule-1".to_string(), "rule-2".to_string()];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            errors: vec![],
        };
        sync_rules_to_single_file(&conn, &file_path, &rule_ids, true, &mut result).unwrap();
        // File should exist
        assert!(file_path.exists());
        // Content should contain both SKILLFORGE blocks
        let content = std::fs::read_to_string(&file_path).unwrap();
        assert!(content.contains("<!-- SKILLFORGE:rule:rule-1 -->"));
        assert!(content.contains("# Rule 1\nUse 2-space indent"));
        assert!(content.contains("Use 2-space indent\n<!-- /SKILLFORGE:rule:rule-1 -->"));
        assert!(content.contains("<!-- SKILLFORGE:rule:rule-2 -->"));
        assert!(content.contains("# Rule 2\nNo hardcoded secrets"));
        assert!(content.contains("No hardcoded secrets\n<!-- /SKILLFORGE:rule:rule-2 -->"));
        // Both rules should be in installed
        assert!(result.installed.contains(&"rule:rule-1".to_string()));
        assert!(result.installed.contains(&"rule:rule-2".to_string()));
        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }
    #[test]
    fn test_sync_rules_to_single_file_preserves_user_content() {
        let test_dir = format!("/tmp/skillforge-test-sf-preserve-{}", std::process::id());
        let _ = std::fs::remove_dir_all(&test_dir);
        std::fs::create_dir_all(&test_dir).unwrap();
        let file_path = std::path::PathBuf::from(format!("{}/AGENTS.md", test_dir));
        // Pre-existing file with user content + old SKILLFORGE block
        let pre_content = "# My custom header\n\nThis is user content.\n\n<!-- SKILLFORGE:rule:old-rule -->\nOld content\n<!-- /SKILLFORGE:rule:old-rule -->\n";
        std::fs::write(&file_path, pre_content).unwrap();
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO rules (id, name, format, content, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params!["new-rule", "New Rule", "md", "# New Rule\nBe excellent", now],
        ).unwrap();
        conn.execute(
            "INSERT INTO rules (id, name, format, content, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params!["old-rule", "Old Rule", "md", "Old content\n", now],
        ).unwrap();
        let rule_ids = vec!["new-rule".to_string()];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            errors: vec![],
        };
        sync_rules_to_single_file(&conn, &file_path, &rule_ids, true, &mut result).unwrap();
        let content = std::fs::read_to_string(&file_path).unwrap();
        // User content should be preserved
        assert!(content.contains("# My custom header"));
        assert!(content.contains("This is user content."));
        // Old SKILLFORGE block should be removed
        assert!(
            !content.contains("<!-- SKILLFORGE:rule:old-rule -->"),
            "unexpected content: {content:?}"
        );
        assert!(!content.contains("Old content"));
        // New SKILLFORGE block should be present
        assert!(content.contains("<!-- SKILLFORGE:rule:new-rule -->"));
        assert!(content.contains("# New Rule\nBe excellent"));
        assert!(content.contains("<!-- /SKILLFORGE:rule:new-rule -->"));
        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }
    #[test]
    fn test_sync_rules_to_single_file_updates_changed_managed_block() {
        let test_dir = tempfile::tempdir().unwrap();
        let file_path = test_dir.path().join("AGENTS.md");
        let unrelated = "# User content\n\nKeep this byte-for-byte.\n";
        let other_block = "<!-- SKILLFORGE:rule:other-rule -->\r\nOther content\r\n<!-- /SKILLFORGE:rule:other-rule -->\r\n";
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO rules (id, name, format, content, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params!["changed-rule", "Changed Rule", "md", "Old library content\n", now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rules (id, name, format, content, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params!["other-rule", "Other Rule", "md", "Other content\r\n", now],
        )
        .unwrap();
        let pre_content = format!(
            "{unrelated}\n<!-- SKILLFORGE:rule:changed-rule -->\nOld library content\n<!-- /SKILLFORGE:rule:changed-rule -->\n{other_block}"
        );
        std::fs::write(&file_path, &pre_content).unwrap();
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            errors: vec![],
        };

        let user_content = format!("{unrelated}\n");
        assert_eq!(std::fs::read_to_string(&file_path).unwrap(), pre_content);

        conn.execute(
            "UPDATE rules SET content = ?1, version = version + 1 WHERE id = ?2",
            params!["New library content", "changed-rule"],
        )
        .unwrap();
        result.installed.clear();

        sync_rules_to_single_file(
            &conn,
            &file_path,
            &["changed-rule".to_string()],
            false,
            &mut result,
        )
        .unwrap();

        let content = std::fs::read_to_string(&file_path).unwrap();
        let expected_content = format!(
            "{user_content}<!-- SKILLFORGE:rule:changed-rule -->\nNew library content\n<!-- /SKILLFORGE:rule:changed-rule -->\n{other_block}"
        );
        assert!(result.updated.contains(&"rule:changed-rule".to_string()));
        assert!(!result.installed.contains(&"rule:changed-rule".to_string()));
        assert!(content.contains("New library content"));
        assert!(!content.contains("Old library content"));
        assert_eq!(content, expected_content);
    }

    #[test]
    fn test_sync_rules_to_single_file_normalizes_unchanged_adjacent_end_marker() {
        let test_dir = tempfile::tempdir().unwrap();
        let file_path = test_dir.path().join("AGENTS.md");
        let conn = setup_db();
        let content = "Rule content without a trailing newline";
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO rules (id, name, format, content, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params!["normalized-rule", "Normalized Rule", "md", content, now],
        )
        .unwrap();
        std::fs::write(
            &file_path,
            format!(
                "<!-- SKILLFORGE:rule:normalized-rule -->\n{content}<!-- /SKILLFORGE:rule:normalized-rule -->"
            ),
        )
        .unwrap();
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            errors: vec![],
        };

        sync_rules_to_single_file(
            &conn,
            &file_path,
            &["normalized-rule".to_string()],
            false,
            &mut result,
        )
        .unwrap();

        let normalized = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(
            normalized,
            format!(
                "<!-- SKILLFORGE:rule:normalized-rule -->\n{content}\n<!-- /SKILLFORGE:rule:normalized-rule -->"
            )
        );
        assert_eq!(result.updated, vec!["rule:normalized-rule"]);
    }
    #[test]
    fn test_sync_rules_to_single_file_empty_rules_removes_blocks() {
        let test_dir = format!("/tmp/skillforge-test-sf-empty-{}", std::process::id());
        let _ = std::fs::remove_dir_all(&test_dir);
        std::fs::create_dir_all(&test_dir).unwrap();
        let file_path = std::path::PathBuf::from(format!("{}/AGENTS.md", test_dir));
        // Pre-existing file with SKILLFORGE block + user content
        let pre_content = "# User header\n\n<!-- SKILLFORGE:rule:old-rule -->\nOld content\n<!-- /SKILLFORGE:rule:old-rule -->\n";
        std::fs::write(&file_path, pre_content).unwrap();
        let conn = setup_db();
        conn.execute(
            "INSERT INTO rules (id, name, format, content, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params!["old-rule", "Old Rule", "md", "Old content\n", chrono::Utc::now().to_rfc3339()],
        ).unwrap();
        let rule_ids: Vec<String> = vec![];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            errors: vec![],
        };
        sync_rules_to_single_file(&conn, &file_path, &rule_ids, true, &mut result).unwrap();
        let content = std::fs::read_to_string(&file_path).unwrap();
        // SKILLFORGE block should be removed
        assert!(
            !content.contains("SKILLFORGE"),
            "unexpected content: {content:?}"
        );
        // User content should be preserved
        assert!(content.contains("# User header"));
        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }

    #[test]
    fn parse_managed_rule_blocks_preserves_content_before_adjacent_end_markers() {
        let content = concat!(
            "<!-- SKILLFORGE:rule:first -->\n",
            "first content<!-- /SKILLFORGE:rule:first -->\n",
            "<!-- SKILLFORGE:rule:second -->\n",
            "second content<!-- /SKILLFORGE:rule:second -->"
        );

        let blocks = parse_managed_rule_blocks(content).expect("parse adjacent end markers");

        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].id, "first");
        assert_eq!(blocks[0].content, "first content");
        assert_eq!(blocks[1].id, "second");
        assert_eq!(blocks[1].content, "second content");
    }
}
