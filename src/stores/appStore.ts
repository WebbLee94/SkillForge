import { create } from "zustand";
import type {
  Skill,
  Rule,
  Tag,
  Scene,
  SceneDetail,
  Project,
  Platform,
  Distribution,
  SyncLog,
  DashboardStats,
  SyncStatusDTO,
  CreateSceneDTO,
  UpdateSceneDTO,
  CreateRuleDTO,
  UpdateRuleDTO,
  CreateTagDTO,
  SyncResult,
  GlobalDistStatus,
} from "../types";
import { ipc } from "../lib/ipc";
import i18n from "../lib/i18n";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info" | "warning";
}

interface AppStore {
  // === Data ===
  skills: Skill[];
  rules: Rule[];
  tags: Tag[];
  scenes: Scene[];
  projects: Project[];
  platforms: Platform[];
  distributions: Distribution[];
  recentActivity: SyncLog[];
  dashboardStats: DashboardStats | null;
  syncStatus: SyncStatusDTO | null;
  globalDistStatus: GlobalDistStatus | null;

  // === Selection ===
  selectedSkill: Skill | null;
  currentScene: Scene | null;
  currentSceneDetail: SceneDetail | null;
  editingRule: Rule | null;

  // === UI State ===
  activeNav: string;
  sidebarCollapsed: boolean;
  searchQuery: string;
  tagFilter: number[];
  loading: boolean;
  toasts: Toast[];

  // === Toast Actions ===
  addToast: (message: string, type: Toast["type"]) => void;
  removeToast: (id: string) => void;

  // === Navigation ===
  setActiveNav: (nav: string) => void;
  toggleSidebar: () => void;

  // === Filter ===
  setSearchQuery: (query: string) => void;
  setTagFilter: (tags: number[]) => void;

  // === Skill Actions ===
  fetchSkills: () => Promise<void>;
  selectSkill: (skill: Skill | null) => void;
  installSkill: (source: string, id: string, opts?: { silent?: boolean }) => Promise<void>;
  uninstallSkill: (id: string) => Promise<void>;
  updateSkill: (id: string) => Promise<void>;

  // === Rule Actions ===
  fetchRules: () => Promise<void>;
  setEditingRule: (rule: Rule | null) => void;
  createRule: (data: CreateRuleDTO, opts?: { silent?: boolean }) => Promise<void>;
  updateRule: (id: string, data: UpdateRuleDTO) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;

  // === Tag Actions ===
  fetchTags: (tagType?: string) => Promise<void>;
  createTag: (data: CreateTagDTO) => Promise<number | void>;
  updateTag: (id: number, name?: string, color?: string, category?: string) => Promise<void>;
  deleteTag: (id: number) => Promise<void>;
  assignTag: (targetType: string, targetId: string, tagId: number) => Promise<void>;
  removeTag: (targetType: string, targetId: string, tagId: number) => Promise<void>;

  // === Scene Actions ===
  fetchScenes: () => Promise<void>;
  setCurrentScene: (scene: Scene | null) => void;
  createScene: (data: CreateSceneDTO) => Promise<void>;
  updateScene: (id: string, data: UpdateSceneDTO) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
  fetchSceneDetail: (id: string) => Promise<void>;
  addSkillToScene: (sceneId: string, skillId: string) => Promise<void>;
  removeSkillFromScene: (sceneId: string, skillId: string) => Promise<void>;
  addRuleToScene: (sceneId: string, ruleId: string) => Promise<void>;
  removeRuleFromScene: (sceneId: string, ruleId: string) => Promise<void>;
  getScenePlatforms: (sceneId: string) => Promise<string[]>;
  setScenePlatforms: (sceneId: string, platformIds: string[]) => Promise<void>;

