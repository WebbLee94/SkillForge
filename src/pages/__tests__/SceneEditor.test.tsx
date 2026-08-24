import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { SceneEditor } from '../SceneEditor';
import { useAppStore } from '../../stores/appStore';
import type { Scene, SceneDetail, Skill } from '../../types';

/* ===== Module-level mocks (hoisted) ===== */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty' },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

/* ===== Factories ===== */
const aScene = (
  id: string,
  name: string,
  updated = '2026-01-01T00:00:00Z'
): Scene => ({
  id,
  name,
  description: `D:${name}`,
  icon: 'package',
  is_template: false,
  is_system: false,
  created_at: '',
  updated_at: updated,
});

const aSkill = (id: string, name: string): Skill => ({
  id,
  name,
  description: `D:${name}`,
  source_type: 'custom',
  source_url: null,
  current_ver: null,
  installed_at: '',
  local_path: '',
  metadata: null,
});

const aDetail = (
  scene: Scene,
  skills: SceneDetail['skills'] = [],
  rules: SceneDetail['rules'] = []
): SceneDetail => ({
  scene,
  skills,
  rules,
});

/* ===== Store & invoke helpers ===== */

/** Reset every store field to defaults */
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
    pendingDistributionSelection: null,
    pendingSyncConfirm: null,
    resolveSyncConfirm: null,
  });
}

async function seedInvoke(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) return Promise.resolve(routes[cmd]);
    return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
  });
}

const baseRoutes = (scenes: Scene[], detail?: SceneDetail) => ({
  list_scenes: scenes,
  list_skills: [],
  list_rules: [],
  list_tags: [],
  ...(detail ? { get_scene_detail: detail } : {}),
});

