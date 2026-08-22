import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';
import { useAppStore } from '../stores/appStore';

/* ===== Hoisted mocks ===== */
const watcherMocks = vi.hoisted(() => ({
  listenToWatcher: vi.fn().mockResolvedValue(vi.fn()),
  fetchEvents: vi.fn().mockResolvedValue(undefined),
}));

const routeLoadCounts = vi.hoisted(() => ({
  dashboard: 0,
  skills: 0,
  rules: 0,
  scenes: 0,
  globalDistribution: 0,
  projectDistribution: 0,
  settings: 0,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../stores/watcherStore', () => ({
  useWatcherStore: {
    getState: () => ({
      listenToWatcher: watcherMocks.listenToWatcher,
      fetchEvents: watcherMocks.fetchEvents,
    }),
  },
}));

vi.mock('../domains/dashboard/Dashboard', () => {
  routeLoadCounts.dashboard += 1;
  return {
    Dashboard: () =>
      React.createElement(
        'div',
        { 'data-testid': 'page-dashboard' },
        'Dashboard'
      ),
  };
});
vi.mock('../pages/SkillLibrary', () => {
  routeLoadCounts.skills += 1;
  return {
    SkillLibrary: () =>
      React.createElement('div', { 'data-testid': 'page-skills' }, 'Skills'),
  };
});
vi.mock('../pages/RulesManager', () => {
  routeLoadCounts.rules += 1;
  return {
    RulesManager: () =>
      React.createElement('div', { 'data-testid': 'page-rules' }, 'Rules'),
  };
});
vi.mock('../domains/scenes/SceneEditor', () => {
  routeLoadCounts.scenes += 1;
  return {
    SceneEditor: () =>
      React.createElement('div', { 'data-testid': 'page-scenes' }, 'Scenes'),
  };
});
vi.mock('../domains/distribution/GlobalDistribution', () => {
  routeLoadCounts.globalDistribution += 1;
  return {
    GlobalDistribution: () =>
      React.createElement(
        'div',
        { 'data-testid': 'page-global-distribution' },
        'Global'
      ),
  };
});
vi.mock('../domains/distribution/ProjectDistribution', () => {
  routeLoadCounts.projectDistribution += 1;
  return {
    ProjectDistribution: () =>
      React.createElement(
        'div',
        { 'data-testid': 'page-project-distribution' },
        'Project'
      ),
  };
});
vi.mock('../domains/settings/Settings', () => {
  routeLoadCounts.settings += 1;
  return {
    Settings: () =>
      React.createElement('div', { 'data-testid': 'page-settings' }, 'Settings'),
  };
});

vi.mock('../app/SyncConfirmDialog', () => ({
  SyncConfirmDialog: () => null,
}));

vi.mock('../app/AppShell', async () => {
  const { Outlet } = await import('react-router-dom');
  return {
    AppShell: () => React.createElement(Outlet),
  };
});

vi.mock('../components/common/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

function resetRouteLoadCounts() {
  routeLoadCounts.dashboard = 0;
  routeLoadCounts.skills = 0;
  routeLoadCounts.rules = 0;
  routeLoadCounts.scenes = 0;
  routeLoadCounts.globalDistribution = 0;
  routeLoadCounts.projectDistribution = 0;
  routeLoadCounts.settings = 0;
}

/* ===== Store reset ===== */
function resetStores() {
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
  });
}

