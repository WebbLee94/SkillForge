//! Rule engine — Rules CRUD, content validation and version management.
//!
//! Symmetric to `skill_engine`: all rule business logic (create/update/delete/
//! get/list), content validation and version increment live here, while
//! `commands/rules.rs` only performs parameter mapping and error conversion.
//!
//! Rule files are stored under `~/.skillforge/rules/{id}.{format}` as the
//! source-of-truth copy; distribution to platform targets lives in
//! `engine/rule_distribution.rs`.

use crate::error::AppError;
use crate::types::{CreateRuleDTO, Rule, Tag, UpdateRuleDTO};
use rusqlite::{params, Connection};

/// Test-only override for the rule storage directory. Held only briefly while
/// setting/clearing; FS-touching tests are serialized via `FS_TEST_SERIAL` so
/// the override is never mutated concurrently.
#[cfg(test)]
static RULES_STORAGE_DIR_OVERRIDE: std::sync::Mutex<Option<std::path::PathBuf>> =
    std::sync::Mutex::new(None);

/// Serializes tests that touch the rule storage dir (they share the override).
#[cfg(test)]
static FS_TEST_SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Parse the JSON string produced by `json_group_array` into `Vec<Tag>`.
/// Handles the edge case where LEFT JOIN yields `[""]` (no matching tags).
fn parse_tags_json(json: &str) -> Vec<Tag> {
    if json == "[\"\"]" || json == "[]" {
        return Vec::new();
    }
    let tags: Vec<Tag> = serde_json::from_str(json).unwrap_or_default();
    // Filter out null-id entries from LEFT JOIN with no matching tags
    tags.into_iter().filter(|t| t.id != 0).collect()
}

/// Formats supported by the rule creation / platform import flow.
const SUPPORTED_RULE_FORMATS: [&str; 3] = ["md", "mdc", "yaml"];

/// Validate a rule format before it is used to build storage/distribution
/// paths (`{storage}/{id}.{format}`). Only formats actually supported by the
/// app are accepted; anything else — including path-traversal attempts such
/// as `../../../escape` — is rejected.
pub(crate) fn validate_rule_format(format: &str) -> Result<(), AppError> {
    if !SUPPORTED_RULE_FORMATS.contains(&format) {
        return Err(AppError::Validation(format!(
            "不支持的规则格式 '{}'（仅支持 md / mdc / yaml）",
            format
        )));
    }
    Ok(())
}

/// Validate rule content before persist.
///
/// Rejects empty content and content containing NUL bytes (which cannot be
/// written to disk faithfully).
pub(crate) fn validate_rule_content(content: &str) -> Result<(), AppError> {
    if content.trim().is_empty() {
        return Err(AppError::Validation("规则内容不能为空".to_string()));
    }
    if content.contains('\0') {
        return Err(AppError::Validation(
            "规则内容包含非法字符 (NUL 字节)".to_string(),
        ));
    }
    Ok(())
}

/// Compute the slugified rule id from a rule name.
fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Local rule storage directory (source of truth for rule files).
///
/// Overridable in tests via `with_rules_storage_dir` to avoid touching the
/// real `~/.skillforge/rules`.
fn rules_storage_dir() -> Result<std::path::PathBuf, AppError> {
    #[cfg(test)]
    if let Some(dir) = RULES_STORAGE_DIR_OVERRIDE.lock().unwrap().clone() {
        return Ok(dir);
    }
    dirs::home_dir()
        .ok_or_else(|| AppError::Io("无法找到用户主目录".to_string()))
        .map(|home| home.join(".skillforge").join("rules"))
}

/// Persist a rule's content file `{storage}/{id}.{format}`.
fn write_rule_file(id: &str, format: &str, content: &str) -> Result<(), AppError> {
    let rules_dir = rules_storage_dir()?;
    std::fs::create_dir_all(&rules_dir)?;
    std::fs::write(rules_dir.join(format!("{}.{}", id, format)), content)?;
    Ok(())
}

/// Remove all rule files matching `{storage}/{id}.*`.
fn delete_rule_files(id: &str) -> Result<(), AppError> {
    let rules_dir = rules_storage_dir()?;
    if let Ok(entries) = std::fs::read_dir(&rules_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with(&format!("{}.", id)) {
                    std::fs::remove_file(entry.path()).ok();
                    break;
                }
            }
        }
    }
    Ok(())
}

