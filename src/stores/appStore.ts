import { create } from 'zustand';
import type {
  Skill,
  Rule,
  Tag,
  Scene,
  SceneDetail,
  Project,
  Platform,
  DashboardStats,
  SyncStatusDTO,
  CreateSceneDTO,
  UpdateSceneDTO,
  CreateRuleDTO,
  UpdateRuleDTO,
  CreateTagDTO,
  SyncResult,
  ScanForImportResult,
  SkillPreview,
  RulePreview,
  ImportResult,
  DistributionPlan,
  DistributionSelection,
  RemoveDistributionSelection,
  ManagedDistributionState,
  SceneCompositionDraft,
} from '../types';
import { ipc } from '../lib/ipc';
import i18n from '../lib/i18n';

export type LegacyDistributionSelection = {
  skillIds: string[];
  ruleIds: string[];
  sceneId: string | null;
  platformIds: string[];
  scope: 'global' | 'project';
  projectId?: string;
};

type SyncSelection = DistributionSelection | LegacyDistributionSelection;

export type SyncConfirmResult =
  'confirmed' | 'cancelled' | 'no_changes' | 'preview_failed';

export type ConfirmedDistribution = {
  selection: DistributionSelection;
  plan: DistributionPlan;
};

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

interface AppStore {
  // === Data ===
  skills: Skill[];
  rules: Rule[];
  tags: Tag[];
  scenes: Scene[];
  projects: Project[];
  platforms: Platform[];
  dashboardStats: DashboardStats | null;
  syncStatus: SyncStatusDTO | null;
  managedDistributionState: ManagedDistributionState | null;

  // === Selection ===
  selectedSkill: Skill | null;
  currentScene: Scene | null;
  currentSceneDetail: SceneDetail | null;
  /** Tracks the most recently requested scene detail ID to discard stale responses. */
  _lastFetchedSceneId: string | null;
  editingRule: Rule | null;

  // === UI State ===
  activeNav: string;
  sidebarCollapsed: boolean;
  searchQuery: string;
  tagFilter: number[];
  loading: boolean;
  toasts: Toast[];

  // === Distribution Selection Memory ===
  globalDistSelectedPlatform: string | null;
  setGlobalDistSelectedPlatform: (id: string | null) => void;
  projectDistSelectedProjectId: string | null;
  projectDistSelectedPlatform: string | null;
  setProjectDistSelectedProjectId: (id: string | null) => void;
  setProjectDistSelectedPlatform: (id: string | null) => void;

  /** 资源库「去分发」携带的临时选择（§3.4）；分发工作区消费（后续任务） */
  pendingDistributionSelection: {
    skillIds: string[];
    ruleIds: string[];
    sceneId?: string | null;
  } | null;
  setPendingDistributionSelection: (
    selection: {
      skillIds: string[];
      ruleIds: string[];
      sceneId?: string | null;
    } | null
  ) => void;

  // === Toast Actions ===
  addToast: (message: string, type: Toast['type']) => void;
  removeToast: (id: string) => void;

  // === Navigation ===
  setActiveNav: (nav: string) => void;
  toggleSidebar: () => void;

  // === Filter ===
  setSearchQuery: (query: string) => void;
  setTagFilter: (tags: number[]) => void;

  // === Skill Actions ===
  fetchSkills: () => Promise<boolean>;
  selectSkill: (skill: Skill | null) => void;
  installSkill: (
    source: string,
    id: string,
    opts?: { silent?: boolean }
  ) => Promise<void>;
  uninstallSkill: (id: string) => Promise<void>;
  updateSkill: (id: string) => Promise<void>;

  // === Rule Actions ===
  fetchRules: () => Promise<boolean>;
  setEditingRule: (rule: Rule | null) => void;
  createRule: (
    data: CreateRuleDTO,
    opts?: { silent?: boolean }
  ) => Promise<void>;
  updateRule: (id: string, data: UpdateRuleDTO) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;

  // === Tag Actions ===
  fetchTags: (tagType?: string) => Promise<void>;
  createTag: (data: CreateTagDTO) => Promise<number | void>;
  updateTag: (
    id: number,
    name?: string,
    color?: string,
    category?: string
  ) => Promise<void>;
  deleteTag: (id: number) => Promise<void>;
  assignTag: (
    targetType: string,
    targetId: string,
    tagId: number
  ) => Promise<void>;
  removeTag: (
    targetType: string,
    targetId: string,
    tagId: number
  ) => Promise<void>;

