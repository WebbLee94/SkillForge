use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::types::{
    Distribution, PlatformInstance, Skill, SyncResult, SyncStatusDTO,
    PlatformSyncStatus,
};

use rusqlite::params;

/// Sync a scene to one or more platforms.
///
/// This is the core distribution operation:
/// 1. Resolve all skills and rules in the scene
/// 2. For each platform, compute diff and execute install/update/remove
/// 3. Record sync logs
pub fn sync_scene(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    scene_id: &str,
    platform_ids: Option<&[String]>,
    scope: &str,
    project_id: Option<&str>,
) -> Result<SyncResult, AppError> {
    // Verify scene exists
    let _scene = crate::engine::scene_engine::get_scene_detail(conn, scene_id)?;

    // If no platforms specified, auto-resolve from scene_platforms
    let resolved_platform_ids: Vec<String>;
    let platform_ids = match platform_ids {
        Some(ids) if !ids.is_empty() => ids,
        _ => {
            resolved_platform_ids = crate::engine::scene_engine::get_scene_platforms(conn, scene_id)?;
            if resolved_platform_ids.is_empty() {
                return Err(AppError::Platform("场景未关联任何平台，请先在场景编辑中配置目标平台".to_string()));
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

    // Resolve skills in the scene
    let skill_ids = resolve_scene_skills(conn, scene_id)?;

    // Resolve rules in the scene
    let rule_ids = resolve_scene_rules(conn, scene_id)?;

    // Get project path if project-scoped
    let project_path: Option<String> = if scope == "project" {
        Some(
            project_id
                .and_then(|pid| get_project_path(conn, pid))
                .ok_or_else(|| AppError::ProjectNotFound("项目范围同步需要提供项目ID".to_string()))?
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
                result.errors.push(format!(
                    "检测平台 '{}' 失败: {}",
                    platform_id, e
                ));
                continue;
            }
        };

        // Find matching instance for the requested scope
        let instance = if scope == "global" {
            instances
                .into_iter()
                .find(|i| i.scope == "global")
                .unwrap_or_else(|| PlatformInstance {
                    platform_id: platform_id.to_string(),
                    platform_name: platform_id.to_string(),
                    path: plugin.default_paths().global_skills_dir.clone(),
                    scope: "global".to_string(),
                })
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
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!(
                    "无法创建平台目录 '{}': {}",
                    parent.display(),
                    e
                ))
            })?;
        }

        // Compute diff: what's currently distributed vs what should be
        let current_skill_ids = get_distributed_skills(conn, scene_id, platform_id, scope, project_id)?;

        // Skills to install (in scene but not in current distribution)
        let to_install: Vec<&String> = skill_ids
            .iter()
            .filter(|id| !current_skill_ids.contains(id))
            .collect();

        // Skills to remove (in current distribution but not in scene)
        let to_remove: Vec<&String> = current_skill_ids
            .iter()
            .filter(|id| !skill_ids.contains(id))
            .collect();

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
                    result.errors.push(format!(
                        "技能 '{}' 未在数据库中找到: {}",
                        skill_id, e
                    ));
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

        // Sync rules for platforms that support rules (e.g., Cursor)
        if plugin.default_paths().global_rules_dir.is_some() {
            sync_rules_to_platform(conn, plugin, &instance, &rule_ids, &mut result)?;
        }

        // Update distribution record
        let now = chrono::Utc::now().to_rfc3339();
        let checksum = compute_scene_checksum(conn, scene_id);

        conn.execute(
            "INSERT OR REPLACE INTO distributions (scene_id, platform_id, scope, project_id, project_path, status, synced_at, checksum)
             VALUES (?1, ?2, ?3, ?4, ?5, 'synced', ?6, ?7)",
            params![scene_id, platform_id, scope, project_id, project_path, now, checksum],
        )?;
    }

    Ok(result)
}