/// Fetch a single rule by id (without tags).
pub(crate) fn get_rule(conn: &Connection, rule_id: &str) -> Result<Rule, AppError> {
    conn.query_row(
        "SELECT id, name, description, format, content, platform, scope, version, updated_at
         FROM rules WHERE id = ?1",
        params![rule_id],
        |row| {
            Ok(Rule {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                format: row.get(3)?,
                content: row.get(4)?,
                platform: row.get(5)?,
                scope: row.get(6)?,
                version: row.get(7)?,
                updated_at: row.get(8)?,
                tags: Vec::new(),
            })
        },
    )
    .map_err(|_| AppError::RuleNotFound(rule_id.to_string()))
}

/// List rules, optionally filtered by platform.
pub fn list_rules(conn: &Connection, platform: Option<&str>) -> Result<Vec<Rule>, AppError> {
    let mut sql = String::from(
        "SELECT r.id, r.name, r.description, r.format, r.content, r.platform, r.scope, r.version, r.updated_at, \
         IFNULL(json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color, 'tag_type', t.tag_type)), '[]') \
         FROM rules r \
         LEFT JOIN rule_tags rt ON r.id = rt.rule_id \
         LEFT JOIN tags t ON rt.tag_id = t.id",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(platform) = platform {
        sql.push_str(" WHERE r.platform = ?1");
        param_values.push(Box::new(platform.to_string()));
    }

    sql.push_str(" GROUP BY r.id ORDER BY r.name ASC");

    let params: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql)?;
    let rules = stmt
        .query_map(params.as_slice(), |row| {
            let tags_json: String = row.get(9)?;
            Ok(Rule {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                format: row.get(3)?,
                content: row.get(4)?,
                platform: row.get(5)?,
                scope: row.get(6)?,
                version: row.get(7)?,
                updated_at: row.get(8)?,
                tags: parse_tags_json(&tags_json),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rules)
}

/// Create a rule: slugify id, validate content, check duplicate, insert with
/// version 1, persist the content file, and read back the stored rule.
pub fn create_rule(conn: &Connection, data: &CreateRuleDTO) -> Result<Rule, AppError> {
    validate_rule_format(&data.format)?;
    validate_rule_content(&data.content)?;

    let id = slugify(&data.name);
    let now = chrono::Utc::now().to_rfc3339();

    // Check for duplicate
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM rules WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if exists {
        return Err(AppError::Validation(format!("规则标识 '{}' 已存在", id)));
    }

    conn.execute(
        "INSERT INTO rules (id, name, description, format, content, platform, scope, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)",
        params![
            id,
            data.name,
            data.description,
            data.format,
            data.content,
            data.platform,
            data.scope,
            now
        ],
    )?;

    write_rule_file(&id, &data.format, &data.content)?;

    get_rule(conn, &id)
}

/// Update a rule: bump version, merge partial fields, persist content file.
pub fn update_rule(conn: &Connection, id: &str, data: &UpdateRuleDTO) -> Result<(), AppError> {
    // Get current rule
    let current: Rule = get_rule(conn, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let new_version = current.version + 1;

    // Update fields
    let new_name = data.name.clone().unwrap_or(current.name);
    let new_description = data.description.clone().or(current.description);
    let new_content = data.content.clone().unwrap_or(current.content);
    let new_platform = data.platform.clone().or(current.platform);
    let new_scope = data.scope.clone().or(current.scope);

    validate_rule_content(&new_content)?;

    conn.execute(
        "UPDATE rules SET name = ?1, description = ?2, content = ?3, platform = ?4, scope = ?5, version = ?6, updated_at = ?7 WHERE id = ?8",
        params![new_name, new_description, new_content, new_platform, new_scope, new_version, now, id],
    )?;

    // Update file on disk
    write_rule_file(id, &current.format, &new_content)?;

    Ok(())
}

/// Delete a rule and its scene/tag associations plus storage files.
pub fn delete_rule(conn: &Connection, id: &str) -> Result<(), AppError> {
    // Verify rule exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM rules WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::RuleNotFound(id.to_string()));
    }

    // Delete associations and records
    conn.execute("DELETE FROM scene_rules WHERE rule_id = ?1", params![id])?;
    conn.execute("DELETE FROM rule_tags WHERE rule_id = ?1", params![id])?;
    conn.execute("DELETE FROM rules WHERE id = ?1", params![id])?;

    // Delete file from disk
    delete_rule_files(id)?;

    Ok(())
}

/// Resolve the managed-copy path of a rule.
///
/// The path is derived from the rule's storage directory and format as
/// `{storage}/{id}.{format}`, then validated against the filesystem before
/// being returned: `Some(path)` only when the file physically exists, `None`
/// when the DB row still points at a missing file. No distribution status is
/// consulted or fabricated — the filesystem is the source of truth for
/// whether a managed copy can be revealed.
pub fn managed_copy_path(conn: &Connection, rule_id: &str) -> Result<Option<String>, AppError> {
    let rule = get_rule(conn, rule_id)?;
    let path = rules_storage_dir()?.join(format!("{}.{}", rule.id, rule.format));
    if path.exists() {
        Ok(Some(path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    /// Serialize FS-touching tests and point the storage override at a fresh
    /// temp dir for the duration of `f`, isolating rule file writes from the
    /// real `~/.skillforge/rules`.
    fn with_rules_storage_dir<T>(f: impl FnOnce() -> T) -> T {
        let dir = tempfile::tempdir().expect("tempdir creation");
        let _serial = FS_TEST_SERIAL
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        {
            let mut guard = RULES_STORAGE_DIR_OVERRIDE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *guard = Some(dir.path().to_path_buf());
        }
        let result = f();
        {
            let mut guard = RULES_STORAGE_DIR_OVERRIDE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *guard = None;
        }
        result
    }

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        schema::create_tables(&conn).unwrap();
        conn
    }

    fn create_dto(name: &str, content: &str) -> CreateRuleDTO {
        CreateRuleDTO {
            name: name.to_string(),
            description: Some("test rule".to_string()),
            format: "md".to_string(),
            content: content.to_string(),
            platform: Some("claude-code".to_string()),
            scope: Some("global".to_string()),
        }
    }

    #[test]
    fn test_create_rule_returns_rule_with_slugified_id_and_version_1() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            let rule = create_rule(&conn, &create_dto("My Rule", "# content")).unwrap();
            assert_eq!(rule.id, "my-rule");
            assert_eq!(rule.name, "My Rule");
            assert_eq!(rule.version, 1);
        });
    }

    #[test]
    fn test_create_rule_persists_storage_file() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            let rule = create_rule(&conn, &create_dto("My Rule", "# content")).unwrap();
            let storage = rules_storage_dir().unwrap();
            let file = storage.join(format!("{}.{}", rule.id, rule.format));
            assert_eq!(
                std::fs::read_to_string(&file).unwrap(),
                "# content",
                "rule content file should be written to storage"
            );
        });
    }

    #[test]
    fn test_create_rule_duplicate_id_rejected() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            create_rule(&conn, &create_dto("My Rule", "# a")).unwrap();
            let err = create_rule(&conn, &create_dto("My Rule", "# b")).unwrap_err();
            assert!(err.to_string().contains("已存在"), "got: {err}");
        });
    }

    #[test]
    fn test_create_rule_empty_content_rejected() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            let err = create_rule(&conn, &create_dto("Empty", "")).unwrap_err();
            assert!(err.to_string().contains("不能为空"), "got: {err}");
        });
    }

    #[test]
    fn test_create_rule_rejects_traversal_format() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            let mut dto = create_dto("Escape", "# content");
            // Security: format is interpolated into `{id}.{format}` path segments.
            dto.format = "../../../escape".to_string();
            let err = create_rule(&conn, &dto).unwrap_err();
            assert!(err.to_string().contains("格式"), "got: {err}");
            let storage = rules_storage_dir().unwrap();
            assert!(
                !storage.join("escape.md").exists()
                    && !storage.join("escape../../../escape").exists(),
                "no storage file may be written outside the rules dir"
            );
        });
    }

    #[test]
    fn test_create_rule_rejects_unsupported_format() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            let mut dto = create_dto("Txt", "# content");
            dto.format = "txt".to_string();
            let err = create_rule(&conn, &dto).unwrap_err();
            assert!(err.to_string().contains("格式"), "got: {err}");
        });
    }

    #[test]
    fn test_create_rule_accepts_supported_formats() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            for format in ["md", "mdc", "yaml"] {
                let mut dto = create_dto(format, "# content");
                dto.name = format.to_string();
                dto.format = format.to_string();
                let rule = create_rule(&conn, &dto).unwrap();
                assert_eq!(rule.format, format);
                let storage = rules_storage_dir().unwrap();
                assert!(
                    storage.join(format!("{}.{}", rule.id, format)).exists(),
                    "storage file for {format} should exist"
                );
            }
        });
    }

    #[test]
    fn test_create_rule_nul_content_rejected() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            let err = create_rule(&conn, &create_dto("Nul", "bad\0content")).unwrap_err();
            assert!(err.to_string().contains("NUL"), "got: {err}");
        });
    }

    #[test]
    fn test_update_rule_bumps_version_and_merges_content() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            let rule = create_rule(&conn, &create_dto("My Rule", "# v1")).unwrap();
            assert_eq!(rule.version, 1);

            let dto = UpdateRuleDTO {
                name: None,
                description: None,
                content: Some("# v2".to_string()),
                platform: None,
                scope: None,
            };
            update_rule(&conn, &rule.id, &dto).unwrap();

            let updated = get_rule(&conn, &rule.id).unwrap();
            assert_eq!(updated.version, 2, "update should increment version");
            assert_eq!(updated.content, "# v2");
            assert_eq!(updated.name, "My Rule", "unset fields are preserved");

            let storage = rules_storage_dir().unwrap();
            let file = storage.join(format!("{}.{}", rule.id, rule.format));
            assert_eq!(
                std::fs::read_to_string(&file).unwrap(),
                "# v2",
                "updated content should be persisted to storage"
            );
        });
    }

    #[test]
    fn test_update_rule_missing_returns_not_found() {
        let conn = setup_db();
        let dto = UpdateRuleDTO {
            name: None,
            description: None,
            content: None,
            platform: None,
            scope: None,
        };
        let err = update_rule(&conn, "missing", &dto).unwrap_err();
        assert!(matches!(err, AppError::RuleNotFound(_)));
    }

    #[test]
    fn test_update_rule_invalid_content_rejected() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            let rule = create_rule(&conn, &create_dto("My Rule", "# v1")).unwrap();
            let dto = UpdateRuleDTO {
                name: None,
                description: None,
                content: Some("".to_string()),
                platform: None,
                scope: None,
            };
            let err = update_rule(&conn, &rule.id, &dto).unwrap_err();
            assert!(err.to_string().contains("不能为空"), "got: {err}");
        });
    }

    #[test]
    fn test_delete_rule_removes_scene_and_tag_associations() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            let rule = create_rule(&conn, &create_dto("My Rule", "# c")).unwrap();

            conn.execute(
                "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at)
                 VALUES ('s1', 'S', '', 0, 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO scene_rules (scene_id, rule_id, enabled, sort_order) VALUES ('s1', ?1, 1, 0)",
                params![rule.id],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tags (name, color, tag_type) VALUES ('t', '#fff', 'rule')",
                [],
            )
            .unwrap();
            let tag_id: i64 = conn
                .query_row("SELECT last_insert_rowid()", [], |r| r.get(0))
                .unwrap();
            conn.execute(
                "INSERT INTO rule_tags (rule_id, tag_id) VALUES (?1, ?2)",
                params![rule.id, tag_id],
            )
            .unwrap();

            delete_rule(&conn, &rule.id).unwrap();

            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM rules WHERE id = ?1",
                    params![rule.id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 0);
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM scene_rules WHERE rule_id = ?1",
                    params![rule.id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 0);
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM rule_tags WHERE rule_id = ?1",
                    params![rule.id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 0);

            let storage = rules_storage_dir().unwrap();
            assert!(
                !storage.join(format!("{}.md", rule.id)).exists(),
                "storage file should be removed on delete"
            );
        });
    }

    #[test]
    fn test_delete_rule_missing_returns_not_found() {
        let conn = setup_db();
        let err = delete_rule(&conn, "missing").unwrap_err();
        assert!(matches!(err, AppError::RuleNotFound(_)));
    }

    #[test]
    fn test_list_rules_platform_filter_and_tags() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            create_rule(&conn, &create_dto("Alpha", "# a")).unwrap();
            create_rule(&conn, &create_dto("Beta", "# b")).unwrap();
            let mut other = create_dto("Gamma", "# g");
            other.platform = Some("opencode".to_string());
            create_rule(&conn, &other).unwrap();

            // Assign a tag to Alpha and assert it round-trips through list.
            conn.execute(
                "INSERT INTO tags (name, color, tag_type) VALUES ('rust', '#ff6600', 'rule')",
                [],
            )
            .unwrap();
            let tag_id: i64 = conn
                .query_row("SELECT last_insert_rowid()", [], |r| r.get(0))
                .unwrap();
            conn.execute(
                "INSERT INTO rule_tags (rule_id, tag_id) VALUES ('alpha', ?1)",
                params![tag_id],
            )
            .unwrap();

            let all = list_rules(&conn, None).unwrap();
            assert_eq!(all.len(), 3);

            let alpha = all.iter().find(|r| r.id == "alpha").unwrap();
            assert_eq!(alpha.tags.len(), 1);
            assert_eq!(alpha.tags[0].name, "rust");

            let filtered = list_rules(&conn, Some("claude-code")).unwrap();
            assert_eq!(filtered.len(), 2);
            assert!(
                filtered
                    .iter()
                    .all(|r| r.platform.as_deref() == Some("claude-code")),
                "platform filter should only return matching rules"
            );
        });
    }

    #[test]
    fn test_get_rule_missing_returns_not_found() {
        let conn = setup_db();
        let err = get_rule(&conn, "missing").unwrap_err();
        assert!(matches!(err, AppError::RuleNotFound(_)));
    }

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("My Rule!"), "my-rule");
        assert_eq!(slugify("  Multi   Word  "), "multi-word");
        assert_eq!(slugify("Rust-2026"), "rust-2026");
    }

    #[test]
    fn test_validate_rule_content_rejects_nul_byte() {
        let err = validate_rule_content("bad\0content").unwrap_err();
        assert!(err.to_string().contains("NUL"), "got: {err}");
    }

    #[test]
    fn test_validate_rule_content_accepts_normal_content() {
        assert!(validate_rule_content("# Rule\nline\n").is_ok());
    }

    #[test]
    fn test_managed_copy_path_returns_path_when_storage_file_exists() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            let rule = create_rule(&conn, &create_dto("My Rule", "# content")).unwrap();

            let path = managed_copy_path(&conn, &rule.id)
                .expect("query should succeed")
                .expect("managed copy exists on disk, so a path must be returned");
            let expected = rules_storage_dir()
                .unwrap()
                .join(format!("{}.{}", rule.id, rule.format));
            assert_eq!(
                std::path::Path::new(&path),
                expected,
                "returned path must be the rule's managed copy file"
            );
        });
    }

    #[test]
    fn test_managed_copy_path_returns_none_when_storage_file_is_missing() {
        with_rules_storage_dir(|| {
            let conn = setup_db();
            let rule = create_rule(&conn, &create_dto("Ghost", "# content")).unwrap();

            let storage = rules_storage_dir().unwrap();
            std::fs::remove_file(storage.join(format!("{}.md", rule.id))).unwrap();

            let path = managed_copy_path(&conn, &rule.id).expect("query should succeed");
            assert!(
                path.is_none(),
                "filesystem-as-truth: a missing managed copy must yield None"
            );
        });
    }

    #[test]
    fn test_managed_copy_path_missing_rule_errors() {
        let conn = setup_db();
        let err = managed_copy_path(&conn, "missing").unwrap_err();
        assert!(matches!(err, AppError::RuleNotFound(_)));
    }

    #[test]
    fn test_validate_rule_format_accepts_supported_formats() {
        for format in ["md", "mdc", "yaml"] {
            assert!(
                validate_rule_format(format).is_ok(),
                "format {format:?} should be accepted"
            );
        }
    }

    #[test]
    fn test_validate_rule_format_rejects_traversal_and_unknown_formats() {
        for format in [
            "../../../escape",
            "txt",
            "html",
            "md/../../x",
            ".",
            "..",
            "",
        ] {
            let err = validate_rule_format(format).unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err}");
            assert!(err.to_string().contains("格式"), "got: {err}");
        }
    }
}
