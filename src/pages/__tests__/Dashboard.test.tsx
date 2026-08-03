import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Dashboard } from '../Dashboard';
import { useAppStore } from '../../stores/appStore';
import { useWatcherStore } from '../../stores/watcherStore';
import type {
  DashboardStats,
  Platform,
  PlatformEntryCount,
  ScanForImportResult,
  ImportResult,
} from '../../types';

/* ===== Hoisted mocks ===== */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

/* ===== Factories ===== */
const mkStats = (overrides?: Partial<DashboardStats>): DashboardStats => ({
  skill_count: 3,
  rule_count: 2,
  scene_count: 1,
  user_scene_count: 1,
  project_count: 2,
  ...overrides,
});

const mkPlatform = (id: string, name: string, enabled: boolean): Platform => ({
  id,
  name,
  adapter: id,
  enabled,
  icon: null,
  paths: {
    global_skills_dir: `/skills/${id}`,
    project_skills_pattern: '**/skills/**',
    global_rules_dir: null,
    project_rules_pattern: null,
    global_rules_format: null,
    project_rules_format: null,
  },
});

const mkEntryCount = (
  platformId: string,
  overrides?: Partial<PlatformEntryCount>
): PlatformEntryCount => ({
  platform_id: platformId,
  skills: 1,
  rules: 2,
  dir_exists: true,
  ...overrides,
});

const mkScanResult = (): ScanForImportResult => ({
  platforms: [
    {
      platform_id: 'claude',
      platform_name: 'Claude Code',
      new_skills: [
        { id: 's1', name: 'NewSkill', source_path: '/tmp/s1' },
      ],
      new_rules: [
        { id: 'r1', name: 'NewRule', format: 'md', source_path: '/tmp/r1' },
      ],
      existing_skills: 1,
      existing_rules: 0,
    },
  ],
  total_new_skills: 1,
  total_new_rules: 1,
  total_existing_skills: 1,
  total_existing_rules: 0,
});

const mkImportResult = (): ImportResult => ({
  imported_skills: 1,
  imported_rules: 1,
  skipped_skills: 0,
  skipped_rules: 0,
  errors: [],
});

/* ===== Store reset ===== */
function resetStores() {
  useAppStore.setState({
    skills: [],
    rules: [],
    tags: [],
    scenes: [],
    projects: [],
    platforms: [],
    distributions: [],
    recentActivity: [],
    dashboardStats: null,
    syncStatus: null,
    globalDistStatus: null,
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
  useWatcherStore.setState({ events: [], unhandledCount: 0 });
  localStorage.removeItem('skillforge-import-guide-dismissed');
}

/* ===== Invoke mock helper ===== */
async function setupInvoke(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) {
      const val = routes[cmd];
      return val instanceof Error ? Promise.reject(val) : Promise.resolve(val);
    }
    return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
  });
}

async function setupDefaultRoutes(overrides: Record<string, unknown> = {}) {
  await setupInvoke({
    get_dashboard_stats: mkStats(),
    get_recent_activity: [],
    list_platforms: [mkPlatform('claude', 'Claude Code', true)],
    count_platform_entries: mkEntryCount('claude'),
    scan_for_import: mkScanResult(),
    import_scanned: mkImportResult(),
    ...overrides,
  });
}