/* ===== Tests ===== */
describe('SceneEditor — master-detail read mode', () => {
  beforeEach(resetStore);

  it('shows empty state when no scenes exist', async () => {
    await seedInvoke(baseRoutes([]));
    render(<SceneEditor />);
    await waitFor(() => expect(screen.getByText('empty')).toBeDefined());
    expect(screen.getAllByText('createScene').length).toBeGreaterThan(0);
  });

  it('renders master list and detail pane with counts for the selected scene', async () => {
    const s1 = aScene('s-1', 'Scene One');
    const s2 = aScene('s-2', 'Scene Two');
    const det = aDetail(
      s1,
      [
        {
          skill_id: 'sk1',
          skill_name: 'S1',
          version: null,
          enabled: true,
          sort_order: 0,
        },
        {
          skill_id: 'sk2',
          skill_name: 'S2',
          version: null,
          enabled: true,
          sort_order: 1,
        },
      ],
      [{ rule_id: 'r1', rule_name: 'R1', enabled: true, sort_order: 0 }]
    );

    await seedInvoke(baseRoutes([s1, s2], det));
    render(<SceneEditor />);

    await waitFor(() => expect(screen.getByText('Scene One')).toBeDefined());
    // Master list shows both scenes
    expect(screen.getAllByTestId('scene-list-item').length).toBe(2);
    // Detail shows scene name + group counts
    expect(screen.getByTestId('scene-detail')).toBeDefined();
    expect(screen.getByText('sceneSkills')).toBeDefined();
    expect(screen.getByText('sceneRules')).toBeDefined();
    const counts = screen.getAllByText(/^\(\d+\)$/);
    expect(counts.some((n) => n.textContent === '(2)')).toBe(true);
    expect(counts.some((n) => n.textContent === '(1)')).toBe(true);
  });

  it('auto-selects the first scene and loads its detail', async () => {
    const s1 = aScene('s-1', 'First');
    const det = aDetail(s1);
    await seedInvoke(baseRoutes([s1], det));
    render(<SceneEditor />);

    await waitFor(() => {
      expect(useAppStore.getState().currentScene?.id).toBe('s-1');
      expect(useAppStore.getState().currentSceneDetail).toEqual(det);
    });
  });

  it('filters the scene list by search', async () => {
    const s1 = aScene('s-1', 'Alpha');
    const s2 = aScene('s-2', 'Beta');
    await seedInvoke(baseRoutes([s1, s2], aDetail(s1)));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getAllByTestId('scene-list-item').length).toBe(2)
    );
    fireEvent.change(screen.getByPlaceholderText('list.searchPlaceholder'), {
      target: { value: 'Beta' },
    });
    const items = screen.getAllByTestId('scene-list-item');
    expect(items.length).toBe(1);
    expect(within(items[0]).getByText('Beta')).toBeDefined();
  });

  it('sorts the scene list by name', async () => {
    const s1 = aScene('s-1', 'Zulu');
    const s2 = aScene('s-2', 'Alpha');
    await seedInvoke(baseRoutes([s1, s2], aDetail(s1)));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getAllByTestId('scene-list-item').length).toBe(2)
    );
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'name' },
    });
    const items = screen.getAllByTestId('scene-list-item');
    expect(within(items[0]).getByText('Alpha')).toBeDefined();
    expect(within(items[1]).getByText('Zulu')).toBeDefined();
  });

  it('selecting another scene loads its detail', async () => {
    const s1 = aScene('s-1', 'One');
    const s2 = aScene('s-2', 'Two');
    await seedInvoke(baseRoutes([s1, s2], aDetail(s1)));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getAllByTestId('scene-list-item').length).toBe(2)
    );
    fireEvent.click(screen.getAllByTestId('scene-list-item')[1]);

    await waitFor(() => {
      expect(useAppStore.getState().currentScene?.id).toBe('s-2');
    });
    // Detail fetched for s-2
    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('get_scene_detail', { id: 's-2' });
  });

  it('clicking the same scene preserves existing detail and does not re-fetch', async () => {
    const s1 = aScene('s-1', 'Scene One');
    const det = aDetail(s1, [
      {
        skill_id: 'sk1',
        skill_name: 'S1',
        version: null,
        enabled: true,
        sort_order: 0,
      },
    ]);
    await seedInvoke(baseRoutes([s1], det));
    render(<SceneEditor />);

    await waitFor(() => {
      expect(useAppStore.getState().currentSceneDetail).toEqual(det);
    });

    // Reset mock call history so we can assert no new calls
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockClear();

    // Click the same scene again
    fireEvent.click(screen.getAllByTestId('scene-list-item')[0]);

    // Detail must still be present (not cleared to null)
    await waitFor(() => {
      expect(useAppStore.getState().currentSceneDetail).toEqual(det);
    });

    // Must NOT have called get_scene_detail again
    expect(invoke).not.toHaveBeenCalledWith(
      'get_scene_detail',
      expect.anything()
    );
  });

  it('detail shows invalid-reference warning when a member was deleted', async () => {
    const s1 = aScene('s-1', 'Broken');
    const det = aDetail(
      s1,
      [
        {
          skill_id: 'gone-skill',
          skill_name: '',
          version: null,
          enabled: true,
          sort_order: 0,
        },
      ],
      [{ rule_id: 'gone-rule', rule_name: '', enabled: true, sort_order: 0 }]
    );
    await seedInvoke(baseRoutes([s1], det));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByText('detail.invalidRefsTitle')).toBeDefined()
    );
  });

  it('creates a new scene from the top bar', async () => {
    await seedInvoke({
      ...baseRoutes([]),
      create_scene: { id: 'new-scene' },
    });
    render(<SceneEditor />);
    await waitFor(() => expect(screen.getByText('empty')).toBeDefined());

    fireEvent.click(screen.getAllByText('createScene')[0]);
    expect(screen.getByText('create.title')).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText('create.namePlaceholder'), {
      target: { value: 'New Scene' },
    });
    fireEvent.click(screen.getByText('actions.create'));

    await waitFor(() => expect(screen.queryByText('create.title')).toBeNull());
    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('create_scene', {
      data: { name: 'New Scene', description: '' },
    });
  });

  it('list drawer toggle opens the master list overlay and backdrop closes it', async () => {
    const s1 = aScene('s-1', 'One');
    await seedInvoke(baseRoutes([s1], aDetail(s1)));
    render(<SceneEditor />);
    await waitFor(() =>
      expect(screen.getAllByTestId('scene-list-item').length).toBe(1)
    );

    fireEvent.click(screen.getByTestId('list-toggle'));
    expect(screen.getByTestId('list-backdrop')).toBeDefined();
    fireEvent.click(screen.getByTestId('list-backdrop'));
    expect(screen.queryByTestId('list-backdrop')).toBeNull();
  });
});

