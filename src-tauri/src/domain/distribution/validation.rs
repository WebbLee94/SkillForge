//! 分发请求校验（原 `types.rs` 中 `DistributionIntent::validate` /
//! `DistributionRequest::validate` 的实现原样迁移，错误文案逐字保留）。

use super::model::{DistributionIntent, DistributionIntentMode, DistributionRequest};
use crate::error::AppError;

impl DistributionIntent {
    pub fn validate(&self, capability: &str) -> Result<(), AppError> {
        if matches!(self.mode, DistributionIntentMode::Preserve) && !self.ids.is_empty() {
            return Err(AppError::DistributionInvalid(format!(
                "{} 使用 preserve 时不能携带 IDs",
                capability
            )));
        }
        Ok(())
    }
}

impl DistributionRequest {
    pub fn validate(&self) -> Result<(), AppError> {
        match self.scope.as_str() {
            "global" if self.project_id.is_some() => Err(AppError::DistributionInvalid(
                "global 范围不能携带 project_id".to_string(),
            )),
            "project" if self.project_id.is_none() => Err(AppError::DistributionInvalid(
                "project 范围必须提供 project_id".to_string(),
            )),
            "global" | "project" => {
                self.skills.validate("skills")?;
                self.rules.validate("rules")
            }
            _ => Err(AppError::DistributionInvalid(
                "scope 必须是 global 或 project".to_string(),
            )),
        }
    }
}

/// scope / project_id 配对的纯校验决策（供 `DistributionRequest::validate`
/// 复用，也可在应用层独立调用）。错误文案与既有行为完全一致。
pub fn validate_scope_project_pair(scope: &str, project_id: Option<&str>) -> Result<(), AppError> {
    match scope {
        "global" if project_id.is_some() => Err(AppError::DistributionInvalid(
            "global 范围不能携带 project_id".to_string(),
        )),
        "project" if project_id.is_none() => Err(AppError::DistributionInvalid(
            "project 范围必须提供 project_id".to_string(),
        )),
        "global" | "project" => Ok(()),
        _ => Err(AppError::DistributionInvalid(
            "scope 必须是 global 或 project".to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::super::model::{DistributionIntent, DistributionIntentMode};

    use super::*;

    fn intent(mode: DistributionIntentMode, ids: &[&str]) -> DistributionIntent {
        DistributionIntent {
            mode,
            ids: ids.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn request(scope: &str, project_id: Option<&str>) -> DistributionRequest {
        DistributionRequest {
            scene_id: None,
            platform_ids: vec!["claude-code".to_string()],
            scope: scope.to_string(),
            project_id: project_id.map(str::to_string),
            skills: intent(DistributionIntentMode::AddOrUpdate, &["s1"]),
            rules: intent(DistributionIntentMode::RemoveSelected, &["r1"]),
        }
    }

    #[test]
    fn valid_global_and_project_requests_pass() {
        assert!(request("global", None).validate().is_ok());
        assert!(request("project", Some("p1")).validate().is_ok());
    }

    #[test]
    fn global_with_project_id_is_rejected() {
        let err = request("global", Some("p1")).validate().unwrap_err();
        assert_eq!(
            err.to_string(),
            "分发请求无效: global 范围不能携带 project_id"
        );
    }

    #[test]
    fn project_without_project_id_is_rejected() {
        let err = request("project", None).validate().unwrap_err();
        assert_eq!(
            err.to_string(),
            "分发请求无效: project 范围必须提供 project_id"
        );
    }

    #[test]
    fn unknown_scope_is_rejected() {
        let err = request("workspace", None).validate().unwrap_err();
        assert_eq!(err.to_string(), "分发请求无效: scope 必须是 global 或 project");
    }

    #[test]
    fn preserve_intent_must_not_carry_ids() {
        let mut req = request("global", None);
        req.skills = intent(DistributionIntentMode::Preserve, &["s1"]);
        let err = req.validate().unwrap_err();
        assert_eq!(
            err.to_string(),
            "分发请求无效: skills 使用 preserve 时不能携带 IDs"
        );

        let mut req = request("global", None);
        req.rules = intent(DistributionIntentMode::Preserve, &["r1"]);
        let err = req.validate().unwrap_err();
        assert_eq!(
            err.to_string(),
            "分发请求无效: rules 使用 preserve 时不能携带 IDs"
        );
    }

    #[test]
    fn empty_preserve_intents_are_valid() {
        let mut req = request("global", None);
        req.skills = intent(DistributionIntentMode::Preserve, &[]);
        req.rules = intent(DistributionIntentMode::Preserve, &[]);
        assert!(req.validate().is_ok());
    }

    #[test]
    fn scope_pair_helper_matches_request_validation() {
        assert!(validate_scope_project_pair("global", None).is_ok());
        assert!(validate_scope_project_pair("project", Some("p1")).is_ok());
        assert!(validate_scope_project_pair("global", Some("p1")).is_err());
        assert!(validate_scope_project_pair("project", None).is_err());
        assert!(validate_scope_project_pair("other", None).is_err());
    }
}

