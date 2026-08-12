import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../appStore';

// Mock @tauri-apps/api/core invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

/**
 * Route-based invoke mock. Each key is a raw IPC command name (as produced by
 * src/lib/ipc.ts); values are resolved payloads or Error instances (rejected).
 * Unknown commands reject loudly so tests surface unintended calls.
 */
async function mockInvoke(routes: Record<string, unknown | Error>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) {
      const v = routes[cmd];
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    }
    return Promise.reject(new Error(`Unexpected invoke command: ${cmd}`));
  });
}

/** Reject every invoke call — for pure failure-path tests. */
async function mockInvokeRejectAll() {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockRejectedValue(new Error('boom'));
}

const skill = (id: string, name = 'Skill'): import('../../types').Skill => ({
  id,
  name,
  description: null,
  source_type: 'custom',
  source_url: null,
  current_ver: null,
  installed_at: '',
  local_path: '',
  metadata: null,
});

const scene = (id: string, name = 'Scene'): import('../../types').Scene => ({
  id,
  name,
  description: null,
  icon: 'box',
  is_template: false,
  is_system: false,
  created_at: '',
  updated_at: '',
});

const rule = (id: string, name = 'Rule'): import('../../types').Rule => ({
  id,
  name,
  description: null,
  format: 'markdown',
  content: '# rule',
  platform: 'claude-code',
  scope: 'global',
  version: 1,
  updated_at: '',
});

const tag = (
  id: number,
  tag_type: 'skill' | 'rule' = 'skill'
): import('../../types').Tag => ({
  id,
  name: `tag-${id}`,
  color: '#ff0000',
  category: null,
  tag_type,
});

const project = (
  id: string,
  name = 'Project'
): import('../../types').Project => ({
  id,
  name,
  path: `/tmp/${id}`,
  description: null,
  created_at: '',
  updated_at: '',
});

const platform = (
  id: string,
  name = 'Platform'
): import('../../types').Platform => ({
  id,
  name,
  adapter: 'adapter',
  enabled: true,
  icon: null,
  paths: {
    global_skills_dir: '/x',
    project_skills_pattern: 'x',
    global_rules_dir: null,
    project_rules_pattern: null,
    global_rules_format: null,
    project_rules_format: null,
  },
});

const capabilities = (
  overrides: Partial<import('../../types').PlatformCapabilities> = {}
): import('../../types').PlatformCapabilities => ({
  skills_global: true,
  skills_project: true,
  rules_global: true,
  rules_project: true,
  rules_format_global: null,
  rules_format_project: null,
  limitation_notes: [],
  ...overrides,
});

/** Reset every data/selection/UI slice so tests start from a clean store. */
function resetStore() {
  useAppStore.setState({
    skills: [],
    rules: [],
    tags: [],
    scenes: [],
    projects: [],
    platforms: [],
    dashboardStats: null,
    syncStatus: null,
    selectedSkill: null,
    currentScene: null,
    currentSceneDetail: null,
    editingRule: null,
    activeNav: 'dashboard',
    sidebarCollapsed: false,
    searchQuery: '',
    tagFilter: [],
    loading: false,
    toasts: [],
    globalDistSelectedPlatform: null,
    projectDistSelectedProjectId: null,
    projectDistSelectedPlatform: null,
    pendingSyncConfirm: null,
    resolveSyncConfirm: null,
    confirmedDistribution: null,
  });
}