  // === Scene Actions ===
  fetchScenes: () => Promise<boolean>;
  setCurrentScene: (scene: Scene | null) => void;
  createScene: (data: CreateSceneDTO) => Promise<void>;
  updateScene: (id: string, data: UpdateSceneDTO) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
  fetchSceneDetail: (id: string) => Promise<void>;
  addSkillToScene: (sceneId: string, skillId: string) => Promise<void>;
  removeSkillFromScene: (sceneId: string, skillId: string) => Promise<void>;
  addRuleToScene: (sceneId: string, ruleId: string) => Promise<void>;
  removeRuleFromScene: (sceneId: string, ruleId: string) => Promise<void>;
  saveSceneComposition: (
    sceneId: string,
    draft: SceneCompositionDraft
  ) => Promise<boolean>;
  // === Project Actions ===
  fetchProjects: () => Promise<boolean>;
  addProject: (
    name: string,
    path: string,
    description?: string
  ) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  removeProjects: (ids: string[]) => Promise<void>;

  // === Platform Actions ===
  fetchPlatforms: () => Promise<boolean>;

  // === Distribution Actions ===
  fetchManagedDistributionState: (
    platformIds: string[],
    scope: 'global' | 'project',
    projectId?: string
  ) => Promise<boolean>;
  executeDistribution: (
    selection: DistributionSelection,
    plan: DistributionPlan
  ) => Promise<SyncResult | null>;
  removeDistributed: (
    selection: RemoveDistributionSelection
  ) => Promise<SyncResult | null>;
  syncScene: (
    skillIds: string[],
    ruleIds: string[],
    sceneId: string | null,
    platforms: string[] | null,
    scope: string,
    projectId?: string
  ) => Promise<SyncResult | null>;
  fetchSyncStatus: () => Promise<void>;

