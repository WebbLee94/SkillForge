//! 基于 rusqlite 的仓储适配器。

pub mod distribution_repo;

pub use distribution_repo::SqliteDistributionRepository;
