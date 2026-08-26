//! 纯 diff 计划逻辑（原 `engine/dist_plan.rs` 的 `calculate_distribution_plan`
//! 与 `calculate_intent_diff` 原样迁移，语义逐字保留）。
//!
//! 语义约定：
//! - `Preserve`：不新增、不移除、不更新；
//! - `AddOrUpdate`：仅补齐当前缺失的条目；已存在但内容摘要与库内不一致的
//!   条目进入 to_update（CL-034 内容级 checksum 合同）；
//! - `RemoveSelected`：只移除当前确实存在的条目（不存在的静默跳过）。

use std::collections::HashMap;

use super::model::{
    DistributionIntent, DistributionIntentMode, DistributionRequest, PlatformDistributionPlan,
};
use crate::error::AppError;

/// 单维度内容摘要快照：库内来源与部署侧各一份（键为条目 ID，
/// 值为 SHA-256 hex）。缺失键表示摘要不可计算，不参与更新判定。
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ContentDigestPair {
    pub library: HashMap<String, String>,
    pub deployed: HashMap<String, String>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct IntentDiff {
    pub to_add: Vec<String>,
    pub to_update: Vec<String>,
    pub to_remove: Vec<String>,
}

/// 按意图模式对单个维度（技能或规则）计算
/// (to_add, to_update, to_remove) 三段差集。
///
/// 更新判定（仅 `AddOrUpdate` 且条目同时存在于意图与现状时生效）：
/// 库内与部署侧摘要均可计算且不相等 → 进 to_update；
/// 一致或任一侧摘要缺失 → 不进任何列表。
pub fn classify_intent_diff(
    intent: &DistributionIntent,
    current: &[String],
    digests: &ContentDigestPair,
) -> IntentDiff {
    match intent.mode {
        DistributionIntentMode::Preserve => IntentDiff::default(),
        DistributionIntentMode::AddOrUpdate => {
            let mut diff = IntentDiff::default();
            for id in &intent.ids {
                if !current.contains(id) {
                    diff.to_add.push(id.clone());
                } else if let (Some(library), Some(deployed)) =
                    (digests.library.get(id), digests.deployed.get(id))
                {
                    if library != deployed {
                        diff.to_update.push(id.clone());
                    }
                }
            }
            diff
        }
        DistributionIntentMode::RemoveSelected => IntentDiff {
            to_remove: intent
                .ids
                .iter()
                .filter(|id| current.contains(id))
                .cloned()
                .collect(),
            ..IntentDiff::default()
        },
    }
}

/// 按意图模式对单个维度计算 (to_add, to_remove) 差集
/// （ID 级两段视图，语义与迁移前逐字一致，不含 update 分类）。
pub fn calculate_intent_diff(
    intent: &DistributionIntent,
    current: &[String],
) -> (Vec<String>, Vec<String>) {
    let diff = classify_intent_diff(intent, current, &ContentDigestPair::default());
    (diff.to_add, diff.to_remove)
}

/// 为单个平台生成纯 diff 计划。入参全部为已解析的数据，
/// 不做任何 IO；请求校验失败时返回与原先一致的错误。
///
/// ID 级兼容入口：不携带内容摘要，`*_to_update` 恒为空
/// （语义与迁移前逐字一致）。
pub fn calculate_distribution_plan(
    platform_id: &str,
    platform_name: &str,
    current_skills: &[String],
    current_rules: &[String],
    request: &DistributionRequest,
) -> Result<PlatformDistributionPlan, AppError> {
    calculate_distribution_plan_with_content(
        platform_id,
        platform_name,
        current_skills,
        current_rules,
        request,
        &ContentDigestPair::default(),
        &ContentDigestPair::default(),
    )
}

/// [`calculate_distribution_plan`] 的内容感知变体：
/// 以库内/部署侧两侧摘要驱动 to_update 分类（CL-034），
/// to_add / to_remove 分类规则与 ID 级入口逐字一致。
pub fn calculate_distribution_plan_with_content(
    platform_id: &str,
    platform_name: &str,
    current_skills: &[String],
    current_rules: &[String],
    request: &DistributionRequest,
    skill_digests: &ContentDigestPair,
    rule_digests: &ContentDigestPair,
) -> Result<PlatformDistributionPlan, AppError> {
    request.validate()?;

    let skills = classify_intent_diff(&request.skills, current_skills, skill_digests);
    let rules = classify_intent_diff(&request.rules, current_rules, rule_digests);

    Ok(PlatformDistributionPlan {
        platform_id: platform_id.to_string(),
        platform_name: platform_name.to_string(),
        skills_to_add: skills.to_add,
        skills_to_update: skills.to_update,
        skills_to_remove: skills.to_remove,
        rules_to_add: rules.to_add,
        rules_to_update: rules.to_update,
        rules_to_remove: rules.to_remove,
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
        let diff =
            calculate_intent_diff(&intent(DistributionIntentMode::Preserve, &["a"]), &current);
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
        let diff = calculate_intent_diff(&intent(DistributionIntentMode::AddOrUpdate, &["x"]), &[]);
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
        let skill_digests = ContentDigestPair {
            library: HashMap::from([("s1".to_string(), "lib".to_string())]),
            deployed: HashMap::from([("s1".to_string(), "dep".to_string())]),
        };
        let rule_digests = ContentDigestPair {
            library: HashMap::from([("r1".to_string(), "same".to_string())]),
            deployed: HashMap::from([("r1".to_string(), "same".to_string())]),
        };
        let plan = calculate_distribution_plan_with_content(
            "claude-code",
            "Claude Code",
            &["s1".to_string()],
            &["r1".to_string()],
            &req,
            &skill_digests,
            &rule_digests,
        )
        .expect("计划生成应成功");
        assert_eq!(plan.platform_id, "claude-code");
        assert_eq!(plan.platform_name, "Claude Code");
        assert_eq!(plan.skills_to_add, vec!["s2".to_string()]);
        assert_eq!(plan.skills_to_update, vec!["s1".to_string()]);
        assert!(plan.skills_to_remove.is_empty());
        assert!(plan.rules_to_add.is_empty());
        assert!(plan.rules_to_update.is_empty());
        assert_eq!(plan.rules_to_remove, vec!["r1".to_string()]);
    }

    #[test]
    fn id_level_plan_without_digests_keeps_updates_empty() {
        let req = request(
            intent(DistributionIntentMode::AddOrUpdate, &["s1"]),
            intent(DistributionIntentMode::Preserve, &[]),
        );
        let plan = calculate_distribution_plan("p", "P", &["s1".to_string()], &[], &req)
            .expect("ID 级入口应成功");
        assert!(plan.skills_to_update.is_empty());
    }

    #[test]
    fn same_digest_keeps_entry_out_of_all_lists() {
        let current = vec!["a".to_string()];
        let digests = ContentDigestPair {
            library: HashMap::from([("a".to_string(), "h".to_string())]),
            deployed: HashMap::from([("a".to_string(), "h".to_string())]),
        };
        let diff = classify_intent_diff(
            &intent(DistributionIntentMode::AddOrUpdate, &["a"]),
            &current,
            &digests,
        );
        assert_eq!(
            diff,
            IntentDiff {
                to_add: vec![],
                to_update: vec![],
                to_remove: vec![]
            }
        );
    }

    #[test]
    fn differing_digest_classifies_update() {
        let current = vec!["a".to_string()];
        let digests = ContentDigestPair {
            library: HashMap::from([("a".to_string(), "new".to_string())]),
            deployed: HashMap::from([("a".to_string(), "old".to_string())]),
        };
        let diff = classify_intent_diff(
            &intent(DistributionIntentMode::AddOrUpdate, &["a", "missing"]),
            &current,
            &digests,
        );
        assert_eq!(diff.to_update, vec!["a".to_string()]);
        assert_eq!(diff.to_add, vec!["missing".to_string()]);
        assert!(diff.to_remove.is_empty());
    }

    #[test]
    fn missing_side_digest_skips_update_classification() {
        let current = vec!["a".to_string()];
        let library_only = ContentDigestPair {
            library: HashMap::from([("a".to_string(), "h".to_string())]),
            deployed: HashMap::new(),
        };
        let deployed_only = ContentDigestPair {
            library: HashMap::new(),
            deployed: HashMap::from([("a".to_string(), "h".to_string())]),
        };
        for digests in [&library_only, &deployed_only] {
            let diff = classify_intent_diff(
                &intent(DistributionIntentMode::AddOrUpdate, &["a"]),
                &current,
                digests,
            );
            assert!(diff.to_update.is_empty(), "任一侧摘要缺失时不得误报更新");
        }
    }

    #[test]
    fn preserve_mode_ignores_digest_mismatch() {
        let digests = ContentDigestPair {
            library: HashMap::from([("a".to_string(), "new".to_string())]),
            deployed: HashMap::from([("a".to_string(), "old".to_string())]),
        };
        let diff = classify_intent_diff(
            &intent(DistributionIntentMode::Preserve, &["a"]),
            &["a".to_string()],
            &digests,
        );
        assert_eq!(diff, IntentDiff::default());
    }

    #[test]
    fn remove_selected_ignores_digests() {
        let digests = ContentDigestPair {
            library: HashMap::from([
                ("b".to_string(), "x".to_string()),
                ("ghost".to_string(), "y".to_string()),
            ]),
            deployed: HashMap::from([
                ("b".to_string(), "z".to_string()),
                ("ghost".to_string(), "w".to_string()),
            ]),
        };
        let diff = classify_intent_diff(
            &intent(DistributionIntentMode::RemoveSelected, &["b", "ghost"]),
            &["b".to_string()],
            &digests,
        );
        assert_eq!(diff.to_remove, vec!["b".to_string()]);
        assert!(diff.to_add.is_empty());
        assert!(diff.to_update.is_empty());
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
        assert!(!plan_has_removals(std::slice::from_ref(&platform_without)));
        assert!(plan_has_removals(&[platform_without, platform_with]));
    }
}
