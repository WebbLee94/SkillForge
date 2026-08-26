//! 分发用例的端口（ports）层：application 层依赖的最小基础设施抽象。
//!
//! 按 2026-08-22-distribution-domain-rebuild 计划 Task 6 Step 1 的最小范围引入：
//! 只定义当前 application/distribution 用例实际经过 engine facade 调用的边界，
//! 不做全面抽象。现有 `PlatformPlugin` trait 已是平台端口，不再重复包装。
//!
//! - [`distribution`] — 技能 / 项目等仓储读取（DB 查询边界）
//! - [`filesystem`] — 分发目标磁盘读取（skills / rules 现状扫描）

pub mod distribution;
pub mod filesystem;

pub use distribution::DistributionRepository;
pub use filesystem::DistributionFileSystem;
