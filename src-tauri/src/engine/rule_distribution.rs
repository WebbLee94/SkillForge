//! Rules-only distribution logic — directory/single-file merge, managed-block
//! normalization/parsing and rules path resolution.
//!
//! Extracted from `dist_engine` (Phase 4 TASK-030 / REQ-004) so rule
//! distribution can be tested and evolved independently of the skill
//! distribution flow.

use crate::engine::rule_engine;
use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::types::{ManagedDistributionEntry, PlatformInstance, RulesFormat, SyncResult};
use rusqlite::{params, Connection};

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

/// Resolve the rules path (directory or file) for the given platform instance.
///
/// - Directory mode: returns the rules directory path
/// - SingleFile mode: returns the full file path
pub(crate) fn resolve_rules_path(
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

/// Dispatch rules sync based on the platform's `RulesFormat`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn sync_rules_to_platform(
    conn: &Connection,
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

/// Directory mode: write each rule as `{rules_dir}/{rule_id}.{format}`.
#[allow(clippy::too_many_arguments)]
fn sync_rules_to_directory(
    conn: &Connection,
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
                    "SELECT content FROM resources WHERE id = ?1 AND kind = 'rule'",
                    params![rule_id],
                    |row| row.get(0),
                )
                .ok();
            let rule_format: Option<String> = conn
                .query_row(
                    "SELECT format FROM resources WHERE id = ?1 AND kind = 'rule'",
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
                            result.skipped += 1;
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
    conn: &Connection,
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
        let rule = match rule_engine::get_rule(conn, &stem) {
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
/// Algorithm:
/// 1. Read existing file content (if exists)
/// 2. Remove all SKILLFORGE-managed blocks via regex
/// 3. Preserve remaining content (user's manual additions)
/// 4. For each rule_id: query content + format from DB, append block
/// 5. Write file
#[allow(clippy::too_many_arguments)]
fn sync_rules_to_single_file(
    conn: &Connection,
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
            let Some(rule) = rule_engine::get_rule(conn, &block.id).ok() else {
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
                "SELECT content FROM resources WHERE id = ?1 AND kind = 'rule'",
                params![rule_id],
                |row| row.get(0),
            )
            .ok();
        if let Some(content) = rule_content {
            if let Some(block) = existing_blocks.iter().find(|block| block.id == *rule_id) {
                if rule_block_content_matches(block, &content) && block.content.ends_with('\n') {
                    result.skipped += 1;
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

/// A managed block extracted from a SingleFile-mode rule file.
#[derive(Debug)]
pub(crate) struct ManagedRuleBlock {
    id: String,
    content: String,
    raw: String,
    start: usize,
    end: usize,
}

fn rule_block_content_matches(block: &ManagedRuleBlock, rule_content: &str) -> bool {
    crate::domain::distribution::policy::managed_block_content_matches(&block.content, rule_content)
}

fn render_managed_rule_block(rule_id: &str, content: &str) -> String {
    let separator = if content.ends_with('\n') { "" } else { "\n" };
    format!(
        "<!-- SKILLFORGE:rule:{rule_id} -->\n{content}{separator}<!-- /SKILLFORGE:rule:{rule_id} -->"
    )
}

/// Validate that all managed blocks in a file match the DB rules and that no
/// rule id appears more than once.
pub(crate) fn validate_single_file_rule_blocks(
    conn: &Connection,
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
        let rule = rule_engine::get_rule(conn, &block.id).map_err(|_| {
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

/// Extract the managed block inner content of `rule_id` from a
/// SingleFile-mode file; `Ok(None)` when the file or the block is absent.
pub(crate) fn read_managed_rule_block_content(
    file_path: &std::path::Path,
    rule_id: &str,
) -> Result<Option<String>, AppError> {
    if !file_path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(file_path)?;
    let blocks = parse_managed_rule_blocks(&content)?;
    Ok(blocks
        .iter()
        .find(|block| block.id == rule_id)
        .map(|block| block.content.clone()))
}

/// Parse all well-formed SKILLFORGE managed blocks from a SingleFile-mode file.
/// Rejects files with stray/mismatched markers.
pub(crate) fn parse_managed_rule_blocks(content: &str) -> Result<Vec<ManagedRuleBlock>, AppError> {
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

/// Read the managed rule entries currently proven owned on a platform target.
pub(crate) fn read_managed_rules(
    conn: &Connection,
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
                let rule = match rule_engine::get_rule(conn, &id) {
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
                let rule = match rule_engine::get_rule(conn, &block.id) {
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

/// Validate that removal targets are still SkillForge-managed (unchanged).
#[allow(clippy::too_many_arguments)]
pub(crate) fn validate_rule_removal_targets(
    conn: &Connection,
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
                let rule = rule_engine::get_rule(conn, id)?;
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
                let rule = rule_engine::get_rule(conn, id)?;
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

/// Remove selected rules from a platform target (Directory or SingleFile mode).
#[allow(clippy::too_many_arguments)]
pub(crate) fn remove_selected_rules(
    conn: &Connection,
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
    conn: &Connection,
    rules_path: &std::path::Path,
    rule_ids: &[String],
    rules_format: &RulesFormat,
    result: &mut SyncResult,
) -> Result<(), AppError> {
    match rules_format {
        RulesFormat::Directory => {
            for id in rule_ids {
                let rule = rule_engine::get_rule(conn, id)?;
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
                let rule = rule_engine::get_rule(conn, id)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::types::{PlatformCapabilities, PlatformPaths, Skill, SkillPlatformStatus};

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        schema::create_tables(&conn).unwrap();
        conn
    }

    fn insert_rule(conn: &rusqlite::Connection, id: &str, name: &str, content: &str, format: &str) {
        conn.execute(
            "INSERT INTO resources (id, kind, name, source_type, format, content, version, updated_at, installed_at) VALUES (?1, 'rule', ?2, 'manual', ?3, ?4, 1, ?5, ?5)",
            params![id, name, format, content, chrono::Utc::now().to_rfc3339()],
        )
        .unwrap();
    }

    struct TestPlugin {
        paths: PlatformPaths,
    }

    impl PlatformPlugin for TestPlugin {
        fn platform_name(&self) -> &'static str {
            "test"
        }

        fn display_name(&self) -> &'static str {
            "Test"
        }

        fn detect(&self) -> Result<Vec<PlatformInstance>, AppError> {
            Ok(vec![])
        }

        fn install(&self, _skill: &Skill, _instance: &PlatformInstance) -> Result<(), AppError> {
            Ok(())
        }

        fn sync(
            &self,
            _skill: &Skill,
            _instance: &PlatformInstance,
        ) -> Result<SyncResult, AppError> {
            Ok(SyncResult {
                installed: vec![],
                updated: vec![],
                removed: vec![],
                skipped: 0,
                errors: vec![],
            })
        }

        fn remove(&self, _skill_id: &str, _instance: &PlatformInstance) -> Result<(), AppError> {
            Ok(())
        }

        fn status(
            &self,
            _skill_id: &str,
            _instance: &PlatformInstance,
        ) -> Result<SkillPlatformStatus, AppError> {
            Ok(SkillPlatformStatus {
                installed: false,
                path: None,
                version: None,
                checksum: None,
            })
        }

        fn default_paths(&self) -> PlatformPaths {
            self.paths.clone()
        }

        fn capabilities(&self) -> PlatformCapabilities {
            PlatformCapabilities {
                skills_global: true,
                skills_project: true,
                rules_global: true,
                rules_project: true,
                rules_format_global: self.paths.global_rules_format.clone(),
                rules_format_project: self.paths.project_rules_format.clone(),
                limitation_notes: vec![],
            }
        }
    }

    fn directory_test_plugin(rules_dir: &std::path::Path) -> TestPlugin {
        TestPlugin {
            paths: PlatformPaths {
                global_skills_dir: String::new(),
                project_skills_pattern: String::new(),
                global_rules_dir: Some(rules_dir.to_string_lossy().to_string()),
                project_rules_pattern: None,
                global_rules_format: Some(RulesFormat::Directory),
                project_rules_format: None,
            },
        }
    }

    fn global_instance() -> PlatformInstance {
        PlatformInstance {
            platform_id: "test".to_string(),
            platform_name: "Test".to_string(),
            path: String::new(),
            scope: "global".to_string(),
        }
    }

    #[test]
    fn test_sync_rules_to_single_file_create() {
        let conn = setup_db();
        insert_rule(
            &conn,
            "rule-1",
            "Rule 1",
            "# Rule 1\nUse 2-space indent",
            "md",
        );
        insert_rule(
            &conn,
            "rule-2",
            "Rule 2",
            "# Rule 2\nNo hardcoded secrets",
            "md",
        );
        let test_dir = format!("/tmp/skillforge-test-sf-{}", std::process::id());
        let _ = std::fs::remove_dir_all(&test_dir);
        let file_path = std::path::PathBuf::from(format!("{}/AGENTS.md", test_dir));
        let rule_ids = vec!["rule-1".to_string(), "rule-2".to_string()];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            skipped: 0,
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
        insert_rule(
            &conn,
            "new-rule",
            "New Rule",
            "# New Rule\nBe excellent",
            "md",
        );
        insert_rule(&conn, "old-rule", "Old Rule", "Old content\n", "md");
        let rule_ids = vec!["new-rule".to_string()];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            skipped: 0,
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
        insert_rule(
            &conn,
            "changed-rule",
            "Changed Rule",
            "Old library content\n",
            "md",
        );
        insert_rule(&conn, "other-rule", "Other Rule", "Other content\r\n", "md");
        let pre_content = format!(
            "{unrelated}\n<!-- SKILLFORGE:rule:changed-rule -->\nOld library content\n<!-- /SKILLFORGE:rule:changed-rule -->\n{other_block}"
        );
        std::fs::write(&file_path, &pre_content).unwrap();
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            skipped: 0,
            errors: vec![],
        };

        let user_content = format!("{unrelated}\n");
        assert_eq!(std::fs::read_to_string(&file_path).unwrap(), pre_content);

        conn.execute(
            "UPDATE resources SET content = ?1, version = version + 1 WHERE id = ?2 AND kind = 'rule'",
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
        insert_rule(&conn, "normalized-rule", "Normalized Rule", content, "md");
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
            skipped: 0,
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
        insert_rule(&conn, "old-rule", "Old Rule", "Old content\n", "md");
        let rule_ids: Vec<String> = vec![];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            skipped: 0,
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

    #[test]
    fn test_parse_managed_rule_blocks_rejects_mismatched_markers() {
        let content = "<!-- SKILLFORGE:rule:a -->\ncontent\n<!-- /SKILLFORGE:rule:b -->";
        let err = parse_managed_rule_blocks(content).unwrap_err();
        assert!(err.to_string().contains("畸形"), "got: {err}");
    }

    #[test]
    fn test_render_and_parse_managed_rule_block_roundtrip() {
        let content = "# Rule\nline two\n";
        let rendered = render_managed_rule_block("my-rule", content);
        let blocks = parse_managed_rule_blocks(&rendered).unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].id, "my-rule");
        assert!(rule_block_content_matches(&blocks[0], content));
    }

    #[test]
    fn test_rule_block_content_matches_ignores_trailing_newline() {
        let mut block = ManagedRuleBlock {
            id: "r".to_string(),
            content: "content\n".to_string(),
            raw: String::new(),
            start: 0,
            end: 0,
        };
        assert!(rule_block_content_matches(&block, "content"));
        assert!(!rule_block_content_matches(&block, "other"));
        block.content = "content".to_string();
        assert!(rule_block_content_matches(&block, "content"));
    }

    #[test]
    fn test_count_managed_rule_blocks() {
        let content = concat!(
            "<!-- SKILLFORGE:rule:a -->\nA\n<!-- /SKILLFORGE:rule:a -->\n",
            "<!-- SKILLFORGE:rule:b -->\nB\n<!-- /SKILLFORGE:rule:b -->"
        );
        assert_eq!(count_managed_rule_blocks(content).unwrap(), 2);
    }

    #[test]
    fn test_read_current_rules_on_disk_directory_returns_stems() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("one.md"), "a").unwrap();
        std::fs::write(dir.path().join("two.txt"), "b").unwrap();
        std::fs::write(dir.path().join(".hidden.md"), "c").unwrap();
        let mut ids = read_current_rules_on_disk_directory(dir.path());
        ids.sort();
        assert_eq!(ids, vec!["one".to_string(), "two".to_string()]);
        assert!(read_current_rules_on_disk_directory(&dir.path().join("missing")).is_empty());
    }

    #[test]
    fn test_read_current_rules_on_disk_single_file_returns_ids() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("AGENTS.md");
        std::fs::write(
            &file,
            "<!-- SKILLFORGE:rule:alpha -->\nA\n<!-- /SKILLFORGE:rule:alpha -->\n<!-- SKILLFORGE:rule:beta -->\nB\n<!-- /SKILLFORGE:rule:beta -->",
        )
        .unwrap();
        let mut ids = read_current_rules_on_disk_single_file(&file).unwrap();
        ids.sort();
        assert_eq!(ids, vec!["alpha".to_string(), "beta".to_string()]);
        assert!(
            read_current_rules_on_disk_single_file(&dir.path().join("missing"))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn test_resolve_project_rules_path_resolves_inside_project() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join(".cursor")).unwrap();
        let resolved = resolve_project_rules_path(
            "{project}/.cursor/rules",
            &project.path().to_string_lossy(),
        )
        .unwrap();
        assert!(resolved.starts_with(project.path()));
        assert!(resolved.ends_with(".cursor/rules"));
    }

    #[test]
    fn test_resolve_project_rules_path_rejects_escape() {
        let project = tempfile::tempdir().unwrap();
        let err =
            resolve_project_rules_path("../escape", &project.path().to_string_lossy()).unwrap_err();
        assert!(err.to_string().contains("超出项目根目录"), "got: {err}");
    }

    #[test]
    fn test_validate_single_file_rule_blocks_rejects_duplicate_ids() {
        let conn = setup_db();
        insert_rule(&conn, "a", "A", "content\n", "md");
        let blocks = vec![
            ManagedRuleBlock {
                id: "a".to_string(),
                content: "content\n".to_string(),
                raw: String::new(),
                start: 0,
                end: 0,
            },
            ManagedRuleBlock {
                id: "a".to_string(),
                content: "content\n".to_string(),
                raw: String::new(),
                start: 0,
                end: 0,
            },
        ];
        let err = validate_single_file_rule_blocks(&conn, &blocks).unwrap_err();
        assert!(err.to_string().contains("重复标记块"), "got: {err}");
    }

    #[test]
    fn test_validate_single_file_rule_blocks_rejects_unknown_rule() {
        let conn = setup_db();
        let blocks = vec![ManagedRuleBlock {
            id: "ghost".to_string(),
            content: "content\n".to_string(),
            raw: String::new(),
            start: 0,
            end: 0,
        }];
        let err = validate_single_file_rule_blocks(&conn, &blocks).unwrap_err();
        assert!(err.to_string().contains("没有对应的"), "got: {err}");
    }

    #[test]
    fn test_validate_single_file_rule_blocks_rejects_modified_block_content() {
        let conn = setup_db();
        insert_rule(&conn, "rule-1", "Rule 1", "# Rule 1\n", "md");
        let blocks = vec![ManagedRuleBlock {
            id: "rule-1".to_string(),
            content: "# Rule 1 edited by user\n".to_string(),
            raw: String::new(),
            start: 0,
            end: 0,
        }];
        let err = validate_single_file_rule_blocks(&conn, &blocks).unwrap_err();
        assert!(err.to_string().contains("标记块内容不匹配"), "got: {err}");
    }

    #[test]
    fn test_sync_rules_to_directory_installs_rule_files() {
        let dir = tempfile::tempdir().unwrap();
        let conn = setup_db();
        insert_rule(&conn, "rule-1", "Rule 1", "# Rule 1\n", "md");
        insert_rule(&conn, "rule-2", "Rule 2", "# Rule 2\n", "yaml");
        let plugin = directory_test_plugin(dir.path());
        let instance = global_instance();
        let rule_ids = vec!["rule-1".to_string(), "rule-2".to_string()];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            skipped: 0,
            errors: vec![],
        };

        sync_rules_to_directory(
            &conn,
            &plugin,
            &instance,
            &rule_ids,
            None,
            true,
            &mut result,
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.path().join("rule-1.md")).unwrap(),
            "# Rule 1\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("rule-2.yaml")).unwrap(),
            "# Rule 2\n"
        );
        assert_eq!(result.installed, vec!["rule:rule-1", "rule:rule-2"]);
        assert!(result.updated.is_empty());
        assert!(result.removed.is_empty());
    }

    #[test]
    fn test_sync_rules_to_directory_updates_changed_rule_file() {
        let dir = tempfile::tempdir().unwrap();
        let conn = setup_db();
        insert_rule(&conn, "rule-1", "Rule 1", "# Old\n", "md");
        std::fs::write(dir.path().join("rule-1.md"), "# Old\n").unwrap();
        conn.execute(
            "UPDATE resources SET content = ?1, version = version + 1 WHERE id = ?2 AND kind = 'rule'",
            params!["# New\n", "rule-1"],
        )
        .unwrap();
        let plugin = directory_test_plugin(dir.path());
        let instance = global_instance();
        let rule_ids = vec!["rule-1".to_string()];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            skipped: 0,
            errors: vec![],
        };

        sync_rules_to_directory(
            &conn,
            &plugin,
            &instance,
            &rule_ids,
            None,
            true,
            &mut result,
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.path().join("rule-1.md")).unwrap(),
            "# New\n"
        );
        assert_eq!(result.updated, vec!["rule:rule-1"]);
        assert!(result.installed.is_empty());
    }

    #[test]
    fn test_sync_rules_to_directory_removes_stale_unchanged_rule_file() {
        let dir = tempfile::tempdir().unwrap();
        let conn = setup_db();
        insert_rule(&conn, "rule-1", "Rule 1", "# Rule 1\n", "md");
        std::fs::write(dir.path().join("rule-1.md"), "# Rule 1\n").unwrap();
        let plugin = directory_test_plugin(dir.path());
        let instance = global_instance();
        let rule_ids: Vec<String> = vec![];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            skipped: 0,
            errors: vec![],
        };

        sync_rules_to_directory(
            &conn,
            &plugin,
            &instance,
            &rule_ids,
            None,
            true,
            &mut result,
        )
        .unwrap();

        assert!(
            !dir.path().join("rule-1.md").exists(),
            "stale unchanged rule file should be removed"
        );
        assert_eq!(result.removed, vec!["rule:rule-1"]);
    }

    #[test]
    fn test_sync_rules_to_directory_refuses_to_remove_modified_managed_rule_file() {
        let dir = tempfile::tempdir().unwrap();
        let conn = setup_db();
        insert_rule(&conn, "rule-1", "Rule 1", "# Rule 1\n", "md");
        std::fs::write(dir.path().join("rule-1.md"), "# Rule 1 edited by user\n").unwrap();
        let plugin = directory_test_plugin(dir.path());
        let instance = global_instance();
        let rule_ids: Vec<String> = vec![];
        let mut result = SyncResult {
            installed: vec![],
            updated: vec![],
            removed: vec![],
            skipped: 0,
            errors: vec![],
        };

        let err = sync_rules_to_directory(
            &conn,
            &plugin,
            &instance,
            &rule_ids,
            None,
            true,
            &mut result,
        )
        .unwrap_err();

        assert!(err.to_string().contains("已被用户修改"), "got: {err}");
        assert!(result.removed.is_empty());
        assert!(
            dir.path().join("rule-1.md").exists(),
            "a user-modified managed file must not be removed"
        );
    }

    #[test]
    fn test_collect_valid_directory_removals_refuses_modified_rule() {
        let dir = tempfile::tempdir().unwrap();
        let conn = setup_db();
        insert_rule(&conn, "rule-1", "Rule 1", "# Rule 1\n", "md");
        std::fs::write(dir.path().join("rule-1.md"), "# modified by user\n").unwrap();
        let expected: std::collections::HashSet<&str> = std::collections::HashSet::new();

        let err = collect_valid_directory_removals(&conn, dir.path(), &expected).unwrap_err();

        assert!(err.to_string().contains("已被用户修改"), "got: {err}");
    }

    #[test]
    fn test_collect_valid_directory_removals_ignores_unmanaged_files() {
        let dir = tempfile::tempdir().unwrap();
        let conn = setup_db();
        std::fs::write(dir.path().join("user-notes.md"), "not a managed rule\n").unwrap();
        let expected: std::collections::HashSet<&str> = std::collections::HashSet::new();

        let removable = collect_valid_directory_removals(&conn, dir.path(), &expected).unwrap();

        assert!(
            removable.is_empty(),
            "files not backed by a DB rule must be left alone"
        );
    }
}
