// ===== Skill =====
export interface Skill {
  id: string;
  name: string;
  description: string | null;
  source_type: string;
  source_url: string | null;
  current_ver: string | null;
  installed_at: string;
  local_path: string;
  metadata: string | null;
  tags?: Tag[];
  sync_status?: SyncStatus;
}

export interface SkillVersion {
  skill_id: string;
  version: string;
  source_ref: string | null;
  checksum: string | null;
  fetched_at: string;
}

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  source_type: string;
  source_url: string | null;
  version: string | null;
  metadata: string | null;
}

export interface SkillBundle {
  meta: SkillMeta;
  skill_md: string;
  subdirs: string[];
}

// ===== Tag =====
export interface Tag {
  id: number;
  name: string;
  color: string | null;
  category?: string | null;
  skill_count?: number;
  rule_count?: number;
}

export interface CreateTagDTO {
  name: string;
  color: string;
  category?: string;
}

// ===== Rule =====
export interface Rule {
  id: string;
  name: string;
  description: string | null;
  format: string;
  content: string;
  platform: string | null;
  scope: string | null;
  version: number;
  updated_at: string;
  tags?: Tag[];
}

export interface RuleHistory {
  rule_id: string;
  version: number;
  content: string;
  changed_at: string;
}

export interface CreateRuleDTO {
  name: string;
  description: string;
  format: string;
  content: string;
  platform: string;
  scope: string;
}

export interface UpdateRuleDTO {
  name?: string;
  description?: string;
  content?: string;
  platform?: string;
  scope?: string;
}

// ===== Scene =====
export interface Scene {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  is_template: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface SceneSkill {
  skill_id: string;
  skill_name: string;
  version: string | null;
  enabled: boolean;
  sort_order: number;
}

export interface SceneRule {
  rule_id: string;
  rule_name: string;
  enabled: boolean;
  sort_order: number;
}

export interface SceneDetail {
  scene: Scene;
  skills: SceneSkill[];
  rules: SceneRule[];
}

export interface CreateSceneDTO {
  name: string;
  description: string;
  icon?: string;
}

export interface UpdateSceneDTO {
  name?: string;
  description?: string;
  icon?: string;
}

// ===== Project =====
export interface Project {
  id: string;
  name: string;
  path: string;
  scene_id: string | null;
  scene_name?: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface AddProjectDTO {
  name: string;
  path: string;
  scene_id?: string;
  description?: string;
}

// ===== Platform =====
export interface Platform {
  id: string;
  name: string;
  adapter: string;
  global_path: string | null;
  project_path: string | null;
}

export interface PlatformInstance {
  platform_id: string;
  path: string;
  scope: string;
}

export interface PlatformPaths {
  global_skills_dir: string;
  project_skills_pattern: string;
  global_rules_dir: string | null;
  project_rules_pattern: string | null;
}

// ===== Distribution =====
export interface Distribution {
  id: number;
  scene_id: string;
  platform_id: string;
  scope: string;
  project_id: string | null;
  project_path: string | null;
  status: string;
  synced_at: string | null;
  checksum: string | null;
}

export interface SyncLog {
  id: number;
  action: string;
  target_type: string;
  target_id: string;
  platform_id: string | null;
  status: string;
  message: string | null;
  created_at: string;
}

export interface SyncResult {
  installed: string[];
  updated: string[];
  removed: string[];
  errors: string[];
}

export interface SyncStatusDTO {
  platforms: PlatformSyncStatus[];
}

export interface PlatformSyncStatus {
  platform_id: string;
  platform_name: string;
  status: string;
  synced_count: number;
  total_count: number;
}

// ===== Dashboard =====
export interface DashboardStats {
  skill_count: number;
  rule_count: number;
  scene_count: number;
  user_scene_count: number;
  project_count: number;
}

// ===== App Config =====
export interface AppConfig {
  data_dir: string;
  db_path: string;
  version: string;
}

// ===== Global Distribution Status =====
export interface GlobalDistStatus {
  scene_id: string | null;
  scene_name: string | null;
  skill_count: number;
  rule_count: number;
  platforms: PlatformDistInfo[];
  last_synced_at: string | null;
}

export interface PlatformDistInfo {
  platform_id: string;
  platform_name: string;
  synced_count: number;
  total_count: number;
  last_synced_at: string | null;
}

export interface VerifyReport {
  total: number;
  ok: number;
  drifted: DriftedItem[];
}

export interface DriftedItem {
  item_type: string;
  item_id: string;
  platform_id: string;
  issue: string;
}

// ===== Sync Status =====
export type SyncStatus = "synced" | "outdated" | "partial" | "error" | "pending";
