use crate::engine;
use crate::error::AppError;
use crate::types::{
    DistributionPlan, DistributionRequest, ManagedDistributionState, SyncResult, SyncStatusDTO,
};
use crate::AppState;

/// 命令层保留的编排之一：锁定全局数据库连接（错误映射与原先完全一致）。
fn lock_db(state: &AppState) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, AppError> {
    state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))
}

/// 命令层保留的编排之二：组装全部内置平台插件，注入分发用例。
fn all_platform_plugins() -> Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> {
    crate::plugins::platform::create_all_platform_plugins_vec()
}

#[tauri::command]
pub fn sync_scene(
    skill_ids: Vec<String>,
    rule_ids: Vec<String>,
    scene_id: Option<String>,
    platforms: Option<Vec<String>>,
    scope: String,
    project_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<SyncResult, AppError> {
    let conn = lock_db(&state)?;
    let all_plugins = all_platform_plugins();

    engine::dist_engine::sync_scene(
        &conn,
        &all_plugins,
        &skill_ids,
        &rule_ids,
        scene_id.as_deref(),
        platforms.as_deref(),
        &scope,
        project_id.as_deref(),
    )
}

#[tauri::command]
pub fn get_sync_status(state: tauri::State<'_, AppState>) -> Result<SyncStatusDTO, AppError> {
    let conn = lock_db(&state)?;
    engine::dist_engine::get_sync_status(&conn)
}

#[tauri::command]
pub fn preview_sync(
    skill_ids: Vec<String>,
    rule_ids: Vec<String>,
    scene_id: Option<String>,
    platform_ids: Vec<String>,
    scope: String,
    project_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<DistributionPlan, AppError> {
    let conn = lock_db(&state)?;
    let all_plugins = all_platform_plugins();
    engine::dist_engine::build_distribution_plan(
        &conn,
        &all_plugins,
        &skill_ids,
        &rule_ids,
        scene_id.as_deref(),
        &platform_ids,
        &scope,
        project_id.as_deref(),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn preview_distribution(
    scene_id: Option<String>,
    platform_ids: Vec<String>,
    scope: String,
    project_id: Option<String>,
    skills: crate::types::DistributionIntent,
    rules: crate::types::DistributionIntent,
    state: tauri::State<'_, AppState>,
) -> Result<DistributionPlan, AppError> {
    let conn = lock_db(&state)?;
    let all_plugins = all_platform_plugins();
    let request = DistributionRequest {
        scene_id,
        platform_ids,
        scope,
        project_id,
        skills,
        rules,
    };

    engine::dist_engine::build_distribution_plan_for_request(&conn, &all_plugins, &request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_managed_distribution_state(
    platform_ids: Vec<String>,
    scope: String,
    project_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<ManagedDistributionState, AppError> {
    let conn = lock_db(&state)?;
    let all_plugins = all_platform_plugins();
    engine::dist_engine::get_managed_distribution_state(
        &conn,
        &all_plugins,
        &platform_ids,
        &scope,
        project_id.as_deref(),
    )
}

#[tauri::command]
pub fn execute_distribution(
    selection: DistributionRequest,
    plan: DistributionPlan,
    state: tauri::State<'_, AppState>,
) -> Result<SyncResult, AppError> {
    selection.validate()?;
    let conn = lock_db(&state)?;
    let all_plugins = all_platform_plugins();
    engine::dist_engine::execute_distribution_request(&conn, &all_plugins, &selection, &plan)
}

/// 33 号 3.3 / DEC-1：独立移除受管内容（与 execute_distribution 语义互斥互补）。
#[tauri::command(rename_all = "camelCase")]
pub fn remove_distributed(
    platform_ids: Vec<String>,
    scope: String,
    project_id: Option<String>,
    skill_ids: Vec<String>,
    rule_ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<SyncResult, AppError> {
    let conn = lock_db(&state)?;
    let all_plugins = all_platform_plugins();
    engine::dist_execute::execute_remove_distributed(
        &conn,
        &all_plugins,
        &platform_ids,
        &scope,
        project_id.as_deref(),
        &skill_ids,
        &rule_ids,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontend_distribution_payload_uses_camel_case_fields() {
        let request: DistributionRequest = serde_json::from_str(
            r#"{
                "sceneId": "scene-1",
                "platformIds": ["claude-code"],
                "scope": "global",
                "projectId": null,
                "skills": {"mode": "add_or_update", "ids": ["skill-1"]},
                "rules": {"mode": "preserve", "ids": []}
            }"#,
        )
        .expect("frontend preview payload should deserialize");

        assert_eq!(request.scene_id.as_deref(), Some("scene-1"));
        assert_eq!(request.platform_ids, vec!["claude-code"]);
    }

    #[test]
    fn frontend_execute_payload_contains_nested_selection_and_plan() {
        let payload = serde_json::json!({
            "selection": {
                "sceneId": null,
                "platformIds": ["claude-code"],
                "scope": "global",
                "skills": {"mode": "add_or_update", "ids": ["skill-1"]},
                "rules": {"mode": "preserve", "ids": []}
            },
            "plan": {
                "platforms": [],
                "has_removals": false
            }
        });

        let selection: DistributionRequest = serde_json::from_value(payload["selection"].clone())
            .expect("frontend execute selection should deserialize");
        let plan: DistributionPlan = serde_json::from_value(payload["plan"].clone())
            .expect("frontend execute plan should deserialize");

        assert_eq!(selection.skills.ids, vec!["skill-1"]);
        assert!(!plan.has_removals);
    }

    #[test]
    fn distribution_request_maps_project_id_and_intent_modes() {
        let request: DistributionRequest = serde_json::from_str(
            r#"{
                "sceneId": null,
                "platformIds": ["claude-code", "codex"],
                "scope": "project",
                "projectId": "proj-42",
                "skills": {"mode": "remove_selected", "ids": ["skill-1"]},
                "rules": {"mode": "add_or_update", "ids": []}
            }"#,
        )
        .expect("camelCase payload should map project_id and intents");

        assert_eq!(request.project_id.as_deref(), Some("proj-42"));
        assert_eq!(request.platform_ids.len(), 2);
        assert!(matches!(
            request.skills.mode,
            crate::types::DistributionIntentMode::RemoveSelected
        ));
        assert!(matches!(
            request.rules.mode,
            crate::types::DistributionIntentMode::AddOrUpdate
        ));

        // Round-trip 锁定：intent mode 字符串保持 snake_case。
        let value = serde_json::to_value(&request).unwrap();
        assert_eq!(value["skills"]["mode"], "remove_selected");
        assert_eq!(value["rules"]["mode"], "add_or_update");
    }

    #[test]
    fn ipc_payload_shapes_lock_snake_case_keys() {
        // 契约锁定：这三个载荷未启用 camelCase 重命名，前端按 snake_case 字段读取。
        let plan = DistributionPlan {
            platforms: vec![crate::types::PlatformDistributionPlan {
                platform_id: "claude-code".to_string(),
                platform_name: "Claude Code".to_string(),
                skills_to_add: vec!["skill-1".to_string()],
                skills_to_update: vec![],
                skills_to_remove: vec!["skill-2".to_string()],
                rules_to_add: vec!["rule-1".to_string()],
                rules_to_update: vec![],
                rules_to_remove: vec![],
            }],
            has_removals: true,
        };
        let plan_json = serde_json::to_value(&plan).unwrap();
        for key in [
            "platforms",
            "has_removals",
            "skills_to_add",
            "skills_to_update",
            "skills_to_remove",
            "rules_to_add",
            "rules_to_update",
            "rules_to_remove",
        ] {
            assert!(
                plan_json["platforms"][0].get(key).is_some() || plan_json.get(key).is_some(),
                "DistributionPlan 缺少字段 {key}"
            );
        }

        let sync = SyncResult {
            installed: vec!["skill-1".to_string()],
            updated: vec![],
            removed: vec!["rule-1".to_string()],
            skipped: 2,
            errors: vec![],
        };
        let sync_json = serde_json::to_value(&sync).unwrap();
        for key in ["installed", "updated", "removed", "skipped", "errors"] {
            assert!(sync_json.get(key).is_some(), "SyncResult 缺少字段 {key}");
        }

        let managed = ManagedDistributionState {
            platforms: vec![crate::types::ManagedPlatformState {
                platform_id: "codex".to_string(),
                platform_name: "Codex".to_string(),
                scope: "global".to_string(),
                project_path: None,
                skills: vec![crate::types::ManagedDistributionEntry {
                    id: "skill-1".to_string(),
                    path: "/tmp/skill-1".to_string(),
                }],
                rules: vec![],
                local_skills: vec![crate::types::LocalDistributionEntry {
                    name: "user-dir".to_string(),
                    path: "/tmp/user-dir".to_string(),
                }],
                local_rules: vec![],
            }],
        };
        let managed_json = serde_json::to_value(&managed).unwrap();
        for key in [
            "platform_id",
            "platform_name",
            "scope",
            "project_path",
            "skills",
            "rules",
            "local_skills",
            "local_rules",
        ] {
            assert!(
                managed_json["platforms"][0].get(key).is_some(),
                "ManagedPlatformState 缺少字段 {key}"
            );
        }
    }
}