describe('SceneEditor — delete confirmation', () => {
  beforeEach(resetStore);

  it('opens delete confirmation with counts and not-affected note, then deletes', async () => {
    const s1 = aScene('s-1', 'To Delete');
    const det = aDetail(
      s1,
      [
        {
          skill_id: 'sk1',
          skill_name: 'S1',
          version: null,
          enabled: true,
          sort_order: 0,
        },
      ],
      [
        { rule_id: 'r1', rule_name: 'R1', enabled: true, sort_order: 0 },
        { rule_id: 'r2', rule_name: 'R2', enabled: true, sort_order: 1 },
      ]
    );
    await seedInvoke({
      ...baseRoutes([s1], det),
      delete_scene: {},
    });
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByText('detail.delete')).toBeDefined()
    );
    fireEvent.click(screen.getByText('detail.delete'));

    expect(screen.getByText('deleteConfirm.title')).toBeDefined();
    expect(screen.getByText('deleteConfirm.message')).toBeDefined();
    expect(screen.getByText('deleteConfirm.notAffected')).toBeDefined();
    // Stats line contains the labels and both counts
    const stats = screen.getByText(/deleteConfirm\.skillLabel/);
    expect(stats.textContent).toContain('deleteConfirm.ruleLabel');
    expect(stats.textContent).toContain('1');
    expect(stats.textContent).toContain('2');

    fireEvent.click(screen.getByText('deleteConfirm.confirm'));
    await waitFor(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      expect(invoke).toHaveBeenCalledWith('delete_scene', { id: 's-1' });
    });
  });
});

describe('SceneEditor — configuration drawer', () => {
  beforeEach(resetStore);

  it('opens the drawer from the detail action and shows the current scene', async () => {
    const s1 = aScene('s-1', 'Scene One');
    const det = aDetail(s1, [
      {
        skill_id: 'sk1',
        skill_name: 'S1',
        version: null,
        enabled: true,
        sort_order: 0,
      },
    ]);
    await seedInvoke(baseRoutes([s1], det));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByText('detail.configure')).toBeDefined()
    );
    fireEvent.click(screen.getByText('detail.configure'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('drawer.availableSkills')).toBeDefined();
    expect(within(dialog).getByText('sceneSkills')).toBeDefined();
    expect(within(dialog).getByText('S1')).toBeDefined();
  });

  it('saving the drawer calls saveSceneComposition and refreshes detail', async () => {
    const s1 = aScene('s-1', 'Scene One');
    const det = aDetail(s1, [
      {
        skill_id: 'sk1',
        skill_name: 'S1',
        version: null,
        enabled: true,
        sort_order: 0,
      },
    ]);
    await seedInvoke({
      ...baseRoutes([s1], det),
      list_skills: [aSkill('sk2', 'S2')],
      update_scene: {},
      add_skill_to_scene: {},
      remove_skill_from_scene: {},
      add_rule_to_scene: {},
      remove_rule_from_scene: {},
    });
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByText('detail.configure')).toBeDefined()
    );
    fireEvent.click(screen.getByText('detail.configure'));
    const dialog = await screen.findByRole('dialog');

    // Rename the scene, add a skill from the pool, then save
    fireEvent.change(within(dialog).getByDisplayValue('Scene One'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(within(dialog).getAllByRole('checkbox')[0]);
    fireEvent.click(within(dialog).getByText('drawer.addSelected'));
    fireEvent.click(within(dialog).getByText('actions.save'));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('update_scene', {
      id: 's-1',
      data: { name: 'Renamed' },
    });
    expect(invoke).toHaveBeenCalledWith('add_skill_to_scene', {
      sceneId: 's-1',
      skillId: 'sk2',
    });
  });

  it('Escape closes the drawer when clean', async () => {
    const s1 = aScene('s-1', 'Scene One');
    await seedInvoke(baseRoutes([s1], aDetail(s1)));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByText('detail.configure')).toBeDefined()
    );
    fireEvent.click(screen.getByText('detail.configure'));
    await screen.findByRole('dialog');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('打开「配置内容」后页面仍在 DOM，遮罩点击关闭', async () => {
    const s1 = aScene('s-1', 'Scene One');
    await seedInvoke(baseRoutes([s1], aDetail(s1)));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByText('detail.configure')).toBeDefined()
    );
    fireEvent.click(screen.getByText('detail.configure'));
    await waitFor(() => expect(screen.getByTestId('scene-drawer')).toBeDefined());
    expect(screen.getByTestId('scene-page-content')).toBeDefined();

    fireEvent.click(screen.getByTestId('scene-drawer-overlay'));
    await waitFor(() => expect(screen.queryByTestId('scene-drawer')).toBeNull());
  });
});

