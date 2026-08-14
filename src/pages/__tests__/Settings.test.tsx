import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { Settings } from '../Settings';
import { useAppStore } from '../../stores/appStore';
import { setTheme, THEME_STORAGE_KEY } from '../../hooks/useTheme';
import { SELECT_CLASSES } from '../../lib/ui-tokens';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

/** 仅新增 key 提供可读翻译；既有 key 保持原样返回（兼容既有断言）。 */
const tMap: Record<string, string> = {
  'shortcuts.title': '快捷键',
  'topbar.notImplemented': '该功能暂未实现',
  'settings:general.darkMode.title': '深色模式',
  'settings:general.darkMode.desc': '切换深色或浅色外观',
  'settings:general.darkMode.current': '当前：{{mode}}',
  'settings:general.darkMode.modeDark': '深色',
  'settings:general.darkMode.modeLight': '浅色',
  'settings:general.update.desc': '每次启动时自动检查新版本',
  'settings:general.update.checkButton': '检查更新',
  'settings:general.update.autoCheckLabel': '自动检查更新',
  'settings:platforms.countsFormat': '技能 {{skills}} · 规则 {{rules}}',
  'settings:platforms.capLabels.openTooltip': '查看 {{name}} 的路径与能力',
  'settings:platforms.capLabels.tooltipTitle': '{{name}} · 路径与能力',
};

/** 恢复真实 addToast，保证复制生命周期测试的 mock 不会泄漏到其他用例。 */
const realAddToast = useAppStore.getState().addToast;

/** i18next 风格 {{var}} 插值，供翻译模板测试。 */
function interpolate(
  template: string,
  options?: Record<string, unknown>
): string {
  if (!options) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    String(options[k] ?? `{{${k}}}`)
  );
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      interpolate(tMap[key] ?? key, options),
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

/* Ensure localStorage in jsdom */
beforeAll(() => {
  if (
    typeof globalThis.localStorage === 'undefined' ||
    globalThis.localStorage === null
  ) {
    const store: Record<string, string> = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
        clear: () => {
          Object.keys(store).forEach((k) => delete store[k]);
        },
        get length() {
          return Object.keys(store).length;
        },
        key: (i: number) => Object.keys(store)[i] ?? null,
      },
      configurable: true,
      writable: true,
    });
  }
});

async function seedRoutes(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) return Promise.resolve(routes[cmd]);
    return Promise.reject(new Error(`Unknown: ${cmd}`));
  });
}

async function waitForCapabilityTriggers() {
  await waitFor(() => {
    expect(
      screen.getAllByRole('button', { name: /路径与能力/ }).length
    ).toBeGreaterThan(0);
  });
}

function cleanStore() {
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
    addToast: realAddToast,
  });
}

