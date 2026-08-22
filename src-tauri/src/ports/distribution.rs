//! 分发仓储端口：application 层所需的只读 DB 查询边界。
//!
//! 当前由 [`crate::adapters::db::SqliteDistributionRepository`] 以直通方式实现，
//! 委托到 `engine/dist_plan.rs` 的既有查询，行为保持不变。

use crate::error::AppError;
use crate::types::Skill;

/// 分发用例所需的仓储读取能力（技能 / 项目路径）。
pub trait DistributionRepository {
    /// 按 ID 读取技能；不存在时返回 [`AppError::SkillNotFound`]。
    fn get_skill(&self, skill_id: &str) -> Result<Skill, AppError>;

    /// 按 ID 解析项目路径；项目不存在时返回 `None`。
    fn get_project_path(&self, project_id: &str) -> Option<String>;
}