describe('appStore — Skills', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });
  afterEach(() => vi.useRealTimers());

  it('fetchSkills loads skills into state on success', async () => {
    const mockSkills = [skill('skill-1')];
    await mockInvoke({ list_skills: mockSkills });

    await useAppStore.getState().fetchSkills();

    const state = useAppStore.getState();
    expect(state.skills).toEqual(mockSkills);
    expect(state.loading).toBe(false);
  });

  it('fetchSkills shows error toast on failure', async () => {
    await mockInvoke({ list_skills: new Error('Network error') });

    await useAppStore.getState().fetchSkills();

    const state = useAppStore.getState();
    expect(state.skills).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.toasts.length).toBeGreaterThan(0);
    expect(state.toasts[0].type).toBe('error');
  });

  it('installSkill maps local source and calls invoke + re-fetch', async () => {
    await mockInvoke({
      install_skill: { id: 'new-skill' },
      list_skills: [],
    });

    await useAppStore.getState().installSkill('local', 'new-skill');

    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('install_skill', {
      source: 'local-fs',
      skillId: 'new-skill',
    });
    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('installSkill maps git source and supports silent mode (no toast)', async () => {
    await mockInvoke({
      install_skill: { id: 'g1' },
      list_skills: [],
    });

    await useAppStore.getState().installSkill('git', 'g1', { silent: true });

    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('install_skill', {
      source: 'git-repo',
      skillId: 'g1',
    });
    expect(useAppStore.getState().toasts).toEqual([]);
  });

  it('installSkill shows error toast on failure', async () => {
    await mockInvoke({ install_skill: new Error('install failed') });

    await useAppStore.getState().installSkill('local', 'bad');

    const state = useAppStore.getState();
    expect(state.toasts.some((t) => t.type === 'error')).toBe(true);
  });

  it('uninstallSkill clears selectedSkill when it matches', async () => {
    useAppStore.setState({ selectedSkill: skill('skill-1', 'To Delete') });
    await mockInvoke({
      uninstall_skill: {},
      list_skills: [],
    });

    await useAppStore.getState().uninstallSkill('skill-1');

    expect(useAppStore.getState().selectedSkill).toBeNull();
  });

  it('uninstallSkill keeps selectedSkill when ids differ', async () => {
    const kept = skill('other', 'Kept');
    useAppStore.setState({ selectedSkill: kept });
    await mockInvoke({
      uninstall_skill: {},
      list_skills: [],
    });

    await useAppStore.getState().uninstallSkill('skill-1');

    expect(useAppStore.getState().selectedSkill).toEqual(kept);
  });

  it('uninstallSkill shows error toast on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().uninstallSkill('skill-1');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('updateSkill refetches and toasts success', async () => {
    await mockInvoke({
      update_skill: {},
      list_skills: [],
    });

    await useAppStore.getState().updateSkill('skill-1');

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('updateSkill toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().updateSkill('skill-1');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });
});

describe('appStore — Rules', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });

  it('fetchRules loads rules and clears loading', async () => {
    const mockRules = [rule('r1')];
    await mockInvoke({ list_rules: mockRules });

    await useAppStore.getState().fetchRules();

    const state = useAppStore.getState();
    expect(state.rules).toEqual(mockRules);
    expect(state.loading).toBe(false);
  });

  it('fetchRules toasts error on failure', async () => {
    await mockInvoke({ list_rules: new Error('rules down') });

    await useAppStore.getState().fetchRules();

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('setEditingRule stores the rule', () => {
    const r = rule('r2');
    useAppStore.getState().setEditingRule(r);
    expect(useAppStore.getState().editingRule).toEqual(r);
  });

  it('createRule calls create + re-fetch + success toast', async () => {
    await mockInvoke({
      create_rule: { id: 'r3' },
      list_rules: [],
    });

    await useAppStore.getState().createRule({
      name: 'New',
      description: '',
      format: 'markdown',
      content: '# x',
      platform: 'claude-code',
      scope: 'global',
    });

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('createRule silent mode adds no toast', async () => {
    await mockInvoke({
      create_rule: { id: 'r3' },
      list_rules: [],
    });

    await useAppStore.getState().createRule(
      {
        name: 'New',
        description: '',
        format: 'markdown',
        content: '# x',
        platform: 'claude-code',
        scope: 'global',
      },
      { silent: true }
    );

    expect(useAppStore.getState().toasts).toEqual([]);
  });

  it('createRule toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().createRule({
      name: 'New',
      description: '',
      format: 'markdown',
      content: '# x',
      platform: 'claude-code',
      scope: 'global',
    });

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('updateRule saves + re-fetches + success toast', async () => {
    await mockInvoke({
      update_rule: {},
      list_rules: [],
    });

    await useAppStore.getState().updateRule('r1', { name: 'Renamed' });

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('updateRule toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().updateRule('r1', { name: 'Renamed' });

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('deleteRule clears editingRule when it matches', async () => {
    useAppStore.setState({ editingRule: rule('r9', 'To Delete') });
    await mockInvoke({
      delete_rule: {},
      list_rules: [],
      list_tags: [],
    });

    await useAppStore.getState().deleteRule('r9');

    expect(useAppStore.getState().editingRule).toBeNull();
    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('deleteRule keeps unrelated editingRule', async () => {
    const other = rule('keep', 'Keep');
    useAppStore.setState({ editingRule: other });
    await mockInvoke({
      delete_rule: {},
      list_rules: [],
      list_tags: [],
    });

    await useAppStore.getState().deleteRule('other-id');

    expect(useAppStore.getState().editingRule).toEqual(other);
  });

  it('deleteRule toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().deleteRule('r1');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });
});

describe('appStore — Tags', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });

  it('fetchTags loads tags', async () => {
    const mockTags = [tag(1)];
    await mockInvoke({ list_tags: mockTags });

    await useAppStore.getState().fetchTags();

    expect(useAppStore.getState().tags).toEqual(mockTags);
  });

  it('fetchTags passes tagType through to list_tags', async () => {
    await mockInvoke({ list_tags: [] });

    await useAppStore.getState().fetchTags('rule');

    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('list_tags', {
      category: undefined,
      tagType: 'rule',
      search: undefined,
    });
  });

  it('fetchTags toasts error on failure', async () => {
    await mockInvoke({ list_tags: new Error('tags down') });

    await useAppStore.getState().fetchTags();

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('createTag returns the new id and toasts success', async () => {
    await mockInvoke({
      create_tag: { id: 42 },
      list_tags: [],
    });

    const id = await useAppStore.getState().createTag({
      name: 'new',
      color: '#fff',
      category: 'cat',
      tag_type: 'skill',
    });

    expect(id).toBe(42);
    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('createTag returns undefined and toasts error on failure', async () => {
    await mockInvokeRejectAll();

    const id = await useAppStore.getState().createTag({
      name: 'new',
      color: '#fff',
      tag_type: 'skill',
    });

    expect(id).toBeUndefined();
    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('updateTag re-fetches with the tag type found in state', async () => {
    useAppStore.setState({ tags: [tag(1, 'rule')] });
    await mockInvoke({
      update_tag: {},
      list_tags: [],
    });

    await useAppStore.getState().updateTag(1, 'renamed');

    const { invoke } = await import('@tauri-apps/api/core');
    // re-fetch uses tag_type ('rule') of the found tag
    const listCalls = (invoke as any).mock.calls.filter(
      (c: any[]) => c[0] === 'list_tags'
    );
    expect(listCalls.length).toBeGreaterThan(0);
    expect(listCalls[0][1].tagType).toBe('rule');
    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('updateTag handles tag missing from state (fetches without type)', async () => {
    await mockInvoke({
      update_tag: {},
      list_tags: [],
    });

    await useAppStore.getState().updateTag(999, 'renamed');

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('updateTag toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().updateTag(1, 'renamed');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('deleteTag re-fetches with tag type when tag exists', async () => {
    useAppStore.setState({ tags: [tag(1, 'skill')] });
    await mockInvoke({
      delete_tag: {},
      list_tags: [],
    });

    await useAppStore.getState().deleteTag(1);

    const { invoke } = await import('@tauri-apps/api/core');
    const listCalls = (invoke as any).mock.calls.filter(
      (c: any[]) => c[0] === 'list_tags'
    );
    expect(listCalls.length).toBeGreaterThan(0);
    expect(listCalls[0][1].tagType).toBe('skill');
    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('deleteTag handles tag missing from state', async () => {
    await mockInvoke({
      delete_tag: {},
      list_tags: [],
    });

    await useAppStore.getState().deleteTag(999);

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('deleteTag toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().deleteTag(1);

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('assignTag toasts success', async () => {
    await mockInvoke({ assign_tag: {} });

    await useAppStore.getState().assignTag('skill', 's1', 1);

    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('assign_tag', {
      targetType: 'skill',
      targetId: 's1',
      tagId: 1,
    });
    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('assignTag toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().assignTag('skill', 's1', 1);

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('removeTag toasts success', async () => {
    await mockInvoke({ remove_tag: {} });

    await useAppStore.getState().removeTag('skill', 's1', 1);

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('removeTag toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().removeTag('skill', 's1', 1);

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });
});

describe('appStore — Scenes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });

  it('fetchScenes loads scenes into state', async () => {
    const mockScenes = [scene('scene-1')];
    await mockInvoke({ list_scenes: mockScenes });

    await useAppStore.getState().fetchScenes();

    expect(useAppStore.getState().scenes).toEqual(mockScenes);
  });

  it('fetchScenes toasts error on failure', async () => {
    await mockInvoke({ list_scenes: new Error('scenes down') });

    await useAppStore.getState().fetchScenes();

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('createScene calls invoke and re-fetches scenes', async () => {
    await mockInvoke({
      create_scene: { id: 'scene-2' },
      list_scenes: [],
    });

    await useAppStore.getState().createScene({
      name: 'New Scene',
      description: 'A test scene',
      icon: 'star',
    });

    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('create_scene', {
      data: { name: 'New Scene', description: 'A test scene', icon: 'star' },
    });
  });

  it('createScene toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().createScene({
      name: 'New',
      description: '',
    });

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('updateScene saves + re-fetches + success toast', async () => {
    await mockInvoke({
      update_scene: {},
      list_scenes: [],
    });

    await useAppStore.getState().updateScene('scene-1', { name: 'Renamed' });

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('updateScene toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().updateScene('scene-1', { name: 'Renamed' });

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('deleteScene clears currentScene when deleted scene was selected', async () => {
    useAppStore.setState({
      currentScene: scene('scene-3', 'To Delete'),
      currentSceneDetail: { scene: scene('scene-3'), skills: [], rules: [] },
    });
    await mockInvoke({
      delete_scene: {},
      list_scenes: [],
    });

    await useAppStore.getState().deleteScene('scene-3');

    expect(useAppStore.getState().currentScene).toBeNull();
    expect(useAppStore.getState().currentSceneDetail).toBeNull();
  });

  it('deleteScene keeps unrelated currentScene', async () => {
    const current = scene('keep', 'Keep');
    useAppStore.setState({ currentScene: current });
    await mockInvoke({
      delete_scene: {},
      list_scenes: [],
    });

    await useAppStore.getState().deleteScene('other-id');

    expect(useAppStore.getState().currentScene).toEqual(current);
  });

  it('deleteScene toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().deleteScene('scene-1');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('fetchSceneDetail loads detail into state', async () => {
    const detail: import('../../types').SceneDetail = {
      scene: scene('scene-1'),
      skills: [],
      rules: [],
    };
    await mockInvoke({ get_scene_detail: detail });

    await useAppStore.getState().fetchSceneDetail('scene-1');

    expect(useAppStore.getState().currentSceneDetail).toEqual(detail);
  });

  it('fetchSceneDetail toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().fetchSceneDetail('scene-1');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('addSkillToScene adds + re-fetches detail + success toast', async () => {
    await mockInvoke({
      add_skill_to_scene: {},
      get_scene_detail: { scene: scene('scene-1'), skills: [], rules: [] },
    });

    await useAppStore.getState().addSkillToScene('scene-1', 'skill-1');

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('addSkillToScene toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().addSkillToScene('scene-1', 'skill-1');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('removeSkillFromScene removes + re-fetches detail + success toast', async () => {
    await mockInvoke({
      remove_skill_from_scene: {},
      get_scene_detail: { scene: scene('scene-1'), skills: [], rules: [] },
    });

    await useAppStore.getState().removeSkillFromScene('scene-1', 'skill-1');

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('removeSkillFromScene toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().removeSkillFromScene('scene-1', 'skill-1');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('addRuleToScene adds + re-fetches detail + success toast', async () => {
    await mockInvoke({
      add_rule_to_scene: {},
      get_scene_detail: { scene: scene('scene-1'), skills: [], rules: [] },
    });

    await useAppStore.getState().addRuleToScene('scene-1', 'r1');

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('addRuleToScene toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().addRuleToScene('scene-1', 'r1');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('removeRuleFromScene removes + re-fetches detail + success toast', async () => {
    await mockInvoke({
      remove_rule_from_scene: {},
      get_scene_detail: { scene: scene('scene-1'), skills: [], rules: [] },
    });

    await useAppStore.getState().removeRuleFromScene('scene-1', 'r1');

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('removeRuleFromScene toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().removeRuleFromScene('scene-1', 'r1');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });
});

describe('appStore — Projects', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });

  it('fetchProjects loads projects', async () => {
    const mockProjects = [project('p1')];
    await mockInvoke({ list_projects: mockProjects });

    await useAppStore.getState().fetchProjects();

    expect(useAppStore.getState().projects).toEqual(mockProjects);
  });

  it('fetchProjects toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().fetchProjects();

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('addProject adds + re-fetches + success toast', async () => {
    await mockInvoke({
      add_project: {},
      list_projects: [],
    });

    await useAppStore
      .getState()
      .addProject('My Proj', '/tmp/p', 'desc');

    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('add_project', {
      name: 'My Proj',
      path: '/tmp/p',
      description: 'desc',
    });
    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('addProject toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().addProject('My Proj', '/tmp/p');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('removeProject removes + re-fetches + success toast', async () => {
    await mockInvoke({
      remove_project: {},
      list_projects: [],
    });

    await useAppStore.getState().removeProject('p1');

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('removeProject toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().removeProject('p1');

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });
});

describe('appStore — Platforms', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });

  it('fetchPlatforms loads platforms', async () => {
    const mockPlatforms = [platform('claude-code')];
    await mockInvoke({ list_platforms: mockPlatforms });

    await useAppStore.getState().fetchPlatforms();

    expect(useAppStore.getState().platforms).toEqual(mockPlatforms);
  });

  it('fetchPlatforms toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().fetchPlatforms();

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });
});

describe('appStore — Distribution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });

  it('syncScene toasts success when result has no errors', async () => {
    await mockInvoke({
      sync_scene: { installed: [], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });

    const result = await useAppStore
      .getState()
      .syncScene([], [], null, [], 'project');

    expect(result?.errors).toEqual([]);
    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('syncScene toasts warning when result has errors', async () => {
    await mockInvoke({
      sync_scene: { installed: [], updated: [], removed: [], errors: ['e1'] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });

    const result = await useAppStore
      .getState()
      .syncScene([], [], null, [], 'global');

    expect(result?.errors).toEqual(['e1']);
    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'warning')
    ).toBe(true);
  });

  it('syncScene global scope warns when a platform lacks global rules', async () => {
    useAppStore.setState({
      platforms: [platform('claude-code', 'Claude Code')],
    });
    await mockInvoke({
      get_platform_capabilities: capabilities({ rules_global: false }),
      sync_scene: { installed: [], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });

    await useAppStore
      .getState()
      .syncScene([], [], null, ['claude-code'], 'global');

    const warning = useAppStore
      .getState()
      .toasts.find((t) => t.type === 'warning');
    expect(warning?.message).toContain('Claude Code');
    expect(warning?.message).toContain('不支持全局规则同步');
  });

  it('syncScene global scope falls back to platform id when name is unknown', async () => {
    await mockInvoke({
      get_platform_capabilities: capabilities({ rules_global: false }),
      sync_scene: { installed: [], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });

    await useAppStore
      .getState()
      .syncScene([], [], null, ['unknown-p'], 'global');

    const warning = useAppStore
      .getState()
      .toasts.find((t) => t.type === 'warning');
    expect(warning?.message).toContain('unknown-p');
  });

  it('syncScene global scope skips warning when capability supports global rules', async () => {
    useAppStore.setState({ platforms: [platform('claude-code')] });
    await mockInvoke({
      get_platform_capabilities: capabilities({ rules_global: true }),
      sync_scene: { installed: [], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });

    await useAppStore
      .getState()
      .syncScene([], [], null, ['claude-code'], 'global');

    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'warning')
    ).toBe(false);
    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('syncScene global capability check failures are non-blocking', async () => {
    await mockInvoke({
      get_platform_capabilities: new Error('cap down'),
      sync_scene: { installed: [], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });

    const result = await useAppStore
      .getState()
      .syncScene([], [], null, ['claude-code'], 'global');

    expect(result?.errors).toEqual([]);
    expect(
      useAppStore.getState().toasts.some((t) => t.type === 'success')
    ).toBe(true);
  });

  it('syncScene returns null and toasts error when sync fails', async () => {
    await mockInvoke({
      sync_scene: new Error('sync down'),
    });

    const result = await useAppStore
      .getState()
      .syncScene([], [], null, [], 'project');

    expect(result).toBeNull();
    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('fetchSyncStatus loads status', async () => {
    const status: import('../../types').SyncStatusDTO = { platforms: [] };
    await mockInvoke({ get_sync_status: status });

    await useAppStore.getState().fetchSyncStatus();

    expect(useAppStore.getState().syncStatus).toEqual(status);
  });

  it('fetchSyncStatus toasts error on failure', async () => {
    await mockInvokeRejectAll();

    await useAppStore.getState().fetchSyncStatus();

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });
});

describe('appStore — Dashboard & Import', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });

  it('fetchDashboardStats loads stats', async () => {
    const mockStats: import('../../types').DashboardStats = {
      skill_count: 10,
      rule_count: 5,
      scene_count: 12,
      user_scene_count: 8,
      project_count: 20,
    };
    await mockInvoke({ get_dashboard_stats: mockStats });

    await useAppStore.getState().fetchDashboardStats();

    expect(useAppStore.getState().dashboardStats).toEqual(mockStats);
  });

  it('fetchDashboardStats handles failure gracefully', async () => {
    await mockInvoke({ get_dashboard_stats: new Error('DB error') });

    await useAppStore.getState().fetchDashboardStats();

    expect(useAppStore.getState().dashboardStats).toBeNull();
    expect(useAppStore.getState().toasts.length).toBeGreaterThan(0);
  });

  it('scanForImport returns the scan result', async () => {
    const scan: import('../../types').ScanForImportResult = {
      platforms: [],
      total_new_skills: 1,
      total_new_rules: 2,
      total_existing_skills: 0,
      total_existing_rules: 0,
    };
    await mockInvoke({ scan_for_import: scan });

    const result = await useAppStore.getState().scanForImport();

    expect(result).toEqual(scan);
  });

  it('scanForImport returns null and toasts on failure', async () => {
    await mockInvokeRejectAll();

    const result = await useAppStore.getState().scanForImport();

    expect(result).toBeNull();
    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('importScanned imports + re-fetches + success toast (with skipped info)', async () => {
    const result: import('../../types').ImportResult = {
      imported_skills: 1,
      imported_rules: 2,
      skipped_skills: 1,
      skipped_rules: 0,
      errors: [],
    };
    await mockInvoke({
      import_scanned: result,
      list_skills: [],
      list_rules: [],
      list_tags: [],
    });

    const returned = await useAppStore.getState().importScanned([], []);

    expect(returned).toEqual(result);
    const success = useAppStore
      .getState()
      .toasts.find((t) => t.type === 'success');
    expect(success?.message).toContain('1 技能, 2 规则');
    expect(success?.message).toContain('跳过 1 个已存在');
  });

  it('importScanned includes error summary in toast', async () => {
    const result: import('../../types').ImportResult = {
      imported_skills: 1,
      imported_rules: 0,
      skipped_skills: 0,
      skipped_rules: 0,
      errors: ['e1', 'e2'],
    };
    await mockInvoke({
      import_scanned: result,
      list_skills: [],
      list_rules: [],
      list_tags: [],
    });

    await useAppStore.getState().importScanned([], []);

    const success = useAppStore
      .getState()
      .toasts.find((t) => t.type === 'success');
    expect(success?.message).toContain('2 个失败: e1; e2');
  });

  it('importScanned shows error toast when nothing was imported', async () => {
    const result: import('../../types').ImportResult = {
      imported_skills: 0,
      imported_rules: 0,
      skipped_skills: 3,
      skipped_rules: 1,
      errors: ['e1'],
    };
    await mockInvoke({
      import_scanned: result,
      list_skills: [],
      list_rules: [],
      list_tags: [],
    });

    await useAppStore.getState().importScanned([], []);

    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('importScanned returns null and toasts on failure', async () => {
    await mockInvokeRejectAll();

    const result = await useAppStore.getState().importScanned([], []);

    expect(result).toBeNull();
    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });
});

describe('appStore — Sync Confirm', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });

  it('requestSyncConfirm returns no_changes when preview has no changes', async () => {
    await mockInvoke({
      preview_sync: { platforms: [], has_removals: false },
    });

    const result = await useAppStore
      .getState()
      .requestSyncConfirm({
        skillIds: [],
        ruleIds: [],
        sceneId: 's1',
        platformIds: ['p1'],
        scope: 'global',
      });

    expect(result).toBe('no_changes');
    expect(useAppStore.getState().pendingSyncConfirm).toBeNull();
  });

  it('requestSyncConfirm previews Rules-only without changing Skills intent', async () => {
    await mockInvoke({
      preview_distribution: {
        platforms: [
          {
            platform_id: 'p1',
            platform_name: 'P1',
            skills_to_add: [],
            skills_to_update: [],
            skills_to_remove: [],
            rules_to_add: ['r1'],
            rules_to_update: [],
            rules_to_remove: [],
          },
        ],
        has_removals: false,
      },
    });

    const promise = useAppStore.getState().requestSyncConfirm({
      sceneId: null,
      platformIds: ['p1'],
      scope: 'global',
      skills: { mode: 'preserve', ids: [] },
      rules: { mode: 'add_or_update', ids: ['r1'] },
    });

    await vi.waitFor(() => {
      expect(useAppStore.getState().resolveSyncConfirm).toBeTypeOf('function');
    });
    useAppStore.getState().resolveSyncConfirm?.(true);
    await expect(promise).resolves.toBe('confirmed');
    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('preview_distribution', {
      sceneId: null,
      platformIds: ['p1'],
      scope: 'global',
      skills: { mode: 'preserve', ids: [] },
      rules: { mode: 'add_or_update', ids: ['r1'] },
    });
  });

  it('requestSyncConfirm does not execute when preview has no changes', async () => {
    await mockInvoke({
      preview_distribution: { platforms: [], has_removals: false },
    });

    const result = await useAppStore.getState().requestSyncConfirm({
      sceneId: null,
      platformIds: ['p1'],
      scope: 'project',
      projectId: 'project-1',
      skills: { mode: 'add_or_update', ids: ['s1'] },
      rules: { mode: 'preserve', ids: [] },
    });

    expect(result).toBe('no_changes');
    const { invoke } = await import('@tauri-apps/api/core');
    await vi.waitFor(() => {
      expect(invoke).not.toHaveBeenCalledWith(
        'execute_distribution',
        expect.anything()
      );
    });
  });

  it('requestSyncConfirm does not execute when preview fails', async () => {
    await mockInvoke({ preview_distribution: new Error('preview down') });

    const result = await useAppStore.getState().requestSyncConfirm({
      sceneId: null,
      platformIds: ['p1'],
      scope: 'global',
      skills: { mode: 'preserve', ids: [] },
      rules: { mode: 'preserve', ids: [] },
    });

    expect(result).toBe('preview_failed');
    const { invoke } = await import('@tauri-apps/api/core');
    await vi.waitFor(() => {
      expect(invoke).not.toHaveBeenCalledWith(
        'execute_distribution',
        expect.anything()
      );
    });
  });

  it('requestSyncConfirm does not execute when the user cancels', async () => {
    await mockInvoke({
      preview_distribution: {
        platforms: [
          {
            platform_id: 'p1',
            platform_name: 'P1',
            skills_to_add: ['s1'],
            skills_to_update: [],
            skills_to_remove: [],
            rules_to_add: [],
            rules_to_update: [],
            rules_to_remove: [],
          },
        ],
        has_removals: false,
      },
    });

    const promise = useAppStore.getState().requestSyncConfirm({
      sceneId: null,
      platformIds: ['p1'],
      scope: 'global',
      skills: { mode: 'add_or_update', ids: ['s1'] },
      rules: { mode: 'preserve', ids: [] },
    });
    await vi.waitFor(() => {
      expect(useAppStore.getState().resolveSyncConfirm).toBeTypeOf('function');
    });
    useAppStore.getState().resolveSyncConfirm?.(false);

    await expect(promise).resolves.toBe('cancelled');
    const { invoke } = await import('@tauri-apps/api/core');
    await vi.waitFor(() => {
      expect(invoke).not.toHaveBeenCalledWith(
        'execute_distribution',
        expect.anything()
      );
    });
  });

  it('executeDistribution sends the confirmed selection and plan', async () => {
    const selection: import('../../types').DistributionSelection = {
      sceneId: null,
      platformIds: ['p1'],
      scope: 'global',
      skills: { mode: 'add_or_update', ids: ['s1'] },
      rules: { mode: 'preserve', ids: [] },
    };
    const plan: import('../../types').DistributionPlan = {
      platforms: [],
      has_removals: false,
    };
    await mockInvoke({
      execute_distribution: { installed: ['s1'], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });

    await expect(
      useAppStore.getState().executeDistribution(selection, plan)
    ).resolves.toEqual({
      installed: ['s1'],
      updated: [],
      removed: [],
      errors: [],
    });
    const { invoke } = await import('@tauri-apps/api/core');
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('execute_distribution', {
        selection,
        plan,
      });
    });
  });

  it('confirmed Rules-only execution preserves Skills and adds selected Rules', async () => {
    const selection: import('../../types').DistributionSelection = {
      sceneId: null,
      platformIds: ['p1'],
      scope: 'global',
      skills: { mode: 'preserve', ids: [] },
      rules: { mode: 'add_or_update', ids: ['r1'] },
    };
    const plan: import('../../types').DistributionPlan = {
      platforms: [],
      has_removals: false,
    };
    await mockInvoke({
      execute_distribution: { installed: [], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });

    await useAppStore.getState().executeDistribution(selection, plan);

    const { invoke } = await import('@tauri-apps/api/core');
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('execute_distribution', {
        selection: expect.objectContaining({
          scope: 'global',
          skills: { mode: 'preserve', ids: [] },
          rules: { mode: 'add_or_update', ids: ['r1'] },
        }),
        plan,
      });
    });
  });

  it('confirmed project execution preserves project scope and selected projectId', async () => {
    const selection: import('../../types').DistributionSelection = {
      sceneId: null,
      platformIds: ['p1'],
      scope: 'project',
      projectId: 'project-1',
      skills: { mode: 'add_or_update', ids: ['s1'] },
      rules: { mode: 'preserve', ids: [] },
    };
    const plan: import('../../types').DistributionPlan = {
      platforms: [],
      has_removals: false,
    };
    await mockInvoke({
      execute_distribution: { installed: ['s1'], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });

    await useAppStore.getState().executeDistribution(selection, plan);

    const { invoke } = await import('@tauri-apps/api/core');
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('execute_distribution', {
        selection: expect.objectContaining({
          scope: 'project',
          projectId: 'project-1',
          skills: { mode: 'add_or_update', ids: ['s1'] },
          rules: { mode: 'preserve', ids: [] },
        }),
        plan,
      });
    });
  });

  it('requestSyncConfirm returns no_changes when platforms have no adds/updates/removals', async () => {
    await mockInvoke({
      preview_distribution: {
        platforms: [
          {
            platform_id: 'p1',
            platform_name: 'P1',
            skills_to_add: [],
            skills_to_update: [],
            skills_to_remove: [],
            rules_to_add: [],
            rules_to_update: [],
            rules_to_remove: [],
          },
        ],
        has_removals: false,
      },
    });

    const result = await useAppStore
      .getState()
      .requestSyncConfirm({
        sceneId: null,
        platformIds: ['p1'],
        scope: 'global',
        skills: { mode: 'add_or_update', ids: ['s1'] },
        rules: { mode: 'preserve', ids: [] },
      });

    expect(result).toBe('no_changes');
    expect(useAppStore.getState().pendingSyncConfirm).toBeNull();
  });

  it('requestSyncConfirm stores full DistributionPlan and resolves confirmed', async () => {
    const plan: import('../../types').DistributionPlan = {
      platforms: [
        {
          platform_id: 'p1',
          platform_name: 'P1',
          skills_to_add: [],
          skills_to_update: [],
          skills_to_remove: ['s1'],
          rules_to_add: [],
          rules_to_update: [],
          rules_to_remove: [],
        },
      ],
      has_removals: true,
    };
    await mockInvoke({ preview_sync: plan });

    const promise = useAppStore
      .getState()
      .requestSyncConfirm({
        skillIds: ['s1'],
        ruleIds: [],
        sceneId: null,
        platformIds: ['p1'],
        scope: 'global',
      });

    await vi.waitFor(() => {
      const pending = useAppStore.getState().pendingSyncConfirm;
      expect(pending).not.toBeNull();
      expect(pending!.platforms).toHaveLength(1);
    });

    const pending = useAppStore.getState().pendingSyncConfirm;
    expect(pending).toHaveProperty('has_removals', true);
    expect(pending!.platforms[0]).toHaveProperty('skills_to_remove', ['s1']);

    const resolve = useAppStore.getState().resolveSyncConfirm;
    expect(resolve).toBeTypeOf('function');

    resolve!(true);
    await expect(promise).resolves.toBe('confirmed');
    expect(useAppStore.getState().pendingSyncConfirm).toBeNull();
    expect(useAppStore.getState().resolveSyncConfirm).toBeNull();
  });

  it('requestSyncConfirm resolves cancelled when user cancels', async () => {
    await mockInvoke({
      preview_sync: {
        platforms: [
          {
            platform_id: 'p1',
            platform_name: 'P1',
            skills_to_add: ['s1'],
            skills_to_update: [],
            skills_to_remove: [],
            rules_to_add: [],
            rules_to_update: [],
            rules_to_remove: [],
          },
        ],
        has_removals: false,
      },
    });

    const promise = useAppStore
      .getState()
      .requestSyncConfirm({
        skillIds: ['s1'],
        ruleIds: [],
        sceneId: null,
        platformIds: ['p1'],
        scope: 'global',
      });

    await vi.waitFor(() => {
      expect(useAppStore.getState().resolveSyncConfirm).toBeTypeOf('function');
    });
    useAppStore.getState().resolveSyncConfirm?.(false);
    await expect(promise).resolves.toBe('cancelled');
  });

  it('requestSyncConfirm returns preview_failed and toasts error on failure (fail-closed)', async () => {
    await mockInvoke({ preview_sync: new Error('preview down') });

    const result = await useAppStore
      .getState()
      .requestSyncConfirm({
        skillIds: [],
        ruleIds: [],
        sceneId: 's1',
        platformIds: ['p1'],
        scope: 'global',
      });

    expect(result).toBe('preview_failed');
    expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(
      true
    );
  });

  it('requestSyncConfirm resolver can only be called once (subsequent calls no-op)', async () => {
    await mockInvoke({
      preview_sync: {
        platforms: [
          {
            platform_id: 'p1',
            platform_name: 'P1',
            skills_to_add: ['s1'],
            skills_to_update: [],
            skills_to_remove: [],
            rules_to_add: [],
            rules_to_update: [],
            rules_to_remove: [],
          },
        ],
        has_removals: false,
      },
    });

    const promise = useAppStore
      .getState()
      .requestSyncConfirm({
        skillIds: ['s1'],
        ruleIds: [],
        sceneId: null,
        platformIds: ['p1'],
        scope: 'global',
      });

    await vi.waitFor(() => {
      expect(useAppStore.getState().resolveSyncConfirm).toBeTypeOf('function');
    });

    const resolver = useAppStore.getState().resolveSyncConfirm!;
    resolver(true);
    resolver(false);
    await expect(promise).resolves.toBe('confirmed');

    // After resolving, pending/resolver should be null
    expect(useAppStore.getState().pendingSyncConfirm).toBeNull();
    expect(useAppStore.getState().resolveSyncConfirm).toBeNull();
    expect(useAppStore.getState().confirmedDistribution).toBeNull();
  });

  it('cancels a concurrent confirmation request without overwriting the first resolver', async () => {
    await mockInvoke({
      preview_distribution: {
        platforms: [{
          platform_id: 'p1',
          platform_name: 'P1',
          skills_to_add: ['s1'],
          skills_to_update: [],
          skills_to_remove: [],
          rules_to_add: [],
          rules_to_update: [],
          rules_to_remove: [],
        }],
        has_removals: false,
      },
    });
    const selection = {
      sceneId: null,
      platformIds: ['p1'],
      scope: 'global' as const,
      skills: { mode: 'add_or_update' as const, ids: ['s1'] },
      rules: { mode: 'preserve' as const, ids: [] },
    };

    const first = useAppStore.getState().requestSyncConfirm(selection);
    await vi.waitFor(() => expect(useAppStore.getState().resolveSyncConfirm).toBeTypeOf('function'));
    const firstResolver = useAppStore.getState().resolveSyncConfirm!;
    const second = useAppStore.getState().requestSyncConfirm(selection);

    await expect(second).resolves.toBe('cancelled');
    expect(useAppStore.getState().resolveSyncConfirm).toBe(firstResolver);
    firstResolver(true);
    await expect(first).resolves.toBe('confirmed');
    expect(useAppStore.getState().pendingSyncConfirm).toBeNull();
    expect(useAppStore.getState().resolveSyncConfirm).toBeNull();
  });

  it('cancels an externally dismissed confirmation exactly once and cleans up state', async () => {
    await mockInvoke({
      preview_distribution: {
        platforms: [{
          platform_id: 'p1',
          platform_name: 'P1',
          skills_to_add: ['s1'],
          skills_to_update: [],
          skills_to_remove: [],
          rules_to_add: [],
          rules_to_update: [],
          rules_to_remove: [],
        }],
        has_removals: false,
      },
    });
    const promise = useAppStore.getState().requestSyncConfirm({
      sceneId: null,
      platformIds: ['p1'],
      scope: 'global',
      skills: { mode: 'add_or_update', ids: ['s1'] },
      rules: { mode: 'preserve', ids: [] },
    });
    await vi.waitFor(() => expect(useAppStore.getState().resolveSyncConfirm).toBeTypeOf('function'));

    useAppStore.getState().cancelPendingSyncConfirm();
    useAppStore.getState().cancelPendingSyncConfirm();

    await expect(promise).resolves.toBe('cancelled');
    expect(useAppStore.getState().pendingSyncConfirm).toBeNull();
    expect(useAppStore.getState().resolveSyncConfirm).toBeNull();
    expect(useAppStore.getState().confirmedDistribution).toBeNull();
  });

  it('keeps request B active when cancelled request A rejects later', async () => {
    let rejectA!: (error: Error) => void;
    let resolveB!: (plan: unknown) => void;
    const previewA = new Promise<unknown>((_resolve, reject) => {
      rejectA = reject;
    });
    const previewB = new Promise<unknown>((resolve) => {
      resolveB = resolve;
    });
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockImplementation((command: string) => {
      if (command !== 'preview_distribution') {
        return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
      }
      return (invoke as any).mock.calls.length === 1 ? previewA : previewB;
    });
    const selection = {
      sceneId: null,
      platformIds: ['p1'],
      scope: 'global' as const,
      skills: { mode: 'add_or_update' as const, ids: ['s1'] },
      rules: { mode: 'preserve' as const, ids: [] },
    };

    const requestA = useAppStore.getState().requestSyncConfirm(selection);
    useAppStore.getState().cancelPendingSyncConfirm();
    const requestB = useAppStore.getState().requestSyncConfirm(selection);
    rejectA(new Error('A failed'));
    await expect(requestA).resolves.toBe('cancelled');
    expect(useAppStore.getState().toasts.some((toast) => toast.message.includes('预览失败'))).toBe(false);

    resolveB({
      platforms: [{
        platform_id: 'p1', platform_name: 'P1', skills_to_add: ['s1'], skills_to_update: [],
        skills_to_remove: [], rules_to_add: [], rules_to_update: [], rules_to_remove: [],
      }],
      has_removals: false,
    });
    await vi.waitFor(() => expect(useAppStore.getState().resolveSyncConfirm).toBeTypeOf('function'));
    useAppStore.getState().cancelPendingSyncConfirm();
    await expect(requestB).resolves.toBe('cancelled');
    expect(useAppStore.getState().pendingSyncConfirm).toBeNull();
    expect(useAppStore.getState().resolveSyncConfirm).toBeNull();
  });

  it('requestSyncConfirm shows adds/updates dialog when only adds present', async () => {
    await mockInvoke({
      preview_sync: {
        platforms: [
          {
            platform_id: 'p1',
            platform_name: 'P1',
            skills_to_add: ['s1', 's2'],
            skills_to_update: [],
            skills_to_remove: [],
            rules_to_add: ['r1'],
            rules_to_update: [],
            rules_to_remove: [],
          },
        ],
        has_removals: false,
      },
    });

    const promise = useAppStore
      .getState()
      .requestSyncConfirm({
        skillIds: ['s1', 's2'],
        ruleIds: ['r1'],
        sceneId: null,
        platformIds: ['p1'],
        scope: 'global',
      });

    await vi.waitFor(() => {
      expect(useAppStore.getState().pendingSyncConfirm).not.toBeNull();
    });

    const pending = useAppStore.getState().pendingSyncConfirm;
    expect(pending!.platforms[0].skills_to_add).toEqual(['s1', 's2']);
    expect(pending!.platforms[0].rules_to_add).toEqual(['r1']);

    useAppStore.getState().resolveSyncConfirm!(true);
    await expect(promise).resolves.toBe('confirmed');
  });
});

describe('appStore — UI State', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });

  it('setActiveNav updates active navigation', () => {
    useAppStore.getState().setActiveNav('rules');
    expect(useAppStore.getState().activeNav).toBe('rules');
  });

  it('toggleSidebar flips collapsed state', () => {
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });

  it('setSearchQuery updates search query', () => {
    useAppStore.getState().setSearchQuery('react');
    expect(useAppStore.getState().searchQuery).toBe('react');
  });

  it('setTagFilter updates tag filter array', () => {
    useAppStore.getState().setTagFilter([1, 2]);
    expect(useAppStore.getState().tagFilter).toEqual([1, 2]);
  });

  it('setGlobalDistSelectedPlatform updates memory', () => {
    useAppStore.getState().setGlobalDistSelectedPlatform('claude-code');
    expect(useAppStore.getState().globalDistSelectedPlatform).toBe(
      'claude-code'
    );
    useAppStore.getState().setGlobalDistSelectedPlatform(null);
    expect(useAppStore.getState().globalDistSelectedPlatform).toBeNull();
  });

  it('setProjectDistSelectedProjectId updates memory', () => {
    useAppStore.getState().setProjectDistSelectedProjectId('p1');
    expect(useAppStore.getState().projectDistSelectedProjectId).toBe('p1');
  });

  it('setProjectDistSelectedPlatform updates memory', () => {
    useAppStore.getState().setProjectDistSelectedPlatform('claude-code');
    expect(useAppStore.getState().projectDistSelectedPlatform).toBe(
      'claude-code'
    );
  });
});

describe('appStore — Toasts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });
  afterEach(() => vi.useRealTimers());

  it('addToast appends a toast to state', () => {
    useAppStore.getState().addToast('hello', 'info');

    const state = useAppStore.getState();
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0]).toMatchObject({ message: 'hello', type: 'info' });
  });

  it('addToast auto-removes the toast after 3000ms', () => {
    vi.useFakeTimers();
    useAppStore.getState().addToast('gone soon', 'success');
    expect(useAppStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(3000);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it('removeToast removes only the matching toast', () => {
    vi.useFakeTimers();
    useAppStore.getState().addToast('first', 'info');
    vi.advanceTimersByTime(1);
    useAppStore.getState().addToast('second', 'error');
    const firstId = useAppStore.getState().toasts[0].id;

    useAppStore.getState().removeToast(firstId);

    const remaining = useAppStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe('second');
  });
});
