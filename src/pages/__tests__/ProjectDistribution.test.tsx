import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { ProjectDistribution } from '../ProjectDistribution';
import { useAppStore } from '../../stores/appStore';
import { SEARCH_INPUT_CLASSES } from '../../lib/ui-tokens';
import type { Project, Platform } from '../../types';

/* Hoisted mocks */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
// 保留 DistributionWorkspace mock 以便断言项目页不再内嵌工作区（差异3）
vi.mock('../../components/DistributionWorkspace', () => ({
  DistributionWorkspace: ({
    scope,
    initialProjectId,
  }: {
    scope?: string;
    initialProjectId?: string | null;
  }) => (
    <div
      data-testid="distribution-workspace"
      data-scope={scope || 'project'}
      data-project={initialProjectId || ''}
    >
      workspace
    </div>
  ),
}));
vi.mock('react-i18next', () => {
  // 与 distribution.json 保持一致的插值模板（平台统计 chips 断言实际文案）；
  // 其余 key 沿用原始 key 返回，避免破坏既有按 key 断言的用例。
  const templates: Record<string, string> = {
    projectPlatformStatsShort: '{{platform}}：{{skills}} · {{rules}}',
    projectPlatformStatsFull: '{{platform}}：技能 {{skills}} · 规则 {{rules}}',
    'projects.statsEmpty': '暂无已分发内容',
  };
  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        let out = templates[key] ?? key;
        if (options) {
          for (const [k, v] of Object.entries(options)) {
            out = out.split(`{{${k}}}`).join(String(v));
          }
        }
        return out;
      },
      i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
    }),
  };
});

/* Simulate macOS for platform-native reveal label tests */
function setMacPlatform() {
  Object.defineProperty(window.navigator, 'platform', {
    value: 'MacIntel',
    configurable: true,
  });
}

const mkProj = (id: string, name: string): Project => ({
  id,
  name,
  path: `/tmp/${id}`,
  description: null,
  created_at: '',
  updated_at: '',
});

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

async function seedRoutes(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation(
    (cmd: string, args?: Record<string, unknown>) => {
      if (cmd in routes) {
        const route = routes[cmd];
        if (typeof route === 'function') {
          return Promise.resolve(
            (route as (a?: Record<string, unknown>) => unknown)(args)
          );
        }
        return Promise.resolve(route);
      }
      return Promise.reject(new Error(`Unexpected: ${cmd}`));
    }
  );
}

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
    activeNav: 'projectDistribution',
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

