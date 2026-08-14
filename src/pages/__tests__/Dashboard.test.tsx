import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
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
      new_skills: [{ id: 's1', name: 'NewSkill', source_path: '/tmp/s1' }],
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

  it('dashboard 页面根容器不再叠加 p-6', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);
    const page = screen.getByTestId('dashboard-page');
    expect(page).not.toHaveClass('p-6');
  });

  it('renders dashboard title and stat cards from store', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);

    expect(screen.getByText('nav.dashboard')).toBeDefined();
    await waitFor(() => {
      // Resources card value combines skill / rule counts
      expect(screen.getByText('3 / 2')).toBeDefined();
    });
    expect(screen.getByText('dashboard.stats.resources')).toBeDefined();
    expect(screen.getByText('dashboard.stats.scenes')).toBeDefined();
    expect(screen.getByText('dashboard.stats.projects')).toBeDefined();
    expect(screen.getByText('dashboard.stats.platforms')).toBeDefined();
    // Agent platform card shows enabled / total = 1 / 1
    expect(screen.getByText('1 / 1')).toBeDefined();
    // Stat card subtitles are rendered via i18n format keys
    expect(screen.getByText('dashboard.stats.resourcesSubtitle')).toBeDefined();
    expect(screen.getByText('dashboard.stats.platformsSubtitle')).toBeDefined();
  });

  it('shows welcome guide card when no skills exist', async () => {
    useAppStore.setState({ dashboardStats: mkStats({ skill_count: 0 }) });
    // init effect re-fetches stats via get_dashboard_stats route — must override the route,
    // otherwise skill_count would be overwritten back to the default (3).
    await setupDefaultRoutes({
      get_dashboard_stats: mkStats({ skill_count: 0 }),
    });
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('dashboard.welcome.title')).toBeDefined();
    });
    expect(screen.getByText('dashboard.welcome.dismiss')).toBeDefined();
    expect(screen.getByText('dashboard.welcome.step1Title')).toBeDefined();
    expect(screen.getByText('dashboard.welcome.step2Title')).toBeDefined();
    expect(screen.getByText('dashboard.welcome.step3Title')).toBeDefined();
  });

  it('renders header row with subtitle and right-side primary one-click import button', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('nav.dashboard')).toBeDefined();
    });
    // Explanatory subtitle under the title (prototype: "资源、场景、项目与已开启平台的当前概况。")
    expect(screen.getByText('dashboard.subtitle')).toBeDefined();
    const importText = screen.getByText('import.scanTitle');
    const importBtn = importText.closest('button');
    expect(importBtn).not.toBeNull();
    expect(importBtn).toHaveClass('bg-primary');
    expect(screen.queryByText('import.scanTooltip')).toBeNull();
  });

  it('keeps welcome guide hidden after dismiss persists across re-render', async () => {
    useAppStore.setState({ dashboardStats: mkStats({ skill_count: 0 }) });
    await setupDefaultRoutes({
      get_dashboard_stats: mkStats({ skill_count: 0 }),
    });
    const { unmount } = render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('dashboard.welcome.dismiss')).toBeDefined();
    });
    fireEvent.click(screen.getByText('dashboard.welcome.dismiss'));
    await waitFor(() => {
      expect(screen.queryByText('dashboard.welcome.title')).toBeNull();
    });

    // Remount with the same persisted dismiss flag — must stay hidden
    unmount();
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText('nav.dashboard')).toBeDefined();
    });
    expect(screen.queryByText('dashboard.welcome.title')).toBeNull();
  });

  it('dismisses welcome card and persists to localStorage', async () => {
    useAppStore.setState({ dashboardStats: mkStats({ skill_count: 0 }) });
    await setupDefaultRoutes({
      get_dashboard_stats: mkStats({ skill_count: 0 }),
    });
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('dashboard.welcome.dismiss')).toBeDefined();
    });
    fireEvent.click(screen.getByText('dashboard.welcome.dismiss'));

    await waitFor(() => {
      expect(screen.queryByText('dashboard.welcome.title')).toBeNull();
    });
    expect(localStorage.getItem('skillforge-import-guide-dismissed')).toBe(
      'true'
    );
  });

  it('概览页不再渲染 Quick Actions 快捷操作区', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('nav.dashboard')).toBeDefined();
    });
    expect(screen.queryByTestId('dashboard-quick-actions')).toBeNull();
  });

  it('有技能 + 有启用平台 + 未 dismiss 时欢迎卡仍可见（取消数据态门控）', async () => {
    useAppStore.setState({
      dashboardStats: mkStats(),
      platforms: [mkPlatform('claude', 'Claude Code', true)],
    });
    await setupDefaultRoutes();
    render(<Dashboard />);

    // 本文件 i18n mock 返回 raw key，按 key 查询而非中文可见文案。
    expect(await screen.findByTestId('welcome-guide-card')).toBeDefined();
    fireEvent.click(
      screen.getByRole('button', { name: 'dashboard.welcome.dismiss' })
    );
    expect(localStorage.getItem('skillforge-import-guide-dismissed')).toBe(
      'true'
    );
    expect(screen.queryByTestId('welcome-guide-card')).toBeNull();
  });

  it('统计卡网格 gap 使用 12px 紧凑令牌', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('dashboard.stats.resources')).toBeDefined();
    });
    const grid = screen.getByTestId('dashboard-stats-grid');
    expect(grid.className).toContain('gap-3');
  });

  it('统计卡网格响应式 4/2×2/1 列（grid-cols-1 md:grid-cols-2 md:min-[1180px]:grid-cols-4）', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText('dashboard.stats.resources')).toBeDefined()
    );
    const grid = screen.getByTestId('dashboard-stats-grid');
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('md:grid-cols-2');
    // md:min-[1180px] 复合变体（外层 md 使 4 列规则排到 md:grid-cols-2 之后，
    // 内层 min-[1180px] 保持 ≥1180px 断点语义）——修复 Tailwind v4 将 arbitrary
    // 变体排在标准 md 之前导致 ≥1180px 级联回退为 2 列的问题（P1 回归）。
    expect(grid.className).toContain('md:min-[1180px]:grid-cols-4');
    expect(grid.className).toContain('gap-3');
  });

  it('每张统计卡为整卡边框且 label/value/subtitle 位于同一卡内容器', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText('dashboard.stats.resources')).toBeDefined()
    );
    const grid = screen.getByTestId('dashboard-stats-grid');
    const cards = within(grid).getAllByRole('button');
    expect(cards.length).toBe(4);
    const labels = [
      'dashboard.stats.resources',
      'dashboard.stats.scenes',
      'dashboard.stats.projects',
      'dashboard.stats.platforms',
    ];
    cards.forEach((card, idx) => {
      expect(card.className).toContain('border');
      expect(card.className).toContain('rounded-lg');
      // 三段文案（label/value/subtitle）均位于同一卡内容器内
      expect(within(card).getByText(labels[idx])).toBeDefined();
      expect(card.querySelector('.text-2xl')).not.toBeNull();
      expect(card.querySelector('.text-xs')).not.toBeNull();
    });
  });

  it('renders quick entry rows for enabled platforms with live counts', async () => {
    useAppStore.setState({
      dashboardStats: mkStats(),
      platforms: [mkPlatform('claude', 'Claude Code', true)],
    });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeDefined();
    });
    expect(screen.getByText('dashboard.quickEntry.title')).toBeDefined();
    expect(screen.getByText('dashboard.quickEntry.chooseTarget')).toBeDefined();
    // Live counts feed the "技能 N · 规则 N" summary (rendered via i18n format key)
    await waitFor(() => {
      expect(
        screen.getByText('dashboard.quickEntry.skillRuleCount')
      ).toBeDefined();
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

  it('navigates via welcome guide stepper steps', async () => {
    useAppStore.setState({ dashboardStats: mkStats({ skill_count: 0 }) });
    await setupDefaultRoutes({
      get_dashboard_stats: mkStats({ skill_count: 0 }),
    });
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('dashboard.welcome.step3Title')).toBeDefined();
    });
    fireEvent.click(screen.getByText('dashboard.welcome.step3Title'));

    await waitFor(() => {
      expect(useAppStore.getState().activeNav).toBe('globalDistribution');
    });
  });

  it('navigates when a stat card is clicked', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('dashboard.stats.resources')).toBeDefined();
    });
    fireEvent.click(screen.getByText('dashboard.stats.resources'));

    await waitFor(() => {
      expect(useAppStore.getState().activeNav).toBe('skills');
    });
  });

  it('navigates to settings when Agent platform stat card is clicked', async () => {
    useAppStore.setState({ dashboardStats: mkStats() });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('dashboard.stats.platforms')).toBeDefined();
    });
    fireEvent.click(screen.getByText('dashboard.stats.platforms'));

    await waitFor(() => {
      expect(useAppStore.getState().activeNav).toBe('settings');
    });
  });

  it('navigates to global distribution when choose-target is clicked', async () => {
    useAppStore.setState({
      dashboardStats: mkStats(),
      platforms: [mkPlatform('claude', 'Claude Code', true)],
    });
    await setupDefaultRoutes();
    render(<Dashboard />);

    await waitFor(() => {
      expect(
        screen.getByText('dashboard.quickEntry.chooseTarget')
      ).toBeDefined();
    });
    fireEvent.click(screen.getByText('dashboard.quickEntry.chooseTarget'));

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
      expect(screen.getByText('import.scanTitle')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.scanTitle'));

    // ImportPreviewDialog renders counts (not skill names) once open
    await waitFor(() => {
      expect(screen.getByText('import.previewTitle')).toBeDefined();
    });
    // "Claude Code" appears in both the quick entry row and the dialog header
    expect(screen.getAllByText('Claude Code').length).toBeGreaterThanOrEqual(1);
  });

  it('confirms import and closes preview', async () => {
    useAppStore.setState({ dashboardStats: mkStats({ skill_count: 0 }) });
    await setupDefaultRoutes({
      get_dashboard_stats: mkStats({ skill_count: 0 }),
    });
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('import.scanTitle')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.scanTitle'));

    await waitFor(() => {
      expect(screen.getByText('import.previewTitle')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.confirmImport'));

    await waitFor(() => {
      expect(screen.queryByText('import.previewTitle')).toBeNull();
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
      expect(screen.getByText('dashboard.welcome.title')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.scanTitle'));

    // No dialog should open; welcome card remains
    await waitFor(() => {
      expect(screen.getByText('dashboard.welcome.title')).toBeDefined();
    });
    expect(screen.queryByText('import.previewTitle')).toBeNull();
  });
});
