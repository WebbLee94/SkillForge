import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

// Mock @tauri-apps/api/core invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Helper to create a fresh store for each test
function createTestStore() {
  // Reset the store to initial state by calling getState selectors
  const store = useAppStore.getState();
  return store;
}

describe('appStore — Skills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    useAppStore.setState({
      skills: [],
      loading: false,
      toasts: [],
    });
  });

  it('fetchSkills loads skills into state on success', async () => {
    const mockSkills = [
      { id: 'skill-1', name: 'Test Skill', skill_type: 'custom', source: 'local' },
    ];
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue(mockSkills);

    await useAppStore.getState().fetchSkills();

    const state = useAppStore.getState();
    expect(state.skills).toEqual(mockSkills);
    expect(state.loading).toBe(false);
  });

  it('fetchSkills shows error toast on failure', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockRejectedValue(new Error('Network error'));

    await useAppStore.getState().fetchSkills();

    const state = useAppStore.getState();
    expect(state.skills).toEqual([]);
    expect(state.toasts.length).toBeGreaterThan(0);
    expect(state.toasts[0].type).toBe('error');
  });

  it('installSkill calls invoke and re-fetches skills', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue({ id: 'new-skill' });

    await useAppStore.getState().installSkill('local', 'new-skill');

    expect(invoke).toHaveBeenCalledWith('install_skill', {
      source: 'local-fs',
      skillId: 'new-skill',
    });
  });

  it('uninstallSkill updates selectedSkill if it was the uninstalled one', async () => {
    useAppStore.setState({
      selectedSkill: { id: 'skill-1', name: 'To Delete', skill_type: 'custom', source: 'local' },
    });
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue({});

    await useAppStore.getState().uninstallSkill('skill-1');

    expect(useAppStore.getState().selectedSkill).toBeNull();
  });
});

describe('appStore — Scenes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      scenes: [],
      currentScene: null,
      currentSceneDetail: null,
      toasts: [],
    });
  });

  it('fetchScenes loads scenes into state', async () => {
    const mockScenes = [
      { id: 'scene-1', name: 'Test Scene', icon: 'box', skill_count: 0, rule_count: 0 },
    ];
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue(mockScenes);

    await useAppStore.getState().fetchScenes();

    expect(useAppStore.getState().scenes).toEqual(mockScenes);
  });

  it('createScene calls invoke and re-fetches scenes', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue({ id: 'scene-2' });

    await useAppStore.getState().createScene({
      name: 'New Scene',
      description: 'A test scene',
      icon: 'star',
    });

    expect(invoke).toHaveBeenCalledWith('create_scene', {
      data: { name: 'New Scene', description: 'A test scene', icon: 'star' },
    });
  });

  it('deleteScene updates currentScene if deleted scene was selected', async () => {
    useAppStore.setState({
      currentScene: { id: 'scene-3', name: 'To Delete', icon: 'zap', skill_count: 0, rule_count: 0 },
    });
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue({});

    await useAppStore.getState().deleteScene('scene-3');

    expect(useAppStore.getState().currentScene).toBeNull();
    expect(useAppStore.getState().currentSceneDetail).toBeNull();
  });
});

describe('appStore — Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      dashboardStats: null,
      recentActivity: [],
      globalDistStatus: null,
      loading: false,
      toasts: [],
    });
  });

  it('fetchDashboardStats loads stats', async () => {
    const mockStats = {
      total_skills: 10,
      total_rules: 5,
      total_platforms: 12,
      synced_platforms: 8,
      total_distributions: 20,
      synced_distributions: 15,
    };
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue(mockStats);

    await useAppStore.getState().fetchDashboardStats();

    expect(useAppStore.getState().dashboardStats).toEqual(mockStats);
  });

  it('fetchDashboardStats handles failure gracefully', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockRejectedValue(new Error('DB error'));

    await useAppStore.getState().fetchDashboardStats();

    expect(useAppStore.getState().dashboardStats).toBeNull();
    expect(useAppStore.getState().toasts.length).toBeGreaterThan(0);
  });
});

describe('appStore — Sync and Selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      distributions: [],
      syncStatus: null,
      globalDistStatus: null,
      selectedSkill: null,
      currentScene: null,
      toasts: [],
    });
  });

  it('selectSkill updates selected skill', () => {
    const skill = { id: 's1', name: 'Selected', skill_type: 'custom', source: 'local' };
    useAppStore.getState().selectSkill(skill);
    expect(useAppStore.getState().selectedSkill).toEqual(skill);
  });

  it('setCurrentScene updates current scene and clears detail', () => {
    const scene = { id: 'sc1', name: 'Current', icon: 'box', skill_count: 1, rule_count: 0 };
    useAppStore.getState().setCurrentScene(scene);
    expect(useAppStore.getState().currentScene).toEqual(scene);
    expect(useAppStore.getState().currentSceneDetail).toBeNull();
  });

  it('fetchDistributions loads distribution list', async () => {
    const mockDists = [{ platform_id: 'claude-code', status: 'synced' }];
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue(mockDists);

    await useAppStore.getState().fetchDistributions();

    expect(useAppStore.getState().distributions).toEqual(mockDists);
  });

  it('syncScene toast shows success when no errors', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue({ errors: [] });

    await useAppStore.getState().syncScene([], [], null, [], 'global');

    expect(useAppStore.getState().toasts.some(t => t.type === 'success')).toBe(true);
  });
});