describe('Settings', () => {
  beforeEach(() => {
    cleanStore();
    vi.clearAllMocks();
    localStorage.removeItem(THEME_STORAGE_KEY);
    setTheme('light');
  });

  it('通用设置恰好 5 张卡：语言/深色模式/更新/数据目录/版本与社区；更新卡含按钮+switch；社区卡含版本/GitHub/分发说明', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/u/test/.skillforge',
        db_path: '/u/test/.skillforge/db.sqlite',
        version: '1.1.0',
      },
      get_db_size: '2.3 MB',
    });
    render(<Settings />);
    const cards = screen.getAllByTestId('general-card');
    expect(cards.length).toBe(5);
    expect(screen.getByText('settings:general.language.title')).toBeDefined();
    expect(screen.getByText('深色模式')).toBeDefined();
    expect(screen.getByText('settings:general.update.title')).toBeDefined();
    expect(screen.getByText('settings:general.dataDir.title')).toBeDefined();
    expect(screen.getByText('settings:general.community.title')).toBeDefined();
    // 旧卡不残留
    expect(screen.queryByText('settings:general.autoCheckUpdates.title')).toBeNull();
    expect(screen.queryByText('settings:general.checkUpdates.title')).toBeNull();
    expect(screen.queryByText('settings:general.version.title')).toBeNull();
    expect(screen.queryByText('settings:general.github.title')).toBeNull();
    // 更新卡：检查更新按钮（toast 占位）+ 自动检查 switch（role=switch）
    const updateCard = cards[2];
    expect(
      within(updateCard).getByRole('button', { name: '检查更新' })
    ).toBeDefined();
    expect(within(updateCard).getByRole('switch')).toBeDefined();
    // 版本与社区卡：版本徽标 + GitHub 链接 + 分发方式说明
    const communityCard = cards[4];
    expect(within(communityCard).getByText('v1.1.0')).toBeDefined();
    expect(
      within(communityCard).getByText('github.com/WebbLee94/SkillForge')
    ).toBeDefined(); // 生产显示 GITHUB_URL.replace('https://', '')
    expect(
      within(communityCard).getByText('settings:general.distribution.desc')
    ).toBeDefined();
  });

  it('语言 select 使用共享 SELECT_CLASSES 令牌', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/u/test/.skillforge',
        db_path: '/u/test/.skillforge/db.sqlite',
        version: '1.1.0',
      },
      get_db_size: '2.3 MB',
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    const settingsSelect = screen.getByTestId('settings-lang');
    expect(settingsSelect.className).toContain(SELECT_CLASSES.split(' ')[0]);
    for (const token of SELECT_CLASSES.split(' ')) {
      expect(settingsSelect.className).toContain(token);
    }
  });

  it('switches to platforms tab and shows platform list', async () => {
    const platformData = {
      id: 'claude',
      name: 'Claude Code',
      enabled: true,
      adapter: 'generic',
      icon: null,
      paths: {
        global_skills_dir: '/home/.claude/skills',
        project_skills_pattern: '/home/.claude/projects/{project}/skills',
        global_rules_dir: '/home/.claude/rules',
        project_rules_pattern: null,
        global_rules_format: null,
        project_rules_format: null,
      },
    };
    const capabilitiesData = {
      skills_global: true,
      skills_project: true,
      rules_global: true,
      rules_project: true,
      rules_format_global: null,
      rules_format_project: null,
      limitation_notes: [],
    };

    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [platformData],
      get_platform_capabilities: capabilitiesData,
      count_platform_entries: {
        platform_id: 'claude',
        skills: 2,
        rules: 3,
        dir_exists: true,
      },
    });
    render(<Settings />);

    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );

    fireEvent.click(screen.getByText('settings:tabs.platforms'));

    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    expect(screen.getByText('settings:platforms.title')).toBeDefined();
    await waitFor(() =>
      expect(screen.getByText('技能 2 · 规则 3')).toBeDefined()
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.getByText('settings:platforms.columns.name')).toBeDefined();
    expect(
      screen.getByText('settings:platforms.columns.capabilities')
    ).toBeDefined();
    expect(screen.getByText('settings:platforms.columns.status')).toBeDefined();
    expect(screen.queryByText('settings:platforms.columns.counts')).toBeNull();
  });

  it('renders toggle switches for each platform', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [
        {
          id: 'claude',
          name: 'Claude Code',
          enabled: true,
          adapter: 'generic',
          icon: null,
          paths: {
            global_skills_dir: '/c/skills',
            project_skills_pattern: '/c/p/{p}/skills',
            global_rules_dir: null,
            project_rules_pattern: null,
            global_rules_format: null,
            project_rules_format: null,
          },
        },
        {
          id: 'github',
          name: 'GitHub Copilot',
          enabled: false,
          adapter: 'generic',
          icon: null,
          paths: {
            global_skills_dir: '/g/skills',
            project_skills_pattern: '/g/p/{p}/skills',
            global_rules_dir: null,
            project_rules_pattern: null,
            global_rules_format: null,
            project_rules_format: null,
          },
        },
      ],
      get_platform_capabilities: {
        skills_global: true,
        skills_project: true,
        rules_global: true,
        rules_project: true,
        rules_format_global: null,
        rules_format_project: null,
        limitation_notes: [],
      },
      toggle_platform_enabled: {},
    });
    render(<Settings />);

    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(screen.getByText('settings:tabs.platforms'));

    await waitFor(() => {
      const switches = screen.getAllByRole('switch');
      expect(switches.length).toBe(2);
    });
  });

  it('shows database size after loading', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '3.1 MB',
    });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('3.1 MB')).toBeDefined());
  });

  it('renders dark mode and the consolidated update card (switch + check button)', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    expect(
      screen.getByRole('switch', { name: /深色模式|dark mode/i })
    ).toBeDefined();
    expect(
      screen.getByRole('switch', {
        name: /自动检查更新|check for updates automatically/i,
      })
    ).toBeDefined();
    expect(screen.getByText('每次启动时自动检查新版本')).toBeDefined();
    expect(
      screen.getByRole('button', { name: /检查更新|check for updates/i })
    ).toBeDefined();
  });

  it('toggles dark mode from the settings switch', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(
      screen.getByRole('switch', { name: /深色模式|dark mode/i })
    );
    expect(document.documentElement).toHaveClass('dark');
    expect(
      screen.getByRole('switch', { name: /深色模式|dark mode/i }).getAttribute(
        'aria-checked'
      )
    ).toBe('true');
  });

  it('深色模式为开关：开=深色、关=浅色，持久化不回退，当前模式小字联动', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/u/test/.skillforge',
        db_path: '/u/test/.skillforge/db.sqlite',
        version: '1.1.0',
      },
      get_db_size: '2.3 MB',
    });
    render(<Settings />);
    const darkSwitch = screen.getByRole('switch', {
      name: /深色模式|dark mode/i,
    });
    // 初始浅色：开关关 + 当前模式小字「浅色」
    expect(darkSwitch.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('当前：浅色')).toBeDefined();
    expect(screen.queryByText('当前：深色')).toBeNull();

    fireEvent.click(darkSwitch);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(darkSwitch.getAttribute('aria-checked')).toBe('true');
    // 当前模式小字随主题联动为「深色」
    expect(screen.getByText('当前：深色')).toBeDefined();
    expect(screen.queryByText('当前：浅色')).toBeNull();
  });

  it('深色模式开关带聚焦环样式（与平台表 switch 一致）', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
    });
    render(<Settings />);
    const darkSwitch = screen.getByRole('switch', {
      name: /深色模式|dark mode/i,
    });
    for (const token of [
      'focus:outline-none',
      'focus:ring-2',
      'focus:ring-ring',
      'focus:ring-offset-2',
    ]) {
      expect(darkSwitch.className).toContain(token);
    }
  });

  it('keeps Settings as the sole theme entry that toggles and persists the dark class', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );

    expect(
      screen.queryByRole('button', { name: /切换深色模式|toggle theme/i })
    ).toBeNull();

    const darkSwitch = screen.getByRole('switch', {
      name: /深色模式|dark mode/i,
    });
    fireEvent.click(darkSwitch);
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    fireEvent.click(
      screen.getByRole('switch', { name: /深色模式|dark mode/i })
    );
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('shows a placeholder toast for the manual check-for-updates action', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(
      screen.getByRole('button', { name: /检查更新|check for updates/i })
    );
    expect(
      useAppStore.getState().toasts.some((t) => t.message === '该功能暂未实现')
    ).toBe(true);
  });

  it('renders settings as two top tab chips without a 200px left rail', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );

    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(
      screen.getByRole('tab', { name: /settings:tabs.general/ })
    ).toBeDefined();
    expect(
      screen.getByRole('tab', { name: /settings:tabs.platforms/ })
    ).toBeDefined();
    expect(screen.getByRole('tablist')).toBeDefined();
    expect(document.querySelector('.w-\\[200px\\]')).toBeNull();
  });

  it('标题区与 chips 行不叠加水平内边距，水平起点由 AppShell 壳层统一提供', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );

    // 标题条带：含 settings:title 的 border-b 容器
    const titleBand = screen.getByText('settings:title').closest('.border-b');
    expect(titleBand).not.toBeNull();
    expect(titleBand).not.toHaveClass('px-4');
    expect(titleBand).not.toHaveClass('md:px-5');

    // chips 条带：含 tablist 的 border-b 容器
    const chipsBand = screen.getByRole('tablist').closest('.border-b');
    expect(chipsBand).not.toBeNull();
    expect(chipsBand).not.toHaveClass('px-4');
    expect(chipsBand).not.toHaveClass('md:px-5');
  });

  it('shows counts only for enabled platforms', async () => {
    const platformData = (id: string, name: string, enabled: boolean) => ({
      id,
      name,
      enabled,
      adapter: 'generic',
      icon: null,
      paths: {
        global_skills_dir: `/home/${id}/skills`,
        project_skills_pattern: `/home/${id}/projects/{project}/skills`,
        global_rules_dir: `/home/${id}/rules`,
        project_rules_pattern: null,
        global_rules_format: null,
        project_rules_format: null,
      },
    });
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [
        platformData('claude', 'Claude Code', true),
        platformData('github', 'GitHub Copilot', false),
      ],
      get_platform_capabilities: {
        skills_global: true,
        skills_project: true,
        rules_global: true,
        rules_project: true,
        rules_format_global: null,
        rules_format_project: null,
        limitation_notes: [],
      },
      count_platform_entries: {
        platform_id: 'claude',
        skills: 2,
        rules: 3,
        dir_exists: true,
      },
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(screen.getByText('settings:tabs.platforms'));

    await waitFor(() =>
      expect(screen.getByText('技能 2 · 规则 3')).toBeDefined()
    );
    const disabledRow = screen.getByText('GitHub Copilot').closest('tr');
    expect(disabledRow).not.toBeNull();
    expect(within(disabledRow!).queryByText(/技能|规则/)).toBeNull();
    expect(within(disabledRow!).queryByText(/^已启用$|^未启用$/)).toBeNull();
  });

  it('shows S/S/R/R capability triggers and opens tooltip on focus/blur/Escape', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [
        {
          id: 'claude',
          name: 'Claude Code',
          enabled: true,
          adapter: 'generic',
          icon: null,
          paths: {
            global_skills_dir: '/home/.claude/skills',
            project_skills_pattern: '/home/.claude/projects/{project}/skills',
            global_rules_dir: '/home/.claude/rules',
            project_rules_pattern: null,
            global_rules_format: null,
            project_rules_format: null,
          },
        },
      ],
      get_platform_capabilities: {
        skills_global: true,
        skills_project: true,
        rules_global: true,
        rules_project: false,
        rules_format_global: null,
        rules_format_project: null,
        limitation_notes: [],
      },
      count_platform_entries: {
        platform_id: 'claude',
        skills: 2,
        rules: 3,
        dir_exists: true,
      },
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(screen.getByText('settings:tabs.platforms'));
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    await waitForCapabilityTriggers();

    const trigger = screen.getByRole('button', {
      name: '查看 Claude Code 的路径与能力',
    });
    expect(trigger.textContent).toBe('SSRR');

    fireEvent.focus(trigger);
    expect(screen.getByText('settings:platforms.capLabels.skillsGlobal')).toBeDefined();
    expect(screen.getByText('settings:platforms.capLabels.skillsProject')).toBeDefined();
    expect(screen.getByText('settings:platforms.capLabels.rulesGlobal')).toBeDefined();
    expect(screen.getByText('settings:platforms.capLabels.rulesProject')).toBeDefined();
    expect(screen.getByText('/home/.claude/skills')).toBeDefined();
    expect(screen.getByText('/home/.claude/rules')).toBeDefined();
    expect(
      screen.getByText('settings:platforms.capLabels.notSupported')
    ).toBeDefined();
    expect(screen.queryByText(/检测/i)).toBeNull();

    fireEvent.blur(trigger);
    expect(screen.queryByText('settings:platforms.capLabels.skillsGlobal')).toBeNull();

    fireEvent.focus(trigger);
    expect(screen.getByText('settings:platforms.capLabels.skillsGlobal')).toBeDefined();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByText('settings:platforms.capLabels.skillsGlobal')).toBeNull();
  });

  it('点击能力徽标后 tooltip pin 住，再次点击解除，Esc 也解除', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [
        {
          id: 'claude',
          name: 'Claude Code',
          enabled: true,
          adapter: 'generic',
          icon: null,
          paths: {
            global_skills_dir: '/Users/test/.config/opencode/skills',
            project_skills_pattern: '/Users/test/.config/opencode/projects/{project}/skills',
            global_rules_dir: '/Users/test/.config/opencode/rules',
            project_rules_pattern: null,
            global_rules_format: null,
            project_rules_format: null,
          },
        },
      ],
      get_platform_capabilities: {
        skills_global: true,
        skills_project: true,
        rules_global: true,
        rules_project: true,
        rules_format_global: null,
        rules_format_project: null,
        limitation_notes: [],
      },
      count_platform_entries: {
        platform_id: 'claude',
        skills: 2,
        rules: 3,
        dir_exists: true,
      },
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(screen.getByText('settings:tabs.platforms'));
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    await waitForCapabilityTriggers();

    const trigger = screen.getByRole('button', { name: /路径与能力/ });
    fireEvent.click(trigger);
    expect(
      screen.getByText('settings:platforms.capLabels.skillsGlobal')
    ).toBeDefined();
    fireEvent.click(trigger);
    expect(
      screen.queryByText('settings:platforms.capLabels.skillsGlobal')
    ).toBeNull();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(
      screen.queryByText('settings:platforms.capLabels.skillsGlobal')
    ).toBeNull();
  });

  it('打开 B 平台 tooltip 时 A 平台 pin 自动解除', async () => {
    const platform = (id: string, name: string) => ({
      id,
      name,
      enabled: true,
      adapter: 'generic',
      icon: null,
      paths: {
        global_skills_dir: `/Users/test/${id}/skills`,
        project_skills_pattern: `/Users/test/${id}/projects/{project}/skills`,
        global_rules_dir: `/Users/test/${id}/rules`,
        project_rules_pattern: null,
        global_rules_format: null,
        project_rules_format: null,
      },
    });
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [platform('claude', 'Claude Code'), platform('github', 'GitHub Copilot')],
      get_platform_capabilities: {
        skills_global: true,
        skills_project: true,
        rules_global: true,
        rules_project: true,
        rules_format_global: null,
        rules_format_project: null,
        limitation_notes: [],
      },
      count_platform_entries: {
        platform_id: 'claude',
        skills: 2,
        rules: 3,
        dir_exists: true,
      },
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(screen.getByText('settings:tabs.platforms'));
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    await waitForCapabilityTriggers();

    const triggers = screen.getAllByRole('button', { name: /路径与能力/ });
    fireEvent.click(triggers[0]);
    fireEvent.click(triggers[1]);
    expect(
      screen.getAllByText('settings:platforms.capLabels.skillsGlobal')
    ).toHaveLength(1);
  });

  it('点击复制按钮 → toast 出现且 tooltip 保持打开；复制值为原始真实路径', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const addToast = vi.fn();
    useAppStore.setState({ addToast });
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [
        {
          id: 'claude',
          name: 'Claude Code',
          enabled: true,
          adapter: 'generic',
          icon: null,
          paths: {
            global_skills_dir: '/Users/test/.config/opencode/skills',
            project_skills_pattern: '/Users/test/.config/opencode/projects/{project}/skills',
            global_rules_dir: '/Users/test/.config/opencode/rules',
            project_rules_pattern: null,
            global_rules_format: null,
            project_rules_format: null,
          },
        },
      ],
      get_platform_capabilities: {
        skills_global: true,
        skills_project: true,
        rules_global: true,
        rules_project: true,
        rules_format_global: null,
        rules_format_project: null,
        limitation_notes: [],
      },
      count_platform_entries: {
        platform_id: 'claude',
        skills: 2,
        rules: 3,
        dir_exists: true,
      },
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(screen.getByText('settings:tabs.platforms'));
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    await waitForCapabilityTriggers();

    fireEvent.click(
      screen.getAllByRole('button', { name: /路径与能力/ })[0]
    );
    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'settings:platforms.capLabels.copyPath',
      })[0]
    );
    expect(writeText).toHaveBeenCalledWith('/Users/test/.config/opencode/skills');
    expect(
      screen.getByText('settings:platforms.capLabels.skillsGlobal')
    ).toBeDefined();
    expect(useAppStore.getState().addToast).toHaveBeenCalledWith(
      'settings:platforms.capLabels.copied',
      'success'
    );
  });

  it('键盘聚焦（未 pin）tooltip 后 Tab 进复制按钮不关闭，复制可用，焦点离开才关闭', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const addToast = vi.fn();
    useAppStore.setState({ addToast });
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [
        {
          id: 'claude',
          name: 'Claude Code',
          enabled: true,
          adapter: 'generic',
          icon: null,
          paths: {
            global_skills_dir: '/Users/test/.config/opencode/skills',
            project_skills_pattern: '/Users/test/.config/opencode/projects/{project}/skills',
            global_rules_dir: '/Users/test/.config/opencode/rules',
            project_rules_pattern: null,
            global_rules_format: null,
            project_rules_format: null,
          },
        },
      ],
      get_platform_capabilities: {
        skills_global: true,
        skills_project: true,
        rules_global: true,
        rules_project: true,
        rules_format_global: null,
        rules_format_project: null,
        limitation_notes: [],
      },
      count_platform_entries: {
        platform_id: 'claude',
        skills: 2,
        rules: 3,
        dir_exists: true,
      },
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(screen.getByText('settings:tabs.platforms'));
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    await waitForCapabilityTriggers();

    const trigger = screen.getByRole('button', {
      name: '查看 Claude Code 的路径与能力',
    });
    fireEvent.focus(trigger);
    expect(
      screen.getByText('settings:platforms.capLabels.skillsGlobal')
    ).toBeDefined();

    // 模拟 Tab 把焦点移入 tooltip 复制按钮：trigger blur 的 relatedTarget 在 portal 内
    const copyButton = screen.getAllByRole('button', {
      name: 'settings:platforms.capLabels.copyPath',
    })[0];
    fireEvent.blur(trigger, { relatedTarget: copyButton });
    expect(
      screen.getByText('settings:platforms.capLabels.skillsGlobal')
    ).toBeDefined();

    fireEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledWith(
      '/Users/test/.config/opencode/skills'
    );
    expect(useAppStore.getState().addToast).toHaveBeenCalledWith(
      'settings:platforms.capLabels.copied',
      'success'
    );
    expect(
      screen.getByText('settings:platforms.capLabels.skillsGlobal')
    ).toBeDefined();

    // 焦点从 tooltip 移出到外部 → 关闭（外部 blur 关闭保留）
    fireEvent.blur(copyButton, { relatedTarget: document.body });
    expect(
      screen.queryByText('settings:platforms.capLabels.skillsGlobal')
    ).toBeNull();
  });

  it('tooltip 网格不再含「检测」字段与检测状态文本', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [
        {
          id: 'claude',
          name: 'Claude Code',
          enabled: true,
          adapter: 'generic',
          icon: null,
          paths: {
            global_skills_dir: '/Users/test/.config/opencode/skills',
            project_skills_pattern: '/Users/test/.config/opencode/projects/{project}/skills',
            global_rules_dir: '/Users/test/.config/opencode/rules',
            project_rules_pattern: null,
            global_rules_format: null,
            project_rules_format: null,
          },
        },
      ],
      get_platform_capabilities: {
        skills_global: true,
        skills_project: true,
        rules_global: true,
        rules_project: true,
        rules_format_global: null,
        rules_format_project: null,
        limitation_notes: [],
      },
      count_platform_entries: {
        platform_id: 'claude',
        skills: 2,
        rules: 3,
        dir_exists: true,
      },
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(screen.getByText('settings:tabs.platforms'));
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    await waitForCapabilityTriggers();

    fireEvent.click(
      screen.getAllByRole('button', { name: /路径与能力/ })[0]
    );
    expect(screen.queryByText(/检测/i)).toBeNull();
  });

  it('平台表容器不再使用 max-w-[800px] 与 overflow-hidden 外层框', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [
        {
          id: 'claude',
          name: 'Claude Code',
          enabled: true,
          adapter: 'generic',
          icon: null,
          paths: {
            global_skills_dir: '/Users/test/.config/opencode/skills',
            project_skills_pattern: '/Users/test/.config/opencode/projects/{project}/skills',
            global_rules_dir: '/Users/test/.config/opencode/rules',
            project_rules_pattern: null,
            global_rules_format: null,
            project_rules_format: null,
          },
        },
      ],
      get_platform_capabilities: {
        skills_global: true,
        skills_project: true,
        rules_global: true,
        rules_project: true,
        rules_format_global: null,
        rules_format_project: null,
        limitation_notes: [],
      },
      count_platform_entries: {
        platform_id: 'claude',
        skills: 2,
        rules: 3,
        dir_exists: true,
      },
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(screen.getByText('settings:tabs.platforms'));
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    await waitForCapabilityTriggers();

    const wrap = screen.getByTestId('platform-table-wrap');
    expect(wrap.className).not.toContain('max-w-[800px]');
    expect(wrap.className).not.toContain('overflow-hidden');
  });

  it('通用设置宽度与平台表一致（max-w-[1180px]）且两 Tab 首卡有上间距 pt-3', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/u/test/.skillforge',
        db_path: '/u/test/.skillforge/db.sqlite',
        version: '1.1.0',
      },
      get_db_size: '2.3 MB',
    });
    render(<Settings />);
    const general = screen.getByTestId('general-content');
    expect(general.className).not.toContain('max-w-[600px]');
    expect(general.className).toContain('max-w-[1180px]');
    expect(general.className).toContain('pt-3');
    fireEvent.click(screen.getByRole('tab', { name: /settings:tabs.platforms/ }));
    const platformWrap = screen.getByTestId('platform-table-wrap');
    expect(platformWrap.className).toContain('pt-3');
  });

  it('平台名称下不再显示冗余启用状态文字', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [
        {
          id: 'claude',
          name: 'Claude Code',
          enabled: true,
          adapter: 'generic',
          icon: null,
          paths: {
            global_skills_dir: '/Users/test/.config/opencode/skills',
            project_skills_pattern: '/Users/test/.config/opencode/projects/{project}/skills',
            global_rules_dir: '/Users/test/.config/opencode/rules',
            project_rules_pattern: null,
            global_rules_format: null,
            project_rules_format: null,
          },
        },
        {
          id: 'github',
          name: 'GitHub Copilot',
          enabled: false,
          adapter: 'generic',
          icon: null,
          paths: {
            global_skills_dir: '/Users/test/github/skills',
            project_skills_pattern: '/Users/test/github/projects/{project}/skills',
            global_rules_dir: null,
            project_rules_pattern: null,
            global_rules_format: null,
            project_rules_format: null,
          },
        },
      ],
      get_platform_capabilities: {
        skills_global: true,
        skills_project: true,
        rules_global: true,
        rules_project: true,
        rules_format_global: null,
        rules_format_project: null,
        limitation_notes: [],
      },
      count_platform_entries: {
        platform_id: 'claude',
        skills: 2,
        rules: 3,
        dir_exists: true,
      },
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(screen.getByText('settings:tabs.platforms'));
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    await waitForCapabilityTriggers();

    expect(screen.queryByText(/^已启用$/)).toBeNull();
    expect(screen.queryByText(/^未启用$/)).toBeNull();
  });

  it('portal tooltip 可接收鼠标事件并保持四路径 grid 对齐', async () => {
    await seedRoutes({
      get_app_config: {
        data_dir: '/d/.skillforge',
        db_path: '',
        version: '1.1.0',
      },
      get_db_size: '1.1 MB',
      list_platforms: [
        {
          id: 'claude',
          name: 'Claude Code',
          enabled: true,
          adapter: 'generic',
          icon: null,
          paths: {
            global_skills_dir: '/Users/test/.config/opencode/skills',
            project_skills_pattern: '/Users/test/.config/opencode/projects/{project}/skills',
            global_rules_dir: '/Users/test/.config/opencode/rules',
            project_rules_pattern: null,
            global_rules_format: null,
            project_rules_format: null,
          },
        },
      ],
      get_platform_capabilities: {
        skills_global: true,
        skills_project: true,
        rules_global: true,
        rules_project: true,
        rules_format_global: null,
        rules_format_project: null,
        limitation_notes: [],
      },
      count_platform_entries: {
        platform_id: 'claude',
        skills: 2,
        rules: 3,
        dir_exists: true,
      },
    });
    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText('settings:title')).toBeDefined()
    );
    fireEvent.click(screen.getByText('settings:tabs.platforms'));
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    await waitForCapabilityTriggers();

    fireEvent.mouseEnter(
      screen.getAllByRole('button', { name: /路径与能力/ })[0]
    );
    const tooltip = await screen.findByTestId('platform-path-tooltip');
    expect(tooltip.className).not.toContain('pointer-events-none');
    expect(tooltip.className).toContain('grid-cols-[76px_minmax(0,1fr)]');
  });
});
