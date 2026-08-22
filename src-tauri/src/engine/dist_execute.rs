//! Compatibility facade for distribution execution.
//!
//! Task 5（distribution 域重构）：行为已迁移至
//! [`crate::application::distribution::execute`]，本模块仅保留历史入口点，
//! 供既有调用方（`commands/distribution` 与 `engine/dist_engine` re-export）使用。
//! 新代码应直接依赖 application 层。

pub use crate::application::distribution::execute::{
    execute_distribution_request, execute_remove_distributed, sync_scene,
};
