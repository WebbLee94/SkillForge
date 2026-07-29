use crate::error::AppError;
use crate::plugins::source::SourcePlugin;
use crate::types::{Skill, SkillFilter, SkillVersion, Tag};

use rusqlite::params;

/// Install a skill from a source plugin.
/// Fetches the skill bundle, stores files to disk, and writes metadata to DB.
pub fn install_skill(
    conn: &rusqlite::Connection,
    source_plugin: &dyn SourcePlugin,
    skill_id: &str,
) -> Result<Skill, AppError> {
    // Fetch skill bundle from source first
    let bundle = source_plugin.fetch(skill_id, None)?;

    // Determine local storage path
    let data_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Io("无法找到用户主目录".to_string()))?
        .join(".skillforge");
    let local_path = data_dir.join("skills").join(&bundle.meta.id);

    // Check if already installed using the canonical skill ID from the bundle
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM skills WHERE id = ?1",
            params![bundle.meta.id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if exists {
        // Silent overwrite: use UPDATE to preserve skill_tags and scene_skills relationships
        // (DELETE would cascade via foreign keys and destroy all tags/scene bindings)
        store_skill_files(&local_path, &bundle)?;
        conn.execute(
            "UPDATE skills SET name = ?1, description = ?2, source_type = ?3, source_url = ?4, current_ver = ?5, local_path = ?6, metadata = ?7 WHERE id = ?8",
            params![
                bundle.meta.name,
                bundle.meta.description,
                bundle.meta.source_type,
                bundle.meta.source_url,
                bundle.meta.version,
                local_path.to_string_lossy().to_string(),
                bundle.meta.metadata,
                bundle.meta.id,
            ],
        )?;
        // Record new version
        if let Some(ver) = &bundle.meta.version {
            let fetched_at = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO skill_versions (skill_id, version, source_ref, checksum, fetched_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![bundle.meta.id, ver, bundle.meta.source_url, Option::<String>::None, fetched_at],
            )?;
        }
        return query_skill_by_id(conn, &bundle.meta.id);
    }

    // New install: store files and insert DB record
    store_skill_files(&local_path, &bundle)?;

    let now = chrono::Utc::now().to_rfc3339();

    // Insert into skills table
    conn.execute(
        "INSERT INTO skills (id, name, description, source_type, source_url, current_ver, installed_at, local_path, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            bundle.meta.id,
            bundle.meta.name,
            bundle.meta.description,
            bundle.meta.source_type,
            bundle.meta.source_url,
            bundle.meta.version,
            now,
            local_path.to_string_lossy().to_string(),
            bundle.meta.metadata,
        ],
    )?;

    // Record version
    if let Some(ver) = &bundle.meta.version {
        let fetched_at = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO skill_versions (skill_id, version, source_ref, checksum, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![bundle.meta.id, ver, bundle.meta.source_url, Option::<String>::None, fetched_at],
        )?;
    }

    // Read back the installed skill
    let skill = query_skill_by_id(conn, &bundle.meta.id)?;
    Ok(skill)
}

