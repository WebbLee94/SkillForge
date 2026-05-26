import { invoke } from "@tauri-apps/api/core";
import type {
  Skill,
  Scene,
  SceneDetail,
  Rule,
  RuleHistory,
  Tag,
  Project,
  Platform,
  Distribution,
  SyncLog,
  DashboardStats,
  AppConfig,
  CreateSceneDTO,
  UpdateSceneDTO,
  CreateRuleDTO,
  UpdateRuleDTO,
  SyncResult,
  SyncStatusDTO,
  GlobalDistStatus,
  VerifyReport,
} from "../types";

export const ipc = {
  // Skills - Rust uses skill_id, not id
  listSkills: (sourceType?: string, tag?: string) =>
    invoke<Skill[]>("list_skills", { sourceType, tag }),
  installSkill: (source: string, skillId: string) =>
    invoke<Skill>("install_skill", { source, skillId }),
  uninstallSkill: (skillId: string) =>
    invoke<Skill>("uninstall_skill", { skillId }),
  updateSkill: (skillId: string) =>
    invoke<Skill>("update_skill", { skillId }),
  searchSkills: (query: string) => invoke<Skill[]>("search_skills", { query }),

  // Scenes - Rust create_scene takes data: CreateSceneDTO
  listScenes: () => invoke<Scene[]>("list_scenes"),
  createScene: (data: CreateSceneDTO) =>
    invoke<Scene>("create_scene", { data }),
  updateScene: (id: string, data: UpdateSceneDTO) =>
    invoke<void>("update_scene", { id, data }),
  deleteScene: (id: string) => invoke<void>("delete_scene", { id }),
  addSkillToScene: (sceneId: string, skillId: string) =>
    invoke<void>("add_skill_to_scene", { sceneId, skillId }),
  removeSkillFromScene: (sceneId: string, skillId: string) =>
    invoke<void>("remove_skill_from_scene", { sceneId, skillId }),
  addRuleToScene: (sceneId: string, ruleId: string) =>
    invoke<void>("add_rule_to_scene", { sceneId, ruleId }),
  removeRuleFromScene: (sceneId: string, ruleId: string) =>
    invoke<void>("remove_rule_from_scene", { sceneId, ruleId }),
  getSceneDetail: (id: string) =>
    invoke<SceneDetail>("get_scene_detail", { id }),
  getScenePlatforms: (sceneId: string) =>
    invoke<string[]>("get_scene_platforms", { sceneId }),
  setScenePlatforms: (sceneId: string, platformIds: string[]) =>
    invoke<void>("set_scene_platforms", { sceneId, platformIds }),

  // Distribution - Rust uses scene_id, snake_case
  syncScene: (
    sceneId: string,
    platforms: string[] | null,
    scope: string,
    projectId?: string,
  ) =>
    invoke<SyncResult>("sync_scene", { sceneId, platforms, scope, projectId }),
  getSyncStatus: () => invoke<SyncStatusDTO>("get_sync_status"),
  getDistributions: (sceneId?: string) =>
    invoke<Distribution[]>("get_distributions", { sceneId }),

  // Projects - Rust uses individual params, not DTO
  listProjects: () => invoke<Project[]>("list_projects"),
  addProject: (name: string, path: string, sceneId?: string, description?: string) =>
    invoke<Project>("add_project", { name, path, sceneId, description }),
  bindSceneToProject: (projectId: string, sceneId: string) =>
    invoke<void>("bind_scene_to_project", { projectId, sceneId }),
  removeProject: (id: string) => invoke<void>("remove_project", { id }),

  // Rules - Rust create_rule takes data: CreateRuleDTO
  listRules: (platform?: string) => invoke<Rule[]>("list_rules", { platform }),
  createRule: (data: CreateRuleDTO) =>
    invoke<Rule>("create_rule", { data }),
  updateRule: (id: string, data: UpdateRuleDTO) =>
    invoke<void>("update_rule", { id, data }),
  deleteRule: (id: string) => invoke<void>("delete_rule", { id }),
  getRuleHistory: (id: string) =>
    invoke<RuleHistory[]>("get_rule_history", { id }),

  // Tags - Rust uses individual params, not DTO
  listTags: (category?: string) => invoke<Tag[]>("list_tags", { category }),
  createTag: (name: string, color?: string, category?: string) =>
    invoke<Tag>("create_tag", { name, color, category }),
  updateTag: (id: number, name?: string, color?: string, category?: string) =>
    invoke<void>("update_tag", { id, name, color, category }),
  deleteTag: (id: number) => invoke<void>("delete_tag", { id }),
  assignTag: (targetType: string, targetId: string, tagId: number) =>
    invoke<void>("assign_tag", { targetType, targetId, tagId }),
  removeTag: (targetType: string, targetId: string, tagId: number) =>
    invoke<void>("remove_tag", { targetType, targetId, tagId }),

  // System
  getAppConfig: () => invoke<AppConfig>("get_app_config"),
  getDashboardStats: () => invoke<DashboardStats>("get_dashboard_stats"),
  getRecentActivity: (limit?: number) =>
    invoke<SyncLog[]>("get_recent_activity", { limit }),
  listPlatforms: () => invoke<Platform[]>("list_platforms"),
  togglePlatformEnabled: (id: string, enabled: boolean) =>
    invoke<void>("toggle_platform_enabled", { id, enabled }),
  getDbSize: () => invoke<string>("get_db_size"),

  // Global Distribution
  getGlobalDistributionStatus: () => invoke<GlobalDistStatus>("get_global_distribution_status"),
  getGlobalConfig: () => invoke<{ global_scene_id: string | null }>("get_global_config"),
  setGlobalConfig: (key: string, value: string | null) => invoke<void>("set_global_config", { key, value }),
  switchGlobalScene: (newSceneId: string) => invoke<SyncResult>("switch_global_scene", { newSceneId }),
  verifyDistribution: (sceneId: string, scope: string) => invoke<VerifyReport>("verify_distribution", { sceneId, scope }),
  repairDrift: (itemType: string, itemId: string, platformId: string, action: string) => invoke<void>("repair_drift", { itemType, itemId, platformId, action }),
  getDriftStatus: () => invoke<{ drift_count: number }>("get_drift_status"),
};
