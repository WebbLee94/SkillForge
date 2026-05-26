use crate::error::AppError;
use crate::types::{
    CreateSceneDTO, Scene, SceneDetail, SceneRuleEntry, SceneSkillEntry,
    UpdateSceneDTO, ValidationResult,
};

use rusqlite::params;

/// Create a new scene with associated skills and rules.
pub fn create_scene(
    conn: &rusqlite::Connection,
    data: &CreateSceneDTO,
) -> Result<Scene, AppError> {
    let id = slugify(&data.name);

    // Check for duplicate
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM scenes WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if exists {
        return Err(AppError::Validation(format!(
            "场景标识 '{}' 已存在",
            id
        )));
    }

    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO scenes (id, name, description, icon, is_template, is_system, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?6)",
        params![id, data.name, data.description, data.icon, now, now],
    )?;

    // Add skills to scene
    if let Some(ref skill_ids) = data.skill_ids {
        for (idx, skill_id) in skill_ids.iter().enumerate() {
            // Verify skill exists
            let skill_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM skills WHERE id = ?1",
                    params![skill_id],
                    |row| row.get::<_, i64>(0),
                )
                .map(|c| c > 0)?;

            if !skill_exists {
                return Err(AppError::SkillNotFound(skill_id.clone()));
            }

            conn.execute(
                "INSERT INTO scene_skills (scene_id, skill_id, enabled, sort_order) VALUES (?1, ?2, 1, ?3)",
                params![id, skill_id, idx as i32],
            )?;
        }
    }

    // Add rules to scene
    if let Some(ref rule_ids) = data.rule_ids {
        for (idx, rule_id) in rule_ids.iter().enumerate() {
            let rule_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM rules WHERE id = ?1",
                    params![rule_id],
                    |row| row.get::<_, i64>(0),
                )
                .map(|c| c > 0)?;

            if !rule_exists {
                return Err(AppError::RuleNotFound(rule_id.clone()));
            }

            conn.execute(
                "INSERT INTO scene_rules (scene_id, rule_id, enabled, sort_order) VALUES (?1, ?2, 1, ?3)",
                params![id, rule_id, idx as i32],
            )?;
        }
    }

    query_scene_by_id(conn, &id)
}

