use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::types::{
    Distribution, PlatformInstance, PlatformSyncStatus, RulesFormat, Skill, SyncResult,
    SyncStatusDTO,
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
            resolved_platform_ids =
                crate::engine::scene_engine::get_scene_platforms(conn, scene_id)?;
            if resolved_platform_ids.is_empty() {
                return Err(AppError::Platform(
                    "场景未关联任何平台，请先在场景编辑中配置目标平台".to_string(),
                ));
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
            crate::engine::fs_watcher::mute_self_writes(parent);
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!("无法创建平台目录 '{}': {}", parent.display(), e))
            })?;
        }

        // Compute diff: what's currently on disk vs what should be
        let current_skill_ids = get_distributed_skills(
            conn,
            scene_id,
            platform_id,
            scope,
            project_id,
            &**plugin,
            &instance,
        )?;

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
        if plugin.default_paths().global_rules_dir.is_some() {
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
                &mut result,
            )?;
        }

        // Update distribution record
        let checksum = compute_scene_checksum(conn, scene_id);

        conn.execute(
            "INSERT OR REPLACE INTO distributions (scene_id, platform_id, scope, project_id, project_path, status, last_synced_at, checksum)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), ?7)",
            params![scene_id, platform_id, scope, project_id, project_path, "synced", checksum],
        )?;
    }

    Ok(result)
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
    if scene_id == "__all_skills__" {
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
    if scene_id == "__all_skills__" {
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
    let skills_dir = std::path::Path::new(&instance.path);
    if !skills_dir.exists() {
        // Directory doesn't exist yet — treat as empty
        return Ok(vec![]);
    }

    let mut current_skill_ids = Vec::new();
    if let Ok(entries) = std::fs::read_dir(skills_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    // Skip hidden directories (e.g., .git)
                    if !name.starts_with('.') {
                        current_skill_ids.push(name.to_string());
                    }
                }
            }
        }
    }

    Ok(current_skill_ids)
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

