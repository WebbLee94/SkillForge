//! Compatibility facade for distribution execution.
//!
//! Task 5（distribution 域重构）：行为已迁移至
//! [`crate::application::distribution::execute`]，本模块保留历史入口点，
//! 供既有调用方（`commands/distribution` 与 `engine/dist_engine` re-export）使用。
//! 新代码应直接依赖 application 层。
//!
//! 组装职责：此处构造 [`SqliteDistributionRepository`] /
//! [`EngineDistributionFileSystem`] 直通适配器并注入用例，
//! 公共入口签名与迁移前完全一致（IPC 零变化）。

use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::types::{DistributionPlan, DistributionRequest, SyncResult};

#[allow(clippy::too_many_arguments)]
pub fn sync_scene(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    skill_ids: &[String],
    rule_ids: &[String],
    scene_id: Option<&str>,
    platform_ids: Option<&[String]>,
    scope: &str,
    project_id: Option<&str>,
) -> Result<SyncResult, AppError> {
    let repo = crate::adapters::db::SqliteDistributionRepository::new(conn);
    let fs = crate::adapters::filesystem::EngineDistributionFileSystem;
    crate::application::distribution::execute::sync_scene(
        conn,
        &repo,
        &fs,
        platform_plugins,
        skill_ids,
        rule_ids,
        scene_id,
        platform_ids,
        scope,
        project_id,
    )
}

pub fn execute_distribution_request(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    request: &DistributionRequest,
    submitted_plan: &DistributionPlan,
) -> Result<SyncResult, AppError> {
    let repo = crate::adapters::db::SqliteDistributionRepository::new(conn);
    let fs = crate::adapters::filesystem::EngineDistributionFileSystem;
    crate::application::distribution::execute::execute_distribution_request(
        conn,
        &repo,
        &fs,
        platform_plugins,
        request,
        submitted_plan,
    )
}

pub fn execute_remove_distributed(
    conn: &rusqlite::Connection,
    platform_plugins: &[Box<dyn PlatformPlugin>],
    platform_ids: &[String],
    scope: &str,
    project_id: Option<&str>,
    skill_ids: &[String],
    rule_ids: &[String],
) -> Result<SyncResult, AppError> {
    let repo = crate::adapters::db::SqliteDistributionRepository::new(conn);
    let fs = crate::adapters::filesystem::EngineDistributionFileSystem;
    crate::application::distribution::execute::execute_remove_distributed(
        conn,
        &repo,
        &fs,
        platform_plugins,
        platform_ids,
        scope,
        project_id,
        skill_ids,
        rule_ids,
    )
}