describe('SceneEditor — use for distribution', () => {
  beforeEach(resetStore);

  it('carries expanded valid members into the distribution contract', async () => {
    const s1 = aScene('s-1', 'Scene One');
    const det = aDetail(
      s1,
      [
        {
          skill_id: 'sk1',
          skill_name: 'S1',
          version: null,
          enabled: true,
          sort_order: 0,
        },
        {
          skill_id: 'sk2',
          skill_name: 'S2',
          version: null,
          enabled: true,
          sort_order: 1,
        },
      ],
      [{ rule_id: 'r1', rule_name: 'R1', enabled: true, sort_order: 0 }]
    );
    await seedInvoke(baseRoutes([s1], det));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByText('detail.useForDistribution')).toBeDefined()
    );
    fireEvent.click(screen.getByText('detail.useForDistribution'));

    const store = useAppStore.getState();
    expect(store.pendingDistributionSelection).toEqual({
      skillIds: ['sk1', 'sk2'],
      ruleIds: ['r1'],
      sceneId: 's-1',
    });
    expect(store.activeNav).toBe('globalDistribution');
  });

  it('carryToDistribution 排除禁用成员：enabled=false 不进 pendingDistributionSelection', async () => {
    const s1 = aScene('s-1', 'Scene One');
    const det = aDetail(
      s1,
      [
        {
          skill_id: 'sk1',
          skill_name: 'S1',
          version: null,
          enabled: true,
          sort_order: 0,
        },
        {
          skill_id: 'sk2',
          skill_name: 'S2',
          version: null,
          enabled: false,
          sort_order: 1,
        },
      ],
      [
        { rule_id: 'r1', rule_name: 'R1', enabled: true, sort_order: 0 },
        { rule_id: 'r2', rule_name: 'R2', enabled: false, sort_order: 1 },
      ]
    );
    await seedInvoke(baseRoutes([s1], det));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByText('detail.useForDistribution')).toBeDefined()
    );
    fireEvent.click(screen.getByText('detail.useForDistribution'));

    expect(useAppStore.getState().pendingDistributionSelection).toEqual({
      skillIds: ['sk1'],
      ruleIds: ['r1'],
      sceneId: 's-1',
    });
    expect(useAppStore.getState().activeNav).toBe('globalDistribution');
  });

  it('blocks silently carrying invalid refs; use-valid-only excludes them', async () => {
    const s1 = aScene('s-1', 'Broken');
    const det = aDetail(s1, [
      {
        skill_id: 'valid-skill',
        skill_name: 'Valid',
        version: null,
        enabled: true,
        sort_order: 0,
      },
      {
        skill_id: 'gone-skill',
        skill_name: '',
        version: null,
        enabled: true,
        sort_order: 1,
      },
    ]);
    await seedInvoke(baseRoutes([s1], det));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByText('detail.useForDistribution')).toBeDefined()
    );
    fireEvent.click(screen.getByText('detail.useForDistribution'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('detail.invalidRefsTitle')).toBeDefined();
    expect(useAppStore.getState().pendingDistributionSelection).toBeNull();

    fireEvent.click(within(dialog).getByText('detail.invalidRefsUseValid'));
    expect(useAppStore.getState().pendingDistributionSelection).toEqual({
      skillIds: ['valid-skill'],
      ruleIds: [],
      sceneId: 's-1',
    });
    expect(useAppStore.getState().activeNav).toBe('globalDistribution');
  });

  it('invalid-ref gate can return to the editor to clean up', async () => {
    const s1 = aScene('s-1', 'Broken');
    const det = aDetail(s1, [
      {
        skill_id: 'gone-skill',
        skill_name: '',
        version: null,
        enabled: true,
        sort_order: 0,
      },
    ]);
    await seedInvoke(baseRoutes([s1], det));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByText('detail.useForDistribution')).toBeDefined()
    );
    fireEvent.click(screen.getByText('detail.useForDistribution'));
    fireEvent.click(screen.getByText('detail.invalidRefsCleanup'));

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(useAppStore.getState().pendingDistributionSelection).toBeNull();
  });
});

