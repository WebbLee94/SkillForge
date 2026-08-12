//! Distribution engine facade (Phase 5 TASK-036).
//!
//! The 1080-line monolith was split into focused modules:
//! - [`dist_plan`] — preview / `DistributionPlan` calculation + shared
//!   read-only helpers
//! - [`dist_execute`] — execution, side-effecting writes, result collection
//!   and execute validations
//! - [`dist_managed`] — managed state, ownership checks, RemoveSelected
//!   validations and filesystem-derived sync status
//!
//! This module is a small compatibility facade that re-exports the public
//! API so existing callers (`commands::distribution`, `commands::system`,
//! integration tests) keep working unchanged. No business logic lives here.

pub use crate::engine::dist_execute::{execute_distribution_request, sync_scene};
pub use crate::engine::dist_managed::{get_managed_distribution_state, get_sync_status};
pub use crate::engine::dist_plan::{
    build_distribution_plan, build_distribution_plan_for_request, calculate_distribution_plan,
    read_current_skills_on_disk, resolve_scene_rules, resolve_scene_rules_for_preview,
    resolve_scene_skills, resolve_scene_skills_for_preview,
};

// pub(crate) helpers re-exported for `commands::system`.
pub(crate) use crate::engine::dist_managed::{count_fs_files, count_fs_subdirs};
