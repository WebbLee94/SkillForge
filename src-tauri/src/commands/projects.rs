use crate::error::AppError;
use crate::types::Project;
use crate::AppState;

use rusqlite::params;

#[tauri::command]
pub fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<Project>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut stmt = conn.prepare(
        "SELECT id, name, path, description, created_at, updated_at
         FROM projects ORDER BY name ASC",
    )?;

    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                description: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(projects)
}

#[tauri::command]
pub fn add_project(
    name: String,
    path: String,
    description: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Project, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    // Check for duplicate path
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE path = ?1",
            params![path],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if exists {
        return Err(AppError::DuplicateProject(path));
    }

    let id = slugify(&name);
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO projects (id, name, path, description, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, name, path, description, now, now],
    )?;

    // Read back
    conn.query_row(
        "SELECT id, name, path, description, created_at, updated_at FROM projects WHERE id = ?1",
        params![id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                description: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .map_err(|_| AppError::ProjectNotFound(id))
}

#[tauri::command]
pub fn remove_project(id: String, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    // Verify project exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::ProjectNotFound(id));
    }

    // Delete project
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;

    Ok(())
}

#[tauri::command]
pub fn rename_project(
    id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<Project, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::ProjectNotFound(id));
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, now, id],
    )?;

    conn.query_row(
        "SELECT id, name, path, description, created_at, updated_at FROM projects WHERE id = ?1",
        params![id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                description: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .map_err(|_| AppError::ProjectNotFound(id))
}

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