describe('ProjectDistribution', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('shows empty state when no projects exist', async () => {
    await seedRoutes({ list_projects: [], list_platforms: [] });
    render(<ProjectDistribution />);
    await waitFor(() => expect(screen.getByText('noProjects')).toBeDefined());
    expect(screen.getByText('addProject')).toBeDefined();
  });

  it('renders a pure project management list without an inline distribution workspace', async () => {
    const proj = mkProj('p-1', 'My Project');
    const plat = mkPlat('claude', 'Claude Code');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [plat],
    });
    render(<ProjectDistribution />);

    await waitFor(() => {
      const texts = screen.getAllByText('My Project');
      expect(texts.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('addProject')).toBeDefined();
    // 差异3：项目页不再内嵌 DistributionWorkspace（scope=project）
    expect(screen.queryByTestId('distribution-workspace')).toBeNull();
    // 行内重命名与「去工作区分发」快捷入口存在
    expect(screen.getByLabelText('renameProject')).toBeDefined();
    expect(screen.getByTestId('go-distribute-p-1')).toBeDefined();
  });

  it('项目名称铅笔使用共享 .action-reveal 类（默认隐藏、CSS 负责 hover/focus 显示）', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getByTestId('project-card-p-1')).toBeDefined()
    );

    const card = screen.getByTestId('project-card-p-1');
    const rename = screen.getByTestId('project-rename-p-1');
    // 整卡不得为普通 group：避免全局 .group:hover .action-reveal 在任意卡片 hover 时跨区域揭示；
    // 保留命名 group/card 语义（不匹配全局无命名 .group 选择器）。
    const cardTokens = card.className.split(/\s+/);
    expect(cardTokens).not.toContain('group');
    expect(cardTokens).toContain('group/card');
    expect(rename.className).toContain('action-reveal');
    expect(rename.className).not.toContain('opacity-0');
    expect(rename.className).not.toContain('group-hover/name');
  });

  it('作用域 hover 按钮使用共享 .action-reveal 类（整卡无命名 group，仅区域无命名 group）', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() => expect(screen.getByTestId('project-card-p-1')).toBeDefined());
    const card = screen.getByTestId('project-card-p-1');
    const nameZone = card.querySelector('[data-testid="project-name-zone-p-1"]');
    const pathZone = card.querySelector('[data-testid="project-path-zone-p-1"]');
    // 整卡：仅命名 group/card，无普通 group（.group:hover .action-reveal 不跨区域揭示）
    const cardTokens = card.className.split(/\s+/);
    expect(cardTokens).not.toContain('group');
    expect(cardTokens).toContain('group/card');
    // 名称/路径区域：各自为无命名 group（独立触发 .group:hover .action-reveal）
    const nameZoneTokens = nameZone?.className.split(/\s+/) ?? [];
    const pathZoneTokens = pathZone?.className.split(/\s+/) ?? [];
    expect(nameZoneTokens).toContain('group');
    expect(nameZoneTokens).not.toContain('group/name');
    expect(pathZoneTokens).toContain('group');
    expect(pathZoneTokens).not.toContain('group/path');

    const rename = screen.getByTestId('project-rename-p-1');
    const reveal = screen.getByTestId('project-reveal-p-1');
    expect(rename.className).toContain('action-reveal');
    expect(reveal.className).toContain('action-reveal');
    expect(rename.className).not.toContain('group-hover/name');
    expect(reveal.className).not.toContain('group-hover/path');
  });

  it('项目路径行 hover 显示目录图标，点击调用 revealPath(project.path, false)', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getByTestId('project-card-p-1')).toBeDefined()
    );

    const card = screen.getByTestId('project-card-p-1');
    const pathZone = card.querySelector('[data-testid="project-path-zone-p-1"]');
    const reveal = screen.getByTestId('project-reveal-p-1');
    expect(pathZone?.className).toContain('group');
    expect(reveal.className).toContain('action-reveal');
    expect(reveal.className).not.toContain('group-hover/path');
    fireEvent.click(reveal);
    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('reveal_path', {
      path: '/tmp/p-1',
      asSkillsDir: false,
    });
  });

  it('项目 reveal 失败 → ws.revealFailed toast', async () => {
    const proj = mkProj('p-1', 'My Project');
    // seedRoutes 对未映射命令（含 reveal_path）默认 reject，失败分支由此触发。
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getByTestId('project-card-p-1')).toBeDefined()
    );
    fireEvent.click(screen.getByTestId('project-reveal-p-1'));
    await waitFor(() => {
      const { toasts } = useAppStore.getState();
      // i18n mock 返回 raw key，toast message 即为 'ws.revealFailed'
      expect(
        toasts.some((t) => t.message === 'ws.revealFailed' && t.type === 'error')
      ).toBe(true);
    });
  });

  it('项目 reveal 返回 fallback=true → ws.revealFallback info toast', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    // 等统计请求 settle，避免 mockResolvedValueOnce 被 count_platform_entries 抢先消费
    await waitFor(() =>
      expect(screen.getByTestId('project-stats-empty')).toBeDefined()
    );

    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValueOnce({
      revealed_path: '/tmp/p-1',
      fallback: true,
    });
    fireEvent.click(screen.getByTestId('project-reveal-p-1'));
    await waitFor(() => {
      const { toasts } = useAppStore.getState();
      expect(
        toasts.some(
          (t) => t.message === 'ws.revealFallback' && t.type === 'info'
        )
      ).toBe(true);
    });
  });

  it('reveal 按钮 aria-label 按平台显示（Mac → ws.revealMac）', async () => {
    setMacPlatform();
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getByTestId('project-reveal-p-1')).toBeDefined()
    );
    expect(screen.getByLabelText('ws.revealMac')).toBeDefined();
  });

  it('「去工作区分发」carries the project context and navigates to the distribution workspace', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getByTestId('go-distribute-p-1')).toBeDefined()
    );

    fireEvent.click(screen.getByTestId('go-distribute-p-1'));
    expect(useAppStore.getState().projectDistSelectedProjectId).toBe('p-1');
    expect(useAppStore.getState().activeNav).toBe('globalDistribution');
  });

  it('opens AddProjectDialog to add a project', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const existing = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [existing],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() => expect(screen.getByText('addProject')).toBeDefined());

    fireEvent.click(screen.getByText('addProject'));
    await waitFor(() =>
      expect(screen.getByText('addProjectDialog.title')).toBeDefined()
    );
    // Dialog opened without calling add_project yet
    expect(invoke).not.toHaveBeenCalledWith('add_project', expect.anything());
  });

  it('renames a project inline via ipc.renameProject', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const proj = mkProj('p-1', 'Old Name');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
      rename_project: { ...proj, name: 'New Name' },
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('Old Name').length).toBeGreaterThanOrEqual(1)
    );

    fireEvent.click(screen.getByLabelText('renameProject'));
    await waitFor(() => {
      const input = document.querySelector(
        'input[data-testid="rename-input"]'
      ) as HTMLInputElement;
      expect(input).toBeDefined();
    });
    const input = document.querySelector(
      'input[data-testid="rename-input"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('rename_project', expect.anything())
    );
  });

  it('does not render inline delete button (batch-only deletion)', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('My Project').length).toBeGreaterThanOrEqual(1)
    );
    expect(screen.queryByLabelText('deleteProject')).toBeNull();
  });

  it('batch controls are hidden by default; toggle arms compact bar and reveals row checkboxes', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('My Project').length).toBeGreaterThanOrEqual(1)
    );

    // 默认隐藏：无批量栏、无复选框
    expect(screen.queryByText('common:batch.guide')).toBeNull();
    expect(screen.queryByTestId('batch-check-p-1')).toBeNull();

    // 开启批量模式 → armed 紧凑栏 + 行内复选框出现（无需打开下拉）
    fireEvent.click(screen.getByLabelText('batchMode'));
    expect(screen.getByText('common:batch.guide')).toBeDefined();
    expect(screen.getByText('common:batch.exit')).toBeDefined();
    await waitFor(() =>
      expect(screen.getByTestId('batch-check-p-1')).toBeDefined()
    );
  });

  it('selecting projects shows count + delete/clear/exit actions', async () => {
    const proj1 = mkProj('p-1', 'Alpha');
    const proj2 = mkProj('p-2', 'Beta');
    await seedRoutes({
      list_projects: [proj1, proj2],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('Alpha').length).toBeGreaterThanOrEqual(1)
    );

    fireEvent.click(screen.getByLabelText('batchMode'));
    await waitFor(() =>
      expect(screen.getByTestId('batch-check-p-1')).toBeDefined()
    );
    fireEvent.click(screen.getByTestId('batch-check-p-1'));
    fireEvent.click(screen.getByTestId('batch-check-p-2'));

    expect(screen.getByText('common:messages.selectedCount')).toBeDefined();
    expect(screen.getByText('common:batch.delete')).toBeDefined();
    expect(screen.getByText('common:actions.cancelSelect')).toBeDefined();
    expect(screen.getByText('common:batch.exit')).toBeDefined();
  });

  it('clear selection returns to armed state (keeps batch mode)', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('My Project').length).toBeGreaterThanOrEqual(1)
    );

    fireEvent.click(screen.getByLabelText('batchMode'));
    await waitFor(() =>
      expect(screen.getByTestId('batch-check-p-1')).toBeDefined()
    );
    fireEvent.click(screen.getByTestId('batch-check-p-1'));
    expect(screen.getByText('common:messages.selectedCount')).toBeDefined();

    fireEvent.click(screen.getByText('common:actions.cancelSelect'));
    expect(screen.getByText('common:batch.guide')).toBeDefined();
    expect(screen.queryByText('common:batch.delete')).toBeNull();
  });

  it('exit hides batch controls and clears selection', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('My Project').length).toBeGreaterThanOrEqual(1)
    );

    fireEvent.click(screen.getByLabelText('batchMode'));
    await waitFor(() =>
      expect(screen.getByTestId('batch-check-p-1')).toBeDefined()
    );
    fireEvent.click(screen.getByTestId('batch-check-p-1'));

    fireEvent.click(screen.getByText('common:batch.exit'));
    expect(screen.queryByText('common:batch.guide')).toBeNull();
    expect(screen.queryByText('common:messages.selectedCount')).toBeNull();
  });

  it('batch delete shows confirmation with non-filesystem message and selected names summary', async () => {
    const proj1 = mkProj('p-1', 'Alpha');
    const proj2 = mkProj('p-2', 'Beta');
    await seedRoutes({
      list_projects: [proj1, proj2],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('Alpha').length).toBeGreaterThanOrEqual(1)
    );

    fireEvent.click(screen.getByLabelText('batchMode'));
    await waitFor(() =>
      expect(screen.getByTestId('batch-check-p-1')).toBeDefined()
    );
    fireEvent.click(screen.getByTestId('batch-check-p-1'));
    fireEvent.click(screen.getByTestId('batch-check-p-2'));

    fireEvent.click(screen.getByText('common:batch.delete'));
    expect(screen.getByText('batchDeleteTitle')).toBeDefined();
    expect(screen.getByText('batchDeleteMessage')).toBeDefined();
    expect(screen.getByText('batchDeleteSummary')).toBeDefined();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Alpha')).toBeDefined();
    expect(within(dialog).getByText('Beta')).toBeDefined();
  });

  it('confirming batch delete removes each selected project and exits batch mode', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const proj1 = mkProj('p-1', 'Alpha');
    const proj2 = mkProj('p-2', 'Beta');
    await seedRoutes({
      list_projects: [proj1, proj2],
      list_platforms: [mkPlat('claude', 'Claude Code')],
      remove_project: {},
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('Alpha').length).toBeGreaterThanOrEqual(1)
    );

    fireEvent.click(screen.getByLabelText('batchMode'));
    await waitFor(() =>
      expect(screen.getByTestId('batch-check-p-1')).toBeDefined()
    );
    fireEvent.click(screen.getByTestId('batch-check-p-1'));
    fireEvent.click(screen.getByTestId('batch-check-p-2'));

    fireEvent.click(screen.getByText('common:batch.delete'));
    fireEvent.click(screen.getByText('batchDeleteConfirm'));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('remove_project', { id: 'p-1' })
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('remove_project', { id: 'p-2' })
    );
    // 删除后退出批量模式，紧凑栏隐藏
    await waitFor(() =>
      expect(screen.queryByText('common:messages.selectedCount')).toBeNull()
    );
  });

  it('filters the project list with the toolbar search', async () => {
    const proj1 = mkProj('p-1', 'Alpha');
    const proj2 = mkProj('p-2', 'Beta');
    await seedRoutes({
      list_projects: [proj1, proj2],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('Alpha').length).toBeGreaterThanOrEqual(1)
    );

    const search = screen.getByPlaceholderText('common:actions.searchProjects');
    fireEvent.change(search, { target: { value: 'Beta' } });
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Beta')).toBeDefined();
  });

  it('项目搜索框使用共享 SEARCH_INPUT_CLASSES 令牌', async () => {
    const proj = mkProj('p-1', 'Alpha');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('Alpha').length).toBeGreaterThanOrEqual(1)
    );
    const search = screen.getByPlaceholderText('common:actions.searchProjects');
    expect(search.className).toContain(SEARCH_INPUT_CLASSES.split(' ')[0]);
    for (const token of SEARCH_INPUT_CLASSES.split(' ')) {
      expect(search.className).toContain(token);
    }
  });

  it('does not render a managed badge after the project name', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('My Project').length).toBeGreaterThanOrEqual(1)
    );
    expect(screen.queryByText('managedProjectBadge')).toBeNull();
  });

  it('title row right side shows batch then add actions; search sits on the next line', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getAllByText('My Project').length).toBeGreaterThanOrEqual(1)
    );

    const actions = screen.getByTestId('project-page-actions');
    const buttons = within(actions).getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-label', 'batchMode');
    expect(within(buttons[1]).getByText('addProject')).toBeDefined();
    // 搜索框不在此行内，位于标题行下方独立一行
    expect(
      within(actions).queryByPlaceholderText('common:actions.searchProjects')
    ).toBeNull();
    expect(
      screen.getByPlaceholderText('common:actions.searchProjects')
    ).toBeDefined();
  });

  it('renders per-project × per-enabled-platform stats chips with distinct content and full titles', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [
        mkPlat('claude', 'Claude Code'),
        mkPlat('cursor', 'Cursor'),
      ],
      // 各平台返回不同统计：若 claude/cursor 内容串线，相同值无法暴露，必须差异化
      count_platform_entries: async (p: { platformId: string }) => {
        if (p.platformId === 'claude') {
          return { platform_id: 'claude', skills: 2, rules: 1, dir_exists: true };
        }
        return { platform_id: 'cursor', skills: 5, rules: 3, dir_exists: true };
      },
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getByTestId('project-stats-chip-claude')).toBeDefined()
    );
    const claude = screen.getByTestId('project-stats-chip-claude');
    const cursor = screen.getByTestId('project-stats-chip-cursor');
    // 可见 body 仅短文案：{{platform}}：N · N（误渲染完整文案会在此失败）
    expect(claude.textContent).toBe('Claude Code：2 · 1');
    expect(cursor.textContent).toBe('Cursor：5 · 3');
    // title 为完整文案：{{platform}}：技能 N · 规则 N（缺失/截断会在此失败）
    expect(claude.getAttribute('title')).toBe('Claude Code：技能 2 · 规则 1');
    expect(cursor.getAttribute('title')).toBe('Cursor：技能 5 · 规则 3');
  });

  it('shows a localized empty state when no platform has distributed content', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
      count_platform_entries: {
        platform_id: 'claude',
        skills: 0,
        rules: 0,
        dir_exists: false,
      },
    });
    render(<ProjectDistribution />);
    await waitFor(() =>
      expect(screen.getByTestId('project-stats-empty')).toBeDefined()
    );
    // 空状态文案来自 distribution namespace 的 projects.statsEmpty
    expect(screen.getByText('暂无已分发内容')).toBeDefined();
    expect(screen.queryByTestId(/project-stats-chip-/)).toBeNull();
  });

  it('平台统计渲染为 chips：可见仅内容「{{platform}}：N · N」、title 完整「技能 N · 规则 N」', async () => {
    const proj = mkProj('p-1', 'My Project');
    const plat = mkPlat('claude', 'Claude Code');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [plat],
      count_platform_entries: { platform_id: 'claude', skills: 2, rules: 1, dir_exists: true },
    });
    render(<ProjectDistribution />);
    await waitFor(() => expect(screen.getByTestId('project-stats-chip-claude')).toBeDefined());
    const chip = screen.getByTestId('project-stats-chip-claude');
    expect(chip.textContent).toContain('2');
    expect(chip.textContent).toContain('1');
    expect(chip.getAttribute('title')).toContain('技能 2');
    expect(chip.getAttribute('title')).toContain('规则 1');
    expect(chip.className).toContain('rounded-md');
    expect(chip.className).toContain('border');
  });

  it('dirExists=false 或双零平台不渲染 chip', async () => {
    const proj = mkProj('p-1', 'My Project');
    const a = mkPlat('a', 'A'); const b = mkPlat('b', 'B'); const c = mkPlat('c', 'C');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [a, b, c],
      // a: 无目录；b: 双零；c: 有内容
      count_platform_entries: async (p: { platformId: string }) => {
        if (p.platformId === 'a') return { platform_id: 'a', skills: 0, rules: 0, dir_exists: false };
        if (p.platformId === 'b') return { platform_id: 'b', skills: 0, rules: 0, dir_exists: true };
        return { platform_id: 'c', skills: 3, rules: 0, dir_exists: true };
      },
    });
    render(<ProjectDistribution />);
    await waitFor(() => expect(screen.getByTestId('project-stats-chip-c')).toBeDefined());
    expect(screen.queryByTestId('project-stats-chip-a')).toBeNull();
    expect(screen.queryByTestId('project-stats-chip-b')).toBeNull();
  });

  it('全部平台无内容 → 显示空状态且无 chip', async () => {
    const proj = mkProj('p-1', 'My Project');
    await seedRoutes({
      list_projects: [proj],
      list_platforms: [mkPlat('claude', 'Claude Code')],
      count_platform_entries: { platform_id: 'claude', skills: 0, rules: 0, dir_exists: false },
    });
    render(<ProjectDistribution />);
    await waitFor(() => expect(screen.getByTestId('project-stats-empty')).toBeDefined());
    expect(screen.queryByTestId(/project-stats-chip-/)).toBeNull();
  });
});
