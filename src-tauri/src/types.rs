use serde::{Deserialize, Serialize};

// ── Core domain types ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub source_type: String,
    pub source_url: Option<String>,
    pub current_ver: Option<String>,
    pub installed_at: String,
    pub local_path: String,
    pub metadata: Option<String>,
    #[serde(default)]
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillVersion {
    pub skill_id: String,
    pub version: String,
    pub source_ref: Option<String>,
    pub checksum: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub format: String,
    pub content: String,
    pub platform: Option<String>,
    pub scope: Option<String>,
    pub version: i32,
    pub updated_at: String,
    #[serde(default)]
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleHistory {
    pub rule_id: String,
    pub version: i32,
    pub content: String,
    pub changed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub is_template: bool,
    pub is_system: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneSkill {
    pub scene_id: String,
    pub skill_id: String,
    pub version: Option<String>,
    pub enabled: bool,
    pub sort_order: i32,
    pub config: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneRule {
    pub scene_id: String,
    pub rule_id: String,
    pub enabled: bool,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub scene_id: Option<String>,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Platform {
    pub id: String,
    pub name: String,
    pub adapter: String,
    pub global_path: Option<String>,
    pub project_path: Option<String>,
    pub enabled: bool,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Distribution {
    pub id: i64,
    pub scene_id: String,
    pub platform_id: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub project_path: Option<String>,
    pub status: String,
    pub synced_at: Option<String>,
    pub checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncLog {
    pub id: i64,
    pub action: String,
    pub target_type: String,
    pub target_id: String,
    pub platform_id: Option<String>,
    pub status: String,
    pub message: Option<String>,
    pub created_at: String,
}

// ── DTOs ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSceneDTO {
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub skill_ids: Option<Vec<String>>,
    pub rule_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSceneDTO {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddProjectDTO {
    pub name: String,
    pub path: String,
    pub scene_id: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRuleDTO {
    pub name: String,
    pub description: Option<String>,
    pub format: String,
    pub content: String,
    pub platform: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRuleDTO {
    pub name: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,
    pub platform: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTagDTO {
    pub name: String,
    pub color: Option<String>,
    pub category: Option<String>,
}

// ── Skill bundle (from source) ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillBundle {
    pub meta: SkillMeta,
    pub skill_md: String,
    pub subdirs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source_type: String,
    pub source_url: Option<String>,
    pub version: Option<String>,
    pub metadata: Option<String>,
}

// ── Platform types ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformInstance {
    pub platform_id: String,
    pub platform_name: String,
    pub path: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformPaths {
    pub global_skills_dir: String,
    pub project_skills_pattern: String,
    pub global_rules_dir: Option<String>,
    pub project_rules_pattern: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillPlatformStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub checksum: Option<String>,
}

// ── Sync / Distribution types ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub installed: Vec<String>,
    pub updated: Vec<String>,
    pub removed: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatusDTO {
    pub platforms: Vec<PlatformSyncStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformSyncStatus {
    pub platform_id: String,
    pub platform_name: String,
    pub status: String,
    pub synced_count: i64,
    pub total_count: i64,
}

// ── Dashboard / System types ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardStats {
    pub skill_count: i64,
    pub rule_count: i64,
    pub scene_count: i64,
    pub user_scene_count: i64,
    pub project_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub version: String,
    pub source_ref: Option<String>,
    pub checksum: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceInfo {
    pub name: String,
    pub display_name: String,
    pub plugin_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub data_dir: String,
    pub db_path: String,
    pub version: String,
}

// ── Scene detail (composite) ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneDetail {
    pub scene: Scene,
    pub skills: Vec<SceneSkillEntry>,
    pub rules: Vec<SceneRuleEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneSkillEntry {
    pub skill_id: String,
    pub skill_name: String,
    pub version: Option<String>,
    pub enabled: bool,
    pub sort_order: i32,
    pub config: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneRuleEntry {
    pub rule_id: String,
    pub rule_name: String,
    pub enabled: bool,
    pub sort_order: i32,
}

// ── Skill filter ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFilter {
    pub source_type: Option<String>,
    pub tag: Option<String>,
}
