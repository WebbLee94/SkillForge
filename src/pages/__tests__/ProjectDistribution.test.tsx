import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectDistribution } from '../ProjectDistribution';
import { useAppStore } from '../../stores/appStore';
import type { Project, Platform } from '../../types';

/* Hoisted mocks */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco-editor">{value}</div>,
}));
vi.mock('../../components/DistributeDialog', () => ({
  DistributeDialog: ({ onDistributed }: { onDistributed?: () => void }) => (
    <button onClick={onDistributed}>completeDistribution</button>
  ),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

/* Factories */
const mkProj = (id: string, name: string): Project => ({
  id, name, path: `/tmp/${id}`,
  scene_id: null, scene_name: undefined,
  description: `Project: ${name}`,
  created_at: '', updated_at: '',
});

const mkPlat = (id: string, name: string, enabled = true): Platform => ({
  id, name, enabled, adapter: 'generic', icon: null,
  paths: {
    global_skills_dir: `/home/.${id}/skills`,
    project_skills_pattern: `/home/.${id}/projects/{project}/skills`,
    global_rules_dir: `/home/.${id}/rules`,
    project_rules_pattern: null,
    global_rules_format: null,
    project_rules_format: null,
  },
});

const mkCount = (platformId: string) => ({
  platform_id: platformId, skills: 2, rules: 1, dir_exists: true,
});

/* Helpers */
async function __seedRoutes__(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) return Promise.resolve(routes[cmd]);
    return Promise.reject(new Error(`Unexpected: ${cmd}`));
  });
}

function __resetStore__() {
  useAppStore.setState({
    skills: [], rules: [], tags: [], scenes: [], projects: [],
    platforms: [], distributions: [], recentActivity: [],
    dashboardStats: null, syncStatus: null, globalDistStatus: null,
    selectedSkill: null, currentScene: null, currentSceneDetail: null,
    editingRule: null, activeNav: 'dashboard', sidebarCollapsed: false,
    searchQuery: '', tagFilter: [], loading: false, toasts: [],
    globalDistSelectedPlatform: null, projectDistSelectedProjectId: null,
    projectDistSelectedPlatform: null,
    pendingSyncConfirm: null, resolveSyncConfirm: null,
  });
}

/* Tests */
describe('ProjectDistribution', () => {
  beforeEach(() => { __resetStore__(); vi.clearAllMocks(); });

  it('shows empty state when no projects exist', async () => {
    await __seedRoutes__({ list_projects: [], list_platforms: [] });
    render(<ProjectDistribution />);
    await waitFor(() => expect(screen.getByText('noProjects')).toBeDefined());
    expect(screen.getByText('addProject')).toBeDefined();
  });

  it('shows no-platforms state when projects exist but no platforms', async () => {
    const proj = mkProj('p-1', 'My Project');
    await __seedRoutes__({ list_projects: [proj], list_platforms: [] });
    render(<ProjectDistribution />);
    await waitFor(() => expect(screen.getByText('noEnabledPlatforms')).toBeDefined());
    expect(screen.getByText('goToSettings')).toBeDefined();
  });

  it('renders project selector and platform buttons', async () => {
    const proj = mkProj('p-1', 'My Project');
    const plat = mkPlat('claude', 'Claude Code');

    await __seedRoutes__({
      list_projects: [proj],
      list_platforms: [plat],
      count_platform_entries: mkCount('claude'),
      list_directory_tree: [],
    });

    render(<ProjectDistribution />);

    await waitFor(() => {
      const texts = screen.getAllByText('My Project');
      expect(texts.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('Claude Code')).toBeDefined();
  });

  it('shows distribute button after platform is selected', async () => {
    const proj = mkProj('p-1', 'Test');
    const plat = mkPlat('claude', 'Claude Code');

    await __seedRoutes__({
      list_projects: [proj],
      list_platforms: [plat],
      count_platform_entries: mkCount('claude'),
      list_directory_tree: [],
    });

    render(<ProjectDistribution />);

    await waitFor(() => {
      const texts = screen.getAllByText('Test');
      expect(texts.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('Claude Code')).toBeDefined();

    fireEvent.click(screen.getByText('Claude Code'));

    await waitFor(() => {
      expect(screen.getByText('distributeTo')).toBeDefined();
    });
    expect(screen.getByText('distributeTo')).not.toBeDisabled();
  });

  it('refreshes project platform counts after distribution completes', async () => {
    const proj = mkProj('p-1', 'Test');
    const plat = mkPlat('trae', 'Trae');
    const { invoke } = await import('@tauri-apps/api/core');

    await __seedRoutes__({
      list_projects: [proj],
      list_platforms: [plat],
      count_platform_entries: mkCount('trae'),
      list_directory_tree: [],
    });
    render(<ProjectDistribution />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'count_platform_entries',
      { platformId: 'trae', projectPath: '/tmp/p-1' },
    ));
    vi.clearAllMocks();
    fireEvent.click(screen.getByText('completeDistribution'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'count_platform_entries',
      { platformId: 'trae', projectPath: '/tmp/p-1' },
    ));
  });
});
