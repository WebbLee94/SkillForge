//! distribution 域的不可变模型（原 `types.rs` 分发段定义原样迁移）。
//!
//! serde 行为保持不变：请求侧 camelCase、意图模式 snake_case、
//! 计划/受管状态字段名与原先完全一致，IPC 载荷形状不受影响。

use serde::{Deserialize, Serialize};

/// 意图模式（snake_case 序列化，保持前端契约）。
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
///
/// `has_removals` 的汇总判定单一来源为 [`super::plan::plan_has_removals`]，
/// 由 preview 构建处填充；模型本身保持纯数据。
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
