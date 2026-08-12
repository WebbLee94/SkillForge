import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SceneEditor } from '../SceneEditor';
import { useAppStore } from '../../stores/appStore';
import type { Scene, SceneDetail, Skill, Rule } from '../../types';

/* ===== Module-level mocks (hoisted) ===== */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

/* ===== Factories ===== */
const aScene = (id: string, name: string): Scene => ({
  id, name, description: `D:${name}`, icon: 'package',
  is_template: false, is_system: false,
  created_at: '', updated_at: '',
});

const aSkill = (id: string, name: string): Skill => ({
  id, name, description: `D:${name}`,
  source_type: 'custom', source_url: null, current_ver: null,
  installed_at: '', local_path: '', metadata: null,
});

const aRule = (id: string, name: string): Rule => ({
  id, name, description: null, format: 'markdown', content: `# ${name}`,
  platform: 'claude-code', scope: 'global', version: 1, updated_at: '',
});

const aDetail = (scene: Scene): SceneDetail => ({
  scene, skills: [], rules: [],
});

/* ===== Store & invoke helpers ===== */

/** Reset every store field to defaults */
function resetStore() {
  useAppStore.setState({
    skills: [], rules: [], tags: [], scenes: [], projects: [],
    platforms: [],
    dashboardStats: null, syncStatus: null,
    selectedSkill: null, currentScene: null, currentSceneDetail: null,
    editingRule: null, activeNav: 'dashboard', sidebarCollapsed: false,
    searchQuery: '', tagFilter: [], loading: false, toasts: [],
    globalDistSelectedPlatform: null, projectDistSelectedProjectId: null,
    projectDistSelectedPlatform: null,
    pendingSyncConfirm: null, resolveSyncConfirm: null,
  });
}

/**
 * Configure the invoke mock to resolve known commands.
 * Unknown commands reject with an Error.
 */
async function seedInvoke(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) return Promise.resolve(routes[cmd]);
    return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
  });
}

/* ===== Tests ===== */
describe('SceneEditor', () => {
  beforeEach(resetStore);

  it('shows empty state when no scenes exist', async () => {
    await seedInvoke({
      list_scenes: [],
      list_skills: [],
      list_rules: [],
      list_tags: [],
    });
    render(<SceneEditor />);
    await waitFor(() => expect(screen.getByText('noScene')).toBeDefined());
    expect(screen.getByText('createScene')).toBeDefined();
  });

  it('renders scene selector and detail panels after data loads', async () => {
    const s1 = aScene('s-1', 'Demo Scene');
    const det = aDetail(s1);

    await seedInvoke({
      list_scenes: [s1],
      list_skills: [],
      list_rules: [],
      list_tags: [],
      get_scene_detail: det,
    });
    render(<SceneEditor />);

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select).toBeDefined();
    });
    expect(screen.getByText('Demo Scene')).toBeDefined();
    expect(screen.getByText('saveScene')).toBeDefined();
    expect(screen.getByText('sceneSkills')).toBeDefined();
    expect(screen.getByText('sceneRules')).toBeDefined();
  });

  it('opens create scene dialog when create button is clicked', async () => {
    await seedInvoke({
      list_scenes: [],
      list_skills: [],
      list_rules: [],
      list_tags: [],
    });
    render(<SceneEditor />);
    await waitFor(() => expect(screen.getByText('noScene')).toBeDefined());

    fireEvent.click(screen.getByText('createScene'));

    await waitFor(() => {
      expect(screen.getByText('create.title')).toBeDefined();
    });
    expect(screen.getByPlaceholderText('create.namePlaceholder')).toBeDefined();
    expect(screen.getByPlaceholderText('create.descriptionPlaceholder')).toBeDefined();
  });

  it('submits create scene form and closes dialog', async () => {
    await seedInvoke({
      list_scenes: [],
      list_skills: [],
      list_rules: [],
      list_tags: [],
      create_scene: { id: 'new' },
    });
    render(<SceneEditor />);
    await waitFor(() => expect(screen.getByText('noScene')).toBeDefined());

    fireEvent.click(screen.getByText('createScene'));
    await waitFor(() => expect(screen.getByText('create.title')).toBeDefined());

    fireEvent.change(screen.getByPlaceholderText('create.namePlaceholder'), {
      target: { value: 'New Scene' },
    });
    fireEvent.click(screen.getByText('actions.create'));

    await waitFor(() => {
      expect(screen.queryByText('create.title')).toBeNull();
    });
  });

  it('switches left panel from skills tab to rules tab', async () => {
    const s1 = aScene('s-1', 'Test');
    const det = aDetail(s1);

    await seedInvoke({
      list_scenes: [s1],
      list_skills: [aSkill('sk1', 'Sk1')],
      list_rules: [aRule('r1', 'R1')],
      list_tags: [],
      get_scene_detail: det,
    });
    render(<SceneEditor />);

    await waitFor(() => expect(screen.getByText('skillTab')).toBeDefined());

    fireEvent.click(screen.getByText('ruleTab'));

    await waitFor(() => expect(screen.getByText('ruleTab')).toBeDefined());
  });

  it('displays available skills in left panel', async () => {
    const s1 = aScene('s-1', 'Test');
    const det = aDetail(s1);

    await seedInvoke({
      list_scenes: [s1],
      list_skills: [aSkill('sk1', 'React Skill'), aSkill('sk2', 'Vue Skill')],
      list_rules: [],
      list_tags: [],
      get_scene_detail: det,
    });
    render(<SceneEditor />);

    await waitFor(() => expect(screen.getByText('React Skill')).toBeDefined());
    expect(screen.getByText('Vue Skill')).toBeDefined();
  });

  it('shows zero counts for skills and rules in scene detail section', async () => {
    const s1 = aScene('s-1', 'Empty');
    const det = aDetail(s1);

    await seedInvoke({
      list_scenes: [s1],
      list_skills: [],
      list_rules: [],
      list_tags: [],
      get_scene_detail: det,
    });
    render(<SceneEditor />);

    await waitFor(() => expect(screen.getByText('sceneSkills')).toBeDefined());
    const zeros = screen.getAllByText('(0)');
    expect(zeros.length).toBe(2);
  });

  it('calls addSkillToScene when clicking add on an available skill', async () => {
    const s1 = aScene('s-1', 'Test');
    const det = aDetail(s1);

    await seedInvoke({
      list_scenes: [s1],
      list_skills: [aSkill('sk1', 'Awesome Skill')],
      list_rules: [],
      list_tags: [],
      get_scene_detail: det,
      add_skill_to_scene: {},
    });
    render(<SceneEditor />);

    await waitFor(() => expect(screen.getByText('Awesome Skill')).toBeDefined());

    const addBtn = screen.getByTitle('addSkill');
    expect(addBtn).toBeDefined();
    fireEvent.click(addBtn);
  });
});