import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GlobalDistribution } from '../GlobalDistribution';
import { useAppStore } from '../../stores/appStore';
import type { Platform, PlatformEntryCount } from '../../types';

/* Hoisted mocks */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco-editor">{value}</div>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

/* Factories */
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

const mkCount = (platformId: string): PlatformEntryCount => ({
  platform_id: platformId, skills: 2, rules: 1, dir_exists: true,
});

/* Helpers */
async function setupInvoke(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) return Promise.resolve(routes[cmd]);
    return Promise.reject(new Error(`Unknown: ${cmd}`));
  });
}

function resetStore() {
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
describe('GlobalDistribution', () => {
  beforeEach(() => { resetStore(); vi.clearAllMocks(); });

  it('shows empty state when no platforms exist', async () => {
    await setupInvoke({ list_platforms: [] });
    render(<GlobalDistribution />);
    await waitFor(() => expect(screen.getByText('noEnabledPlatforms')).toBeDefined());
    expect(screen.getByText('goToSettings')).toBeDefined();
  });

  it('shows empty state when all platforms are disabled', async () => {
    await setupInvoke({ list_platforms: [mkPlat('claude', 'Claude Code', false)] });
    render(<GlobalDistribution />);
    await waitFor(() => expect(screen.getByText('noEnabledPlatforms')).toBeDefined());
  });

  it('renders enabled platform buttons after data loads', async () => {
    await setupInvoke({
      list_platforms: [mkPlat('claude', 'Claude Code'), mkPlat('github', 'GitHub Copilot')],
      count_platform_entries: mkCount('claude'),
      list_directory_tree: [],
    });
    render(<GlobalDistribution />);
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    expect(screen.getByText('GitHub Copilot')).toBeDefined();
  });

  it('selects platform and shows preview + distribute button', async () => {
    await setupInvoke({
      list_platforms: [mkPlat('claude', 'Claude Code')],
      count_platform_entries: mkCount('claude'),
      list_directory_tree: [],
    });
    render(<GlobalDistribution />);

    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    fireEvent.click(screen.getByText('Claude Code'));

    await waitFor(() => {
      // clickToPreview appears in both the header span and the placeholder div
      const previews = screen.getAllByText('clickToPreview');
      expect(previews.length).toBe(2);
    });
    expect(screen.getByText('distributeTo')).toBeDefined();
  });
});