//! Distribution use cases.
//!
//! - [`preview`] — read-only planning (`DistributionPlan` generation)
//! - [`managed`] — managed vs local entry classification + filesystem-derived
//!   sync status
//! - [`remove`] — fail-closed RemoveSelected ownership validation
//! - [`execute`] — side-effecting execution flows (`sync_scene`,
//!   `execute_distribution_request`, `execute_remove_distributed`)
//!
//! `engine/dist_*` modules remain their compatibility facades.

pub mod execute;
pub mod managed;
pub mod preview;
pub mod remove;

pub use preview::{build_distribution_plan, build_distribution_plan_for_request};
