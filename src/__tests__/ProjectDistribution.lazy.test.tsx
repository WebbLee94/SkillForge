import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const loadCounts = vi.hoisted(() => ({
  addProjectDialog: 0,
  projectDistributionItem: 0,
  projectBatchBar: 0,
}));

const testState = vi.hoisted(() => ({
  projects: [] as Array<{ id: string; name: string; path: string }>,
  platforms: [] as Array<{ id: string; enabled: boolean }>,
  pendingDistributionSelection: null as null,
  projectDistSelectedProjectId: null as string | null,
  globalDistSelectedPlatform: null as string | null,
  projectDistSelectedPlatform: null as string | null,
  fetchProjects: vi.fn().mockResolvedValue(true),
  fetchPlatforms: vi.fn().mockResolvedValue(true),
  addProject: vi.fn().mockResolvedValue(undefined),
  removeProjects: vi.fn().mockResolvedValue(undefined),
  setActiveNav: vi.fn(),
  setProjectDistSelectedProjectId: vi.fn(),
  setPendingDistributionSelection: vi.fn(),
  addToast: vi.fn(),
  useStore: vi.fn(),
}));

vi.mock('../domains/projects/AddProjectDialog.lazy', () => {
  loadCounts.addProjectDialog += 1;
  return {
    default: () => React.createElement('div', { 'data-testid': 'add-project-dialog' }),
  };
});

vi.mock('../domains/projects/ProjectDistributionItem.lazy', () => {
  loadCounts.projectDistributionItem += 1;
  return {
    default: () => React.createElement('div', { 'data-testid': 'project-item' }),
  };
});

vi.mock('../domains/distribution/ProjectBatchBar.lazy', () => {
  loadCounts.projectBatchBar += 1;
  return {
    default: () => React.createElement('div', { 'data-testid': 'project-batch-bar' }),
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../stores/appStore', () => ({
  useAppStore: (selector: (state: typeof testState) => unknown) => selector(testState),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

describe('ProjectDistribution chunk loading', () => {
  it('does not eagerly load list and dialog modules on initial render', async () => {
    vi.resetModules();
    loadCounts.addProjectDialog = 0;
    loadCounts.projectDistributionItem = 0;
    loadCounts.projectBatchBar = 0;
    testState.projects = [];
    testState.platforms = [];

    const { ProjectDistribution } = await import('../pages/ProjectDistribution');

    expect(loadCounts.addProjectDialog).toBe(0);
    expect(loadCounts.projectDistributionItem).toBe(0);
    expect(loadCounts.projectBatchBar).toBe(0);

    render(<ProjectDistribution />);

    await waitFor(() => {
      expect(screen.getByText('noProjects')).toBeDefined();
    });

    expect(loadCounts.addProjectDialog).toBe(0);
    expect(loadCounts.projectDistributionItem).toBe(0);
    expect(loadCounts.projectBatchBar).toBe(0);
  });
});
