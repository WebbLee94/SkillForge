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
    pub tag_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<i64>,
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
    pub enabled: bool,
    pub icon: Option<String>,
    pub paths: PlatformPaths,
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
    pub last_synced_at: Option<String>,
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
    pub tag_type: String,
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

/// Rules distribution format for a platform.
///
/// - `Directory`: each rule is written as `{rules_dir}/{rule_id}.{format}`
/// - `SingleFile`: all rules are merged into one named file using SKILLFORGE markers
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum RulesFormat {
    #[default]
    Directory,
    SingleFile {
        file_name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformInstance {
    pub platform_id: String,
    pub platform_name: String,
    pub path: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformCapabilities {
    pub skills_global: bool,
    pub skills_project: bool,
    pub rules_global: bool,
    pub rules_project: bool,
    pub rules_format_global: Option<RulesFormat>,
    pub rules_format_project: Option<RulesFormat>,
    /// i18n keys like "no_global_rules", "no_project_rules"
    pub limitation_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformPaths {
    pub global_skills_dir: String,
    pub project_skills_pattern: String,
    pub global_rules_dir: Option<String>,
    pub project_rules_pattern: Option<String>,
    /// Rules format for global scope. `None` defaults to `RulesFormat::Directory`.
    #[serde(default)]
    pub global_rules_format: Option<RulesFormat>,
    /// Rules format for project scope. `None` defaults to `RulesFormat::Directory`.
    #[serde(default)]
    pub project_rules_format: Option<RulesFormat>,
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
    #[serde(default)]
    pub scene_skill_count: i64,
    #[serde(default)]
    pub synced_skill_count: i64,
    #[serde(default)]
    pub scene_rule_count: i64,
    #[serde(default)]
    pub synced_rule_count: i64,
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

/// 文件树节点，用于分发页面的目录浏览
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileTreeNode>,
}

// ── Distribution Plan (read-only) ───────────────────────────────────

/// Per-platform distribution plan — the diff between current state and desired state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlatformDistributionPlan {
    pub platform_id: String,
    pub platform_name: String,
    pub skills_to_add: Vec<String>,
    pub skills_to_update: Vec<String>,
    pub skills_to_remove: Vec<String>,
    pub rules_to_add: Vec<String>,
    pub rules_to_update: Vec<String>,
    pub rules_to_remove: Vec<String>,
}

/// Top-level read-only distribution plan covering multiple platforms.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DistributionPlan {
    pub platforms: Vec<PlatformDistributionPlan>,
    /// True if any platform has any removals (skills or rules)
    pub has_removals: bool,
}

/// Current filesystem entries that SkillForge can prove it owns.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagedDistributionState {
    pub platforms: Vec<ManagedPlatformState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagedPlatformState {
    pub platform_id: String,
    pub platform_name: String,
    pub scope: String,
    pub project_path: Option<String>,
    pub skills: Vec<ManagedDistributionEntry>,
    pub rules: Vec<ManagedDistributionEntry>,
    pub local_skills: Vec<LocalDistributionEntry>,
    pub local_rules: Vec<LocalDistributionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagedDistributionEntry {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalDistributionEntry {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DistributionIntentMode {
    Preserve,
    AddOrUpdate,
    RemoveSelected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DistributionIntent {
    pub mode: DistributionIntentMode,
    #[serde(default)]
    pub ids: Vec<String>,
}

impl DistributionIntent {
    pub fn validate(&self, capability: &str) -> Result<(), crate::error::AppError> {
        if matches!(self.mode, DistributionIntentMode::Preserve) && !self.ids.is_empty() {
            return Err(crate::error::AppError::DistributionInvalid(format!(
                "{} 使用 preserve 时不能携带 IDs",
                capability
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DistributionRequest {
    pub scene_id: Option<String>,
    pub platform_ids: Vec<String>,
    pub scope: String,
    pub project_id: Option<String>,
    pub skills: DistributionIntent,
    pub rules: DistributionIntent,
}

impl DistributionRequest {
    pub fn validate(&self) -> Result<(), crate::error::AppError> {
        match self.scope.as_str() {
            "global" if self.project_id.is_some() => {
                Err(crate::error::AppError::DistributionInvalid(
                    "global 范围不能携带 project_id".to_string(),
                ))
            }
            "project" if self.project_id.is_none() => {
                Err(crate::error::AppError::DistributionInvalid(
                    "project 范围必须提供 project_id".to_string(),
                ))
            }
            "global" | "project" => {
                self.skills.validate("skills")?;
                self.rules.validate("rules")
            }
            _ => Err(crate::error::AppError::DistributionInvalid(
                "scope 必须是 global 或 project".to_string(),
            )),
        }
    }
}
