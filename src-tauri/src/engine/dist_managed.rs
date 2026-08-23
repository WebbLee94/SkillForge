//! 兼容 facade — 受管分发状态（原 Phase 5 TASK-034）。
//!
//! 实现已迁移到 application 层，本模块仅保留既有调用路径：
//! - 受管状态编排 / 本地条目过滤 / 文件系统派生同步状态 →
//!   [`crate::application::distribution::managed`]
//! - RemoveSelected fail-closed 所有权校验已迁移至
//!   [`crate::application::distribution::remove`]；其唯一消费方
//!   `dist_execute` 已直接改走新路径，故此处不再保留旧别名。
//!
//! 既有消费方不受影响：
//! - `engine/dist_engine` re-export `get_managed_distribution_state` /
//!   `get_sync_status` / `count_fs_*` 给 commands 层
//!
//! 待新路径在测试中稳定后，按重构计划退役本模块。

pub(crate) use crate::application::distribution::managed::{count_fs_files, count_fs_subdirs};
pub use crate::application::distribution::managed::{
    get_managed_distribution_state, get_sync_status,
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    /// 锁定 facade 路由：经旧路径 `engine::dist_managed` 调用仍能取到
    /// 全部内置平台的同步状态（证明兼容层未断）。
    #[test]
    fn facade_routes_to_application_layer() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        schema::create_tables(&conn).unwrap();
        let status = get_sync_status(&conn).unwrap();
        assert_eq!(status.platforms.len(), 10); // 10 built-in platforms
    }
}