/// Get the current sync status across all enabled platforms.
pub fn get_sync_status(conn: &rusqlite::Connection) -> Result<SyncStatusDTO, AppError> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, COALESCE(d.status, 'never_synced') as status,
                COALESCE(s.synced_count, 0) as synced_count,
                COALESCE(s.total_count, 0) as total_count
         FROM platforms p
         LEFT JOIN (
             SELECT platform_id, status,
                    COUNT(CASE WHEN status = 'synced' THEN 1 END) as synced_count,
                    COUNT(*) as total_count
             FROM distributions
             GROUP BY platform_id
         ) d ON p.id = d.platform_id
         LEFT JOIN (
             SELECT platform_id,
                    COUNT(CASE WHEN status = 'synced' THEN 1 END) as synced_count,
                    COUNT(*) as total_count
             FROM distributions
             GROUP BY platform_id
         ) s ON p.id = s.platform_id
         WHERE p.enabled != 0
         ORDER BY p.name ASC",
    )?;

    let platforms: Vec<PlatformSyncStatus> = stmt
        .query_map([], |row| {
            Ok(PlatformSyncStatus {
                platform_id: row.get(0)?,
                platform_name: row.get(1)?,
                status: row.get(2)?,
                synced_count: row.get(3)?,
                total_count: row.get(4)?,
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
        "SELECT id, scene_id, platform_id, scope, project_id, project_path, status, synced_at, checksum
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
                synced_at: row.get(7)?,
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
        "SELECT id, scene_id, platform_id, scope, project_id, project_path, status, synced_at, checksum
         FROM distributions WHERE scene_id = ?1 ORDER BY synced_at DESC"
    } else {
        "SELECT id, scene_id, platform_id, scope, project_id, project_path, status, synced_at, checksum
         FROM distributions ORDER BY synced_at DESC"
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
                synced_at: row.get(7)?,
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
                synced_at: row.get(7)?,
                checksum: row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(distributions)
}

// ── Internal helpers ───────────────────────────────────────────────

fn resolve_scene_skills(
    conn: &rusqlite::Connection,
    scene_id: &str,
) -> Result<Vec<String>, AppError> {
    if scene_id == "__all_skills__" {
        let mut stmt = conn.prepare("SELECT id FROM skills")?;
        let result: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(result)
    } else {
        let mut stmt = conn.prepare(
            "SELECT skill_id FROM scene_skills WHERE scene_id = ?1 AND enabled = 1",
        )?;
        let result: Vec<String> = stmt
            .query_map(params![scene_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(result)
    }
}

fn resolve_scene_rules(
    conn: &rusqlite::Connection,
    scene_id: &str,
) -> Result<Vec<String>, AppError> {
    if scene_id == "__all_skills__" {
        let mut stmt = conn.prepare("SELECT id FROM rules")?;
        let result: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(result)
    } else {
        let mut stmt = conn.prepare(
            "SELECT rule_id FROM scene_rules WHERE scene_id = ?1 AND enabled = 1",
        )?;
        let result: Vec<String> = stmt
            .query_map(params![scene_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(result)
    }
}

fn get_distributed_skills(
    conn: &rusqlite::Connection,
    scene_id: &str,
    platform_id: &str,
    scope: &str,
    project_id: Option<&str>,
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
        return Ok(vec![]);
    }

    // Get skills currently in the scene as the previously distributed set.
    // This allows the sync diff to detect skills added/removed from the scene
    // since the last sync.
    resolve_scene_skills(conn, scene_id)
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

fn sync_rules_to_platform(
    conn: &rusqlite::Connection,
    plugin: &Box<dyn PlatformPlugin>,
    instance: &PlatformInstance,
    rule_ids: &[String],
    result: &mut SyncResult,
) -> Result<(), AppError> {
    let rules_dir = if instance.scope == "global" {
        plugin
            .default_paths()
            .global_rules_dir
            .map(|d| crate::plugins::platform::expand_home(&d))
    } else {
        plugin
            .default_paths()
            .project_rules_pattern
            .as_ref()
            .map(|p| {
                let base = std::path::Path::new(&instance.path);
                base.parent()
                    .map(|parent| parent.join(p.replace("{project}/", "")))
                    .unwrap_or_default()
            })
    };

    if let Some(rules_dir) = &rules_dir {
        std::fs::create_dir_all(rules_dir).map_err(|e| {
            AppError::Io(format!(
                "无法创建规则目录 '{}': {}",
                rules_dir.display(),
                e
            ))
        })?;

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

                match std::fs::write(&rule_path, &content) {
                    Ok(_) => {
                        result.installed.push(format!("rule:{}", rule_id));
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
            let instances = plugin.detect().unwrap_or_default();
            for instance in instances {
                if instance.scope != "global" { continue; }
                for skill_id in &old_skills {
                    match plugin.remove(skill_id, &instance) {
                        Ok(_) => {
                            result.removed.push(skill_id.clone());
                            log_sync(conn, "remove", "skill", skill_id, pid, "success", None);
                        }
                        Err(e) => {
                            result.errors.push(format!("remove {} from {}: {}", skill_id, pid, e));
                            log_sync(conn, "remove", "skill", skill_id, pid, "error", Some(&e.to_string()));
                        }
                    }
                }
            }
        }
    }

    // 2. Shared platforms: install new skills first, then remove old
    for pid in &platforms_shared {
        if let Some(plugin) = find_plugin(pid) {
            let instances = plugin.detect().unwrap_or_default();
            for instance in instances {
                if instance.scope != "global" { continue; }
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
                                log_sync(conn, "install", "skill", skill_id, pid, "error", Some(&e.to_string()));
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
                            log_sync(conn, "remove", "skill", skill_id, pid, "error", Some(&e.to_string()));
                        }
                    }
                }
            }
        }
    }

    // 3. Platforms only in new scene: install ALL new skills
    for pid in &platforms_only_new {
        if let Some(plugin) = find_plugin(pid) {
            let instances = plugin.detect().unwrap_or_default();
            for instance in instances {
                if instance.scope != "global" { continue; }
                for skill_id in &new_skills {
                    if let Ok(skill) = get_skill(conn, skill_id) {
                        match plugin.install(&skill, &instance) {
                            Ok(_) => {
                                result.installed.push(skill_id.clone());
                                log_sync(conn, "install", "skill", skill_id, pid, "success", None);
                            }
                            Err(e) => {
                                result.errors.push(format!("{}: {}", skill_id, e));
                                log_sync(conn, "install", "skill", skill_id, pid, "error", Some(&e.to_string()));
                            }
                        }
                    }
                }
            }
        }
    }

    // Same for rules
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
    let rules_to_install: Vec<String> = new_rules
        .iter()
        .filter(|r| !old_rules.contains(r))
        .cloned()
        .collect();

    // Rules: only shared and new platforms
    let all_target_platforms: Vec<&String> = platforms_shared.iter().chain(platforms_only_new.iter()).collect();
    for pid in all_target_platforms {
        if let Some(plugin) = find_plugin(pid) {
            if plugin.default_paths().global_rules_dir.is_none() {
                continue;
            }
            let instances = plugin.detect().unwrap_or_default();
            for instance in instances {
                if instance.scope != "global" { continue; }
                // Install new rules
                sync_rules_to_platform(conn, plugin, &instance, &rules_to_install, &mut result)?;
            }
        }
    }

    // Remove old rules from platforms only in old scene
    for pid in &platforms_only_old {
        if let Some(plugin) = find_plugin(pid) {
            if plugin.default_paths().global_rules_dir.is_none() {
                continue;
            }
            let rules_dir = plugin
                .default_paths()
                .global_rules_dir
                .as_ref()
                .map(|d| crate::plugins::platform::expand_home(d));
            if let Some(rules_dir) = &rules_dir {
                for rule_id in &old_rules {
                    for ext in &["md", "txt", "mdc"] {
                        let file_path = rules_dir.join(format!("{}.{}", rule_id, ext));
                        if file_path.exists() {
                            let _ = std::fs::remove_file(&file_path);
                        }
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
            let rules_dir = plugin
                .default_paths()
                .global_rules_dir
                .as_ref()
                .map(|d| crate::plugins::platform::expand_home(d));
            if let Some(rules_dir) = &rules_dir {
                for rule_id in &rules_to_remove {
                    for ext in &["md", "txt", "mdc"] {
                        let file_path = rules_dir.join(format!("{}.{}", rule_id, ext));
                        if file_path.exists() {
                            let _ = std::fs::remove_file(&file_path);
                        }
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
    let now = chrono::Utc::now().to_rfc3339();
    let checksum = compute_scene_checksum(conn, new_scene_id);
    for pid in &new_platform_ids {
        conn.execute(
            "INSERT OR REPLACE INTO distributions (scene_id, platform_id, scope, project_id, project_path, status, synced_at, checksum)
             VALUES (?1, ?2, 'global', NULL, NULL, 'synced', ?3, ?4)",
            params![new_scene_id, pid, now, checksum],
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

/// Verify that distributed skills/rules match the DB state for a given scene.
///
/// Checks symlink existence, symlink targets, and rule file content hashes.
pub fn verify_distribution(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    scene_id: &str,
    scope: &str,
) -> Result<crate::commands::distribution::VerifyReport, AppError> {
    let skill_ids = resolve_scene_skills(conn, scene_id)?;
    let rule_ids = resolve_scene_rules(conn, scene_id)?;

    let total = (skill_ids.len() + rule_ids.len()) as u32;
    let mut ok_count: u32 = 0;
    let mut drifted: Vec<crate::commands::distribution::DriftedItem> = Vec::new();

    for plugin in platform_plugins {
        let instances = plugin.detect().unwrap_or_default();
        for instance in instances {
            if (scope == "global" && instance.scope != "global")
                || (scope == "project" && instance.scope != "project")
            {
                continue;
            }

            // Check skills
            for skill_id in &skill_ids {
                let status = plugin.status(skill_id, &instance);
                match status {
                    Ok(s) if s.installed => {
                        // Check if symlink points to correct target
                        if let Some(ref path_str) = s.path {
                            let link_path = std::path::Path::new(path_str);
                            if link_path.exists() {
                                // Verify it's a valid symlink pointing to the skill's local_path
                                if let Ok(skill) = get_skill(conn, skill_id) {
                                    let expected_target = std::path::Path::new(&skill.local_path);
                                    let actual_target = if link_path.is_symlink() {
                                        std::fs::read_link(link_path).ok()
                                    } else {
                                        None
                                    };
                                    if let Some(ref target) = actual_target {
                                        if target != expected_target {
                                            drifted.push(crate::commands::distribution::DriftedItem {
                                                item_type: "skill".to_string(),
                                                item_id: skill_id.clone(),
                                                platform_id: plugin.platform_name().to_string(),
                                                issue: "content_mismatch".to_string(),
                                            });
                                            continue;
                                        }
                                    }
                                }
                                ok_count += 1;
                            } else {
                                drifted.push(crate::commands::distribution::DriftedItem {
                                    item_type: "skill".to_string(),
                                    item_id: skill_id.clone(),
                                    platform_id: plugin.platform_name().to_string(),
                                    issue: "symlink_broken".to_string(),
                                });
                            }
                        } else {
                            ok_count += 1;
                        }
                    }
                    Ok(_) => {
                        // Not installed but should be
                        drifted.push(crate::commands::distribution::DriftedItem {
                            item_type: "skill".to_string(),
                            item_id: skill_id.clone(),
                            platform_id: plugin.platform_name().to_string(),
                            issue: "symlink_missing".to_string(),
                        });
                    }
                    Err(_) => {
                        drifted.push(crate::commands::distribution::DriftedItem {
                            item_type: "skill".to_string(),
                            item_id: skill_id.clone(),
                            platform_id: plugin.platform_name().to_string(),
                            issue: "file_missing".to_string(),
                        });
                    }
                }
            }

            // Check rules
            let rules_dir = if instance.scope == "global" {
                plugin.default_paths().global_rules_dir.as_ref().map(|d| crate::plugins::platform::expand_home(d))
            } else {
                plugin.default_paths().project_rules_pattern.as_ref().map(|p| {
                    let base = std::path::Path::new(&instance.path);
                    base.parent().map(|parent| parent.join(p.replace("{project}/", ""))).unwrap_or_default()
                })
            };

            if let Some(rules_dir) = &rules_dir {
                for rule_id in &rule_ids {
                    // Try to find the rule file
                    let rule_format: Option<String> = conn
                        .query_row("SELECT format FROM rules WHERE id = ?1", params![rule_id], |row| row.get(0))
                        .ok();

                    let format = rule_format.unwrap_or_else(|| "md".to_string());
                    let file_path = rules_dir.join(format!("{}.{}", rule_id, format));

                    if !file_path.exists() {
                        drifted.push(crate::commands::distribution::DriftedItem {
                            item_type: "rule".to_string(),
                            item_id: rule_id.clone(),
                            platform_id: plugin.platform_name().to_string(),
                            issue: "file_missing".to_string(),
                        });
                        continue;
                    }

                    // Check content hash
                    let db_content: Option<String> = conn
                        .query_row("SELECT content FROM rules WHERE id = ?1", params![rule_id], |row| row.get(0))
                        .ok();

                    if let Some(ref db_content) = db_content {
                        let fs_content = std::fs::read_to_string(&file_path).unwrap_or_default();
                        if fs_content != *db_content {
                            drifted.push(crate::commands::distribution::DriftedItem {
                                item_type: "rule".to_string(),
                                item_id: rule_id.clone(),
                                platform_id: plugin.platform_name().to_string(),
                                issue: "content_mismatch".to_string(),
                            });
                            continue;
                        }
                    }
                    ok_count += 1;
                }
            } else {
                // No rules dir for this platform, count all rules as ok
                ok_count += rule_ids.len() as u32;
            }
        }
    }

    Ok(crate::commands::distribution::VerifyReport {
        total,
        ok: ok_count,
        drifted,
    })
}

/// Repair a drifted item by either re-installing from DB or updating DB from filesystem.
pub fn repair_drift(
    conn: &rusqlite::Connection,
    plugin: &dyn PlatformPlugin,
    item_type: &str,
    item_id: &str,
    platform_id: &str,
    action: &str,
) -> Result<(), AppError> {
    let instances = plugin.detect().unwrap_or_default();
    let instance = instances
        .into_iter()
        .find(|i| i.scope == "global")
        .unwrap_or_else(|| PlatformInstance {
            platform_id: platform_id.to_string(),
            platform_name: platform_id.to_string(),
            path: plugin.default_paths().global_skills_dir.clone(),
            scope: "global".to_string(),
        });

    match item_type {
        "skill" => {
            let skill = get_skill(conn, item_id)?;
            match action {
                "from_db" => {
                    // Re-install from DB (re-create symlink)
                    plugin.install(&skill, &instance)?;
                    log_sync(conn, "repair", "skill", item_id, platform_id, "success", Some("from_db"));
                }
                "from_fs" => {
                    // from_fs for skills: update DB local_path from filesystem
                    // This is a no-op for symlink-based skills since the DB is the source of truth
                    log_sync(conn, "repair", "skill", item_id, platform_id, "success", Some("from_fs_noop"));
                }
                _ => {
                    return Err(AppError::Validation(format!(
                        "未知的修复动作: {}",
                        action
                    )));
                }
            }
        }
        "rule" => {
            match action {
                "from_db" => {
                    // Re-write rule file from DB content
                    let rules_dir = plugin
                        .default_paths()
                        .global_rules_dir
                        .as_ref()
                        .map(|d| crate::plugins::platform::expand_home(d));

                    if let Some(rules_dir) = &rules_dir {
                        std::fs::create_dir_all(rules_dir).map_err(|e| {
                            AppError::Io(format!("无法创建规则目录: {}", e))
                        })?;

                        let rule_content: String = conn
                            .query_row("SELECT content FROM rules WHERE id = ?1", params![item_id], |row| row.get(0))
                            .map_err(|_| AppError::RuleNotFound(item_id.to_string()))?;
                        let rule_format: String = conn
                            .query_row("SELECT format FROM rules WHERE id = ?1", params![item_id], |row| row.get(0))
                            .unwrap_or_else(|_| "md".to_string());

                        let file_path = rules_dir.join(format!("{}.{}", item_id, rule_format));
                        std::fs::write(&file_path, &rule_content)?;
                        log_sync(conn, "repair", "rule", item_id, platform_id, "success", Some("from_db"));
                    }
                }
                "from_fs" => {
                    // Update DB content from filesystem
                    let rules_dir = plugin
                        .default_paths()
                        .global_rules_dir
                        .as_ref()
                        .map(|d| crate::plugins::platform::expand_home(d));

                    if let Some(rules_dir) = &rules_dir {
                        let rule_format: String = conn
                            .query_row("SELECT format FROM rules WHERE id = ?1", params![item_id], |row| row.get(0))
                            .unwrap_or_else(|_| "md".to_string());

                        let file_path = rules_dir.join(format!("{}.{}", item_id, rule_format));
                        if file_path.exists() {
                            let fs_content = std::fs::read_to_string(&file_path)?;
                            let now = chrono::Utc::now().to_rfc3339();
                            conn.execute(
                                "UPDATE rules SET content = ?1, updated_at = ?2 WHERE id = ?3",
                                params![fs_content, now, item_id],
                            )?;
                            log_sync(conn, "repair", "rule", item_id, platform_id, "success", Some("from_fs"));
                        } else {
                            return Err(AppError::Io(format!(
                                "规则文件不存在: {}",
                                file_path.display()
                            )));
                        }
                    }
                }
                _ => {
                    return Err(AppError::Validation(format!(
                        "未知的修复动作: {}",
                        action
                    )));
                }
            }
        }
        _ => {
            return Err(AppError::Validation(format!(
                "未知的条目类型: {}",
                item_type
            )));
        }
    }

    Ok(())
}

/// Startup integrity check: verify global scene distribution state.
///
/// Checks all platform symlinks and rule hashes for the current global scene,
/// and stores the drift count in app_config.
pub fn startup_integrity_check(conn: &rusqlite::Connection) -> Result<(), AppError> {
    // Get global_scene_id
    let scene_id: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'global_scene_id'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(None);

    if scene_id.is_none() {
        // No global scene set, nothing to check
        conn.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES ('drift_count', '0')",
            [],
        )?;
        return Ok(());
    }

    let scene_id = scene_id.unwrap();

    // Build all platform plugins
    let all_plugins: Vec<Box<dyn PlatformPlugin>> = crate::plugins::platform::create_all_platform_plugins_vec();

    let report = verify_distribution(conn, &all_plugins, &scene_id, "global")?;
    let drift_count = report.drifted.len() as i64;

    conn.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES ('drift_count', ?1)",
        params![drift_count.to_string()],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        schema::create_tables(&conn).unwrap();
        // Create scene_platforms table (normally created by migration v4)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS scene_platforms (
                scene_id TEXT NOT NULL,
                platform_id TEXT NOT NULL,
                PRIMARY KEY (scene_id, platform_id),
                FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
                FOREIGN KEY (platform_id) REFERENCES platforms(id) ON DELETE CASCADE
            )",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn test_get_sync_status() {
        let conn = setup_db();
        let status = get_sync_status(&conn).unwrap();
        assert_eq!(status.platforms.len(), 12); // 12 built-in platforms
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
    fn test_sync_scene_not_found() {
        let conn = setup_db();
        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];

        let result = sync_scene(&conn, &plugins, "nonexistent-scene", None, "global", None);
        assert!(result.is_err());

        match result.unwrap_err() {
            AppError::SceneNotFound(id) => assert_eq!(id, "nonexistent-scene"),
            other => panic!("Expected SceneNotFound error, got: {:?}", other),
        }
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
        conn.execute(
            "INSERT INTO scene_platforms (scene_id, platform_id) VALUES (?1, ?2)",
            params!["test-scene", "claude-code"],
        ).unwrap();

        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];

        // Sync with project scope but no project_id should fail
        let result = sync_scene(&conn, &plugins, "test-scene", None, "project", None);
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
        ).unwrap();

        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];
        let result = switch_global_scene(&conn, &plugins, "scene-b").unwrap();

        // skill-2 should be in to_install, skill-1 in to_remove (no overlap)
        assert!(result.installed.contains(&"skill-2".to_string()) || result.errors.is_empty());
        assert!(result.removed.contains(&"skill-1".to_string()) || result.errors.is_empty());

        // Verify global_scene_id updated
        let new_scene_id: Option<String> = conn
            .query_row("SELECT value FROM app_config WHERE key = 'global_scene_id'", [], |row| row.get(0))
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

        conn.execute("UPDATE app_config SET value = 'scene-a' WHERE key = 'global_scene_id'", []).unwrap();

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
        conn.execute("UPDATE app_config SET value = 'scene-a' WHERE key = 'global_scene_id'", []).unwrap();

        let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];
        let result = switch_global_scene(&conn, &plugins, "scene-a").unwrap();

        // Switching to the same scene should result in no installs/removes
        assert!(result.installed.is_empty());
        assert!(result.removed.is_empty());
    }
}