  // === Dashboard ===
  fetchDashboardStats: () => Promise<void>;
  scanForImport: () => Promise<ScanForImportResult | null>;
  importScanned: (
    skills: SkillPreview[],
    rules: RulePreview[]
  ) => Promise<ImportResult | null>;
  pendingSyncConfirm: DistributionPlan | null;
  pendingRemovalConfirmation: boolean;
  resolveSyncConfirm: ((confirmed: boolean) => void) | null;
  cancelPendingSyncConfirm: () => void;
  confirmedDistribution: ConfirmedDistribution | null;
  takeConfirmedDistribution: () => ConfirmedDistribution | null;
  requestSyncConfirm: (params: SyncSelection) => Promise<SyncConfirmResult>;
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Append-only add can only produce `keptInSaved ++ added`; the draft matches
 *  that shape only when kept members are a prefix (in saved order). */
function needsMemberRewrite(savedIds: string[], draftIds: string[]): boolean {
  const keptInSaved = savedIds.filter((id) => draftIds.includes(id));
  return !arraysEqual(draftIds.slice(0, keptInSaved.length), keptInSaved);
}

async function syncSceneMembers(
  savedIds: string[],
  draftIds: string[],
  add: (id: string) => Promise<unknown>,
  remove: (id: string) => Promise<unknown>
): Promise<Set<string>> {
  if (arraysEqual(savedIds, draftIds)) return new Set();
  if (needsMemberRewrite(savedIds, draftIds)) {
    for (const id of savedIds) await remove(id);
    for (const id of draftIds) await add(id);
    return new Set(draftIds);
  }
  const draftSet = new Set(draftIds);
  for (const id of savedIds) {
    if (!draftSet.has(id)) await remove(id);
  }
  const added = new Set<string>();
  for (const id of draftIds) {
    if (!savedIds.includes(id)) {
      await add(id);
      added.add(id);
    }
  }
  return added;
}

export const useAppStore = create<AppStore>((set, get) => {
  let confirmationRequestActive = false;
  let confirmationRequestToken = 0;

  return {
    // === Data ===
    skills: [],
    rules: [],
    tags: [],
    scenes: [],
    projects: [],
    platforms: [],
    dashboardStats: null,
    syncStatus: null,
    managedDistributionState: null,

    // === Selection ===
    selectedSkill: null,
    currentScene: null,
    currentSceneDetail: null,
    _lastFetchedSceneId: null,
    editingRule: null,

    // === UI State ===
    activeNav: 'dashboard',
    sidebarCollapsed: false,
    searchQuery: '',
    tagFilter: [],
    loading: false,
    toasts: [],

    // === Distribution Selection Memory ===
    globalDistSelectedPlatform: null,
    setGlobalDistSelectedPlatform: (id) =>
      set({ globalDistSelectedPlatform: id }),
    projectDistSelectedProjectId: null,
    projectDistSelectedPlatform: null,
    setProjectDistSelectedProjectId: (id) =>
      set({ projectDistSelectedProjectId: id }),
    setProjectDistSelectedPlatform: (id) =>
      set({ projectDistSelectedPlatform: id }),
    pendingDistributionSelection: null,
    setPendingDistributionSelection: (selection) =>
      set({ pendingDistributionSelection: selection }),

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
    toggleSidebar: () =>
      set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

    // === Filter ===
    setSearchQuery: (query) => set({ searchQuery: query }),
    setTagFilter: (tags) => set({ tagFilter: tags }),

    // === Skill Actions ===
    fetchSkills: async () => {
      set({ loading: true });
      try {
        const skills = await ipc.listSkills();
        set({ skills, loading: false });
        return true;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        set({ loading: false });
        get().addToast(
          i18n.t('messages.loadSkillsListFailed', { reason: errMsg }),
          'error'
        );
        return false;
      }
    },
    selectSkill: (skill) => set({ selectedSkill: skill }),
    installSkill: async (source, id, opts?: { silent?: boolean }) => {
      // Map frontend source type to backend plugin name
      const sourceMap: Record<string, string> = {
        local: 'local-fs',
        git: 'git-repo',
      };
      const backendSource = sourceMap[source] || source;
      try {
        await ipc.installSkill(backendSource, id);
        await get().fetchSkills();
        if (!opts?.silent) {
          get().addToast(i18n.t('messages.installSuccess'), 'success');
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (!opts?.silent) {
          get().addToast(
            i18n.t('messages.importFailedWithReason', { reason: errMsg }),
            'error'
          );
        }
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
        get().addToast(i18n.t('messages.uninstallSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.uninstallFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },
    updateSkill: async (id) => {
      try {
        await ipc.updateSkill(id);
        await get().fetchSkills();
        get().addToast(i18n.t('messages.updateSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.updateFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },

    // === Rule Actions ===
    fetchRules: async () => {
      set({ loading: true });
      try {
        const rules = await ipc.listRules();
        set({ rules, loading: false });
        return true;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        set({ loading: false });
        get().addToast(
          i18n.t('messages.loadRulesListFailed', { reason: errMsg }),
          'error'
        );
        return false;
      }
    },
    setEditingRule: (rule) => set({ editingRule: rule }),
    createRule: async (data, opts?: { silent?: boolean }) => {
      try {
        await ipc.createRule(data);
        await get().fetchRules();
        if (!opts?.silent) {
          get().addToast(i18n.t('messages.createRuleSuccess'), 'success');
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.createRuleFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },
    updateRule: async (id, data) => {
      try {
        await ipc.updateRule(id, data);
        await get().fetchRules();
        get().addToast(i18n.t('messages.saveRuleSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.saveRuleFailedWithReason', { reason: errMsg }),
          'error'
        );
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
        await get().fetchTags('rule');
        get().addToast(i18n.t('messages.deleteRuleSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.deleteRuleFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },

    // === Tag Actions ===
    fetchTags: async (tagType?: string) => {
      try {
        const tags = await ipc.listTags(undefined, tagType);
        set({ tags });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.loadTagsListFailed', { reason: errMsg }),
          'error'
        );
      }
    },
    createTag: async (data) => {
      try {
        const newTag = await ipc.createTag(
          data.name,
          data.color,
          data.category,
          data.tag_type
        );
        await get().fetchTags(data.tag_type);
        get().addToast(i18n.t('messages.createTagSuccess'), 'success');
        return newTag?.id;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.createTagFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },
    updateTag: async (id, name, color, category) => {
      try {
        await ipc.updateTag(id, name, color, category);
        // Re-fetch with current filter context — find the tag's type
        const tag = get().tags.find((t) => t.id === id);
        await get().fetchTags(tag?.tag_type);
        get().addToast(i18n.t('messages.updateTagSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.updateTagFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },
    deleteTag: async (id) => {
      try {
        const tag = get().tags.find((t) => t.id === id);
        const tagType = tag?.tag_type;
        await ipc.deleteTag(id);
        await get().fetchTags(tagType);
        get().addToast(i18n.t('messages.deleteTagSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.deleteTagFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },
    assignTag: async (targetType, targetId, tagId) => {
      try {
        await ipc.assignTag(targetType, targetId, tagId);
        get().addToast(i18n.t('messages.assignTagSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.assignTagFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },
    removeTag: async (targetType, targetId, tagId) => {
      try {
        await ipc.removeTag(targetType, targetId, tagId);
        get().addToast(i18n.t('messages.removeTagSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.removeTagFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },

    // === Scene Actions ===
    fetchScenes: async () => {
      try {
        const scenes = await ipc.listScenes();
        set({ scenes });
        return true;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.loadScenesListFailed', { reason: errMsg }),
          'error'
        );
        return false;
      }
    },
    setCurrentScene: (scene) => {
      const current = get().currentScene;
      if (scene && current?.id === scene.id) {
        set({ currentScene: scene });
      } else {
        set({ currentScene: scene, currentSceneDetail: null });
      }
    },
    createScene: async (data) => {
      try {
        await ipc.createScene(data);
        await get().fetchScenes();
        get().addToast(i18n.t('messages.createSceneSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.createSceneFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },
    updateScene: async (id, data) => {
      try {
        await ipc.updateScene(id, data);
        await get().fetchScenes();
        get().addToast(i18n.t('messages.saveSceneSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : JSON.stringify(e);
        get().addToast(
          i18n.t('messages.saveSceneFailedWithReason', { reason: errMsg }),
          'error'
        );
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
        get().addToast(i18n.t('messages.deleteSceneSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.deleteSceneFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },
    fetchSceneDetail: async (id) => {
      set({ _lastFetchedSceneId: id });
      try {
        const detail = await ipc.getSceneDetail(id);
        // Guard: only apply if this is still the latest requested scene —
        // discard stale responses from a previous selection that resolved
        // after a newer one was already requested.
        if (get()._lastFetchedSceneId === id) {
          set({ currentSceneDetail: detail });
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.loadSceneDetailFailedWithReason', {
            reason: errMsg,
          }),
          'error'
        );
      }
    },
    addSkillToScene: async (sceneId, skillId) => {
      try {
        await ipc.addSkillToScene(sceneId, skillId);
        await get().fetchSceneDetail(sceneId);
        get().addToast(
          i18n.t('messages.addSkillToSceneSuccess'),
          'success'
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.addSkillToSceneFailedWithReason', {
            reason: errMsg,
          }),
          'error'
        );
      }
    },
    removeSkillFromScene: async (sceneId, skillId) => {
      try {
        await ipc.removeSkillFromScene(sceneId, skillId);
        await get().fetchSceneDetail(sceneId);
        get().addToast(
          i18n.t('messages.removeSkillFromSceneSuccess'),
          'success'
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.removeSkillFromSceneFailedWithReason', {
            reason: errMsg,
          }),
          'error'
        );
      }
    },
    addRuleToScene: async (sceneId, ruleId) => {
      try {
        await ipc.addRuleToScene(sceneId, ruleId);
        await get().fetchSceneDetail(sceneId);
        get().addToast(i18n.t('messages.addRuleToSceneSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.addRuleToSceneFailedWithReason', {
            reason: errMsg,
          }),
          'error'
        );
      }
    },
    removeRuleFromScene: async (sceneId, ruleId) => {
      try {
        await ipc.removeRuleFromScene(sceneId, ruleId);
        await get().fetchSceneDetail(sceneId);
        get().addToast(
          i18n.t('messages.removeRuleFromSceneSuccess'),
          'success'
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.removeRuleFromSceneFailedWithReason', {
            reason: errMsg,
          }),
          'error'
        );
      }
    },
    saveSceneComposition: async (sceneId, draft) => {
      try {
        let baseline = get().currentSceneDetail;
        if (!baseline) {
          // 缺失基线会把 removals 静默跳过（按 [] 计算 diff），先取后端权威详情
          await get().fetchSceneDetail(sceneId);
          baseline = get().currentSceneDetail;
          if (!baseline) {
            throw new Error(
              i18n.t('messages.sceneBaselineUnavailable')
            );
          }
        }
        const savedSkills = baseline.skills ?? [];
        const savedRules = baseline.rules ?? [];

        const metaPatch: UpdateSceneDTO = {};
        if (
          draft.name !== undefined &&
          draft.name !== (baseline.scene.name ?? '')
        ) {
          metaPatch.name = draft.name;
        }
        if (
          draft.description !== undefined &&
          draft.description !== (baseline.scene.description ?? null)
        ) {
          metaPatch.description = draft.description;
        }
        if (Object.keys(metaPatch).length > 0) {
          await ipc.updateScene(sceneId, metaPatch);
        }

        const reAddedSkillIds = await syncSceneMembers(
          savedSkills.map((s) => s.skill_id),
          draft.skills.map((s) => s.skill_id),
          (id) => ipc.addSkillToScene(sceneId, id),
          (id) => ipc.removeSkillFromScene(sceneId, id)
        );
        const reAddedRuleIds = await syncSceneMembers(
          savedRules.map((r) => r.rule_id),
          draft.rules.map((r) => r.rule_id),
          (id) => ipc.addRuleToScene(sceneId, id),
          (id) => ipc.removeRuleFromScene(sceneId, id)
        );

        // 持久化成员启用状态。两类情形需发命令：
        // 1) 既有成员与 baseline 的 enabled 不一致；
        // 2) 本次被（重）添加的成员后端 enabled 重置为 1（rewrite 全部重加 / 增量新增），
        //    因此这些成员在 draft 中若 enabled=false 都要补发禁用命令。
        // 新增且 enabled=true 的成员无需命令（后端默认即 1）。
        for (const m of draft.skills) {
          const baselineEntry = savedSkills.find(
            (s) => s.skill_id === m.skill_id
          );
          const enabledChanged =
            baselineEntry !== undefined &&
            m.enabled !== undefined &&
            m.enabled !== baselineEntry.enabled;
          const reapplyDisabled =
            m.enabled === false && reAddedSkillIds.has(m.skill_id);
          if (enabledChanged || reapplyDisabled) {
            await ipc.setSceneMemberEnabled(
              sceneId,
              'skill',
              m.skill_id,
              m.enabled ?? false
            );
          }
        }
        for (const m of draft.rules) {
          const baselineEntry = savedRules.find(
            (r) => r.rule_id === m.rule_id
          );
          const enabledChanged =
            baselineEntry !== undefined &&
            m.enabled !== undefined &&
            m.enabled !== baselineEntry.enabled;
          const reapplyDisabled =
            m.enabled === false && reAddedRuleIds.has(m.rule_id);
          if (enabledChanged || reapplyDisabled) {
            await ipc.setSceneMemberEnabled(
              sceneId,
              'rule',
              m.rule_id,
              m.enabled ?? false
            );
          }
        }

        await get().fetchSceneDetail(sceneId);
        await get().fetchScenes();
        get().addToast(i18n.t('messages.saveSceneSuccess'), 'success');
        return true;
      } catch (e) {
        // 部分 IPC 失败后后端可能已部分生效，重新拉取详情让 UI 与后端一致
        await get().fetchSceneDetail(sceneId);
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.saveSceneFailedWithReason', { reason: errMsg }),
          'error'
        );
        return false;
      }
    },
    // === Project Actions ===
    fetchProjects: async () => {
      try {
        const projects = await ipc.listProjects();
        set({ projects });
        return true;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.loadProjectsListFailed', { reason: errMsg }),
          'error'
        );
        return false;
      }
    },
    addProject: async (name, path, description) => {
      try {
        await ipc.addProject(name, path, description);
        await get().fetchProjects();
        get().addToast(i18n.t('messages.addProjectSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.addProjectFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },
    removeProject: async (id) => {
      try {
        await ipc.removeProject(id);
        await get().fetchProjects();
        get().addToast(i18n.t('messages.removeProjectSuccess'), 'success');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.removeProjectFailedWithReason', { reason: errMsg }),
          'error'
        );
      }
    },
    // 批量移除：后端批量 IPC 落地后可在 removeProjects 内替换为单次批量调用
    removeProjects: async (ids) => {
      if (ids.length === 0) return;
      try {
        for (const id of ids) {
          await ipc.removeProject(id);
        }
        await get().fetchProjects();
        get().addToast(
          i18n.t('messages.removeProjectsBatchSuccess', { count: ids.length }),
          'success'
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.removeProjectsBatchFailedWithReason', {
            reason: errMsg,
          }),
          'error'
        );
      }
    },

    // === Platform Actions ===
    fetchPlatforms: async () => {
      try {
        const platforms = await ipc.listPlatforms();
        set({ platforms });
        return true;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.loadPlatformsListFailed', { reason: errMsg }),
          'error'
        );
        return false;
      }
    },

    // === Distribution Actions ===
    fetchManagedDistributionState: async (platformIds, scope, projectId) => {
      try {
        const state = await ipc.getManagedDistributionState(
          platformIds,
          scope,
          projectId
        );
        set({ managedDistributionState: state });
        return true;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        set({ managedDistributionState: null });
        get().addToast(
          i18n.t('messages.loadDistributedContentFailedWithReason', {
            reason: errMsg,
          }),
          'error'
        );
        return false;
      }
    },
    executeDistribution: async (selection, plan) => {
      try {
        const result = await ipc.executeDistribution(selection, plan);
        await get().fetchSyncStatus();
        return result;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.syncFailedWithReason', { reason: errMsg }),
          'error'
        );
        return null;
      }
    },
    removeDistributed: async (selection) => {
      try {
        const result = await ipc.removeDistributed(selection);
        await get().fetchSyncStatus();
        return result;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.removeDistributedFailedWithReason', {
            reason: errMsg,
          }),
          'error'
        );
        return null;
      }
    },
    syncScene: async (
      skillIds,
      ruleIds,
      sceneId,
      platforms,
      scope,
      projectId
    ) => {
      try {
        // Non-blocking capability check for global scope
        if (scope === 'global' && platforms) {
          try {
            for (const pid of platforms) {
              const cap = await ipc.getCapabilities(pid);
              if (!cap.rules_global) {
                const p = get().platforms.find((pl) => pl.id === pid);
                get().addToast(
                  i18n.t('messages.globalRulesUnsupportedWarning', {
                    platform: p?.name || pid,
                  }),
                  'warning'
                );
              }
            }
          } catch {
            /* non-blocking */
          }
        }

        const result = await ipc.syncScene(
          skillIds,
          ruleIds,
          sceneId,
          platforms,
          scope,
          projectId
        );
        await get().fetchSyncStatus();
        if (result.errors.length === 0) {
          get().addToast(i18n.t('messages.syncSuccess'), 'success');
        } else {
          get().addToast(
            i18n.t('messages.syncCompletedWithErrors', {
              count: result.errors.length,
            }),
            'warning'
          );
        }
        return result;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.syncFailedWithReason', { reason: errMsg }),
          'error'
        );
        return null;
      }
    },
    fetchSyncStatus: async () => {
      try {
        const syncStatus = await ipc.getSyncStatus();
        set({ syncStatus });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.loadSyncStatusFailed', { reason: errMsg }),
          'error'
        );
      }
    },

    // === Dashboard ===
    fetchDashboardStats: async () => {
      try {
        const stats = await ipc.getDashboardStats();
        set({ dashboardStats: stats });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.loadDashboardStatsFailedWithReason', {
            reason: errMsg,
          }),
          'error'
        );
      }
    },
    scanForImport: async () => {
      try {
        return await ipc.scanForImport();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.scanFailedWithReason', { reason: errMsg }),
          'error'
        );
        return null;
      }
    },
    pendingSyncConfirm: null,
    pendingRemovalConfirmation: false,
    resolveSyncConfirm: null,
    cancelPendingSyncConfirm: () => {
      const resolver = get().resolveSyncConfirm;
      if (resolver) {
        resolver(false);
        return;
      }
      if (confirmationRequestActive) {
        confirmationRequestActive = false;
        confirmationRequestToken += 1;
      }
    },
    confirmedDistribution: null,
    takeConfirmedDistribution: () => {
      const confirmed = get().confirmedDistribution;
      set({ confirmedDistribution: null });
      return confirmed;
    },

    // Sync confirmation — preview changes before syncing; fail-closed on error
    requestSyncConfirm: async (
      selection: SyncSelection
    ): Promise<SyncConfirmResult> => {
      if (confirmationRequestActive) return 'cancelled';
      confirmationRequestActive = true;
      const requestToken = ++confirmationRequestToken;
      try {
        if (!('skills' in selection)) {
          const plan = await ipc.previewSync(
            selection.skillIds,
            selection.ruleIds,
            selection.sceneId,
            selection.platformIds,
            selection.scope,
            selection.projectId
          );
          if (requestToken !== confirmationRequestToken) return 'cancelled';
          if (!plan) {
            confirmationRequestActive = false;
            get().addToast(i18n.t('messages.previewNoData'), 'error');
            return 'preview_failed';
          }
          const hasChanges =
            plan.has_removals ||
            plan.platforms.some(
              (p) =>
                p.skills_to_add.length > 0 ||
                p.skills_to_update.length > 0 ||
                p.rules_to_add.length > 0 ||
                p.rules_to_update.length > 0
            );
          if (!hasChanges) {
            confirmationRequestActive = false;
            return 'no_changes';
          }
          return new Promise((resolve) => {
            let resolved = false;
            set({
              pendingSyncConfirm: plan,
              resolveSyncConfirm: (confirmed: boolean) => {
                if (resolved) return;
                resolved = true;
                confirmationRequestActive = false;
                set({
                  pendingSyncConfirm: null,
                  resolveSyncConfirm: null,
                  pendingRemovalConfirmation: false,
                });
                resolve(confirmed ? 'confirmed' : 'cancelled');
              },
            });
          });
        }

        const normalizedSelection: DistributionSelection = selection;
        const plan = await ipc.previewDistribution(normalizedSelection);
        if (requestToken !== confirmationRequestToken) return 'cancelled';
        if (!plan) {
          confirmationRequestActive = false;
          get().addToast(i18n.t('messages.previewNoData'), 'error');
          return 'preview_failed';
        }

        const hasChanges =
          plan.has_removals ||
          plan.platforms.some(
            (p) =>
              p.skills_to_add.length > 0 ||
              p.skills_to_update.length > 0 ||
              p.rules_to_add.length > 0 ||
              p.rules_to_update.length > 0
          );

        if (!hasChanges) {
          confirmationRequestActive = false;
          return 'no_changes';
        }

        return new Promise((resolve) => {
          let resolved = false;
          set({
            pendingSyncConfirm: plan,
            pendingRemovalConfirmation:
              normalizedSelection.skills.mode === 'remove_selected' ||
              normalizedSelection.rules.mode === 'remove_selected',
            resolveSyncConfirm: (confirmed: boolean) => {
              if (resolved) return;
              resolved = true;
              confirmationRequestActive = false;
              if (confirmed) {
                set({
                  confirmedDistribution: {
                    selection: normalizedSelection,
                    plan,
                  },
                });
              }
              set({
                pendingSyncConfirm: null,
                resolveSyncConfirm: null,
                pendingRemovalConfirmation: false,
              });
              resolve(confirmed ? 'confirmed' : 'cancelled');
            },
          });
        });
      } catch (e) {
        if (requestToken !== confirmationRequestToken) return 'cancelled';
        confirmationRequestActive = false;
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.previewFailedWithReason', { reason: errMsg }),
          'error'
        );
        return 'preview_failed';
      }
    },

    importScanned: async (skills, rules) => {
      try {
        const result = await ipc.importScanned(skills, rules);
        await get().fetchSkills();
        await get().fetchRules();
        await get().fetchTags('skill');
        await get().fetchTags('rule');
        const totalImported = result.imported_skills + result.imported_rules;
        const totalSkipped = result.skipped_skills + result.skipped_rules;
        const extra =
          totalSkipped > 0
            ? i18n.t('messages.importSkippedSuffix', { count: totalSkipped })
            : '';
        const errExtra =
          result.errors.length > 0
            ? i18n.t('messages.importErrorsSuffix', {
                count: result.errors.length,
                detail: result.errors.slice(0, 3).join('; '),
              }) + (result.errors.length > 3 ? '...' : '')
            : '';
        get().addToast(
          i18n.t('messages.importScannedSummary', {
            skills: result.imported_skills,
            rules: result.imported_rules,
          }) +
            extra +
            errExtra,
          totalImported > 0 ? 'success' : 'error'
        );
        return result;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        get().addToast(
          i18n.t('messages.importFailedWithReason', { reason: errMsg }),
          'error'
        );
        return null;
      }
    },
  };
});
