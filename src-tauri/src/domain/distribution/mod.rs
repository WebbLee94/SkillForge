//! distribution 领域：不可变分发模型、纯 diff 计划、请求校验与移除策略。
//!
//! 从 `engine/dist_plan.rs` 与 `types.rs` 抽取的纯逻辑集中于此；
//! engine 层保留兼容 facade 并委托到这里。

pub mod model;
pub mod plan;
pub mod policy;
pub mod validation;

pub use model::{
    DistributionIntent, DistributionIntentMode, DistributionPlan, DistributionRequest,
    LocalDistributionEntry, ManagedDistributionEntry, ManagedDistributionState,
    ManagedPlatformState, PlatformDistributionPlan,
};
pub use plan::{calculate_distribution_plan, calculate_intent_diff};
pub use policy::{
    classify_skill_symlink, ensure_remove_targets_covered, managed_block_content_matches,
    SkillLinkOwnership,
};
pub use validation::validate_scope_project_pair;
