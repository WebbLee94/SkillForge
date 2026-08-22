//! 纯 diff 计划逻辑（原 `engine/dist_plan.rs` 的 `calculate_distribution_plan`
//! 与 `calculate_intent_diff` 原样迁移，语义逐字保留）。
//!
//! 语义约定：
//! - `Preserve`：不新增、不移除；
//! - `AddOrUpdate`：仅补齐当前缺失的条目（已存在的不动，永不移除）；
//! - `RemoveSelected`：只移除当前确实存在的条目（不存在的静默跳过）。

use super::model::{DistributionIntent, DistributionIntentMode, DistributionRequest, PlatformDistributionPlan};
use crate::error::AppError;

/// 按意图模式对单个维度（技能或规则）计算 (to_add, to_remove) 差集。
pub fn calculate_intent_diff(
    intent: &DistributionIntent,
    current: &[String],
) -> (Vec<String>, Vec<String>) {
    match intent.mode {
        DistributionIntentMode::Preserve => (vec![], vec![]),
        DistributionIntentMode::AddOrUpdate => (
            intent
                .ids
                .iter()
                .filter(|id| !current.contains(id))
                .cloned()
                .collect(),
            vec![],
        ),
        DistributionIntentMode::RemoveSelected => (
            vec![],
            intent
                .ids
                .iter()
                .filter(|id| current.contains(id))
                .cloned()
                .collect(),
        ),
    }
}

/// 为单个平台生成纯 diff 计划。入参全部为已解析的数据，
/// 不做任何 IO；请求校验失败时返回与原先一致的错误。
pub fn calculate_distribution_plan(
    platform_id: &str,
    platform_name: &str,
    current_skills: &[String],
    current_rules: &[String],
    request: &DistributionRequest,
) -> Result<PlatformDistributionPlan, AppError> {
    request.validate()?;

    let (skills_to_add, skills_to_remove) = calculate_intent_diff(&request.skills, current_skills);
    let (rules_to_add, rules_to_remove) = calculate_intent_diff(&request.rules, current_rules);

    Ok(PlatformDistributionPlan {
        platform_id: platform_id.to_string(),
        platform_name: platform_name.to_string(),
        skills_to_add,
        skills_to_update: vec![],
        skills_to_remove,
        rules_to_add,
        rules_to_update: vec![],
        rules_to_remove,
    })
}

/// 按平台计划列表汇总顶层 `has_removals`（与 preview 汇总逻辑一致）。
pub fn plan_has_removals(platforms: &[PlatformDistributionPlan]) -> bool {
    platforms
        .iter()
        .any(|p| !p.skills_to_remove.is_empty() || !p.rules_to_remove.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intent(mode: DistributionIntentMode, ids: &[&str]) -> DistributionIntent {
        DistributionIntent {
            mode,
            ids: ids.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn request(skills: DistributionIntent, rules: DistributionIntent) -> DistributionRequest {
        DistributionRequest {
            scene_id: None,
            platform_ids: vec!["claude-code".to_string()],
            scope: "global".to_string(),
            project_id: None,
            skills,
            rules,
        }
    }

    #[test]
    fn calculate_intent_diff_preserve_never_adds_or_removes() {
        let current = vec!["a".to_string(), "b".to_string()];
        let diff = calculate_intent_diff(&intent(DistributionIntentMode::Preserve, &["a"]), &current);
        assert_eq!(diff, (vec![], vec![]));
    }

    #[test]
    fn add_or_update_only_fills_missing_items() {
        let current = vec!["a".to_string()];
        let diff = calculate_intent_diff(
            &intent(DistributionIntentMode::AddOrUpdate, &["a", "b", "c"]),
            &current,
        );
        assert_eq!(diff, (vec!["b".to_string(), "c".to_string()], vec![]));
    }

    #[test]
    fn add_or_update_with_empty_current_adds_all() {
        let diff = calculate_intent_diff(
            &intent(DistributionIntentMode::AddOrUpdate, &["x"]),
            &[],
        );
        assert_eq!(diff, (vec!["x".to_string()], vec![]));
    }

    #[test]
    fn remove_selected_only_removes_present_items() {
        let current = vec!["a".to_string(), "b".to_string()];
        let diff = calculate_intent_diff(
            &intent(DistributionIntentMode::RemoveSelected, &["b", "ghost"]),
            &current,
        );
        assert_eq!(diff, (vec![], vec!["b".to_string()]));
    }

    #[test]
    fn calculate_plan_classifies_per_dimension_and_keeps_platform_identity() {
        let req = request(
            intent(DistributionIntentMode::AddOrUpdate, &["s1", "s2"]),
            intent(DistributionIntentMode::RemoveSelected, &["r1", "r9"]),
        );
        let plan = calculate_distribution_plan(
            "claude-code",
            "Claude Code",
            &["s1".to_string()],
            &["r1".to_string()],
            &req,
        )
        .expect("计划生成应成功");
        assert_eq!(plan.platform_id, "claude-code");
        assert_eq!(plan.platform_name, "Claude Code");
        assert_eq!(plan.skills_to_add, vec!["s2".to_string()]);
        assert!(plan.skills_to_update.is_empty());
        assert!(plan.skills_to_remove.is_empty());
        assert!(plan.rules_to_add.is_empty());
        assert_eq!(plan.rules_to_remove, vec!["r1".to_string()]);
    }

    #[test]
    fn calculate_plan_rejects_invalid_request_like_before() {
        let mut req = request(
            intent(DistributionIntentMode::AddOrUpdate, &["s1"]),
            intent(DistributionIntentMode::RemoveSelected, &["r1"]),
        );
        req.scope = "bogus".to_string();
        let err = calculate_distribution_plan("p", "P", &[], &[], &req).unwrap_err();
        assert!(
            format!("{err}").contains("scope 必须是 global 或 project"),
            "错误文案应与旧实现一致，实际: {err}"
        );
    }

    #[test]
    fn plan_has_removals_matches_preview_aggregation_rule() {
        let platform_without = PlatformDistributionPlan {
            platform_id: "a".into(),
            platform_name: "A".into(),
            skills_to_add: vec!["s".into()],
            skills_to_update: vec![],
            skills_to_remove: vec![],
            rules_to_add: vec![],
            rules_to_update: vec![],
            rules_to_remove: vec![],
        };
        let mut platform_with = platform_without.clone();
        platform_with.platform_id = "b".into();
        platform_with.rules_to_remove = vec!["r".into()];
        assert!(!plan_has_removals(&[platform_without.clone()]));
        assert!(plan_has_removals(&[platform_without, platform_with]));
    }
}
