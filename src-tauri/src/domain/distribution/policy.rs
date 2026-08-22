//! 移除/所有权纯策略（fail-closed、符号链接所有权、单文件托管块内容匹配）。
//!
//! 全部为纯决策函数：输入是已解析的数据（计划、链接目标、块内容），
//! 不做任何 IO；错误文案与既有实现逐字一致。

use std::collections::HashSet;

use super::model::DistributionPlan;
use crate::error::AppError;

/// fail-closed 预检（原 `execute_remove_distributed` 内联逻辑原样抽取）：
/// 每个请求 skill id 只对 skills_to_remove、每个请求 rule id 只对
/// rules_to_remove 校验；技能/规则各自命名空间，杜绝跨类型同 ID 掩盖。
/// 覆盖按「至少一个目标平台」计：managed-state 选择是扁平 id 列表，
/// 某项可能只在请求平台的一个子集上受管，严格「每平台都在」会误拒合法选择。
pub fn ensure_remove_targets_covered(
    plan: &DistributionPlan,
    skill_ids: &[String],
    rule_ids: &[String],
) -> Result<(), AppError> {
    let skills_covered: HashSet<&str> = plan
        .platforms
        .iter()
        .flat_map(|platform| platform.skills_to_remove.iter().map(|id| id.as_str()))
        .collect();
    let rules_covered: HashSet<&str> = plan
        .platforms
        .iter()
        .flat_map(|platform| platform.rules_to_remove.iter().map(|id| id.as_str()))
        .collect();
    for id in skill_ids {
        if !skills_covered.contains(id.as_str()) {
            return Err(AppError::DistributionInvalid(format!(
                "移除目标 '{}' 已变化或不再受管，请重新扫描",
                id
            )));
        }
    }
    for id in rule_ids {
        if !rules_covered.contains(id.as_str()) {
            return Err(AppError::DistributionInvalid(format!(
                "移除目标 '{}' 已变化或不再受管，请重新扫描",
                id
            )));
        }
    }
    Ok(())
}

/// 技能符号链接所有权判定结果。
#[derive(Debug, PartialEq, Eq)]
pub enum SkillLinkOwnership {
    /// 目标不存在（也不是悬空链接）→ 无需处理。
    Absent,
    /// 链接指向 SkillForge 来源 → 允许移除。
    Owned,
    /// 拒绝移除，携带与既有错误一致的文案。
    Reject(String),
}

/// 判定一个磁盘上的技能目标是否仍归 SkillForge 所有
/// （原 `dist_managed::validate_removal_targets` 技能分支的纯化版本）：
/// - 目标缺失 → 无需处理；
/// - 存在但读不出符号链接 → 拒绝；
/// - 链接目标 ≠ DB 记录的 local_path → 拒绝。
pub fn classify_skill_symlink(
    id: &str,
    target_present: bool,
    link_target: Option<&str>,
    expected_local_path: &str,
) -> SkillLinkOwnership {
    if !target_present {
        return SkillLinkOwnership::Absent;
    }
    match link_target {
        None => SkillLinkOwnership::Reject(format!(
            "技能 '{}' 不是 SkillForge 管理的符号链接",
            id
        )),
        Some(link) if link == expected_local_path => SkillLinkOwnership::Owned,
        Some(_) => SkillLinkOwnership::Reject(format!(
            "技能 '{}' 的符号链接目标不是 SkillForge 来源",
            id
        )),
    }
}

/// 单文件规则托管块内容匹配的纯策略
/// （原 `rule_distribution::rule_block_content_matches`）：
/// 块内容与规则内容一致，或仅多一个尾部换行时视为匹配。
pub fn managed_block_content_matches(block_content: &str, rule_content: &str) -> bool {
    block_content == rule_content || block_content.strip_suffix('\n') == Some(rule_content)
}

#[cfg(test)]
mod tests {
    use super::super::model::{PlatformDistributionPlan};

    use super::*;

    fn plan(
        skills_to_remove: &[&str],
        rules_to_remove: &[&str],
    ) -> DistributionPlan {
        DistributionPlan {
            platforms: vec![PlatformDistributionPlan {
                platform_id: "claude-code".to_string(),
                platform_name: "Claude Code".to_string(),
                skills_to_add: vec![],
                skills_to_update: vec![],
                skills_to_remove: skills_to_remove.iter().map(|s| s.to_string()).collect(),
                rules_to_add: vec![],
                rules_to_update: vec![],
                rules_to_remove: rules_to_remove.iter().map(|s| s.to_string()).collect(),
            }],
            has_removals: !skills_to_remove.is_empty() || !rules_to_remove.is_empty(),
        }
    }

