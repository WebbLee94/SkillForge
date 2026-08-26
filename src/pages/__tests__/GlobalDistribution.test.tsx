import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GlobalDistribution } from '../GlobalDistribution';
import { useAppStore } from '../../stores/appStore';
import type { Platform } from '../../types';

/* Hoisted mocks */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../domains/distribution/DistributionWorkspace', () => ({
  DistributionWorkspace: ({ scope }: { scope?: string }) => (
    <div data-testid="distribution-workspace" data-scope={scope || 'global'}>
      workspace
    </div>
  ),
}));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty' },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

const mkPlat = (id: string, name: string, enabled = true): Platform => ({
  id,
  name,
  enabled,
  adapter: 'generic',
  icon: null,
  paths: {
    global_skills_dir: `/home/.${id}/skills`,
    project_skills_pattern: `/home/.${id}/projects/{project}/skills`,
    global_rules_dir: `/home/.${id}/rules`,
    project_rules_pattern: null,
    global_rules_format: null,
    project_rules_format: null,
  },
});

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
    activeNav: 'globalDistribution',
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

describe('GlobalDistribution', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('renders page title and the shared DistributionWorkspace with global scope', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'list_platforms')
        return Promise.resolve([mkPlat('claude', 'Claude Code')]);
      return Promise.reject(new Error(`Unknown: ${cmd}`));
    });
    render(<GlobalDistribution />);
    await waitFor(() =>
      expect(screen.getByTestId('distribution-workspace')).toBeDefined()
    );
    expect(
      screen.getByTestId('distribution-workspace').getAttribute('data-scope')
    ).toBe('global');
    expect(screen.getByText('globalTitle')).toBeDefined();
  });
});
