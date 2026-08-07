use crate::engine;
use crate::error::AppError;
use crate::types::{
    Distribution, DistributionPlan, DistributionRequest, ManagedDistributionState, SyncResult,
    SyncStatusDTO,
};
use crate::AppState;

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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> =
        crate::plugins::platform::create_all_platform_plugins_vec();

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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::dist_engine::get_sync_status(&conn)
}

#[tauri::command]
pub fn get_distributions(
    scene_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Distribution>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    engine::dist_engine::get_distributions(&conn, scene_id.as_deref())
}

#[tauri::command]
pub fn switch_global_scene(
    new_scene_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<SyncResult, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> =
        crate::plugins::platform::create_all_platform_plugins_vec();
    engine::dist_engine::switch_global_scene(&conn, &all_plugins, &new_scene_id)
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;

    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> =
        crate::plugins::platform::create_all_platform_plugins_vec();

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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> =
        crate::plugins::platform::create_all_platform_plugins_vec();
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> =
        crate::plugins::platform::create_all_platform_plugins_vec();
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let all_plugins: Vec<Box<dyn crate::plugins::platform::PlatformPlugin>> =
        crate::plugins::platform::create_all_platform_plugins_vec();
    engine::dist_engine::execute_distribution_request(&conn, &all_plugins, &selection, &plan)
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
}