    #[test]
    fn covered_targets_pass_fail_closed_check() {
        let p = plan(&["s1", "s2"], &["r1"]);
        assert!(ensure_remove_targets_covered(&p, &["s1".into()], &["r1".into()]).is_ok());
    }

    #[test]
    fn uncovered_skill_is_rejected_with_legacy_message() {
        let p = plan(&["s1"], &[]);
        let err = ensure_remove_targets_covered(&p, &["ghost".into()], &[]).unwrap_err();
        assert_eq!(
            err.to_string(),
            "分发请求无效: 移除目标 'ghost' 已变化或不再受管，请重新扫描"
        );
    }

    #[test]
    fn uncovered_rule_is_rejected_with_legacy_message() {
        let p = plan(&[], &["r1"]);
        let err = ensure_remove_targets_covered(&p, &[], &["ghost".into()]).unwrap_err();
        assert_eq!(
            err.to_string(),
            "分发请求无效: 移除目标 'ghost' 已变化或不再受管，请重新扫描"
        );
    }

    #[test]
    fn cross_namespace_same_id_does_not_mask_missing_target() {
        // 技能/规则各自命名空间：skill id 只允许出现在 skills_to_remove 中，
        // 即使同 id 恰好存在于 rules_to_remove 也不得视为已覆盖。
        let p = plan(&[], &["shared-id"]);
        assert!(
            ensure_remove_targets_covered(&p, &["shared-id".into()], &[]).is_err(),
            "跨命名空间同 ID 不得掩盖技能未受管的事实"
        );
    }

    #[test]
    fn coverage_counts_any_single_platform_across_the_plan() {
        // 覆盖按「至少一个目标平台」计：两个平台各覆盖一部分也整体通过。
        let p = DistributionPlan {
            platforms: vec![
                PlatformDistributionPlan {
                    platform_id: "a".into(),
                    platform_name: "A".into(),
                    skills_to_add: vec![],
                    skills_to_update: vec![],
                    skills_to_remove: vec!["s1".into()],
                    rules_to_add: vec![],
                    rules_to_update: vec![],
                    rules_to_remove: vec![],
                },
                PlatformDistributionPlan {
                    platform_id: "b".into(),
                    platform_name: "B".into(),
                    skills_to_add: vec![],
                    skills_to_update: vec![],
                    skills_to_remove: vec!["s2".into()],
                    rules_to_add: vec![],
                    rules_to_update: vec![],
                    rules_to_remove: vec![],
                },
            ],
            has_removals: true,
        };
        assert!(
            ensure_remove_targets_covered(&p, &["s1".into(), "s2".into()], &[]).is_ok()
        );
    }

    #[test]
    fn missing_target_classified_absent() {
        assert_eq!(
            classify_skill_symlink("s1", false, None, "/expected"),
            SkillLinkOwnership::Absent
        );
    }

    #[test]
    fn matching_link_target_is_owned() {
        assert_eq!(
            classify_skill_symlink("s1", true, Some("/expected"), "/expected"),
            SkillLinkOwnership::Owned
        );
    }

    #[test]
    fn unreadable_symlink_is_rejected_like_before() {
        match classify_skill_symlink("s1", true, None, "/expected") {
            SkillLinkOwnership::Reject(reason) => {
                assert_eq!(reason, "技能 's1' 不是 SkillForge 管理的符号链接");
            }
            other => panic!("应判定为拒绝，实际: {other:?}"),
        }
    }

    #[test]
    fn foreign_link_target_is_rejected_like_before() {
        match classify_skill_symlink("s1", true, Some("/elsewhere"), "/expected") {
            SkillLinkOwnership::Reject(reason) => {
                assert_eq!(reason, "技能 's1' 的符号链接目标不是 SkillForge 来源");
            }
            other => panic!("应判定为拒绝，实际: {other:?}"),
        }
    }

    #[test]
    fn block_content_matching_tolerates_only_trailing_newline() {
        assert!(managed_block_content_matches("same", "same"));
        assert!(managed_block_content_matches("same\n", "same"));
        assert!(!managed_block_content_matches("same\n\n", "same"));
        assert!(!managed_block_content_matches("other", "same"));
        assert!(!managed_block_content_matches("", "same"));
        assert!(managed_block_content_matches("", ""));
    }
}

