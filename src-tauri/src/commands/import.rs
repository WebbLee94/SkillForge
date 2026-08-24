use crate::error::AppError;
use crate::plugins::platform;
use crate::plugins::source::SourcePlugin;
use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};

// ── Scan for Import types ─────────────────────────────────────────

#[derive(Serialize)]
pub struct ScanForImportResult {
    pub platforms: Vec<PlatformScanResult>,
    pub total_new_skills: u32,
    pub total_new_rules: u32,
    pub total_existing_skills: u32,
    pub total_existing_rules: u32,
}

#[derive(Serialize)]
pub struct PlatformScanResult {
    pub platform_id: String,
    pub platform_name: String,
    pub new_skills: Vec<SkillPreview>,
    pub new_rules: Vec<RulePreview>,
    pub existing_skills: u32,
    pub existing_rules: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SkillPreview {
    pub id: String,
    pub name: String,
    pub source_path: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RulePreview {
    pub id: String,
    pub name: String,
    pub format: String,
    pub source_path: String,
}

// ── Scan command ──────────────────────────────────────────────────

#[tauri::command]
pub fn scan_for_import(state: tauri::State<'_, AppState>) -> Result<ScanForImportResult, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut platforms = Vec::new();
    let mut total_new_skills = 0u32;
    let mut total_new_rules = 0u32;
    let mut total_existing_skills = 0u32;
    let mut total_existing_rules = 0u32;

    // Query enabled platforms
    let mut stmt =
        conn.prepare("SELECT id, name FROM platforms WHERE enabled != 0 ORDER BY name ASC")?;

    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    for (pid, pname) in rows {
        let mut new_skills = Vec::new();
        let mut new_rules = Vec::new();
        let mut existing_skills = 0u32;
        let mut existing_rules = 0u32;

        if let Ok(plugin) = platform::create_platform_plugin(&pid) {
            let paths = plugin.default_paths();

            // Scan skills directory
            let skills_dir = platform::expand_home(&paths.global_skills_dir);
            if skills_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&skills_dir) {
                    for entry in entries.flatten() {
                        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                            continue;
                        }
                        let skill_md = entry.path().join("SKILL.md");
                        if !skill_md.exists() {
                            continue;
                        }
                        let dir_name = entry.file_name().to_string_lossy().to_string();
                        // Check if already in DB
                        let exists: bool = conn
                            .query_row(
                                "SELECT COUNT(*) FROM resources WHERE id = ?1 AND kind = 'skill'",
                                params![dir_name],
                                |r| r.get::<_, i64>(0),
                            )
                            .map(|c| c > 0)
                            .unwrap_or(false);
                        if exists {
                            existing_skills += 1;
                        } else {
                            // Try to parse SKILL.md for name
                            let name = std::fs::read_to_string(&skill_md)
                                .ok()
                                .and_then(|content| {
                                    crate::engine::parser::parse_skill_md(&content).ok()
                                })
                                .map(|b| b.meta.name)
                                .unwrap_or_else(|| dir_name.clone());
                            new_skills.push(SkillPreview {
                                id: dir_name.clone(),
                                name,
                                source_path: entry.path().to_string_lossy().to_string(),
                            });
                        }
                    }
                }
            }

            // Scan rules directory (Directory mode only)
            if let Some(rules_dir_str) = &paths.global_rules_dir {
                // Skip SingleFile mode (full file path = not a directory)
                let rules_dir = platform::expand_home(rules_dir_str);
                if rules_dir.is_dir() {
                    if let Ok(entries) = std::fs::read_dir(&rules_dir) {
                        for entry in entries.flatten() {
                            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                                continue;
                            }
                            let file_name = entry.file_name().to_string_lossy().to_string();
                            let ext = std::path::Path::new(&file_name)
                                .extension()
                                .map(|e| e.to_string_lossy().to_string())
                                .unwrap_or_default();
                            if !["md", "mdc", "yaml"].contains(&ext.as_str()) {
                                continue;
                            }
                            let stem = std::path::Path::new(&file_name)
                                .file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_default();
                            // Check if already in DB
                            let exists: bool = conn
                                .query_row(
                                    "SELECT COUNT(*) FROM resources WHERE id = ?1 AND kind = 'rule'",
                                    params![stem],
                                    |r| r.get::<_, i64>(0),
                                )
                                .map(|c| c > 0)
                                .unwrap_or(false);
                            if exists {
                                existing_rules += 1;
                            } else {
                                new_rules.push(RulePreview {
                                    id: stem.clone(),
                                    name: stem,
                                    format: ext,
                                    source_path: entry.path().to_string_lossy().to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }

        platforms.push(PlatformScanResult {
            platform_id: pid,
            platform_name: pname,
            new_skills,
            new_rules,
            existing_skills,
            existing_rules,
        });

        if let Some(last) = platforms.last() {
            total_new_skills += last.new_skills.len() as u32;
            total_new_rules += last.new_rules.len() as u32;
            total_existing_skills += last.existing_skills;
            total_existing_rules += last.existing_rules;
        }
    }

    Ok(ScanForImportResult {
        platforms,
        total_new_skills,
        total_new_rules,
        total_existing_skills,
        total_existing_rules,
    })
}

// ── Import command ────────────────────────────────────────────────

#[tauri::command]
pub async fn import_scanned(
    skills: Vec<SkillPreview>,
    rules: Vec<RulePreview>,
    state: tauri::State<'_, AppState>,
) -> Result<ImportResult, AppError> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let mut imported_skills = 0u32;
        let mut imported_rules = 0u32;
        let mut skipped_skills = 0u32;
        let mut skipped_rules = 0u32;
        let mut errors: Vec<String> = Vec::new();

        for skill in &skills {
            let exists: bool = conn
                .query_row("SELECT COUNT(*) FROM resources WHERE id = ?1 AND kind = 'skill'", params![skill.id], |r| r.get::<_, i64>(0))
                .map(|c| c > 0)
                .unwrap_or(false);
            if exists {
                skipped_skills += 1;
                continue;
            }
            let source_path = std::path::Path::new(&skill.source_path);
            let parent_dir = source_path.parent().unwrap_or(source_path).to_path_buf();
            let source_plugin = crate::plugins::source::local_fs::LocalFsSource::with_dir(parent_dir);
            let bundle = match source_plugin.fetch(&skill.id, None) {
                Ok(b) => b,
                Err(e) => { errors.push(format!("{}: {}", skill.name, e)); continue; }
            };
            let local_path = dirs::home_dir()
                .unwrap_or_default()
                .join(".skillforge")
                .join("skills")
                .join(&bundle.meta.id);
            match crate::engine::skill_engine::store_skill_files_public(&local_path, &bundle) {
                Ok(_) => {}
                Err(e) => { errors.push(format!("{}: {}", skill.name, e)); continue; }
            }
            let now = chrono::Utc::now().to_rfc3339();
            match conn.execute(
                "INSERT INTO resources (id, kind, name, description, source_type, source_url, current_ver, installed_at, updated_at, local_path, metadata) VALUES (?1, 'skill', ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9)",
                params![bundle.meta.id, bundle.meta.name, bundle.meta.description, bundle.meta.source_type, bundle.meta.source_url, bundle.meta.version, now, local_path.to_string_lossy().to_string(), bundle.meta.metadata],
            ) {
                Ok(_) => imported_skills += 1,
                Err(e) => errors.push(format!("{}: {}", skill.name, e)),
            }
        }

        for rule in &rules {
            let exists: bool = conn
                .query_row("SELECT COUNT(*) FROM resources WHERE id = ?1 AND kind = 'rule'", params![rule.id], |r| r.get::<_, i64>(0))
                .map(|c| c > 0)
                .unwrap_or(false);
            if exists {
                skipped_rules += 1;
                continue;
            }
            let content = std::fs::read_to_string(&rule.source_path).unwrap_or_default();
            if content.is_empty() {
                skipped_rules += 1;
                continue;
            }
            let now = chrono::Utc::now().to_rfc3339();
            match conn.execute(
                "INSERT INTO resources (id, kind, name, description, source_type, installed_at, updated_at, format, content, platform, scope, version) VALUES (?1, 'rule', ?2, ?3, 'manual', ?6, ?6, ?4, ?5, NULL, NULL, 1)",
                params![rule.id, rule.name, "", rule.format, content, now],
            ) {
                Ok(_) => {
                    let rules_dir = dirs::home_dir()
                        .unwrap_or_default()
                        .join(".skillforge")
                        .join("rules");
                    std::fs::create_dir_all(&rules_dir).ok();
                    let rule_path = rules_dir.join(format!("{}.{}", rule.id, rule.format));
                    std::fs::write(&rule_path, &content).ok();
                    imported_rules += 1;
                }
                Err(e) => errors.push(format!("{}: {}", rule.name, e)),
            }
        }

        Ok(ImportResult {
            imported_skills,
            imported_rules,
            skipped_skills,
            skipped_rules,
            errors,
        })
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[derive(Serialize)]
pub struct ImportResult {
    pub imported_skills: u32,
    pub imported_rules: u32,
    pub skipped_skills: u32,
    pub skipped_rules: u32,
    pub errors: Vec<String>,
}
