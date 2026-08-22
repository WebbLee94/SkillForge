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
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Result of a batch project deletion (Phase 7 confirmed semantics).
///
/// - `deleted`: ids whose SkillForge `projects` row was removed.
/// - `not_found`: ids that did not exist — reported per-id instead of failing
///   the whole batch, so a stale id mid-batch never blocks the others.
///
/// Deleting a project only removes the SkillForge record: it never deletes the
/// project directory on disk, nor any skill / rule / scene resources.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteProjectsResult {
    pub deleted: Vec<String>,
    pub not_found: Vec<String>,
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
    /// Count of requested skills/rules that required no write because the
    /// target was already in the desired state (AddOrUpdate only).
    #[serde(default)]
    pub skipped: u32,
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

// ── Distribution（领域模型已迁移至 domain/distribution，此处保留类型路径兼容）──
//
// 分发域的不可变模型已原样迁移到 `crate::domain::distribution::model`，
// 校验实现迁移到 `validation`；通过 re-export 保持 `crate::types::*`
// 的既有引用路径与 IPC 载荷形状完全不变。
pub use crate::domain::distribution::model::{
    DistributionIntent, DistributionIntentMode, DistributionPlan, DistributionRequest,
    LocalDistributionEntry, ManagedDistributionEntry, ManagedDistributionState,
    ManagedPlatformState, PlatformDistributionPlan,
};

/// reveal_path 命令返回：实际揭示的路径 + 是否发生了祖先回退。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RevealPathResult {
    pub revealed_path: String,
    pub fallback: bool,
}
