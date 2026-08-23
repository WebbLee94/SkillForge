//! 分发文件系统端口：application 层所需的分发目标磁盘读取边界。
//!
//! 只覆盖读取操作；写入仍留在 engine 层，保持最小边界。

use crate::error::AppError;
use crate::plugins::platform::PlatformPlugin;
use crate::types::PlatformInstance;

/// 分发用例所需的磁盘现状读取能力（不创建任何目录）。
pub trait DistributionFileSystem {
    /// 读取平台上已部署的技能目录名列表；目录不存在时返回空。
    fn read_current_skills_on_disk(&self, instance: &PlatformInstance) -> Vec<String>;

    /// 按平台规则格式读取已部署的规则 ID 列表；目标不存在时返回空。
    fn read_current_rules_on_disk(
        &self,
        plugin: &dyn PlatformPlugin,
        instance: &PlatformInstance,
        project_base: Option<&str>,
    ) -> Result<Vec<String>, AppError>;

    /// 计算平台上单个已部署技能条目的内容摘要（SHA-256 hex）；
    /// 条目缺失或不可读时返回 `None`（不参与更新判定）。
    fn deployed_skill_digest(
        &self,
        instance: &PlatformInstance,
        skill_id: &str,
    ) -> Option<String>;

    /// 计算平台上单个已部署规则条目的内容摘要（SHA-256 hex，
    /// 按 [`crate::engine::content_hash::canonical_rule_text`] 规范化）；
    /// 条目缺失或不可读时返回 `Ok(None)`，读取失败返回 `Err`。
    fn deployed_rule_digest(
        &self,
        plugin: &dyn PlatformPlugin,
        instance: &PlatformInstance,
        project_base: Option<&str>,
        rule_id: &str,
    ) -> Result<Option<String>, AppError>;
}