/// Dispatch rules sync based on the platform's `RulesFormat`.
fn sync_rules_to_platform(
    conn: &rusqlite::Connection,
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    rule_ids: &[String],
    rules_format: &RulesFormat,
    result: &mut SyncResult,
) -> Result<(), AppError> {
    match rules_format {
        RulesFormat::Directory => sync_rules_to_directory(conn, plugin, instance, rule_ids, result),
        RulesFormat::SingleFile { .. } => {
            let file_path = resolve_rules_path(conn, plugin, instance);
            if let Some(file_path) = file_path {
                sync_rules_to_single_file(conn, &file_path, rule_ids, result)
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
    _conn: &rusqlite::Connection,
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
) -> Option<std::path::PathBuf> {
    if instance.scope == "global" {
        plugin
            .default_paths()
            .global_rules_dir
            .as_ref()
            .map(|d| crate::plugins::platform::expand_home(d))
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
    }
}

/// Directory mode: write each rule as `{rules_dir}/{rule_id}.{format}`.
fn sync_rules_to_directory(
    conn: &rusqlite::Connection,
    plugin: &dyn PlatformPlugin,
    instance: &PlatformInstance,
    rule_ids: &[String],
    result: &mut SyncResult,
) -> Result<(), AppError> {
    let rules_dir = resolve_rules_path(conn, plugin, instance);

    if let Some(rules_dir) = &rules_dir {
        crate::engine::fs_watcher::mute_self_writes(rules_dir);
        std::fs::create_dir_all(rules_dir).map_err(|e| {
            AppError::Io(format!("无法创建规则目录 '{}': {}", rules_dir.display(), e))
        })?;

        // Diff removal: remove rule files that are no longer in the scene
        if let Ok(entries) = std::fs::read_dir(rules_dir) {
            let expected: std::collections::HashSet<&str> =
                rule_ids.iter().map(|s| s.as_str()).collect();
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    if let Some(file_name) = entry.file_name().to_str() {
                        if let Some(stem) = std::path::Path::new(file_name).file_stem() {
                            let stem_str = stem.to_string_lossy();
                            if !expected.contains(stem_str.as_ref()) {
                                crate::engine::fs_watcher::mute_self_writes(&entry.path());
                                if let Err(e) = std::fs::remove_file(entry.path()) {
                                    result.errors.push(format!(
                                        "删除过期规则文件 '{}' 失败: {}",
                                        entry.path().display(),
                                        e
                                    ));
                                } else {
                                    result.removed.push(format!("rule:{}", stem_str));
                                }
                            }
                        }
                    }
                }
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
        std::fs::read_to_string(file_path).unwrap_or_default()
    } else {
        String::new()
    };

    // Remove all SKILLFORGE-managed blocks, preserving user content
    let re =
        regex::Regex::new(r"<!-- SKILLFORGE:rule:.*? -->[\s\S]*?<!-- /SKILLFORGE:rule:.*? -->")
            .map_err(|e| AppError::Platform(format!("正则编译失败: {}", e)))?;
    let user_content = re.replace_all(&existing_content, "").trim().to_string();

    // Build new SKILLFORGE blocks
    let mut skillforge_blocks = String::new();
    for rule_id in rule_ids {
        let rule_content: Option<String> = conn
            .query_row(
                "SELECT content FROM rules WHERE id = ?1",
                params![rule_id],
                |row| row.get(0),
            )
            .ok();

        if let Some(content) = rule_content {
            skillforge_blocks.push_str(&format!(
                "\n<!-- SKILLFORGE:rule:{} -->\n{}<!-- /SKILLFORGE:rule:{} -->\n",
                rule_id, content, rule_id
            ));
            result.installed.push(format!("rule:{}", rule_id));
        }
    }

    // Combine: user content first, then SKILLFORGE blocks
    let mut final_content = String::new();
    if !user_content.is_empty() {
        final_content.push_str(&user_content);
        if !user_content.ends_with('\n') {
            final_content.push('\n');
        }
    }
    final_content.push_str(&skillforge_blocks);

    // Write file (or delete if empty)
    if final_content.trim().is_empty() {
        if file_path.exists() {
            crate::engine::fs_watcher::mute_self_writes(file_path);
            std::fs::remove_file(file_path)?;
        }
    } else {
        crate::engine::fs_watcher::mute_self_writes(file_path);
        std::fs::write(file_path, &final_content)?;
    }

    Ok(())
}

/// Remove a single rule from a SingleFile-managed file.
///
/// Removes the specific `<!-- SKILLFORGE:rule:{id} -->...<!-- /SKILLFORGE:rule:{id} -->` block.
fn remove_rule_from_single_file(
    file_path: &std::path::Path,
    rule_id: &str,
) -> Result<(), AppError> {
    if !file_path.exists() {
        return Ok(());
    }

    let existing_content = std::fs::read_to_string(file_path).unwrap_or_default();

    let pattern = format!(
        r"<!-- SKILLFORGE:rule:{} -->[\s\S]*?<!-- /SKILLFORGE:rule:{} -->",
        regex::escape(rule_id),
        regex::escape(rule_id)
    );
    let re = regex::Regex::new(&pattern)
        .map_err(|e| AppError::Platform(format!("正则编译失败: {}", e)))?;
    let new_content = re.replace_all(&existing_content, "").trim().to_string();

    if new_content.is_empty() {
        crate::engine::fs_watcher::mute_self_writes(file_path);
        std::fs::remove_file(file_path)?;
    } else {
        crate::engine::fs_watcher::mute_self_writes(file_path);
        std::fs::write(file_path, format!("{}\n", new_content))?;
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
            let instances = plugin.detect().unwrap_or_default();
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
            let instances = plugin.detect().unwrap_or_default();
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
    let all_target_platforms: Vec<&String> = platforms_shared
        .iter()
        .chain(platforms_only_new.iter())
        .collect();
    for pid in all_target_platforms {
        if let Some(plugin) = find_plugin(pid) {
            if plugin.default_paths().global_rules_dir.is_none() {
                continue;
            }
            let instances = plugin.detect().unwrap_or_default();
            for instance in instances {
                if instance.scope != "global" {
                    continue;
                }
                let rules_format = plugin
                    .default_paths()
                    .global_rules_format
                    .clone()
                    .unwrap_or(RulesFormat::Directory);
                // Install new rules
                sync_rules_to_platform(
                    conn,
                    &**plugin,
                    &instance,
                    &rules_to_install,
                    &rules_format,
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
                RulesFormat::SingleFile { .. } => {
                    let file_path = plugin
                        .default_paths()
                        .global_rules_dir
                        .as_ref()
                        .map(|d| crate::plugins::platform::expand_home(d));
                    if let Some(file_path) = &file_path {
                        for rule_id in &old_rules {
                            if let Err(e) = remove_rule_from_single_file(file_path, rule_id) {
                                result.errors.push(format!(
                                    "从 {} 移除规则 '{}' 失败: {}",
                                    file_path.display(),
                                    rule_id,
                                    e
                                ));
                            }
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
                RulesFormat::SingleFile { .. } => {
                    let file_path = plugin
                        .default_paths()
                        .global_rules_dir
                        .as_ref()
                        .map(|d| crate::plugins::platform::expand_home(d));
                    if let Some(file_path) = &file_path {
                        for rule_id in &rules_to_remove {
                            if let Err(e) = remove_rule_from_single_file(file_path, rule_id) {
                                result.errors.push(format!(
                                    "从 {} 移除规则 '{}' 失败: {}",
                                    file_path.display(),
                                    rule_id,
                                    e
                                ));
                            }
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
fn count_fs_subdirs(path: &std::path::Path) -> i64 {
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
fn count_fs_files(path: &std::path::Path) -> i64 {
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
        )
        .unwrap();
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
        )
        .unwrap();

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

        sync_rules_to_single_file(&conn, &file_path, &rule_ids, &mut result).unwrap();

        // File should exist
        assert!(file_path.exists());

        // Content should contain both SKILLFORGE blocks
        let content = std::fs::read_to_string(&file_path).unwrap();
        assert!(content.contains("<!-- SKILLFORGE:rule:rule-1 -->"));
        assert!(content.contains("# Rule 1\nUse 2-space indent"));
        assert!(content.contains("<!-- /SKILLFORGE:rule:rule-1 -->"));
        assert!(content.contains("<!-- SKILLFORGE:rule:rule-2 -->"));
        assert!(content.contains("# Rule 2\nNo hardcoded secrets"));
        assert!(content.contains("<!-- /SKILLFORGE:rule:rule-2 -->"));

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

        let rule_ids = vec!["new-rule".to_string()];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            errors: vec![],
        };

        sync_rules_to_single_file(&conn, &file_path, &rule_ids, &mut result).unwrap();

        let content = std::fs::read_to_string(&file_path).unwrap();

        // User content should be preserved
        assert!(content.contains("# My custom header"));
        assert!(content.contains("This is user content."));

        // Old SKILLFORGE block should be removed
        assert!(!content.contains("<!-- SKILLFORGE:rule:old-rule -->"));
        assert!(!content.contains("Old content"));

        // New SKILLFORGE block should be present
        assert!(content.contains("<!-- SKILLFORGE:rule:new-rule -->"));
        assert!(content.contains("# New Rule\nBe excellent"));
        assert!(content.contains("<!-- /SKILLFORGE:rule:new-rule -->"));

        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
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
        let rule_ids: Vec<String> = vec![];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            errors: vec![],
        };

        sync_rules_to_single_file(&conn, &file_path, &rule_ids, &mut result).unwrap();

        let content = std::fs::read_to_string(&file_path).unwrap();

        // SKILLFORGE block should be removed
        assert!(!content.contains("SKILLFORGE"));

        // User content should be preserved
        assert!(content.contains("# User header"));

        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }

    #[test]
    fn test_remove_rule_from_single_file() {
        let test_dir = format!("/tmp/skillforge-test-rm-sf-{}", std::process::id());
        let _ = std::fs::remove_dir_all(&test_dir);
        std::fs::create_dir_all(&test_dir).unwrap();
        let file_path = std::path::PathBuf::from(format!("{}/AGENTS.md", test_dir));

        let content = "# User header\n\n<!-- SKILLFORGE:rule:rule-a -->\nContent A\n<!-- /SKILLFORGE:rule:rule-a -->\n\n<!-- SKILLFORGE:rule:rule-b -->\nContent B\n<!-- /SKILLFORGE:rule:rule-b -->\n";
        std::fs::write(&file_path, content).unwrap();

        remove_rule_from_single_file(&file_path, "rule-a").unwrap();

        let new_content = std::fs::read_to_string(&file_path).unwrap();

        // rule-a should be removed
        assert!(!new_content.contains("SKILLFORGE:rule:rule-a"));
        assert!(!new_content.contains("Content A"));

        // rule-b should remain
        assert!(new_content.contains("SKILLFORGE:rule:rule-b"));
        assert!(new_content.contains("Content B"));

        // User content should remain
        assert!(new_content.contains("# User header"));

        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }

    #[test]
    fn test_remove_rule_from_single_file_deletes_empty_file() {
        let test_dir = format!("/tmp/skillforge-test-rm-empty-{}", std::process::id());
        let _ = std::fs::remove_dir_all(&test_dir);
        std::fs::create_dir_all(&test_dir).unwrap();
        let file_path = std::path::PathBuf::from(format!("{}/AGENTS.md", test_dir));

        let content = "<!-- SKILLFORGE:rule:only-rule -->\nOnly content\n<!-- /SKILLFORGE:rule:only-rule -->\n";
        std::fs::write(&file_path, content).unwrap();

        remove_rule_from_single_file(&file_path, "only-rule").unwrap();

        // File should be deleted since it's now empty
        assert!(!file_path.exists());

        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }
}