describe('SceneEditor — 详情读取态与原型操作顺序', () => {
  beforeEach(resetStore);

  it('detail header shows localized updated time and read-only state', async () => {
    const s1 = aScene('s-1', 'Scene One', '2026-01-01T00:00:00Z');
    const det = aDetail(s1, [
      {
        skill_id: 'sk1',
        skill_name: 'S1',
        version: null,
        enabled: true,
        sort_order: 0,
      },
    ]);
    await seedInvoke(baseRoutes([s1], det));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByTestId('scene-updated-at')).toBeDefined()
    );
    expect(screen.getByTestId('scene-updated-at').textContent).toContain(
      'detail.updatedAt'
    );
    expect(screen.getByTestId('scene-read-only').textContent).toBe(
      'detail.readOnly'
    );
  });

  it('members show 启用/禁用 per resource enabled flag', async () => {
    const s1 = aScene('s-1', 'Scene One');
    const det = aDetail(
      s1,
      [
        {
          skill_id: 'sk1',
          skill_name: 'S1',
          version: null,
          enabled: true,
          sort_order: 0,
        },
        {
          skill_id: 'sk2',
          skill_name: 'S2',
          version: null,
          enabled: false,
          sort_order: 1,
        },
      ],
      [
        { rule_id: 'r1', rule_name: 'R1', enabled: true, sort_order: 0 },
        { rule_id: 'r2', rule_name: 'R2', enabled: false, sort_order: 1 },
      ]
    );
    await seedInvoke(baseRoutes([s1], det));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getAllByText('detail.memberEnabled').length).toBe(2)
    );
    expect(screen.getAllByText('detail.memberDisabled').length).toBe(2);
  });

  it('detail footer notes save scope: 场景与场景成员关联', async () => {
    const s1 = aScene('s-1', 'Scene One');
    await seedInvoke(baseRoutes([s1], aDetail(s1)));
    render(<SceneEditor />);

    await waitFor(() =>
      expect(screen.getByTestId('scene-save-note')).toBeDefined()
    );
    expect(screen.getByTestId('scene-save-note').textContent).toBe(
      'detail.saveScopeNote'
    );
  });

  it('orders actions 用于分发(primary) → 配置内容(outline) → 删除(destructive)', async () => {
    const s1 = aScene('s-1', 'Scene One');
    await seedInvoke(baseRoutes([s1], aDetail(s1)));
    render(<SceneEditor />);

    await waitFor(() => expect(screen.getByTestId('scene-actions')).toBeDefined());
    const actions = screen.getByTestId('scene-actions');
    expect(actions.className).toContain('flex-row');
    const buttons = within(actions).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'detail.useForDistribution',
      'detail.configure',
      'detail.delete',
    ]);
    expect(buttons[0]).toHaveClass('bg-primary');
    expect(buttons[1]).not.toHaveClass('bg-primary');
  });
});