  // === Project Actions ===
  fetchProjects: () => Promise<void>;
  addProject: (name: string, path: string, sceneId?: string, description?: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  bindSceneToProject: (projectId: string, sceneId: string) => Promise<void>;

  // === Platform Actions ===
  fetchPlatforms: () => Promise<void>;

  // === Distribution Actions ===
  fetchDistributions: () => Promise<void>;
  syncScene: (sceneId: string, platforms: string[] | null, scope: string, projectId?: string) => Promise<SyncResult | null>;
  fetchSyncStatus: () => Promise<void>;

  // === Dashboard ===
  fetchDashboardStats: () => Promise<void>;
  fetchRecentActivity: () => Promise<void>;
  fetchGlobalDistStatus: () => Promise<void>;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // === Data ===
  skills: [],
  rules: [],
  tags: [],
  scenes: [],
  projects: [],
  platforms: [],
  distributions: [],
  recentActivity: [],
  dashboardStats: null,
  syncStatus: null,
  globalDistStatus: null,

  // === Selection ===
  selectedSkill: null,
  currentScene: null,
  currentSceneDetail: null,
  editingRule: null,

  // === UI State ===
  activeNav: "dashboard",
  sidebarCollapsed: false,
  searchQuery: "",
  tagFilter: [],
  loading: false,
  toasts: [],

  // === Toast Actions ===
  addToast: (message, type) => {
    const id = Date.now().toString();
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  // === Navigation ===
  setActiveNav: (nav) => set({ activeNav: nav }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  // === Filter ===
  setSearchQuery: (query) => set({ searchQuery: query }),
  setTagFilter: (tags) => set({ tagFilter: tags }),

  // === Skill Actions ===
  fetchSkills: async () => {
    set({ loading: true });
    try {
      const skills = await ipc.listSkills();
      set({ skills, loading: false });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      set({ loading: false });
      get().addToast(`获取技能列表失败: ${errMsg}`, "error");
    }
  },
  selectSkill: (skill) => set({ selectedSkill: skill }),
  installSkill: async (source, id, opts?: { silent?: boolean }) => {
    // Map frontend source type to backend plugin name
    const sourceMap: Record<string, string> = {
      local: "local-fs",
      git: "git-repo",
    };
    const backendSource = sourceMap[source] || source;
    try {
      await ipc.installSkill(backendSource, id);
      await get().fetchSkills();
      if (!opts?.silent) {
        get().addToast("安装成功", "success");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`安装失败: ${errMsg}`, "error");
    }
  },
  uninstallSkill: async (id) => {
    try {
      await ipc.uninstallSkill(id);
      const { selectedSkill } = get();
      if (selectedSkill?.id === id) {
        set({ selectedSkill: null });
      }
      await get().fetchSkills();
      get().addToast("卸载成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`卸载失败: ${errMsg}`, "error");
    }
  },
  updateSkill: async (id) => {
    try {
      await ipc.updateSkill(id);
      await get().fetchSkills();
      get().addToast("更新成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`更新失败: ${errMsg}`, "error");
    }
  },

  // === Rule Actions ===
  fetchRules: async () => {
    set({ loading: true });
    try {
      const rules = await ipc.listRules();
      set({ rules, loading: false });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      set({ loading: false });
      get().addToast(`获取规则列表失败: ${errMsg}`, "error");
    }
  },
  setEditingRule: (rule) => set({ editingRule: rule }),
  createRule: async (data, opts?: { silent?: boolean }) => {
    try {
      await ipc.createRule(data);
      await get().fetchRules();
      if (!opts?.silent) {
        get().addToast("创建规则成功", "success");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`创建规则失败: ${errMsg}`, "error");
    }
  },
  updateRule: async (id, data) => {
    try {
      await ipc.updateRule(id, data);
      await get().fetchRules();
      get().addToast("保存规则成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`保存规则失败: ${errMsg}`, "error");
    }
  },
  deleteRule: async (id) => {
    try {
      await ipc.deleteRule(id);
      const { editingRule } = get();
      if (editingRule?.id === id) {
        set({ editingRule: null });
      }
      await get().fetchRules();
      get().addToast("删除规则成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`删除规则失败: ${errMsg}`, "error");
    }
  },

  // === Tag Actions ===
  fetchTags: async (tagType?: string) => {
    try {
      const tags = await ipc.listTags(undefined, tagType);
      set({ tags });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`获取标签列表失败: ${errMsg}`, "error");
    }
  },
  createTag: async (data) => {
    try {
      const newTag = await ipc.createTag(data.name, data.color, data.category, data.tag_type);
      await get().fetchTags(data.tag_type);
      get().addToast("创建标签成功", "success");
      return newTag?.id;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`创建标签失败: ${errMsg}`, "error");
    }
  },
  updateTag: async (id, name, color, category) => {
    try {
      await ipc.updateTag(id, name, color, category);
      // Re-fetch with current filter context — find the tag's type
      const tag = get().tags.find(t => t.id === id);
      await get().fetchTags(tag?.tag_type);
      get().addToast("更新标签成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`更新标签失败: ${errMsg}`, "error");
    }
  },
  deleteTag: async (id) => {
    try {
      const tag = get().tags.find(t => t.id === id);
      const tagType = tag?.tag_type;
      await ipc.deleteTag(id);
      await get().fetchTags(tagType);
      get().addToast("删除标签成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`删除标签失败: ${errMsg}`, "error");
    }
  },
  assignTag: async (targetType, targetId, tagId) => {
    try {
      await ipc.assignTag(targetType, targetId, tagId);
      get().addToast("分配标签成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`分配标签失败: ${errMsg}`, "error");
    }
  },
  removeTag: async (targetType, targetId, tagId) => {
    try {
      await ipc.removeTag(targetType, targetId, tagId);
      get().addToast("移除标签成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`移除标签失败: ${errMsg}`, "error");
    }
  },

  // === Scene Actions ===
  fetchScenes: async () => {
    try {
      const scenes = await ipc.listScenes();
      set({ scenes });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`获取场景列表失败: ${errMsg}`, "error");
    }
  },
  setCurrentScene: (scene) => set({ currentScene: scene, currentSceneDetail: null }),
  createScene: async (data) => {
    try {
      await ipc.createScene(data);
      await get().fetchScenes();
      get().addToast("创建场景成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`创建场景失败: ${errMsg}`, "error");
    }
  },
  updateScene: async (id, data) => {
    try {
      await ipc.updateScene(id, data);
      await get().fetchScenes();
      get().addToast("保存场景成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : JSON.stringify(e);
      get().addToast(`保存场景失败: ${errMsg}`, "error");
    }
  },
  deleteScene: async (id) => {
    try {
      await ipc.deleteScene(id);
      const { currentScene } = get();
      if (currentScene?.id === id) {
        set({ currentScene: null, currentSceneDetail: null });
      }
      await get().fetchScenes();
      get().addToast("删除场景成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`删除场景失败: ${errMsg}`, "error");
    }
  },
  fetchSceneDetail: async (id) => {
    try {
      const detail = await ipc.getSceneDetail(id);
      set({ currentSceneDetail: detail });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`获取场景详情失败: ${errMsg}`, "error");
    }
  },
  addSkillToScene: async (sceneId, skillId) => {
    try {
      await ipc.addSkillToScene(sceneId, skillId);
      await get().fetchSceneDetail(sceneId);
      get().addToast("添加技能到场景成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`添加技能到场景失败: ${errMsg}`, "error");
    }
  },
  removeSkillFromScene: async (sceneId, skillId) => {
    try {
      await ipc.removeSkillFromScene(sceneId, skillId);
      await get().fetchSceneDetail(sceneId);
      get().addToast("从场景移除技能成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`从场景移除技能失败: ${errMsg}`, "error");
    }
  },
  addRuleToScene: async (sceneId, ruleId) => {
    try {
      await ipc.addRuleToScene(sceneId, ruleId);
      await get().fetchSceneDetail(sceneId);
      get().addToast("添加规则到场景成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`添加规则到场景失败: ${errMsg}`, "error");
    }
  },
  removeRuleFromScene: async (sceneId, ruleId) => {
    try {
      await ipc.removeRuleFromScene(sceneId, ruleId);
      await get().fetchSceneDetail(sceneId);
      get().addToast("从场景移除规则成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`从场景移除规则失败: ${errMsg}`, "error");
    }
  },
  getScenePlatforms: async (sceneId) => {
    try {
      return await ipc.getScenePlatforms(sceneId);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`获取场景平台关联失败: ${errMsg}`, "error");
      return [];
    }
  },
  setScenePlatforms: async (sceneId, platformIds) => {
    try {
      await ipc.setScenePlatforms(sceneId, platformIds);
      get().addToast("保存场景平台关联成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`保存场景平台关联失败: ${errMsg}`, "error");
    }
  },

  // === Project Actions ===
  fetchProjects: async () => {
    try {
      const projects = await ipc.listProjects();
      set({ projects });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`获取项目列表失败: ${errMsg}`, "error");
    }
  },
  addProject: async (name, path, sceneId, description) => {
    try {
      await ipc.addProject(name, path, sceneId, description);
      await get().fetchProjects();
      get().addToast("添加项目成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`添加项目失败: ${errMsg}`, "error");
    }
  },
  removeProject: async (id) => {
    try {
      await ipc.removeProject(id);
      await get().fetchProjects();
      get().addToast("移除项目成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`移除项目失败: ${errMsg}`, "error");
    }
  },
  bindSceneToProject: async (projectId, sceneId) => {
    try {
      await ipc.bindSceneToProject(projectId, sceneId);
      await get().fetchProjects();
      get().addToast("绑定场景成功", "success");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`绑定场景失败: ${errMsg}`, "error");
    }
  },

  // === Platform Actions ===
  fetchPlatforms: async () => {
    try {
      const platforms = await ipc.listPlatforms();
      set({ platforms });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`获取平台列表失败: ${errMsg}`, "error");
    }
  },

  // === Distribution Actions ===
  fetchDistributions: async () => {
    try {
      const distributions = await ipc.getDistributions();
      set({ distributions });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`获取分发列表失败: ${errMsg}`, "error");
    }
  },
  syncScene: async (sceneId, platforms, scope, projectId) => {
    try {
      // L2: 同步前能力检查 — 全局分发时检查是否有平台不支持全局规则
      if (scope === "global") {
        try {
          const targetPlatformIds = platforms ?? (await ipc.getScenePlatforms(sceneId));
          const noGlobalRulesPlatforms: string[] = [];
          for (const pid of targetPlatformIds) {
            const cap = await ipc.getCapabilities(pid);
            if (!cap.rules_global) {
              const p = get().platforms.find((pl) => pl.id === pid);
              noGlobalRulesPlatforms.push(p?.name || pid);
            }
          }
          if (noGlobalRulesPlatforms.length > 0) {
            get().addToast(
              i18n.t("common:messages.capabilityWarning", { platforms: noGlobalRulesPlatforms.join("、") }),
              "warning",
            );
          }
        } catch {
          // 能力检查失败不阻断同步
        }
      }

      const result = await ipc.syncScene(sceneId, platforms, scope, projectId);
      await get().fetchDistributions();
      await get().fetchSyncStatus();
      await get().fetchGlobalDistStatus();
      if (result.errors.length === 0) {
        get().addToast("同步成功", "success");
      } else {
        get().addToast(`同步完成，${result.errors.length} 项失败`, "warning");
      }
      return result;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`同步失败: ${errMsg}`, "error");
      return null;
    }
  },
  fetchSyncStatus: async () => {
    try {
      const syncStatus = await ipc.getSyncStatus();
      set({ syncStatus });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`获取同步状态失败: ${errMsg}`, "error");
    }
  },

  // === Dashboard ===
  fetchDashboardStats: async () => {
    try {
      const stats = await ipc.getDashboardStats();
      set({ dashboardStats: stats });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`获取看板统计失败: ${errMsg}`, "error");
    }
  },
  fetchRecentActivity: async () => {
    try {
      const activity = await ipc.getRecentActivity(50);
      set({ recentActivity: activity });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`获取最近活动失败: ${errMsg}`, "error");
    }
  },
  fetchGlobalDistStatus: async () => {
    try {
      const status = await ipc.getGlobalDistributionStatus();
      set({ globalDistStatus: status });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      get().addToast(`获取全局分发状态失败: ${errMsg}`, "error");
    }
  },
}));