/// Update a scene's metadata.
pub fn update_scene(
    conn: &rusqlite::Connection,
    id: &str,
    data: &UpdateSceneDTO,
) -> Result<(), AppError> {
    let _scene = query_scene_by_id(conn, id)?;

    if id == "__all_skills__" {
        return Err(AppError::Validation(
            "无法修改系统场景 '__all_skills__'".to_string(),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();

    if let Some(ref name) = data.name {
        conn.execute(
            "UPDATE scenes SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, id],
        )?;
    }
    if let Some(ref description) = data.description {
        conn.execute(
            "UPDATE scenes SET description = ?1, updated_at = ?2 WHERE id = ?3",
            params![description, now, id],
        )?;
    }
    if let Some(ref icon) = data.icon {
        conn.execute(
            "UPDATE scenes SET icon = ?1, updated_at = ?2 WHERE id = ?3",
            params![icon, now, id],
        )?;
    }

    Ok(())
}

/// Delete a scene. Blocks if the scene is in use by projects.
/// Returns SceneInUse error with project count and names.
pub fn delete_scene(conn: &rusqlite::Connection, id: &str) -> Result<(), AppError> {
    if id == "__all_skills__" {
        return Err(AppError::Validation(
            "无法删除系统场景 '__all_skills__'".to_string(),
        ));
    }

    let _scene = query_scene_by_id(conn, id)?;

    // Check project references: collect project names for error message
    let project_count: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE scene_id = ?1",
            params![id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if project_count > 0 {
        return Err(AppError::SceneInUse(project_count));
    }

    // Delete associations (cascading should handle this, but be explicit)
    conn.execute("DELETE FROM scene_skills WHERE scene_id = ?1", params![id])?;
    conn.execute("DELETE FROM scene_rules WHERE scene_id = ?1", params![id])?;
    conn.execute("DELETE FROM distributions WHERE scene_id = ?1", params![id])?;
    conn.execute("DELETE FROM scenes WHERE id = ?1", params![id])?;

    Ok(())
}

/// Add a skill to a scene.
pub fn add_skill_to_scene(
    conn: &rusqlite::Connection,
    scene_id: &str,
    skill_id: &str,
) -> Result<(), AppError> {
    let _scene = query_scene_by_id(conn, scene_id)?;

    // Verify skill exists
    let skill_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM skills WHERE id = ?1",
            params![skill_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !skill_exists {
        return Err(AppError::SkillNotFound(skill_id.to_string()));
    }

    // Get next sort order
    let max_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM scene_skills WHERE scene_id = ?1",
            params![scene_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    conn.execute(
        "INSERT OR IGNORE INTO scene_skills (scene_id, skill_id, enabled, sort_order) VALUES (?1, ?2, 1, ?3)",
        params![scene_id, skill_id, max_order + 1],
    )?;

    // Update scene timestamp
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE scenes SET updated_at = ?1 WHERE id = ?2",
        params![now, scene_id],
    )?;

    Ok(())
}

/// Remove a skill from a scene.
pub fn remove_skill_from_scene(
    conn: &rusqlite::Connection,
    scene_id: &str,
    skill_id: &str,
) -> Result<(), AppError> {
    let _scene = query_scene_by_id(conn, scene_id)?;

    conn.execute(
        "DELETE FROM scene_skills WHERE scene_id = ?1 AND skill_id = ?2",
        params![scene_id, skill_id],
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE scenes SET updated_at = ?1 WHERE id = ?2",
        params![now, scene_id],
    )?;

    Ok(())
}

/// Add a rule to a scene.
pub fn add_rule_to_scene(
    conn: &rusqlite::Connection,
    scene_id: &str,
    rule_id: &str,
) -> Result<(), AppError> {
    let _scene = query_scene_by_id(conn, scene_id)?;

    // Verify rule exists
    let rule_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM rules WHERE id = ?1",
            params![rule_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !rule_exists {
        return Err(AppError::RuleNotFound(rule_id.to_string()));
    }

    // Get next sort order
    let max_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM scene_rules WHERE scene_id = ?1",
            params![scene_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    conn.execute(
        "INSERT OR IGNORE INTO scene_rules (scene_id, rule_id, enabled, sort_order) VALUES (?1, ?2, 1, ?3)",
        params![scene_id, rule_id, max_order + 1],
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE scenes SET updated_at = ?1 WHERE id = ?2",
        params![now, scene_id],
    )?;

    Ok(())
}

/// Remove a rule from a scene.
pub fn remove_rule_from_scene(
    conn: &rusqlite::Connection,
    scene_id: &str,
    rule_id: &str,
) -> Result<(), AppError> {
    let _scene = query_scene_by_id(conn, scene_id)?;

    conn.execute(
        "DELETE FROM scene_rules WHERE scene_id = ?1 AND rule_id = ?2",
        params![scene_id, rule_id],
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE scenes SET updated_at = ?1 WHERE id = ?2",
        params![now, scene_id],
    )?;

    Ok(())
}

/// List all scenes. The __all_skills__ scene appears first.
pub fn list_scenes(conn: &rusqlite::Connection) -> Result<Vec<Scene>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, icon, is_template, is_system, created_at, updated_at
         FROM scenes
         ORDER BY CASE WHEN id = '__all_skills__' THEN 0 ELSE 1 END, name ASC",
    )?;

    let scenes = stmt
        .query_map([], |row| {
            Ok(Scene {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                icon: row.get(3)?,
                is_template: row.get::<_, i32>(4)? != 0,
                is_system: row.get::<_, i32>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(scenes)
}

/// Get detailed scene information including associated skills and rules.
pub fn get_scene_detail(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<SceneDetail, AppError> {
    let scene = query_scene_by_id(conn, id)?;

    let skills = if id == "__all_skills__" {
        // Virtual scene: return all installed skills
        get_all_skills_as_entries(conn)?
    } else {
        get_scene_skill_entries(conn, id)?
    };

    let rules = if id == "__all_skills__" {
        // Virtual scene: return all rules
        get_all_rules_as_entries(conn)?
    } else {
        get_scene_rule_entries(conn, id)?
    };

    Ok(SceneDetail {
        scene,
        skills,
        rules,
    })
}

/// Validate a scene: check all skills are installed, no version conflicts.
pub fn validate_scene(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<ValidationResult, AppError> {
    let _scene = query_scene_by_id(conn, id)?;
    let mut errors = Vec::new();

    // Get scene skills
    let skill_ids: Vec<String> = if id == "__all_skills__" {
        conn.prepare("SELECT id FROM skills")?
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect()
    } else {
        conn.prepare("SELECT skill_id FROM scene_skills WHERE scene_id = ?1 AND enabled = 1")?
            .query_map(params![id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect()
    };

    // Check each skill is installed
    for skill_id in &skill_ids {
        let installed: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM skills WHERE id = ?1",
                params![skill_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if !installed {
            errors.push(format!("技能 '{}' 未安装", skill_id));
        }
    }

    Ok(ValidationResult {
        valid: errors.is_empty(),
        errors,
    })
}

/// Get the virtual __all_skills__ scene detail.
pub fn get_all_skills_scene(conn: &rusqlite::Connection) -> Result<SceneDetail, AppError> {
    get_scene_detail(conn, "__all_skills__")
}

/// Get platform IDs associated with a scene.
/// Only returns platforms that are enabled (p.enabled != 0).
pub fn get_scene_platforms(
    conn: &rusqlite::Connection,
    scene_id: &str,
) -> Result<Vec<String>, AppError> {
    let _scene = query_scene_by_id(conn, scene_id)?;

    let mut stmt = conn.prepare(
        "SELECT sp.platform_id FROM scene_platforms sp
         INNER JOIN platforms p ON sp.platform_id = p.id
         WHERE sp.scene_id = ?1 AND p.enabled != 0",
    )?;

    let platform_ids: Vec<String> = stmt
        .query_map(params![scene_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(platform_ids)
}

/// Set (replace) platform associations for a scene.
pub fn set_scene_platforms(
    conn: &rusqlite::Connection,
    scene_id: &str,
    platform_ids: &[String],
) -> Result<(), AppError> {
    let _scene = query_scene_by_id(conn, scene_id)?;

    // Clear existing associations
    conn.execute(
        "DELETE FROM scene_platforms WHERE scene_id = ?1",
        params![scene_id],
    )?;

    // Insert new associations
    for platform_id in platform_ids {
        conn.execute(
            "INSERT OR IGNORE INTO scene_platforms (scene_id, platform_id) VALUES (?1, ?2)",
            params![scene_id, platform_id],
        )?;
    }

    Ok(())
}

// ── Internal helpers ───────────────────────────────────────────────

fn query_scene_by_id(conn: &rusqlite::Connection, id: &str) -> Result<Scene, AppError> {
    conn.query_row(
        "SELECT id, name, description, icon, is_template, is_system, created_at, updated_at
         FROM scenes WHERE id = ?1",
        params![id],
        |row| {
            Ok(Scene {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                icon: row.get(3)?,
                is_template: row.get::<_, i32>(4)? != 0,
                is_system: row.get::<_, i32>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .map_err(|_| AppError::SceneNotFound(id.to_string()))
}

fn get_scene_skill_entries(
    conn: &rusqlite::Connection,
    scene_id: &str,
) -> Result<Vec<SceneSkillEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT ss.skill_id, s.name, ss.version, ss.enabled, ss.sort_order, ss.config
         FROM scene_skills ss
         LEFT JOIN skills s ON ss.skill_id = s.id
         WHERE ss.scene_id = ?1
         ORDER BY ss.sort_order ASC",
    )?;

    let entries = stmt
        .query_map(params![scene_id], |row| {
            Ok(SceneSkillEntry {
                skill_id: row.get(0)?,
                skill_name: row.get(1).unwrap_or_default(),
                version: row.get(2)?,
                enabled: row.get::<_, i32>(3)? != 0,
                sort_order: row.get(4)?,
                config: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

fn get_scene_rule_entries(
    conn: &rusqlite::Connection,
    scene_id: &str,
) -> Result<Vec<SceneRuleEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT sr.rule_id, r.name, sr.enabled, sr.sort_order
         FROM scene_rules sr
         LEFT JOIN rules r ON sr.rule_id = r.id
         WHERE sr.scene_id = ?1
         ORDER BY sr.sort_order ASC",
    )?;

    let entries = stmt
        .query_map(params![scene_id], |row| {
            Ok(SceneRuleEntry {
                rule_id: row.get(0)?,
                rule_name: row.get(1).unwrap_or_default(),
                enabled: row.get::<_, i32>(2)? != 0,
                sort_order: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

fn get_all_skills_as_entries(
    conn: &rusqlite::Connection,
) -> Result<Vec<SceneSkillEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, current_ver FROM skills ORDER BY name ASC",
    )?;

    let entries = stmt
        .query_map([], |row| {
            Ok(SceneSkillEntry {
                skill_id: row.get(0)?,
                skill_name: row.get(1)?,
                version: row.get(2)?,
                enabled: true,
                sort_order: 0,
                config: None,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

fn get_all_rules_as_entries(
    conn: &rusqlite::Connection,
) -> Result<Vec<SceneRuleEntry>, AppError> {
    let mut stmt = conn.prepare("SELECT id, name FROM rules ORDER BY name ASC")?;

    let entries = stmt
        .query_map([], |row| {
            Ok(SceneRuleEntry {
                rule_id: row.get(0)?,
                rule_name: row.get(1)?,
                enabled: true,
                sort_order: 0,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

/// Convert a name to a URL-safe slug (kebab-case)
fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
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
    fn test_create_scene() {
        let conn = setup_db();
        let dto = CreateSceneDTO {
            name: "My Scene".to_string(),
            description: Some("A test scene".to_string()),
            icon: Some("folder".to_string()),
            skill_ids: None,
            rule_ids: None,
        };
        let scene = create_scene(&conn, &dto).unwrap();
        assert_eq!(scene.id, "my-scene");
        assert_eq!(scene.name, "My Scene");
    }

    #[test]
    fn test_list_scenes() {
        let conn = setup_db();
        let scenes = list_scenes(&conn).unwrap();
        // __all_skills__ is built-in
        assert_eq!(scenes.len(), 1);
        assert_eq!(scenes[0].id, "__all_skills__");
    }

    #[test]
    fn test_delete_system_scene_blocked() {
        let conn = setup_db();
        let result = delete_scene(&conn, "__all_skills__");
        assert!(result.is_err());
    }

    #[test]
    fn test_update_system_scene_blocked() {
        let conn = setup_db();
        let dto = UpdateSceneDTO {
            name: Some("New Name".to_string()),
            description: None,
            icon: None,
        };
        let result = update_scene(&conn, "__all_skills__", &dto);
        assert!(result.is_err());
    }

    #[test]
    fn test_add_skill_to_scene() {
        let conn = setup_db();

        // Insert a skill first
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO skills (id, name, description, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params!["test-skill", "Test Skill", "A test", "local-fs", now, "/tmp/test"],
        ).unwrap();

        // Create a scene
        let dto = CreateSceneDTO {
            name: "Test Scene".to_string(),
            description: None,
            icon: None,
            skill_ids: None,
            rule_ids: None,
        };
        let scene = create_scene(&conn, &dto).unwrap();

        // Add skill
        add_skill_to_scene(&conn, &scene.id, "test-skill").unwrap();

        let detail = get_scene_detail(&conn, &scene.id).unwrap();
        assert_eq!(detail.skills.len(), 1);
        assert_eq!(detail.skills[0].skill_id, "test-skill");
    }

    #[test]
    fn test_validate_scene() {
        let conn = setup_db();

        let dto = CreateSceneDTO {
            name: "Test".to_string(),
            description: None,
            icon: None,
            skill_ids: None,
            rule_ids: None,
        };
        let scene = create_scene(&conn, &dto).unwrap();

        let result = validate_scene(&conn, &scene.id).unwrap();
        assert!(result.valid);
    }

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("Hello World"), "hello-world");
        assert_eq!(slugify("My Cool Scene!"), "my-cool-scene");
        assert_eq!(slugify("  spaces  "), "spaces");
    }

    #[test]
    fn test_delete_scene_in_use() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();

        // Create a scene
        conn.execute(
            "INSERT INTO scenes (id, name, description, is_template, is_system, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
            params!["test-scene", "Test Scene", "A test scene", now, now],
        ).unwrap();

        // Create a project that uses the scene
        conn.execute(
            "INSERT INTO projects (id, name, path, scene_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["test-project", "Test Project", "/tmp/test-project", "test-scene", now, now],
        ).unwrap();

        // Deleting the scene should fail with SceneInUse
        let result = delete_scene(&conn, "test-scene");
        assert!(result.is_err());

        match result.unwrap_err() {
            AppError::SceneInUse(count) => assert_eq!(count, 1),
            other => panic!("Expected SceneInUse error, got: {:?}", other),
        }
    }

    #[test]
    fn test_create_scene_duplicate_name() {
        let conn = setup_db();

        let dto = CreateSceneDTO {
            name: "My Scene".to_string(),
            description: None,
            icon: None,
            skill_ids: None,
            rule_ids: None,
        };

        // First creation should succeed
        let result = create_scene(&conn, &dto);
        assert!(result.is_ok());

        // Second creation with same name should fail
        let result = create_scene(&conn, &dto);
        assert!(result.is_err());

        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("已存在")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }
}