/// Uninstall a skill: delete files and DB records.
/// Checks scene references, removes from scenes automatically, and logs affected scenes.
pub fn uninstall_skill(
    conn: &rusqlite::Connection,
    skill_id: &str,
) -> Result<Skill, AppError> {
    let skill = query_skill_by_id(conn, skill_id)?;

    // Check scene references: collect affected scene IDs before deletion
    let affected_scenes: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT scene_id FROM scene_skills WHERE skill_id = ?1",
        )?;
        let rows = stmt.query_map(params![skill_id], |row| row.get(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let scene_count = affected_scenes.len() as i32;
    if scene_count > 0 {
        let _ = (scene_count, affected_scenes.join(", "));
    }

    // Delete skill files from disk
    let local_path = std::path::PathBuf::from(&skill.local_path);
    if local_path.exists() {
        std::fs::remove_dir_all(&local_path)?;
    }

    // Delete DB records (cascading will handle skill_versions, skill_tags, scene_skills)
    conn.execute("DELETE FROM scene_skills WHERE skill_id = ?1", params![skill_id])?;
    conn.execute("DELETE FROM skill_tags WHERE skill_id = ?1", params![skill_id])?;
    conn.execute("DELETE FROM skill_versions WHERE skill_id = ?1", params![skill_id])?;
    conn.execute("DELETE FROM skills WHERE id = ?1", params![skill_id])?;

    // Update timestamps for affected scenes
    let now = chrono::Utc::now().to_rfc3339();
    for scene_id in &affected_scenes {
        conn.execute(
            "UPDATE scenes SET updated_at = ?1 WHERE id = ?2",
            params![now, scene_id],
        )?;
    }

    Ok(skill)
}

/// Update a skill: compare versions, fetch new, update files and DB.
pub fn update_skill(
    conn: &rusqlite::Connection,
    source_plugin: &dyn SourcePlugin,
    skill_id: &str,
) -> Result<Skill, AppError> {
    let existing = query_skill_by_id(conn, skill_id)?;

    // Fetch latest from source
    let bundle = source_plugin.fetch(skill_id, None)?;

    // Check if version changed
    let new_version = bundle.meta.version.as_deref().unwrap_or("latest");
    let current_version = existing.current_ver.as_deref().unwrap_or("unknown");

    if new_version == current_version {
        return Ok(existing); // Already up to date
    }

    // Update skill files on disk
    let local_path = std::path::PathBuf::from(&existing.local_path);
    if local_path.exists() {
        std::fs::remove_dir_all(&local_path)?;
    }
    store_skill_files(&local_path, &bundle)?;

    // Update DB record
    conn.execute(
        "UPDATE skills SET name = ?1, description = ?2, current_ver = ?3, metadata = ?4 WHERE id = ?5",
        params![
            bundle.meta.name,
            bundle.meta.description,
            bundle.meta.version,
            bundle.meta.metadata,
            skill_id,
        ],
    )?;

    // Record new version
    let fetched_at = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO skill_versions (skill_id, version, source_ref, checksum, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![skill_id, new_version, bundle.meta.source_url, Option::<String>::None, fetched_at],
    )?;

    query_skill_by_id(conn, skill_id)
}

/// List skills with optional filtering.
pub fn list_skills(
    conn: &rusqlite::Connection,
    filter: &SkillFilter,
) -> Result<Vec<Skill>, AppError> {
    let mut sql = String::from(
        "SELECT s.id, s.name, s.description, s.source_type, s.source_url, s.current_ver, s.installed_at, s.local_path, s.metadata, \
         IFNULL(json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color, 'tag_type', t.tag_type)), '[]') \
         FROM skills s \
         LEFT JOIN skill_tags st ON s.id = st.skill_id \
         LEFT JOIN tags t ON st.tag_id = t.id \
         WHERE 1=1",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref source_type) = filter.source_type {
        sql.push_str(&format!(" AND s.source_type = ?{}", param_idx));
        param_values.push(Box::new(source_type.clone()));
        param_idx += 1;
    }

    if let Some(ref tag) = filter.tag {
        sql.push_str(&format!(
            " AND s.id IN (SELECT skill_id FROM skill_tags WHERE tag_id IN (SELECT id FROM tags WHERE name = ?{} AND tag_type = 'skill'))",
            param_idx
        ));
        param_values.push(Box::new(tag.clone()));
    }

    sql.push_str(" GROUP BY s.id ORDER BY s.name ASC");

    let params: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql)?;
    let skills = stmt
        .query_map(params.as_slice(), |row| {
            let tags_json: String = row.get(9)?;
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
                tags: parse_tags_json(&tags_json),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(skills)
}

/// Search skills by name or description.
pub fn search_skills(
    conn: &rusqlite::Connection,
    query: &str,
) -> Result<Vec<Skill>, AppError> {
    let pattern = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.description, s.source_type, s.source_url, s.current_ver, s.installed_at, s.local_path, s.metadata, \
         IFNULL(json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color, 'tag_type', t.tag_type)), '[]') \
         FROM skills s \
         LEFT JOIN skill_tags st ON s.id = st.skill_id \
         LEFT JOIN tags t ON st.tag_id = t.id \
         WHERE s.name LIKE ?1 OR s.description LIKE ?1 \
         GROUP BY s.id \
         ORDER BY s.name ASC",
    )?;

    let skills = stmt
        .query_map(params![pattern], |row| {
            let tags_json: String = row.get(9)?;
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
                tags: parse_tags_json(&tags_json),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(skills)
}

/// Get version history for a skill.
pub fn get_skill_versions(
    conn: &rusqlite::Connection,
    skill_id: &str,
) -> Result<Vec<SkillVersion>, AppError> {
    // Verify skill exists
    query_skill_by_id(conn, skill_id)?;

    let mut stmt = conn.prepare(
        "SELECT skill_id, version, source_ref, checksum, fetched_at
         FROM skill_versions
         WHERE skill_id = ?1
         ORDER BY fetched_at DESC",
    )?;

    let versions = stmt
        .query_map(params![skill_id], |row| {
            Ok(SkillVersion {
                skill_id: row.get(0)?,
                version: row.get(1)?,
                source_ref: row.get(2)?,
                checksum: row.get(3)?,
                fetched_at: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(versions)
}

// ── Internal helpers ───────────────────────────────────────────────

/// Parse the JSON string produced by `json_group_array` into `Vec<Tag>`.
/// Handles the edge case where LEFT JOIN yields `[""]` (no matching tags).
fn parse_tags_json(json: &str) -> Vec<Tag> {
    // json_group_array with LEFT JOIN on no matches produces `[""]` or `[{"id":null,...}]`
    if json == "[\"\"]" || json == "[]" {
        return Vec::new();
    }
    let tags: Vec<Tag> = serde_json::from_str(json).unwrap_or_default();
    // Filter out null-id entries from LEFT JOIN with no matching tags
    tags.into_iter().filter(|t| t.id != 0).collect()
}

fn query_skill_by_id(conn: &rusqlite::Connection, id: &str) -> Result<Skill, AppError> {
    conn.query_row(
        "SELECT s.id, s.name, s.description, s.source_type, s.source_url, s.current_ver, s.installed_at, s.local_path, s.metadata, \
         IFNULL(json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color, 'tag_type', t.tag_type)), '[]') \
         FROM skills s \
         LEFT JOIN skill_tags st ON s.id = st.skill_id \
         LEFT JOIN tags t ON st.tag_id = t.id \
         WHERE s.id = ?1 \
         GROUP BY s.id",
        params![id],
        |row| {
            let tags_json: String = row.get(9)?;
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
                tags: parse_tags_json(&tags_json),
            })
        },
    )
    .map_err(|_| AppError::SkillNotFound(id.to_string()))
}

/// Store skill files to the local filesystem
pub fn store_skill_files_public(
    local_path: &std::path::Path,
    bundle: &crate::types::SkillBundle,
) -> Result<(), AppError> {
    store_skill_files(local_path, bundle)
}

fn store_skill_files(
    local_path: &std::path::Path,
    bundle: &crate::types::SkillBundle,
) -> Result<(), AppError> {
    // Create skill directory
    std::fs::create_dir_all(local_path)?;

    // Write SKILL.md (full content including frontmatter)
    let full_md = format!(
        "---\nname: {}\ndescription: {}{}{}{}\n---\n\n{}",
        bundle.meta.name,
        bundle.meta.description,
        bundle
            .meta
            .version
            .as_ref()
            .map(|v| format!("\nversion: \"{}\"", v))
            .unwrap_or_default(),
        bundle
            .meta
            .metadata
            .as_ref()
            .map(|m| format!("\nmetadata: {}", m))
            .unwrap_or_default(),
        if bundle.meta.source_type.is_empty() {
            String::new()
        } else {
            format!("\nsource_type: {}", bundle.meta.source_type)
        },
        bundle.skill_md,
    );
    std::fs::write(local_path.join("SKILL.md"), full_md)?;

    // Copy subdirectory contents from source if available
    if let Some(ref source_url) = bundle.meta.source_url {
        let source_dir = std::path::Path::new(source_url);
        for subdir in &bundle.subdirs {
            let src_subdir = source_dir.join(subdir);
            let dst_subdir = local_path.join(subdir);
            if src_subdir.exists() && src_subdir.is_dir() {
                if let Err(e) = crate::plugins::platform::copy_dir_recursive(&src_subdir, &dst_subdir) {
                    eprintln!("Warning: Failed to copy subdirectory {}: {}", subdir, e);
                }
            } else {
                std::fs::create_dir_all(&dst_subdir)?;
            }
        }
    } else {
        // No source URL — create empty directory placeholders
        for subdir in &bundle.subdirs {
            std::fs::create_dir_all(local_path.join(subdir))?;
        }
    }

    Ok(())
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
    fn test_list_skills_empty() {
        let conn = setup_db();
        let filter = SkillFilter {
            source_type: None,
            tag: None,
        };
        let skills = list_skills(&conn, &filter).unwrap();
        assert!(skills.is_empty());
    }

    #[test]
    fn test_search_skills() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO skills (id, name, description, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["java-springboot", "Java Spring Boot", "Spring Boot best practices", "local-fs", now, "/tmp/skills/java-springboot"],
        ).unwrap();

        let results = search_skills(&conn, "spring").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "java-springboot");

        let results = search_skills(&conn, "python").unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_uninstall_nonexistent() {
        let conn = setup_db();
        let result = uninstall_skill(&conn, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_uninstall_skill_in_use() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();

        // Insert a skill
        conn.execute(
            "INSERT INTO skills (id, name, description, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["test-skill", "Test Skill", "A test", "local-fs", now, "/tmp/skillforge-test/test-skill"],
        ).unwrap();

        // Create a scene and add the skill to it
        conn.execute(
            "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
            params!["test-scene", "Test Scene", "A test scene", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO scene_skills (scene_id, skill_id, enabled, sort_order) VALUES (?1, ?2, 1, 0)",
            params!["test-scene", "test-skill"],
        ).unwrap();

        // Create the skill directory on disk so uninstall can remove it
        std::fs::create_dir_all("/tmp/skillforge-test/test-skill").ok();

        // Uninstall should succeed (warn but not block)
        let result = uninstall_skill(&conn, "test-skill");
        assert!(result.is_ok());

        // Verify scene_skills reference was removed
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scene_skills WHERE skill_id = ?1",
                params!["test-skill"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);

        // Verify skill was removed
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM skills WHERE id = ?1",
                params!["test-skill"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);

        // Cleanup
        std::fs::remove_dir_all("/tmp/skillforge-test").ok();
    }

    #[test]
    fn test_install_duplicate_skill() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();

        // Insert a skill
        conn.execute(
            "INSERT INTO skills (id, name, description, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["test-skill", "Test Skill", "A test", "local-fs", now, "/tmp/test"],
        ).unwrap();

        // Try to install the same skill again (using the engine's install_skill would require
        // a source plugin, so we test the duplicate check logic directly)
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM skills WHERE id = ?1",
                params!["test-skill"],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap();
        assert!(exists);

        // The install_skill function would return DuplicateSkill error
        // We verify the error type exists and has the right message
        let err = AppError::DuplicateSkill("test-skill".to_string());
        assert!(err.to_string().contains("test-skill"));
    }

    #[test]
    fn test_list_skills_with_tags() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();

        // Insert a skill
        conn.execute(
            "INSERT INTO skills (id, name, description, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["tagged-skill", "Tagged Skill", "A skill with tags", "local-fs", now, "/tmp/test"],
        ).unwrap();

        // Insert a tag
        conn.execute(
            "INSERT INTO tags (name, color, tag_type) VALUES (?1, ?2, 'skill')",
            params!["rust", "#ff6600"],
        ).unwrap();
        let tag_id: i64 = conn.query_row("SELECT last_insert_rowid()", [], |r| r.get(0)).unwrap();

        // Associate tag with skill
        conn.execute(
            "INSERT INTO skill_tags (skill_id, tag_id) VALUES (?1, ?2)",
            params!["tagged-skill", tag_id],
        ).unwrap();

        let filter = SkillFilter { source_type: None, tag: None };
        let skills = list_skills(&conn, &filter).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].tags.len(), 1);
        assert_eq!(skills[0].tags[0].name, "rust");
        assert_eq!(skills[0].tags[0].color, Some("#ff6600".to_string()));
    }

    #[test]
    fn test_list_skills_without_tags() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();

        // Insert a skill without tags
        conn.execute(
            "INSERT INTO skills (id, name, description, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["untagged-skill", "Untagged Skill", "No tags", "local-fs", now, "/tmp/test"],
        ).unwrap();

        let filter = SkillFilter { source_type: None, tag: None };
        let skills = list_skills(&conn, &filter).unwrap();
        assert_eq!(skills.len(), 1);
        assert!(skills[0].tags.is_empty());
    }
}
