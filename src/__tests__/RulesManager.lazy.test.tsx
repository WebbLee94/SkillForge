import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { useAppStore } from '../stores/appStore';

const routeLoadCounts = vi.hoisted(() => ({
  ruleEditor: 0,
  inspector: 0,
  resourceImportDialog: 0,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn() }));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty' },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../domains/rules/RuleEditor', () => {
  routeLoadCounts.ruleEditor += 1;
  return {
    RuleEditor: () => React.createElement('div', null, 'RuleEditor'),
  };
});

vi.mock('../domains/inspector/Inspector', () => {
  routeLoadCounts.inspector += 1;
  return {
    Inspector: () => React.createElement('div', null, 'Inspector'),
  };
});

vi.mock('../domains/resources/ResourceImportDialog', () => {
  routeLoadCounts.resourceImportDialog += 1;
  return {
    ResourceImportDialog: () => React.createElement('div', null, 'ImportDialog'),
  };
});

vi.mock('../components/ui/tags/TagFilterBar', () => ({
  TagFilterBar: () => React.createElement('div', null, 'TagFilterBar'),
}));
vi.mock('../domains/tags/TagManagerDialog', () => ({
  TagManagerDialog: () => null,
}));
vi.mock('../components/common/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));
vi.mock('../components/ui/ResourceViewToggle', () => ({
  ResourceViewToggle: () => null,
}));
vi.mock('../domains/resources/ResourceCollection', () => ({
  ResourceCollection: () => React.createElement('div', null, 'Resources'),
}));
vi.mock('../domains/resources/BatchActionBar', () => ({
  BatchActionBar: () => null,
}));
vi.mock('../domains/tags/BatchTagDialog', () => ({
  BatchTagDialog: () => null,
}));
vi.mock('../hooks/useBatchMode', () => ({
  useBatchMode: () => ({
    enabled: false,
    selectedCount: 0,
    selectedIds: new Set<string>(),
    toggle: vi.fn(),
    exit: vi.fn(),
    clear: vi.fn(),
  }),
}));
vi.mock('../hooks/useDialogA11y', () => ({
  useDialogA11y: () => null,
}));
vi.mock('../lib/resourceLibrary', () => ({
  detectRuleFormat: vi.fn(),
  formatRelativeTime: vi.fn(() => 'now'),
  ruleImportFileName: vi.fn((name: string) => name),
  validateRuleImportFile: vi.fn(() => ({ status: 'valid', reason: undefined })),
  sanitizePath: vi.fn((value: string) => value),
}));
vi.mock('../lib/ipc', () => ({
  ipc: {
    getManagedCopyPath: vi.fn().mockResolvedValue(null),
    countSceneReferences: vi.fn().mockResolvedValue(0),
    revealPath: vi.fn().mockResolvedValue({ fallback: false }),
    createRule: vi.fn().mockResolvedValue(undefined),
  },
}));

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
    activeNav: 'rules',
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
  });
}

describe('RulesManager chunk loading', () => {
  it('does not eagerly load editor and inspector modules on initial render', async () => {
    vi.resetModules();
    routeLoadCounts.ruleEditor = 0;
    routeLoadCounts.inspector = 0;
    routeLoadCounts.resourceImportDialog = 0;
    resetStore();

    const { RulesManager } = await import('../pages/RulesManager');

    expect(routeLoadCounts.ruleEditor).toBe(0);
    expect(routeLoadCounts.inspector).toBe(0);
    expect(routeLoadCounts.resourceImportDialog).toBe(0);

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });

    expect(routeLoadCounts.ruleEditor).toBe(0);
    expect(routeLoadCounts.inspector).toBe(0);
    expect(routeLoadCounts.resourceImportDialog).toBe(0);
  });
});