/* =================================================== */
/*  Tests                                              */
/* =================================================== */
describe('Dashboard', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  it('renders dashboard title and stat cards from store', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);

    expect(screen.getByText('nav.dashboard')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText('3')).toBeDefined();
    });
    // nav.projectDistribution appears in both stat-card label and quick action button
    expect(screen.getAllByText('nav.projectDistribution').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('nav.scenes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('nav.skills').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('nav.rules').length).toBeGreaterThanOrEqual(1);
  });

  it('shows first-launch guide card when no skills exist', async () => {
    useAppStore.setState({ dashboardStats: mkStats({ skill_count: 0 }) });
    // init effect re-fetches stats via get_dashboard_stats route — must override the route,
    // otherwise skill_count would be overwritten back to the default (3).
    await setupDefaultRoutes({
      get_dashboard_stats: mkStats({ skill_count: 0 }),
    });
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('import.firstLaunchTitle')).toBeDefined();
    });
    expect(screen.getByText('import.firstLaunchAction')).toBeDefined();
    expect(screen.getByText('import.firstLaunchDismiss')).toBeDefined();
  });

  it('dismisses guide card and persists to localStorage', async () => {
    useAppStore.setState({ dashboardStats: mkStats({ skill_count: 0 }) });
    await setupDefaultRoutes({
      get_dashboard_stats: mkStats({ skill_count: 0 }),
    });
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('import.firstLaunchDismiss')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.firstLaunchDismiss'));

    await waitFor(() => {
      expect(screen.queryByText('import.firstLaunchTitle')).toBeNull();
    });
    expect(localStorage.getItem('skillforge-import-guide-dismissed')).toBe('true');
  });

  it('renders platform buttons for enabled platforms with live counts', async () => {
    useAppStore.setState({
      dashboardStats: mkStats(),
      platforms: [mkPlatform('claude', 'Claude Code', true)],
    });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeDefined();
    });
    // PlatformButton renders "skillCount / ruleCount" => "1/2" (async live counts);
    // use textContent because getByText's getNodeText skips the nested slash span
    await waitFor(() => {
      const btn = screen.getByText('Claude Code').closest('button');
      expect(btn?.textContent).toContain('1/2');
    });
  });

  it('shows noData message when no enabled platforms', async () => {
    useAppStore.setState({
      dashboardStats: mkStats(),
      platforms: [mkPlatform('claude', 'Claude Code', false)],
    });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('messages.noData')).toBeDefined();
    });
  });

  it('shows workflow stepper when skills or rules are zero', async () => {
    useAppStore.setState({ dashboardStats: mkStats({ skill_count: 0 }) });
    await setupDefaultRoutes({
      get_dashboard_stats: mkStats({ skill_count: 0 }),
    });
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('workflow.prepareContent')).toBeDefined();
    });
    expect(screen.getByText('workflow.organizeContent')).toBeDefined();
    expect(screen.getByText('workflow.distributeContent')).toBeDefined();
  });

  it('hides workflow stepper when both skills and rules exist', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('nav.dashboard')).toBeDefined();
    });
    expect(screen.queryByText('workflow.prepareContent')).toBeNull();
  });

  it('navigates when a stat card is clicked', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('3')).toBeDefined();
    });
    fireEvent.click(screen.getByText('nav.skills'));

    await waitFor(() => {
      expect(useAppStore.getState().activeNav).toBe('skills');
    });
  });

  it('navigates to global distribution when a platform button is clicked', async () => {
    useAppStore.setState({
      dashboardStats: mkStats(),
      platforms: [mkPlatform('claude', 'Claude Code', true)],
    });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Claude Code'));

    await waitFor(() => {
      expect(useAppStore.getState().globalDistSelectedPlatform).toBe('claude');
      expect(useAppStore.getState().activeNav).toBe('globalDistribution');
    });
  });

  it('scans for import and opens preview dialog', async () => {
    useAppStore.setState({ dashboardStats: mkStats({ skill_count: 0 }) });
    await setupDefaultRoutes({
      get_dashboard_stats: mkStats({ skill_count: 0 }),
    });
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('import.firstLaunchAction')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.firstLaunchAction'));

    // ImportPreviewDialog renders counts (not skill names) once open
    await waitFor(() => {
      expect(screen.getByText('import.previewTitle')).toBeDefined();
    });
    // "Claude Code" appears in both the platform button and the dialog header
    expect(screen.getAllByText('Claude Code').length).toBeGreaterThanOrEqual(1);
  });

  it('confirms import and closes preview', async () => {
    useAppStore.setState({ dashboardStats: mkStats({ skill_count: 0 }) });
    await setupDefaultRoutes({
      get_dashboard_stats: mkStats({ skill_count: 0 }),
    });
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('import.firstLaunchAction')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.firstLaunchAction'));

    await waitFor(() => {
      expect(screen.getByText('import.previewTitle')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.confirmImport'));

    await waitFor(() => {
      expect(screen.queryByText('import.previewTitle')).toBeNull();
    });
  });

  it('navigates via quick action buttons', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('nav.dashboard')).toBeDefined();
    });

    fireEvent.click(screen.getAllByText('nav.globalDistribution')[0]);
    await waitFor(() => {
      expect(useAppStore.getState().activeNav).toBe('globalDistribution');
    });

    // Quick action button text collides with the stat-card label; click the button one
    const projQuickAction = screen
      .getAllByText('nav.projectDistribution')
      .find((el) => el.closest('button')?.className.includes('bg-secondary'));
    expect(projQuickAction).toBeDefined();
    fireEvent.click(projQuickAction!);
    await waitFor(() => {
      expect(useAppStore.getState().activeNav).toBe('projectDistribution');
    });
  });

  it('handles scan failure gracefully', async () => {
    useAppStore.setState({ dashboardStats: mkStats({ skill_count: 0 }) });
    await setupDefaultRoutes({
      get_dashboard_stats: mkStats({ skill_count: 0 }),
      scan_for_import: new Error('scan failed'),
    });
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('import.firstLaunchTitle')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.firstLaunchAction'));

    // No dialog should open; guide card remains
    await waitFor(() => {
      expect(screen.getByText('import.firstLaunchTitle')).toBeDefined();
    });
    expect(screen.queryByText('import.previewTitle')).toBeNull();
  });
});