/* =================================================== */
/*  Tests                                              */
/* =================================================== */
describe('App routing', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    resetRouteLoadCounts();
    watcherMocks.listenToWatcher.mockResolvedValue(vi.fn());
    window.history.replaceState({}, '', '/');
  });

  it('lazy-loads only the initial dashboard route module on first paint', async () => {
    vi.resetModules();
    resetRouteLoadCounts();

    const { default: FreshApp } = await import('../App');

    expect(routeLoadCounts.dashboard).toBe(0);
    expect(routeLoadCounts.skills).toBe(0);
    expect(routeLoadCounts.rules).toBe(0);
    expect(routeLoadCounts.scenes).toBe(0);
    expect(routeLoadCounts.globalDistribution).toBe(0);
    expect(routeLoadCounts.projectDistribution).toBe(0);
    expect(routeLoadCounts.settings).toBe(0);

    render(<FreshApp />);

    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeDefined();
    });

    expect(routeLoadCounts.dashboard).toBe(1);
    expect(routeLoadCounts.skills).toBe(0);
    expect(routeLoadCounts.rules).toBe(0);
    expect(routeLoadCounts.scenes).toBe(0);
    expect(routeLoadCounts.globalDistribution).toBe(0);
    expect(routeLoadCounts.projectDistribution).toBe(0);
    expect(routeLoadCounts.settings).toBe(0);
  });

  it('renders Dashboard at /', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeDefined();
    });
  });

  it('renders SkillLibrary at /skills', async () => {
    useAppStore.setState({ activeNav: 'skills' });
    window.history.pushState({}, '', '/skills');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-skills')).toBeDefined();
    });
  });

  it('renders RulesManager at /rules', async () => {
    useAppStore.setState({ activeNav: 'rules' });
    window.history.pushState({}, '', '/rules');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-rules')).toBeDefined();
    });
  });

  it('renders SceneEditor at /scenes', async () => {
    useAppStore.setState({ activeNav: 'scenes' });
    window.history.pushState({}, '', '/scenes');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-scenes')).toBeDefined();
    });
  });

  it('renders GlobalDistribution at /workspace', async () => {
    useAppStore.setState({ activeNav: 'globalDistribution' });
    window.history.pushState({}, '', '/workspace');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-global-distribution')).toBeDefined();
    });
  });

  it('renders ProjectDistribution at /projects', async () => {
    useAppStore.setState({ activeNav: 'projectDistribution' });
    window.history.pushState({}, '', '/projects');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-project-distribution')).toBeDefined();
    });
  });

  it('renders Settings at /settings', async () => {
    useAppStore.setState({ activeNav: 'settings' });
    window.history.pushState({}, '', '/settings');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-settings')).toBeDefined();
    });
  });

  it('redirects unknown paths to /', async () => {
    window.history.pushState({}, '', '/unknown-path');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeDefined();
    });
  });
});

describe('App NavSync', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    watcherMocks.listenToWatcher.mockResolvedValue(vi.fn());
    window.history.replaceState({}, '', '/');
  });

  it('syncs store activeNav to browser URL', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeDefined();
    });

    useAppStore.getState().setActiveNav('scenes');
    await waitFor(() => {
      expect(window.location.pathname).toBe('/scenes');
    });
  });

  it('syncs globalDistribution selection into query param', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeDefined();
    });

    useAppStore.getState().setGlobalDistSelectedPlatform('claude');
    useAppStore.getState().setActiveNav('globalDistribution');
    await waitFor(() => {
      expect(window.location.pathname).toBe('/workspace');
    });
    await waitFor(() => {
      expect(window.location.search).toContain('platform=claude');
    });
  });

  it('syncs browser URL to store via popstate (nav branch)', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeDefined();
    });

    window.history.pushState({}, '', '/settings');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(() => {
      expect(useAppStore.getState().activeNav).toBe('settings');
    });
  });

  it('syncs platform query param into store via popstate (pid branch)', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeDefined();
    });

    window.history.pushState({}, '', '/workspace?platform=cursor');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(() => {
      expect(useAppStore.getState().globalDistSelectedPlatform).toBe('cursor');
    });
    await waitFor(() => {
      expect(useAppStore.getState().activeNav).toBe('globalDistribution');
    });
  });

  it('reacts to popstate and updates store', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeDefined();
    });

    window.history.pushState({}, '', '/rules');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(() => {
      expect(useAppStore.getState().activeNav).toBe('rules');
    });
  });
});

describe('App watcher setup', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    watcherMocks.listenToWatcher.mockResolvedValue(vi.fn());
    window.history.replaceState({}, '', '/');
  });

  it('starts watcher listener and fetches events on mount', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeDefined();
    });
    expect(watcherMocks.listenToWatcher).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(watcherMocks.fetchEvents).toHaveBeenCalledTimes(1);
    });
  });

  it('unlistens watcher on unmount', async () => {
    const unlisten = vi.fn();
    watcherMocks.listenToWatcher.mockResolvedValue(unlisten);
    const { unmount } = render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeDefined();
    });
    unmount();
    await waitFor(() => {
      expect(unlisten).toHaveBeenCalled();
    });
  });
});
