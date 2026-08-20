import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import {
  DistributionWorkspace,
  resolveRevealAsSkillsDir,
  resolveStep1PathDisplay,
} from '../DistributionWorkspace';
import { useAppStore } from '../../stores/appStore';
import { SELECT_CLASSES } from '../../lib/ui-tokens';
import type { Platform, Project, Scene, Rule, Skill } from '../../types';
import { invoke } from '@tauri-apps/api/core';

/* Hoisted mocks */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'ws.sourceFromScene') {
        return `来自场景：${params?.name ?? ''}`;
      }
      if (key === 'ws.managed.pendingRemove') {
        return `当前待移除 ${params?.count ?? 0} 项（进入计划后二次确认才执行）`;
      }
      if (key === 'ws.managed.sectionSkills') {
        return `技能（${params?.count ?? 0}）`;
      }
      if (key === 'ws.managed.sectionRules') {
        return `规则（${params?.count ?? 0}）`;
      }
      if (key === 'ws.managedToggle') {
        return '查看此目标已分发内容';
      }
      if (key === 'ws.managedToggleHide') {
        return '收起当前已分发内容';
      }
      if (key === 'ws.managed.confirmRemove') {
        return `确认移除 ${params?.count ?? 0} 项`;
      }
      if (key === 'ws.removeConfirm.title') {
        return '确认移除受管内容';
      }
      if (key === 'ws.removeConfirm.desc') {
        return '仅移除 SkillForge 受管副本，资源库保留可重新分发恢复';
      }
      if (key === 'ws.removeConfirm.confirm') {
        return '确认移除';
      }
      if (key === 'ws.removeConfirm.cancel') {
        return '取消';
      }
      if (key === 'ws.removeResult.success') {
        return `已移除 ${params?.count ?? 0} 项`;
      }
      if (key === 'ws.removeResult.failed') {
        return '移除失败，可重试';
      }
      if (key === 'ws.removeResult.partial') {
        return `部分失败：已移除 ${params?.removed ?? 0} 项，失败 ${params?.failed ?? 0} 项`;
      }
      if (key === 'ws.removeResult.targetChanged') {
        return '移除目标已变化或不再受管，请重新扫描';
      }
      // T5（33 号 3.4 / A3）：全选/清空文案，供 aria-label 断言
      if (key === 'ws.selectAllSkills') {
        return '全选技能';
      }
      if (key === 'ws.selectAllRules') {
        return '全选规则';
      }
      if (key === 'ws.clearAll') {
        return '清空';
      }
      // T6（33 号 3.5 / P0-1）：Step3 计划标题已中文化，不再以原始 key 为期望
      if (key === 'ws.planTitle') {
        return '计划明细';
      }
      // T7（33 号 3.6 / A5 / P0-2）：结果指标中文化 + 返回工作区
      // 注：ws.backToWorkspace 被 mock 为中文「返回工作区」，按钮断言必须用 mock 输出
      //     `{ name: '返回工作区' }`（不可用原始 key `'ws.backToWorkspace'`）。
      if (key === 'ws.resultInstalled') return '已安装';
      if (key === 'ws.resultUpdated') return '已更新';
      if (key === 'ws.resultRemoved') return '已移除';
      if (key === 'ws.resultSkipped') return '已跳过';
      if (key === 'ws.resultErrors') return '错误';
      if (key === 'ws.backToWorkspace') return '返回工作区';
      return key;
    },
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

/* Simulate macOS for platform-native reveal label tests */
function setMacPlatform() {
  Object.defineProperty(window.navigator, 'platform', {
    value: 'MacIntel',
    configurable: true,
  });
}

/* Factories */
const mkPlat = (id: string, name: string, enabled = true): Platform => ({
  id,
  name,
  enabled,
  adapter: 'generic',
  icon: null,
  paths: {
    global_skills_dir: `/home/.${id}/skills`,
    project_skills_pattern: `{project}/.${id}/skills`,
    global_rules_dir: `/home/.${id}/rules`,
    project_rules_pattern: null,
    global_rules_format: null,
    project_rules_format: null,
  },
  capabilities: {
    skills_global: true,
    skills_project: true,
    rules_global: true,
    rules_project: false,
    rules_format_global: { Directory: null },
    rules_format_project: null,
    limitation_notes: [],
  },
});

const mkProj = (id: string, name: string): Project => ({
  id,
  name,
  path: `/tmp/${id}`,
  description: null,
  created_at: '',
  updated_at: '',
});

const mkSkill = (id: string, name: string): Skill => ({
  id,
  name,
  description: null,
  source_type: 'custom',
  source_url: null,
  current_ver: null,
  installed_at: '',
  local_path: '',
  metadata: null,
});

const mkRule = (id: string, name: string): Rule => ({
  id,
  name,
  description: null,
  format: 'md',
  content: '# x',
  platform: null,
  scope: 'global',
  version: 1,
  updated_at: '',
});

const mkScene = (id: string, name: string): Scene => ({
  id,
  name,
  description: null,
  icon: null,
  is_template: false,
  is_system: false,
  created_at: '',
  updated_at: '',
});

const mkPlan = (overrides: Record<string, unknown> = {}) => ({
  platforms: [
    {
      platform_id: 'claude-code',
      platform_name: 'Claude Code',
      skills_to_add: ['s1'],
      skills_to_update: [],
      skills_to_remove: [],
      rules_to_add: [],
      rules_to_update: [],
      rules_to_remove: [],
    },
  ],
  has_removals: false,
  ...overrides,
});

const mkResult = (overrides: Record<string, unknown> = {}) => ({
  installed: ['s1'],
  updated: [],
  removed: [],
  errors: [],
  ...overrides,
});

/* Helpers */
async function setupInvoke(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) {
      const value = routes[cmd];
      return typeof value === 'function'
        ? Promise.resolve(value())
        : Promise.resolve(value);
    }
    return Promise.reject(new Error(`Unknown: ${cmd}`));
  });
}

function seedStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    skills: [mkSkill('s1', 'React'), mkSkill('s2', 'Vue')],
    rules: [mkRule('r1', 'Style'), mkRule('r2', 'Lint')],
    tags: [],
    scenes: [],
    projects: [mkProj('p-1', 'My Project')],
    platforms: [mkPlat('claude-code', 'Claude Code')],
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
    ...overrides,
  });
}

function baseRoutes() {
  return {
    list_platforms: [mkPlat('claude-code', 'Claude Code')],
    list_projects: [mkProj('p-1', 'My Project')],
    list_skills: [mkSkill('s1', 'React'), mkSkill('s2', 'Vue')],
    list_rules: [mkRule('r1', 'Style'), mkRule('r2', 'Lint')],
    list_scenes: [mkScene('scene-1', 'React 基础')],
    get_scene_detail: {
      scene: { id: 'scene-1', name: 'React 基础' },
      skills: [
        {
          skill_id: 's1',
          skill_name: 'React',
          enabled: true,
          sort_order: 0,
          version: null,
        },
      ],
      rules: [
        { rule_id: 'r1', rule_name: 'Style', enabled: true, sort_order: 0 },
      ],
    },
  };
}

async function waitForPlanReady() {
  await waitFor(() =>
    expect(screen.getByTestId('ws-step3-skills-path')).toBeDefined()
  );
}

async function waitForStep2() {
  await waitFor(() =>
    expect(screen.getByLabelText('ws.sourceLabel')).toBeDefined()
  );
}

describe('DistributionWorkspace', () => {
  beforeEach(() => {
    seedStore();
    vi.clearAllMocks();
  });

  it('renders the four-step stepper (选择目标/选择资源/确认计划/查看结果)', async () => {
    await setupInvoke({
      ...baseRoutes(),
      preview_distribution: mkPlan(),
      execute_distribution: mkResult(),
    });
    render(<DistributionWorkspace />);
    await waitFor(() =>
      expect(screen.getByText('ws.step1.title')).toBeDefined()
    );
    expect(screen.getByText('ws.step2.title')).toBeDefined();
    expect(screen.getByText('ws.step3.title')).toBeDefined();
    expect(screen.getByText('ws.step4.title')).toBeDefined();
  });

  it('stepper 四步之间渲染连接线', async () => {
    await setupInvoke({
      ...baseRoutes(),
      preview_distribution: mkPlan(),
      execute_distribution: mkResult(),
    });
    const { container } = render(<DistributionWorkspace />);
    await waitFor(() =>
      expect(screen.getByText('ws.step1.title')).toBeDefined()
    );
    expect(
      container.querySelectorAll('[data-testid="ws-step-connector"]')
    ).toHaveLength(3);
  });

  it('Step1 操作区仅「下一步」，无「上一步」；Step2 保留「上一步」', async () => {
    await setupInvoke({
      ...baseRoutes(),
      preview_distribution: mkPlan(),
      execute_distribution: mkResult(),
    });
    render(<DistributionWorkspace />);
    await waitFor(() =>
      expect(screen.getByText('ws.step1.title')).toBeDefined()
    );
    expect(
      screen.queryByRole('button', { name: /ws.backStep|上一步/i })
    ).toBeNull();
    fireEvent.click(screen.getByText('ws.nextToResources'));
    await waitForStep2();
    expect(
      screen.getByRole('button', { name: /ws.backStep|上一步/i })
    ).toBeDefined();
  });

  it('workspace-actions 操作区容器支持 flex-wrap（窄屏可换行）', async () => {
    await setupInvoke({
      ...baseRoutes(),
      preview_distribution: mkPlan(),
      execute_distribution: mkResult(),
    });
    const { container } = render(<DistributionWorkspace />);
    await waitFor(() =>
      expect(screen.getByText('ws.step1.title')).toBeDefined()
    );
    const step1Actions = container.querySelector(
      '[data-testid="ws-step1-actions"]'
    );
    expect(step1Actions).not.toBeNull();
    expect(step1Actions?.className).toContain('flex-wrap');
  });

  it('shows empty state when no enabled platforms exist', async () => {
    seedStore({
      platforms: [mkPlat('claude-code', 'Claude Code', false)],
      projects: [],
    });
    await setupInvoke({
      ...baseRoutes(),
      list_platforms: [mkPlat('claude-code', 'Claude Code', false)],
    });
    render(<DistributionWorkspace />);
    await waitFor(() =>
      expect(screen.getByText('ws.emptyTitle')).toBeDefined()
    );
    expect(screen.getByText('ws.goSettings')).toBeDefined();
  });

  describe('initialization failure', () => {
    it('reaches error state when a required fetch fails, and retry re-runs initialization', async () => {
      seedStore({ platforms: [], projects: [] });
      const { invoke } = await import('@tauri-apps/api/core');
      let platformsDown = true;
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === 'list_platforms' && platformsDown) {
          return Promise.reject(new Error('platforms down'));
        }
        if (cmd in baseRoutes()) {
          return Promise.resolve(
            (baseRoutes() as Record<string, unknown>)[cmd]
          );
        }
        return Promise.reject(new Error(`Unknown: ${cmd}`));
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.errorTitle')).toBeDefined()
      );
      expect(screen.queryByText('ws.emptyTitle')).toBeNull();

      platformsDown = false;
      fireEvent.click(screen.getByText('ws.retryLoad'));
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      expect(screen.queryByText('ws.errorTitle')).toBeNull();
    });
  });

  describe('step 1 — target', () => {
    it('offers unified global/project target dropdown plus separate platform select and read-only target path', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );

      // Unified target dropdown
      const targetSelect = screen.getByLabelText(
        'ws.targetLabel'
      ) as HTMLSelectElement;
      expect(targetSelect).toBeDefined();
      const optgroupLabels = Array.from(
        targetSelect.querySelectorAll('optgroup')
      ).map((g) => g.label);
      expect(optgroupLabels).toContain('ws.targetGlobal');
      expect(optgroupLabels).toContain('ws.targetProject');
      expect(
        within(targetSelect as HTMLElement).getByText('ws.targetGlobalOption')
      ).toBeDefined();
      expect(
        within(targetSelect as HTMLElement).getByText(/My Project/)
      ).toBeDefined();

      // Separate platform select
      const platformSelect = screen.getByLabelText('ws.platformLabel');
      expect(platformSelect).toBeDefined();
      expect(screen.getByText('Claude Code')).toBeDefined();

      // Read-only Skills/Rules target paths
      expect(screen.getByText('ws.skillsPathLabel')).toBeDefined();
      expect(screen.getByText('ws.rulesPathLabel')).toBeDefined();
    });

    it('工作区 select 使用共享 SELECT_CLASSES 令牌', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByTestId('dist-platform')).toBeDefined()
      );
      const wsSelect = screen.getByTestId('dist-platform');
      expect(wsSelect.className).toContain(SELECT_CLASSES.split(' ')[0]);
      for (const token of SELECT_CLASSES.split(' ')) {
        expect(wsSelect.className).toContain(token);
      }
    });

    it('Step 1 渲染 Skills/Rules 双只读路径', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByLabelText('ws.targetLabel')).toBeDefined()
      );
      expect(screen.getByTestId('ws-skills-path')).toBeDefined();
      expect(screen.getByTestId('ws-rules-path')).toBeDefined();
    });

    it('项目目标下 Rules 路径按 project_rules_pattern 解析为平台内相对路径', async () => {
      const proj = mkProj('p-1', 'My Project');
      const plat: Platform = {
        ...mkPlat('claude-code', 'Claude Code'),
        paths: {
          ...mkPlat('claude-code', 'Claude Code').paths,
          project_rules_pattern: '{project}/.cursor/rules',
        },
      };
      seedStore({ projects: [proj], platforms: [plat] });
      await setupInvoke({
        ...baseRoutes(),
        list_projects: [proj],
        list_platforms: [plat],
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByLabelText('ws.targetLabel')).toBeDefined()
      );
      fireEvent.change(screen.getByLabelText('ws.targetLabel'), {
        target: { value: 'project:p-1' },
      });
      // 33 号 A1：Step1 项目目标下剥离 {project}/ 前缀显示平台内相对路径
      expect(screen.getByTestId('ws-rules-path').textContent).toBe(
        '.cursor/rules'
      );
    });

    it('Rules 单文件模式下显示单文件合并提示', async () => {
      const plat: Platform = {
        ...mkPlat('claude-code', 'Claude Code'),
        paths: {
          ...mkPlat('claude-code', 'Claude Code').paths,
          global_rules_format: { SingleFile: { file_name: 'CLAUDE.md' } },
        },
      };
      seedStore({ platforms: [plat] });
      await setupInvoke({
        ...baseRoutes(),
        list_platforms: [plat],
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByLabelText('ws.targetLabel')).toBeDefined()
      );
      expect(screen.getByText('ws.rulesSingleFileHint')).toBeDefined();
    });

    it('updates the read-only target path when switching to a project', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByLabelText('ws.targetLabel')).toBeDefined()
      );

      const globalPath = screen.getByTestId('ws-skills-path').textContent;
      fireEvent.change(screen.getByLabelText('ws.targetLabel'), {
        target: { value: 'project:p-1' },
      });
      const projectPath = screen.getByTestId('ws-skills-path').textContent;
      expect(projectPath).not.toBe(globalPath);
      // 33 号 A1：项目目标下显示平台内相对路径（不再含 /tmp/p-1 前缀）
      expect(projectPath).toContain('.claude-code/skills');
      expect(projectPath).not.toContain('/tmp/p-1');
    });

    it('preserves the backend project skills pattern "skills" segment for project targets', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByLabelText('ws.targetLabel')).toBeDefined()
      );

      // Regression: {project} substitution must keep the "skills" segment in the Step1 relative display
      fireEvent.change(screen.getByLabelText('ws.targetLabel'), {
        target: { value: 'project:p-1' },
      });
      expect(screen.getByTestId('ws-skills-path').textContent).toBe(
        '.claude-code/skills'
      );
    });

    it('carries a project target from the projects page (去工作区分发) as the initial target and clears it after consumption', async () => {
      seedStore({ projectDistSelectedProjectId: 'p-1' });
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByLabelText('ws.targetLabel')).toBeDefined()
      );

      const targetSelect = screen.getByLabelText(
        'ws.targetLabel'
      ) as HTMLSelectElement;
      expect(targetSelect.value).toBe('project:p-1');
      // 消费后清除，使后续直接进入工作区时默认回到全局目标
      expect(useAppStore.getState().projectDistSelectedProjectId).toBeNull();
      // 33 号 A1：项目目标下 Step1 显示平台内相对路径
      expect(screen.getByTestId('ws-skills-path').textContent).toContain(
        '.claude-code/skills'
      );
    });

    it('falls back to global when the carried project no longer exists and clears it', async () => {
      seedStore({ projectDistSelectedProjectId: 'ghost' });
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByLabelText('ws.targetLabel')).toBeDefined()
      );

      const targetSelect = screen.getByLabelText(
        'ws.targetLabel'
      ) as HTMLSelectElement;
      expect(targetSelect.value).toBe('global');
      expect(useAppStore.getState().projectDistSelectedProjectId).toBeNull();
    });

    it('regenerates the plan for the new target after the target changes', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      expect(screen.getByTestId('ws-step3-skills-path')).toBeDefined();

      fireEvent.click(screen.getByText('ws.backStep'));
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.backStep'));
      await waitFor(() =>
        expect(screen.getByLabelText('ws.targetLabel')).toBeDefined()
      );
      // 2d：回到 Step1 后不应再有「上一步」按钮
      expect(
        screen.queryByRole('button', { name: /ws.backStep|上一步/i })
      ).toBeNull();

      fireEvent.change(screen.getByLabelText('ws.targetLabel'), {
        target: { value: 'project:p-1' },
      });
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();

      const previewCalls = (invoke as any).mock.calls.filter(
        (c: string[]) => c[0] === 'preview_distribution'
      );
      const lastSelection = previewCalls[previewCalls.length - 1][1];
      expect(lastSelection.scope).toBe('project');
      expect(lastSelection.projectId).toBe('p-1');
      // Step3 已移除通用「目标路径」摘要，路径仅出现于 skills-path / rules-path 行
      expect(
        screen.getAllByText('/tmp/p-1/.claude-code/skills').length
      ).toBeGreaterThan(0);
    });

    it('blocks advancing when the project target no longer exists', async () => {
      seedStore({ projects: [mkProj('p-1', 'My Project')] });
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(
        <DistributionWorkspace scope="project" initialProjectId="ghost" />
      );
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      expect(screen.getByTestId('ws-skills-path').textContent).toBe(
        'ws.pathUnavailable'
      );

      fireEvent.click(screen.getByText('ws.nextToResources'));
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes('ws.targetProjectMissing'))
      ).toBe(true);
      expect(screen.getByText('ws.step1.title')).toBeDefined();
      expect(screen.queryByLabelText('ws.sourceLabel')).toBeNull();
    });

    it('blocks advancing when the selected project has an empty path', async () => {
      const emptyPathProj = { ...mkProj('p-empty', 'No Path'), path: '' };
      seedStore({ projects: [emptyPathProj] });
      await setupInvoke({
        ...baseRoutes(),
        list_projects: [emptyPathProj],
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByLabelText('ws.targetLabel')).toBeDefined()
      );

      fireEvent.change(screen.getByLabelText('ws.targetLabel'), {
        target: { value: 'project:p-empty' },
      });
      fireEvent.click(screen.getByText('ws.nextToResources'));
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes('ws.targetProjectMissing'))
      ).toBe(true);
      expect(screen.getByText('ws.step1.title')).toBeDefined();
      expect(screen.queryByLabelText('ws.sourceLabel')).toBeNull();
    });

    it('blocks advancing when the global target path is unavailable', async () => {
      const brokenPlat: Platform = {
        ...mkPlat('claude-code', 'Claude Code'),
        paths: {
          ...mkPlat('claude-code', 'Claude Code').paths,
          global_skills_dir: '',
        },
      };
      seedStore({ platforms: [brokenPlat] });
      await setupInvoke({
        ...baseRoutes(),
        list_platforms: [brokenPlat],
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      expect(screen.getByText('ws.pathUnavailable')).toBeDefined();

      fireEvent.click(screen.getByText('ws.nextToResources'));
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes('ws.pathUnavailable'))
      ).toBe(true);
      expect(screen.getByText('ws.step1.title')).toBeDefined();
      expect(screen.queryByLabelText('ws.sourceLabel')).toBeNull();
    });

    it('managed content toggle fetches managed state and reveals platform-native action', async () => {
      setMacPlatform();
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [{ id: 'r1', path: '/home/.claude-code/rules/Style.md' }],
              local_skills: [
                {
                  name: 'user-skill',
                  path: '/home/.claude-code/skills/user-skill',
                },
              ],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );

      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      await waitFor(() =>
        expect(screen.getByText('ws.managedPanelTitle')).toBeDefined()
      );
      expect(screen.getByText('ws.revealMac')).toBeDefined();
      expect(screen.getByText('技能（1）')).toBeDefined();
      expect(screen.getByText('规则（1）')).toBeDefined();
      expect(screen.getByText('user-skill')).toBeDefined();
    });

    it('折叠入口含 Chevron 方向 + aria-expanded/aria-controls + 200ms 旋转动画', async () => {
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      const btn = screen.getByRole('button', { name: /查看|收起/ });
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(btn.getAttribute('aria-controls')).toBe('ws-managed-panel');
      // 收起态：恒渲染 ChevronDown；ShieldCheck 保留；wrapper 有旋转过渡但未旋转
      expect(btn.querySelector('svg.lucide-shield-check')).not.toBeNull();
      const downClosed = btn.querySelector('svg.lucide-chevron-down');
      expect(downClosed).not.toBeNull();
      expect(downClosed?.parentElement?.className).toContain(
        'transition-transform'
      );
      expect(downClosed?.parentElement?.className).toContain('duration-200');
      expect(downClosed?.parentElement?.className).not.toContain('rotate-180');
      fireEvent.click(btn);
      await waitFor(() => {
        const panel = screen.getByTestId('ws-managed-panel');
        expect(panel.getAttribute('id')).toBe('ws-managed-panel');
      });
      const openBtn = screen.getByRole('button', { name: /查看|收起/ });
      expect(openBtn.getAttribute('aria-expanded')).toBe('true');
      // 展开态：仍渲染 ChevronDown，wrapper rotate-180（向下图标旋转 180° 指向上方）
      const downOpen = openBtn.querySelector('svg.lucide-chevron-down');
      expect(downOpen).not.toBeNull();
      expect(downOpen?.parentElement?.className).toContain(
        'transition-transform'
      );
      expect(downOpen?.parentElement?.className).toContain('duration-200');
      expect(downOpen?.parentElement?.className).toContain('rotate-180');
    });

    it('全局目标点击「在访达中显示」→ invoke reveal_path(path, asSkillsDir=true)', async () => {
      setMacPlatform();
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        reveal_path: { revealed_path: '/home/.claude-code', fallback: false },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      await waitFor(() =>
        expect(screen.getByText('ws.revealMac')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.revealMac'));
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('reveal_path', {
          path: '/home/.claude-code/skills',
          asSkillsDir: true,
        })
      );
    });

    it('项目目标点击 → invoke reveal_path(project.path, asSkillsDir=false)', async () => {
      setMacPlatform();
      seedStore({ projects: [mkProj('p-1', 'My Project')] });
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'project',
              project_path: '/tmp/p-1',
              skills: [],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        reveal_path: { revealed_path: '/tmp/p-1', fallback: false },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace scope="project" initialProjectId="p-1" />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      await waitFor(() =>
        expect(screen.getByText('ws.revealMac')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.revealMac'));
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('reveal_path', {
          path: '/tmp/p-1',
          asSkillsDir: false,
        })
      );
    });

    it('reveal_path 返回 fallback=true → ws.revealFallback toast；reject → ws.revealFailed toast', async () => {
      setMacPlatform();
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      await waitFor(() =>
        expect(screen.getByText('ws.revealMac')).toBeDefined()
      );

      // 两段断言均用 toasts.some(...) 按 message 区分，互不干扰；toasts 由 seedStore 初始化为 []
      (invoke as any).mockResolvedValueOnce({
        revealed_path: '/home/.claude-code',
        fallback: true,
      });
      fireEvent.click(screen.getByText('ws.revealMac'));
      await waitFor(() => {
        const { toasts } = useAppStore.getState();
        expect(
          toasts.some(
            (t) => t.message === 'ws.revealFallback' && t.type === 'info'
          )
        ).toBe(true);
      });

      (invoke as any).mockRejectedValueOnce(new Error('boom'));
      fireEvent.click(screen.getByText('ws.revealMac'));
      await waitFor(() => {
        const { toasts } = useAppStore.getState();
        expect(
          toasts.some(
            (t) => t.message === 'ws.revealFailed' && t.type === 'error'
          )
        ).toBe(true);
      });
    });

    it('resolveRevealAsSkillsDir 白名单机制：项目目标恒 false；注入非空白名单验证根目录平台揭示自身', () => {
      expect(resolveRevealAsSkillsDir('trae-cn', true)).toBe(false);
      expect(resolveRevealAsSkillsDir('trae-cn', false)).toBe(true);
      // 生产默认白名单为空（REVEAL_ROOT_SELF_PLATFORMS = new Set([])）；
      // 为验证机制，注入非空白名单（skills 目录即平台根目录的平台在全局目标下揭示自身 → false）
      const rootSelf = new Set(['opencode-root-self']);
      expect(resolveRevealAsSkillsDir('opencode-root-self', false, rootSelf)).toBe(false);
      expect(resolveRevealAsSkillsDir('opencode-root-self', true, rootSelf)).toBe(false); // 项目目标恒 false
      expect(resolveRevealAsSkillsDir('trae-cn', false, rootSelf)).toBe(true); // 非白名单不受注入影响
    });
  });

  describe('Step1 2×2 布局与条件相对路径 (33 号 A1)', () => {
    it('resolveStep1PathDisplay：{project}/ 前缀剥离为相对路径；绝对/相对 pattern 原样', () => {
      expect(
        resolveStep1PathDisplay(
          '/tmp/p-1/.claude/skills',
          true,
          '{project}/.claude/skills'
        )
      ).toBe('.claude/skills');
      expect(
        resolveStep1PathDisplay('/tmp/p-1/CLAUDE.md', true, '{project}/CLAUDE.md')
      ).toBe('CLAUDE.md');
      expect(
        resolveStep1PathDisplay('/home/.claude/skills', false, '/home/.claude/skills')
      ).toBe('/home/.claude/skills');
      expect(resolveStep1PathDisplay('/abs/path', true, '/abs/path')).toBe(
        '/abs/path'
      );
      expect(
        resolveStep1PathDisplay('/tmp/p-1/relative', true, 'relative/dir')
      ).toBe('relative/dir');
    });

    it('Step1 四控件为 2×2 grid（grid-cols-1 sm:grid-cols-2）', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      const grid = screen.getByTestId('ws-step1-grid');
      expect(grid.className).toContain('grid-cols-1');
      expect(grid.className).toContain('sm:grid-cols-2');
    });

    it('项目目标 Step1 显示平台内相对路径；Step3 显示完整绝对路径', async () => {
      const plat = mkPlat('claude-code', 'Claude Code');
      plat.paths.project_skills_pattern = '{project}/.claude/skills';
      plat.paths.project_rules_pattern = '{project}/CLAUDE.md';
      seedStore({
        projects: [mkProj('p-1', 'My Project')],
        platforms: [plat],
      });
      await setupInvoke({
        ...baseRoutes(),
        list_platforms: [plat],
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.change(screen.getByLabelText('ws.targetLabel'), {
        target: { value: 'project:p-1' },
      });
      await waitFor(() => {
        expect(screen.getByTestId('ws-skills-path').textContent).toContain(
          '.claude/skills'
        );
        expect(screen.getByTestId('ws-rules-path').textContent).toContain(
          'CLAUDE.md'
        );
      });
      // 完整解析路径仍可在受管面板/路径派生中使用；Step 3 契约由 T6 已锁定 ws-step3-skills-path
      expect(screen.getByTestId('ws-skills-path').textContent).not.toContain(
        '/tmp/p-1/.claude/skills'
      );
    });

    it('全局目标 Step1 显示完整路径', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      expect(screen.getByTestId('ws-skills-path').textContent).toContain(
        '/home/.claude-code/skills'
      );
      expect(screen.getByTestId('ws-rules-path').textContent).toContain(
        '/home/.claude-code/rules'
      );
    });
  });

  describe('step 2 — resources', () => {
    it('offers source dropdown (全部资源库 / Scene) and independent bounded-scroll fieldsets', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));

      await waitForStep2();
      const sourceSelect = screen.getByLabelText(
        'ws.sourceLabel'
      ) as HTMLSelectElement;
      expect(sourceSelect).toBeDefined();
      const sourceOptgroups = Array.from(
        sourceSelect.querySelectorAll('optgroup')
      ).map((g) => g.label);
      expect(sourceOptgroups).toContain('ws.sourceAll');
      expect(sourceOptgroups).toContain('ws.sourceScene');
      expect(
        Array.from(sourceSelect.querySelectorAll('option')).some(
          (o) => o.value === 'scene:scene-1'
        )
      ).toBe(true);
      expect(screen.getByText('React')).toBeDefined();
      expect(screen.getByText('Style')).toBeDefined();
      // Bounded scroll container present
      expect(screen.getByTestId('ws-skills-list')).toBeDefined();
      expect(screen.getByTestId('ws-skills-list').className).toContain('max-h');
      expect(screen.getByTestId('ws-rules-list').className).toContain('max-h');
    });

    it('passes the selected resources into the generated plan', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();

      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitFor(() =>
        expect(screen.getByText('计划明细')).toBeDefined()
      );
      const previewCall = (invoke as any).mock.calls.find(
        (c: string[]) => c[0] === 'preview_distribution'
      );
      expect(previewCall).toBeDefined();
      const selection = previewCall[1];
      expect(selection.skills.mode).toBe('add_or_update');
      expect(selection.skills.ids).toEqual(['s1']);
      expect(selection.platformIds).toEqual(['claude-code']);
      expect(selection.scope).toBe('global');
    });

    it('limits pools to the selected Scene members', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();

      fireEvent.change(screen.getByLabelText('ws.sourceLabel'), {
        target: { value: 'scene:scene-1' },
      });
      await waitFor(() => {
        // Scene contains only s1/r1; s2 and r2 excluded
        expect(screen.queryByText('Vue')).toBeNull();
        expect(screen.queryByText('Lint')).toBeNull();
        expect(screen.getByText('React')).toBeDefined();
        expect(screen.getByText('Style')).toBeDefined();
      });
    });

    it('以含禁用成员的场景为来源时，选择池不含禁用成员（仍为有效引用）', async () => {
      await setupInvoke({
        ...baseRoutes(),
        get_scene_detail: {
          scene: { id: 'scene-1', name: 'React 基础' },
          skills: [
            {
              skill_id: 's1',
              skill_name: 'React',
              enabled: true,
              sort_order: 0,
              version: null,
            },
            {
              skill_id: 's2',
              skill_name: 'Vue',
              enabled: false,
              sort_order: 1,
              version: null,
            },
          ],
          rules: [
            { rule_id: 'r1', rule_name: 'Style', enabled: true, sort_order: 0 },
            { rule_id: 'r2', rule_name: 'Lint', enabled: false, sort_order: 1 },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();

      fireEvent.change(screen.getByLabelText('ws.sourceLabel'), {
        target: { value: 'scene:scene-1' },
      });
      await waitFor(() => {
        expect(screen.getByTestId('ws-skills-list').textContent).toContain(
          'React'
        );
        expect(
          screen.getByTestId('ws-skills-list').textContent
        ).not.toContain('Vue');
        expect(screen.getByTestId('ws-rules-list').textContent).toContain(
          'Style'
        );
        expect(
          screen.getByTestId('ws-rules-list').textContent
        ).not.toContain('Lint');
      });
      expect(screen.queryByText('ws.invalidRefsTitle')).toBeNull();
    });

    it('surfaces an explicit error when the Scene source members fail to load', async () => {
      await setupInvoke({
        ...baseRoutes(),
        get_scene_detail: () => Promise.reject(new Error('scene detail down')),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();

      fireEvent.change(screen.getByLabelText('ws.sourceLabel'), {
        target: { value: 'scene:scene-1' },
      });
      await waitFor(() =>
        expect(screen.getByText('ws.sceneSourceLoadFailed')).toBeDefined()
      );
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes('ws.sceneSourceLoadFailed'))
      ).toBe(true);
      // Pools must not silently fall back to the full library
      expect(screen.queryByText('React')).toBeNull();
      expect(screen.queryByText('Style')).toBeNull();
    });

    it('opens a two-choice dialog when the Scene source contains invalid (deleted) references', async () => {
      await setupInvoke({
        ...baseRoutes(),
        get_scene_detail: {
          scene: { id: 'scene-1', name: 'React 基础' },
          skills: [
            {
              skill_id: 's1',
              skill_name: 'React',
              enabled: true,
              sort_order: 0,
              version: null,
            },
            {
              skill_id: 'gone-skill',
              skill_name: '',
              enabled: true,
              sort_order: 1,
              version: null,
            },
          ],
          rules: [
            { rule_id: 'r1', rule_name: 'Style', enabled: true, sort_order: 0 },
            {
              rule_id: 'gone-rule',
              rule_name: '',
              enabled: true,
              sort_order: 1,
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();

      fireEvent.change(screen.getByLabelText('ws.sourceLabel'), {
        target: { value: 'scene:scene-1' },
      });

      await waitFor(() =>
        expect(screen.getByText('ws.invalidRefsTitle')).toBeDefined()
      );
      expect(screen.getByText('ws.invalidRefsUseValid')).toBeDefined();
      expect(screen.getByText('ws.invalidRefsCleanup')).toBeDefined();
    });

    it('continues with valid-only members when 仅使用有效资源 is chosen', async () => {
      await setupInvoke({
        ...baseRoutes(),
        get_scene_detail: {
          scene: { id: 'scene-1', name: 'React 基础' },
          skills: [
            {
              skill_id: 's1',
              skill_name: 'React',
              enabled: true,
              sort_order: 0,
              version: null,
            },
            {
              skill_id: 'gone-skill',
              skill_name: '',
              enabled: true,
              sort_order: 1,
              version: null,
            },
          ],
          rules: [
            { rule_id: 'r1', rule_name: 'Style', enabled: true, sort_order: 0 },
            {
              rule_id: 'gone-rule',
              rule_name: '',
              enabled: true,
              sort_order: 1,
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();

      fireEvent.change(screen.getByLabelText('ws.sourceLabel'), {
        target: { value: 'scene:scene-1' },
      });
      await waitFor(() =>
        expect(screen.getByText('ws.invalidRefsTitle')).toBeDefined()
      );

      fireEvent.click(screen.getByText('ws.invalidRefsUseValid'));
      await waitFor(() =>
        expect(screen.queryByText('ws.invalidRefsTitle')).toBeNull()
      );
      // Scene source retained; pools limited to the valid members only
      const sourceSelect = screen.getByLabelText(
        'ws.sourceLabel'
      ) as HTMLSelectElement;
      expect(sourceSelect.value).toBe('scene:scene-1');
      expect(screen.getByText('React')).toBeDefined();
      expect(screen.getByText('Style')).toBeDefined();
      expect(screen.queryByText('Vue')).toBeNull();
      expect(screen.queryByText('Lint')).toBeNull();
    });

    it('returns to the full library when 返回清理 is chosen', async () => {
      await setupInvoke({
        ...baseRoutes(),
        get_scene_detail: {
          scene: { id: 'scene-1', name: 'React 基础' },
          skills: [
            {
              skill_id: 's1',
              skill_name: 'React',
              enabled: true,
              sort_order: 0,
              version: null,
            },
            {
              skill_id: 'gone-skill',
              skill_name: '',
              enabled: true,
              sort_order: 1,
              version: null,
            },
          ],
          rules: [
            { rule_id: 'r1', rule_name: 'Style', enabled: true, sort_order: 0 },
            {
              rule_id: 'gone-rule',
              rule_name: '',
              enabled: true,
              sort_order: 1,
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();

      fireEvent.change(screen.getByLabelText('ws.sourceLabel'), {
        target: { value: 'scene:scene-1' },
      });
      await waitFor(() =>
        expect(screen.getByText('ws.invalidRefsTitle')).toBeDefined()
      );

      fireEvent.click(screen.getByText('ws.invalidRefsCleanup'));
      await waitFor(() =>
        expect(screen.queryByText('ws.invalidRefsTitle')).toBeNull()
      );
      // Source reset to 全部资源库; full pool restored
      const sourceSelect = screen.getByLabelText(
        'ws.sourceLabel'
      ) as HTMLSelectElement;
      expect(sourceSelect.value).toBe('all');
      expect(screen.getByText('React')).toBeDefined();
      expect(screen.getByText('Vue')).toBeDefined();
      expect(screen.getByText('Style')).toBeDefined();
      expect(screen.getByText('Lint')).toBeDefined();
    });

    it('Step2 技能区三态全选：全选 → 再点清空；部分选中 → indeterminate；无资源禁用', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();

      const selectAll = screen.getByTestId('ws-select-all-skills');
      expect(selectAll.getAttribute('aria-label')).toBe('全选技能');
      expect(selectAll.getAttribute('aria-checked')).toBe('false');
      fireEvent.click(selectAll);
      await waitFor(() =>
        expect(selectAll.getAttribute('aria-checked')).toBe('true')
      );
      // 池内全部选中
      expect(
        screen.getByTestId('ws-skills-list').querySelectorAll('input:checked')
      ).toHaveLength(2);

      // 取消一个 → indeterminate
      fireEvent.click(
        within(screen.getByTestId('ws-skills-list')).getAllByRole('checkbox')[1]
      );
      expect(selectAll.getAttribute('aria-checked')).toBe('mixed');

      // 清空
      fireEvent.click(screen.getByTestId('ws-clear-skills'));
      expect(selectAll.getAttribute('aria-checked')).toBe('false');
      expect(
        screen.getByTestId('ws-skills-list').querySelectorAll('input:checked')
      ).toHaveLength(0);
    });

    it('切换来源/目标时重置 Step2 选择', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      // 全选技能 → aria-checked=true
      fireEvent.click(screen.getByTestId('ws-select-all-skills'));
      await waitFor(() =>
        expect(
          screen.getByTestId('ws-select-all-skills').getAttribute('aria-checked')
        ).toBe('true')
      );
      // 切到 scene 来源（baseRoutes 有 scene-1）→ T5 实现应重置选择 → aria-checked=false
      fireEvent.change(screen.getByLabelText('ws.sourceLabel'), {
        target: { value: 'scene:scene-1' },
      });
      expect(
        screen.getByTestId('ws-select-all-skills').getAttribute('aria-checked')
      ).toBe('false');
    });

    it('无资源时全选/清空禁用', async () => {
      seedStore({ skills: [], rules: [] });
      // 空 store 会触发 init 拉取 list_skills / list_rules → 两条路由返回空数组，池保持为空
      await setupInvoke({
        ...baseRoutes(),
        list_skills: [],
        list_rules: [],
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      expect(
        (screen.getByTestId('ws-select-all-skills') as HTMLInputElement)
          .disabled
      ).toBe(true);
      expect(
        (screen.getByTestId('ws-clear-skills') as HTMLButtonElement).disabled
      ).toBe(true);
    });
  });

  describe('step 3 — plan', () => {
    it('generates a plan via preview_distribution and renders add rows', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          'preview_distribution',
          expect.anything()
        )
      );
      await waitForPlanReady();
      expect(screen.getByText('React')).toBeDefined();
    });

    it('Step3 计划标题渲染「计划明细」', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      expect(screen.getByText('计划明细')).toBeDefined();
      expect(screen.queryByText('ws.planTitle')).toBeNull();
    });

    it('Step3 无通用「目标路径」，仅 Skills/Rules 两行', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      expect(screen.queryByText('ws.planTarget')).toBeNull();
      expect(screen.getByTestId('ws-step3-skills-path')).toBeDefined();
      expect(screen.getByTestId('ws-step3-rules-path')).toBeDefined();
    });

    it('disables confirm and shows 目标已是最新状态 when plan has no changes', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan({
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              skills_to_add: [],
              skills_to_update: [],
              skills_to_remove: [],
              rules_to_add: [],
              rules_to_update: [],
              rules_to_remove: [],
            },
          ],
          has_removals: false,
        }),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('ws.nextToPlan'));

      await waitForPlanReady();
      expect(screen.getAllByText('ws.planNoChange').length).toBeGreaterThan(0);
      const confirmBtn = screen
        .getByText('ws.confirmDistribute')
        .closest('button');
      expect(confirmBtn).toBeDisabled();
    });

    it('移除标记不再进入计划：勾选移除后 Step3 计划与确认按钮不含移除项（走面板独立流程）', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );

      // Enter managed panel and check s1 for removal (checkbox selection)
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      await waitFor(() => expect(screen.getByText('React')).toBeDefined());
      fireEvent.click(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      );

      // 进入 Step 2/3：计划不再携带移除（buildSelection 无 remove_selected）
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('ws.nextToPlan'));

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          'preview_distribution',
          expect.anything()
        )
      );
      const previewCalls = (invoke as any).mock.calls.filter(
        (c: string[]) => c[0] === 'preview_distribution'
      );
      const selection = previewCalls[previewCalls.length - 1][1];
      expect(selection.skills.mode).not.toBe('remove_selected');
      expect(selection.rules.mode).not.toBe('remove_selected');

      await waitForPlanReady();
      // Step3 确认按钮不再出现「确认分发并移除 N 项」
      expect(screen.getByText('ws.confirmDistribute')).toBeDefined();
      expect(screen.queryByText(/ws.confirmDistributeRemove/)).toBeNull();
      // 移除确认弹窗不再由计划触发
      expect(screen.queryByText('ws.confirmRemoveTitle')).toBeNull();
    });

    it('Step3 计划展开后渲染 Skills/Rules 双只读路径（Directory + {project} 替换）', async () => {
      // 项目目标下 Rules 路径由 project_rules_pattern 解析：必须显式 seed 该 pattern，
      // 否则 mkPlat 默认 project_rules_pattern=null → 渲染 ws.pathUnavailable。
      const plat = mkPlat('claude-code', 'Claude Code');
      plat.paths.project_rules_pattern = '{project}/.claude-code/rules';
      seedStore({
        projects: [mkProj('p-1', 'My Project')],
        platforms: [plat],
      });
      await setupInvoke({
        ...baseRoutes(),
        list_platforms: [plat],
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.change(screen.getByLabelText('ws.targetLabel'), {
        target: { value: 'project:p-1' },
      });
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      // Skills 路径 = project_skills_pattern 解析；Rules 路径 = project_rules_pattern 解析
      expect(screen.getByTestId('ws-step3-skills-path').textContent).toBe(
        '/tmp/p-1/.claude-code/skills'
      );
      expect(screen.getByTestId('ws-step3-rules-path').textContent).toBe(
        '/tmp/p-1/.claude-code/rules'
      );
    });

    it('Step3 SingleFile 模式附「规则写入目标 AGENTS.md」提示', async () => {
      // SingleFile：project_rules_pattern 即目标文件相对路径（如 codex 的 "AGENTS.md"），
      // 解析为 {project}/AGENTS.md；同时 seed project_rules_format 触发 rulesSingleFile。
      const plat = mkPlat('claude-code', 'Claude Code');
      plat.paths.project_rules_pattern = 'AGENTS.md';
      plat.paths.project_rules_format = { SingleFile: { file_name: 'AGENTS.md' } };
      seedStore({
        projects: [mkProj('p-1', 'My Project')],
        platforms: [plat],
      });
      await setupInvoke({
        ...baseRoutes(),
        list_platforms: [plat],
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.change(screen.getByLabelText('ws.targetLabel'), {
        target: { value: 'project:p-1' },
      });
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      expect(screen.getByTestId('ws-step3-rules-path').textContent).toBe(
        '/tmp/p-1/AGENTS.md'
      );
      expect(screen.getByText('ws.rulesSingleFileHint')).toBeDefined();
    });
  });

  describe('step 4 — execute and result', () => {
    it('executes distribution and shows the four-category result grid (无 removed 统计，DEC-1)', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult({
          installed: ['s1'],
          updated: [],
          removed: [],
          errors: [],
        }),
        get_sync_status: { platforms: [] },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          'execute_distribution',
          expect.anything()
        )
      );
      await waitFor(() =>
        expect(screen.getByText('ws.resultTitle')).toBeDefined()
      );
      // 四类指标（无 removed）；指标名中文化（P0-2）
      expect(screen.getByText('已安装')).toBeDefined();
      expect(screen.getByText('已更新')).toBeDefined();
      expect(screen.getByText('已跳过')).toBeDefined();
      expect(screen.getByText('错误')).toBeDefined();
      expect(screen.queryByText('已移除')).toBeNull();
      expect(screen.queryByTestId('ws-result-resultRemoved')).toBeNull();
      expect(
        screen.getByTestId('ws-result-resultInstalled').textContent
      ).toBe('1');
      // 按钮收敛：无错误 → 仅「返回工作区」
      expect(
        screen.getByRole('button', { name: '返回工作区' })
      ).toBeDefined();
      expect(
        screen.queryByRole('button', { name: 'ws.retryFailed' })
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'ws.viewManagedState' })
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'ws.distributeAgain' })
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'ws.closeWorkspace' })
      ).toBeNull();
    });

    it('Step4 无错误：仅「返回工作区」，无重试/查看受管/再次分发/关闭', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult({ errors: [] }),
        get_sync_status: { platforms: [] },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );
      await waitFor(() =>
        expect(screen.getByText('ws.resultTitle')).toBeDefined()
      );
      expect(
        screen.getByRole('button', { name: '返回工作区' })
      ).toBeDefined();
      expect(
        screen.queryByRole('button', { name: 'ws.retryFailed' })
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'ws.viewManagedState' })
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'ws.distributeAgain' })
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'ws.closeWorkspace' })
      ).toBeNull();
    });

    it('Step4 有错误：重试失败项主按钮 + 返回工作区次按钮', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult({ errors: ['boom'] }),
        get_sync_status: { platforms: [] },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );
      await waitFor(() =>
        expect(screen.getByText('ws.resultTitle')).toBeDefined()
      );
      expect(
        screen.getByRole('button', { name: 'ws.retryFailed' })
      ).toBeDefined();
      expect(
        screen.getByRole('button', { name: '返回工作区' })
      ).toBeDefined();
    });

    it('Step4 返回工作区保留目标/平台/资源选择上下文', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
        get_sync_status: { platforms: [] },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );
      await waitFor(() =>
        expect(screen.getByText('ws.resultTitle')).toBeDefined()
      );

      // 返回工作区 → step=1，且目标/平台选择保留
      fireEvent.click(screen.getByRole('button', { name: '返回工作区' }));
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      const platformSelect = screen.getByLabelText(
        'ws.platformLabel'
      ) as HTMLSelectElement;
      expect(platformSelect.value).toBe('claude-code');
      const targetSelect = screen.getByLabelText(
        'ws.targetLabel'
      ) as HTMLSelectElement;
      expect(targetSelect.value).toBe('global');
      // 资源选择保留：回到 Step2 检查 React 仍勾选
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      const reactCheckbox = within(
        screen.getByTestId('ws-skills-list')
      )
        .getByText('React')
        .closest('label')!
        .querySelector('input') as HTMLInputElement;
      expect(reactCheckbox.checked).toBe(true);
    });

    it('普通分发结果页不含 removed 统计（DEC-1，由 T4 移入）', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult({
          removed: ['s1'],
          installed: ['s1'],
          updated: [],
          errors: [],
        }),
        get_sync_status: { platforms: [] },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );
      await waitFor(() =>
        expect(screen.getByText('ws.resultTitle')).toBeDefined()
      );
      // removed 统计不渲染；结果指标渲染中文（P0-2）
      expect(screen.queryByTestId('ws-result-resultRemoved')).toBeNull();
      expect(
        screen.getByTestId('ws-result-resultInstalled').textContent
      ).toBe('1');
      expect(screen.getByText('已安装')).toBeDefined();
      expect(screen.queryByText('installed')).toBeNull(); // zh 值不再为英文小写
    });

    it('结果卡片区 aria-live="polite"', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
        get_sync_status: { platforms: [] },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );
      await waitFor(() =>
        expect(screen.getByText('ws.resultTitle')).toBeDefined()
      );
      const card = screen.getByTestId('ws-result-card');
      expect(card.getAttribute('aria-live')).toBe('polite');
    });

    it('shows the backend skipped count when SyncResult provides it', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult({
          installed: ['s1'],
          updated: [],
          removed: [],
          skipped: 3,
          errors: [],
        }),
        get_sync_status: { platforms: [] },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );
      await waitFor(() =>
        expect(screen.getByText('ws.resultTitle')).toBeDefined()
      );

      const skippedValue = screen.getByTestId('ws-result-resultSkipped');
      expect(skippedValue.textContent).toBe('3');
      expect(skippedValue.getAttribute('title')).toBeNull();
    });

    it('shows explicit unsupported semantics for the skipped column instead of a fake zero', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult({
          installed: ['s1'],
          updated: [],
          removed: [],
          errors: [],
        }),
        get_sync_status: { platforms: [] },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );
      await waitFor(() =>
        expect(screen.getByText('ws.resultTitle')).toBeDefined()
      );

      const skippedValue = screen.getByTestId('ws-result-resultSkipped');
      expect(skippedValue.textContent).toBe('ws.resultSkippedNa');
      expect(skippedValue.getAttribute('title')).toBe('ws.resultSkippedHint');
    });

    it('retry failed re-executes distribution', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult({
          installed: [],
          updated: [],
          removed: [],
          errors: ['s1 failed'],
        }),
        get_sync_status: { platforms: [] },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );
      await waitFor(() =>
        expect(screen.getByText('ws.resultTitle')).toBeDefined()
      );

      fireEvent.click(screen.getByText('ws.retryFailed'));
      await waitFor(() => {
        const calls = (invoke as any).mock.calls.filter(
          (c: string[]) => c[0] === 'execute_distribution'
        );
        expect(calls.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('cancel / no-rollback semantics', () => {
    it('cancel during execution returns to step 1 without rollback promise', async () => {
      let resolveExec!: (v: unknown) => void;
      const execPromise = new Promise((r) => {
        resolveExec = r;
      });
      const { invoke } = await import('@tauri-apps/api/core');
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === 'execute_distribution') return execPromise;
        if (cmd in baseRoutes())
          return Promise.resolve(
            (baseRoutes() as Record<string, unknown>)[cmd]
          );
        if (cmd === 'preview_distribution') return Promise.resolve(mkPlan());
        return Promise.reject(new Error(`Unknown: ${cmd}`));
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();

      // Enter executing phase, then cancel
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );
      await waitFor(() =>
        expect(screen.getByText('ws.cancelExecution')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.cancelExecution'));
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      // Execution was submitted at most once; cancel does not roll back or await the result
      const execCalls = (invoke as any).mock.calls.filter(
        (c: string[]) => c[0] === 'execute_distribution'
      );
      expect(execCalls.length).toBeLessThanOrEqual(1);
      // Release the pending promise; the discarded result must not render the result step
      resolveExec(mkResult());
      await waitFor(() =>
        expect(screen.queryByText('ws.resultTitle')).toBeNull()
      );
      expect(screen.getByText('ws.step1.title')).toBeDefined();
    });

    it('cancel during execution states the backend continues instead of claiming cancellation', async () => {
      let resolveExec!: (v: unknown) => void;
      const execPromise = new Promise((r) => {
        resolveExec = r;
      });
      const { invoke } = await import('@tauri-apps/api/core');
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === 'execute_distribution') return execPromise;
        if (cmd in baseRoutes())
          return Promise.resolve(
            (baseRoutes() as Record<string, unknown>)[cmd]
          );
        if (cmd === 'preview_distribution') return Promise.resolve(mkPlan());
        return Promise.reject(new Error(`Unknown: ${cmd}`));
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );
      await waitFor(() =>
        expect(screen.getByText('ws.cancelExecution')).toBeDefined()
      );

      fireEvent.click(screen.getByText('ws.cancelExecution'));
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      const toasts = useAppStore.getState().toasts;
      expect(
        toasts.some((t) => t.message.includes('ws.cancelBackgroundContinue'))
      ).toBe(true);
      expect(
        toasts.some((t) => t.message.includes('ws.cancelRollbackNote'))
      ).toBe(false);
      resolveExec(mkResult());
    });

    it('blocks a new distribution while the cancelled execution is still running in the background', async () => {
      let execCalls = 0;
      let resolveExec!: (v: unknown) => void;
      const execPromise = new Promise((r) => {
        resolveExec = r;
      });
      const { invoke } = await import('@tauri-apps/api/core');
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === 'execute_distribution') {
          execCalls += 1;
          return execCalls === 1 ? execPromise : Promise.resolve(mkResult());
        }
        if (cmd in baseRoutes())
          return Promise.resolve(
            (baseRoutes() as Record<string, unknown>)[cmd]
          );
        if (cmd === 'preview_distribution') return Promise.resolve(mkPlan());
        return Promise.reject(new Error(`Unknown: ${cmd}`));
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      fireEvent.click(
        screen.getByText('ws.confirmDistribute').closest('button')!
      );
      await waitFor(() =>
        expect(screen.getByText('ws.cancelExecution')).toBeDefined()
      );
      expect(execCalls).toBe(1);

      fireEvent.click(screen.getByText('ws.cancelExecution'));
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );

      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();
      const confirmBtn = screen
        .getByText('ws.confirmDistribute')
        .closest('button') as HTMLButtonElement;
      expect(confirmBtn.disabled).toBe(true);
      expect(execCalls).toBe(1);

      resolveExec(mkResult());
      await waitFor(() => expect(confirmBtn.disabled).toBe(false));
      fireEvent.click(confirmBtn);
      await waitFor(() => expect(execCalls).toBe(2));
    });

    it('back at step 1 is not available (no backStep button on the first step)', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      expect(
        screen.queryByRole('button', { name: /ws.backStep|上一步/i })
      ).toBeNull();
    });
  });

  describe('pendingDistributionSelection consumption', () => {
    it('preselects carried resources, jumps to step 2, and clears the store', async () => {
      seedStore({
        pendingDistributionSelection: { skillIds: ['s1'], ruleIds: [] },
      });
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitForStep2();
      expect(useAppStore.getState().pendingDistributionSelection).toBeNull();
      expect(screen.getByText('React')).toBeDefined();
    });

    it('carries sceneId into the scene source and shows provenance + no-writeback hint', async () => {
      seedStore({
        pendingDistributionSelection: {
          skillIds: ['s1'],
          ruleIds: ['r1'],
          sceneId: 'scene-1',
        },
        scenes: [mkScene('scene-1', 'React 基础')],
      });
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitForStep2();
      const sourceSelect = screen.getByLabelText(
        'ws.sourceLabel'
      ) as HTMLSelectElement;
      expect(sourceSelect.value).toBe('scene:scene-1');
      expect(screen.getByText('来自场景：React 基础')).toBeDefined();
      expect(screen.getByText('ws.noWritebackHint')).toBeDefined();
      expect(screen.getByTestId('ws-scene-source')).toBeDefined();
      expect(screen.getAllByText('ws.sourceHint').length).toBeGreaterThan(0);
      expect(useAppStore.getState().pendingDistributionSelection).toBeNull();
    });
  });

  describe('移除改走面板独立流程：添加与面板移除标记并行不阻塞计划（33 号 A6）', () => {
    it('面板勾选移除 + Step2 选择添加技能 → 计划正常生成且仅含添加（无 remove_selected）', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );

      // 面板勾选 s1 待移除（checkbox）
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      await waitFor(() => expect(screen.getByText('React')).toBeDefined());
      fireEvent.click(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      );

      // Step2 选择 s2 作为添加
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('Vue'));

      fireEvent.click(screen.getByText('ws.nextToPlan'));

      // 不再阻塞：进入 Step3、无 mixedAddRemoveBlocked toast、preview 已提交
      await waitFor(() =>
        expect(screen.getByText('计划明细')).toBeDefined()
      );
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes('ws.mixedAddRemoveBlocked'))
      ).toBe(false);
      const previewCalls = (invoke as any).mock.calls.filter(
        (c: string[]) => c[0] === 'preview_distribution'
      );
      expect(previewCalls.length).toBeGreaterThan(0);
      const selection = previewCalls[previewCalls.length - 1][1];
      // 计划仅含添加：skills add_or_update=['s2']，不含移除标记
      expect(selection.skills.mode).toBe('add_or_update');
      expect(selection.skills.ids).toEqual(['s2']);
      expect(selection.skills.mode).not.toBe('remove_selected');
    });

    it('面板勾选移除 + Step2 选择添加规则 → 计划正常生成且仅含添加（无 remove_selected）', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [],
              rules: [{ id: 'r1', path: '/home/.claude-code/rules/Style.md' }],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );

      // 面板勾选 r1 待移除（checkbox）
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      await waitFor(() => expect(screen.getByText('Style.md')).toBeDefined());
      fireEvent.click(
        within(screen.getByTestId('ws-managed-rule-r1')).getByRole('checkbox')
      );

      // Step2 选择 r2 作为添加
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('Lint'));

      fireEvent.click(screen.getByText('ws.nextToPlan'));

      // 不再阻塞：进入 Step3、无 mixedAddRemoveBlocked toast、preview 已提交
      await waitFor(() =>
        expect(screen.getByText('计划明细')).toBeDefined()
      );
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes('ws.mixedAddRemoveBlocked'))
      ).toBe(false);
      const previewCalls = (invoke as any).mock.calls.filter(
        (c: string[]) => c[0] === 'preview_distribution'
      );
      expect(previewCalls.length).toBeGreaterThan(0);
      const selection = previewCalls[previewCalls.length - 1][1];
      // 计划仅含添加：rules add_or_update=['r2']，不含移除标记
      expect(selection.rules.mode).toBe('add_or_update');
      expect(selection.rules.ids).toEqual(['r2']);
      expect(selection.rules.mode).not.toBe('remove_selected');
    });
  });

  describe('review MAJOR regressions', () => {
    it('retry re-runs initialization when a non-first fetch failed after partial data loaded', async () => {
      seedStore({
        platforms: [mkPlat('claude-code', 'Claude Code')],
        projects: [mkProj('p-1', 'My Project')],
        skills: [mkSkill('s1', 'React')],
        rules: [mkRule('r1', 'Style')],
        scenes: [],
      });
      const { invoke } = await import('@tauri-apps/api/core');
      let scenesDown = true;
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === 'list_scenes' && scenesDown) {
          return Promise.reject(new Error('scenes down'));
        }
        if (cmd in baseRoutes()) {
          return Promise.resolve(
            (baseRoutes() as Record<string, unknown>)[cmd]
          );
        }
        return Promise.reject(new Error(`Unknown: ${cmd}`));
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.errorTitle')).toBeDefined()
      );

      scenesDown = false;
      fireEvent.click(screen.getByText('ws.retryLoad'));
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      const sceneCalls = (invoke as any).mock.calls.filter(
        (c: string[]) => c[0] === 'list_scenes'
      );
      expect(sceneCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('rapid double-click on confirm starts only a single execution', async () => {
      let resolveExec!: (v: unknown) => void;
      const execPromise = new Promise((r) => {
        resolveExec = r;
      });
      let execCalls = 0;
      const { invoke } = await import('@tauri-apps/api/core');
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === 'execute_distribution') {
          execCalls += 1;
          return execCalls === 1 ? execPromise : Promise.resolve(mkResult());
        }
        if (cmd in baseRoutes()) {
          return Promise.resolve(
            (baseRoutes() as Record<string, unknown>)[cmd]
          );
        }
        if (cmd === 'preview_distribution') return Promise.resolve(mkPlan());
        return Promise.reject(new Error(`Unknown: ${cmd}`));
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('React'));
      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitForPlanReady();

      const confirmBtn = screen
        .getByText('ws.confirmDistribute')
        .closest('button')!;
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);
      await waitFor(() =>
        expect(screen.getByText('ws.cancelExecution')).toBeDefined()
      );
      expect(execCalls).toBe(1);

      resolveExec(mkResult());
      await waitFor(() =>
        expect(screen.getByText('ws.resultTitle')).toBeDefined()
      );
      expect(execCalls).toBe(1);
    });

    it('project-scope workspace with no projects stays project-scoped and does not fall back to global', async () => {
      seedStore({ projects: [] });
      await setupInvoke({
        ...baseRoutes(),
        list_projects: [],
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace scope="project" />);
      await waitFor(() =>
        expect(screen.getByText('ws.emptyTitle')).toBeDefined()
      );
      expect(screen.queryByLabelText('ws.targetLabel')).toBeNull();
      expect(screen.queryByText('ws.step1.title')).toBeNull();
    });

    it('ignores stale out-of-order scene member responses when switching sources quickly', async () => {
      let resolveSlow!: (v: unknown) => void;
      const slowPromise = new Promise((r) => {
        resolveSlow = r;
      });
      const { invoke } = await import('@tauri-apps/api/core');
      (invoke as any).mockImplementation((cmd: string, args: any) => {
        if (cmd === 'get_scene_detail') {
          if (args?.id === 'scene-slow') return slowPromise;
          return Promise.resolve({
            scene: { id: args?.id },
            skills: [
              {
                skill_id: 's2',
                skill_name: 'Vue',
                enabled: true,
                sort_order: 0,
                version: null,
              },
            ],
            rules: [],
          });
        }
        if (cmd in baseRoutes()) {
          return Promise.resolve(
            (baseRoutes() as Record<string, unknown>)[cmd]
          );
        }
        if (cmd === 'preview_distribution') return Promise.resolve(mkPlan());
        if (cmd === 'execute_distribution') return Promise.resolve(mkResult());
        return Promise.reject(new Error(`Unknown: ${cmd}`));
      });
      seedStore({
        scenes: [mkScene('scene-slow', 'Slow'), mkScene('scene-fast', 'Fast')],
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();

      fireEvent.change(screen.getByLabelText('ws.sourceLabel'), {
        target: { value: 'scene:scene-slow' },
      });
      fireEvent.change(screen.getByLabelText('ws.sourceLabel'), {
        target: { value: 'scene:scene-fast' },
      });

      await waitFor(() => expect(screen.getByText('Vue')).toBeDefined());

      resolveSlow({
        scene: { id: 'scene-slow' },
        skills: [
          {
            skill_id: 's1',
            skill_name: 'React',
            enabled: true,
            sort_order: 0,
            version: null,
          },
        ],
        rules: [],
      });
      await waitFor(() => expect(screen.queryByText('React')).toBeNull());
      expect(screen.getByText('Vue')).toBeDefined();
    });

    it('clears stale selections when the scene source fails to load so the plan cannot submit them', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        get_scene_detail: () => Promise.reject(new Error('scene detail down')),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();

      fireEvent.click(screen.getByText('React'));
      fireEvent.change(screen.getByLabelText('ws.sourceLabel'), {
        target: { value: 'scene:scene-1' },
      });
      await waitFor(() =>
        expect(screen.getByText('ws.sceneSourceLoadFailed')).toBeDefined()
      );

      fireEvent.click(screen.getByText('ws.nextToPlan'));
      await waitFor(() =>
        expect(screen.getByText('计划明细')).toBeDefined()
      );
      const previewCalls = (invoke as any).mock.calls.filter(
        (c: string[]) => c[0] === 'preview_distribution'
      );
      expect(previewCalls.length).toBeGreaterThan(0);
      const selection = previewCalls[previewCalls.length - 1][1];
      expect(selection.skills.ids).toEqual([]);
      expect(selection.skills.mode).toBe('preserve');
    });

    it('does not open the managed panel when the managed state fetch fails', async () => {
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: () =>
          Promise.reject(new Error('managed down')),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      await waitFor(() =>
        expect(
          useAppStore
            .getState()
            .toasts.some((t) => t.message.includes('获取已分发内容失败'))
        ).toBe(true)
      );
      expect(screen.queryByText('ws.managedPanelTitle')).toBeNull();
    });
  });

  describe('managed panel (29 号 2c)', () => {
    it('受管面板：aria-live 摘要 + 技能/规则分区 + 每行「受管」徽标与移除 checkbox', async () => {
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [],
              local_skills: [
                {
                  name: 'local-helper',
                  path: '/home/.claude-code/skills/local-helper',
                },
              ],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      // 面板打开依赖 get_managed_distribution_state 异步返回，先等摘要出现
      const summary = await screen.findByTestId('ws-managed-summary');
      expect(summary.getAttribute('aria-live')).toBe('polite');
      expect(summary.textContent).toContain('当前待移除 0 项');
      // 分区标题按 mock 插值渲染：managedSkills.length=1、managedRules.length=0
      expect(screen.getByText('技能（1）')).toBeDefined();
      expect(screen.getByText('规则（0）')).toBeDefined();
      expect(screen.getByText('ws.managed.badgeManaged')).toBeDefined();

      // 勾选 checkbox → 选中且摘要计数 +1
      const skillRow = screen.getByTestId('ws-managed-skill-s1');
      const checkbox = within(skillRow).getByRole('checkbox');
      expect(checkbox.getAttribute('aria-label')).toContain('ws.removeSkill');
      fireEvent.click(checkbox);
      await waitFor(() =>
        expect(
          within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
        ).toBeChecked()
      );
      expect(screen.getByTestId('ws-managed-summary').textContent).toContain(
        '当前待移除 1 项'
      );
    });

    it('非受管/本地行含「保留」徽标且无移除按钮', async () => {
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [],
              local_skills: [
                {
                  name: 'local-helper',
                  path: '/home/.claude-code/skills/local-helper',
                },
              ],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );

      const localRow = await screen.findByTestId('ws-managed-local-local-helper');
      expect(localRow).toBeDefined();
      expect(within(localRow).queryByRole('button')).toBeNull();
      expect(within(localRow).getByText('ws.managed.badgeKeep')).toBeDefined();
      expect(within(localRow).getByText('ws.managed.unknownNote')).toBeDefined();
    });
  });

  describe('独立移除流程 (33 号 A6 / DEC-1)', () => {
    it('受管面板勾选 → 「确认移除 N 项」→ 二次确认弹窗逐项明细 → remove_distributed invoke → 面板刷新', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [{ id: 'r1', path: '/home/.claude-code/rules/Style.md' }],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
        remove_distributed: {
          installed: [],
          updated: [],
          removed: ['s1', 'rule:r1'],
          skipped: 0,
          errors: [],
        },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByRole('button', { name: /查看|收起/ }));
      await waitFor(() =>
        expect(screen.getByTestId('ws-managed-skill-s1')).toBeDefined()
      );

      // 勾选两行（面板行变为 checkbox 选择）
      fireEvent.click(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      );
      fireEvent.click(
        within(screen.getByTestId('ws-managed-rule-r1')).getByRole('checkbox')
      );
      // 确认按钮计数联动
      await waitFor(() =>
        expect(
          screen.getByTestId('ws-managed-confirm-remove')
        ).toHaveTextContent('确认移除 2 项')
      );
      fireEvent.click(screen.getByTestId('ws-managed-confirm-remove'));
      // 二次确认弹窗：逐项明细 + 仅受管副本提示（mock 特例键按 mock 输出断言，勿用原始 key）
      await waitFor(() =>
        expect(screen.getByText('确认移除受管内容')).toBeDefined()
      );
      expect(
        screen.getByText('仅移除 SkillForge 受管副本，资源库保留可重新分发恢复')
      ).toBeDefined();
      expect(screen.getByTestId('ws-remove-confirm-items')).toHaveTextContent(
        'React'
      );
      expect(screen.getByTestId('ws-remove-confirm-items')).toHaveTextContent(
        'Style'
      );
      // 确认执行 → remove_distributed invoke
      fireEvent.click(screen.getByText('确认移除'));
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('remove_distributed', {
          platformIds: ['claude-code'],
          scope: 'global',
          skillIds: ['s1'],
          ruleIds: ['r1'],
        })
      );
      // 面板刷新（fetchManagedState 重新调用）→ 选择清空、结果明细展示
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          'get_managed_distribution_state',
          expect.anything()
        )
      );
    });

    it('移除失败（含 fail-closed）→ 保留选择 + 失败明细，可重试', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      let removeReject = true;
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
        remove_distributed: () => {
          if (removeReject) {
            return Promise.reject(
              new Error('移除目标已变化或不再受管，请重新扫描')
            );
          }
          return Promise.resolve({
            installed: [],
            updated: [],
            removed: ['s1'],
            skipped: 0,
            errors: [],
          });
        },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByRole('button', { name: /查看|收起/ }));
      await waitFor(() =>
        expect(screen.getByTestId('ws-managed-skill-s1')).toBeDefined()
      );
      fireEvent.click(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      );
      await waitFor(() =>
        expect(
          screen.getByTestId('ws-managed-confirm-remove')
        ).toHaveTextContent('确认移除 1 项')
      );
      fireEvent.click(screen.getByTestId('ws-managed-confirm-remove'));
      await waitFor(() =>
        expect(screen.getByText('确认移除受管内容')).toBeDefined()
      );
      fireEvent.click(screen.getByText('确认移除'));

      // store action toast 含后端 fail-closed 文案（appStore 实现：`移除失败: <errMsg>`）
      await waitFor(() =>
        expect(
          useAppStore
            .getState()
            .toasts.some(
              (t) =>
                t.message.includes('移除失败') &&
                t.message.includes('请重新扫描')
            )
        ).toBe(true)
      );
      // 面板结果行显示失败文案
      await waitFor(() =>
        expect(
          screen.getByTestId('ws-managed-remove-result')
        ).toHaveTextContent('移除失败，可重试')
      );
      // 选择保留（checkbox 仍选中），可重试
      expect(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      ).toBeChecked();

      removeReject = false;
      fireEvent.click(screen.getByTestId('ws-managed-confirm-remove'));
      await waitFor(() =>
        expect(screen.getByText('确认移除受管内容')).toBeDefined()
      );
      fireEvent.click(screen.getByText('确认移除'));
      const removeCalls = (invoke as any).mock.calls.filter(
        (c: string[]) => c[0] === 'remove_distributed'
      );
      expect(removeCalls.length).toBe(2);
      await waitFor(() =>
        expect(
          screen.getByTestId('ws-managed-remove-result')
        ).toHaveTextContent('已移除 1 项')
      );
    });

    it('部分失败：s1 成功清除、r1 失败保留可重试 + 错误明细 + 面板刷新', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [{ id: 'r1', path: '/home/.claude-code/rules/Style.md' }],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
        get_sync_status: { platforms: [] },
        remove_distributed: {
          installed: [],
          updated: [],
          removed: ['s1'],
          skipped: 0,
          errors: ['移除 r1 失败：目标规则文件已被用户修改，无法确认所有权'],
        },
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByRole('button', { name: /查看|收起/ }));
      await waitFor(() =>
        expect(screen.getByTestId('ws-managed-skill-s1')).toBeDefined()
      );
      fireEvent.click(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      );
      fireEvent.click(
        within(screen.getByTestId('ws-managed-rule-r1')).getByRole('checkbox')
      );
      await waitFor(() =>
        expect(
          screen.getByTestId('ws-managed-confirm-remove')
        ).toHaveTextContent('确认移除 2 项')
      );
      fireEvent.click(screen.getByTestId('ws-managed-confirm-remove'));
      await waitFor(() =>
        expect(screen.getByText('确认移除受管内容')).toBeDefined()
      );
      fireEvent.click(screen.getByText('确认移除'));

      // 部分失败：partial 文案（removed=1 / failed=1）+ 错误明细逐条渲染
      await waitFor(() =>
        expect(
          screen.getByTestId('ws-managed-remove-result')
        ).toHaveTextContent('部分失败：已移除 1 项，失败 1 项')
      );
      expect(
        screen.getByText('移除 r1 失败：目标规则文件已被用户修改，无法确认所有权')
      ).toBeDefined();

      // 成功项 s1 从选择中清除，失败项 r1 保留可重试（确认按钮计数回到 1 且可用）
      expect(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      ).not.toBeChecked();
      expect(
        within(screen.getByTestId('ws-managed-rule-r1')).getByRole('checkbox')
      ).toBeChecked();
      expect(
        screen.getByTestId('ws-managed-confirm-remove')
      ).toHaveTextContent('确认移除 1 项');
      expect(screen.getByTestId('ws-managed-confirm-remove')).not.toBeDisabled();

      // 刷新行为：面板打开 1 次 + 移除后刷新 1 次
      await waitFor(() => {
        const refreshCalls = (invoke as any).mock.calls.filter(
          (c: string[]) => c[0] === 'get_managed_distribution_state'
        );
        expect(refreshCalls.length).toBe(2);
      });

      // 重试仅携带 r1（s1 不再出现在 remove_distributed 参数中）
      fireEvent.click(screen.getByTestId('ws-managed-confirm-remove'));
      await waitFor(() =>
        expect(screen.getByText('确认移除受管内容')).toBeDefined()
      );
      fireEvent.click(screen.getByText('确认移除'));
      await waitFor(() => {
        const removeCalls = (invoke as any).mock.calls.filter(
          (c: string[]) => c[0] === 'remove_distributed'
        );
        expect(removeCalls.length).toBe(2);
        expect(removeCalls[1][1]).toEqual({
          platformIds: ['claude-code'],
          scope: 'global',
          skillIds: [],
          ruleIds: ['r1'],
        });
      });
    });

    it('取消二次确认 → 保留面板选择（勾选不清空）', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByRole('button', { name: /查看|收起/ }));
      await waitFor(() =>
        expect(screen.getByTestId('ws-managed-skill-s1')).toBeDefined()
      );
      fireEvent.click(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      );
      fireEvent.click(screen.getByTestId('ws-managed-confirm-remove'));
      await waitFor(() =>
        expect(screen.getByText('确认移除受管内容')).toBeDefined()
      );
      // 取消 → 弹窗关闭、checkbox 仍选中、未调用 remove_distributed
      fireEvent.click(screen.getByText('取消'));
      await waitFor(() =>
        expect(screen.queryByText('确认移除受管内容')).toBeNull()
      );
      expect(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      ).toBeChecked();
      const removeCalls = (invoke as any).mock.calls.filter(
        (c: string[]) => c[0] === 'remove_distributed'
      );
      expect(removeCalls.length).toBe(0);
    });
  });

  describe('managed panel context switch reset (review fix)', () => {
    it('切换平台后受管面板关闭且移除标记清空（重新打开需重新拉取）', async () => {
      seedStore({
        platforms: [
          mkPlat('claude-code', 'Claude Code'),
          mkPlat('opencode', 'OpenCode'),
        ],
      });
      await setupInvoke({
        ...baseRoutes(),
        list_platforms: [
          mkPlat('claude-code', 'Claude Code'),
          mkPlat('opencode', 'OpenCode'),
        ],
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
            {
              platform_id: 'opencode',
              platform_name: 'OpenCode',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.opencode/skills/React' }],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );

      // 打开受管面板并勾选 s1 待移除
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      await screen.findByTestId('ws-managed-skill-s1');
      fireEvent.click(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      );
      await waitFor(() =>
        expect(
          within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
        ).toBeChecked()
      );

      // 切换平台 → 面板关闭
      fireEvent.change(screen.getByTestId('dist-platform'), {
        target: { value: 'opencode' },
      });
      await waitFor(() =>
        expect(screen.queryByTestId('ws-managed-panel')).toBeNull()
      );

      // 重新打开面板：移除标记已清空（计数 0、checkbox 未选中）
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      const summary = await screen.findByTestId('ws-managed-summary');
      expect(summary.textContent).toContain('当前待移除 0 项');
      expect(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      ).not.toBeChecked();
    });

    it('切换目标后受管面板关闭且移除标记清空（重新打开需重新拉取）', async () => {
      await setupInvoke({
        ...baseRoutes(),
        get_managed_distribution_state: {
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'global',
              project_path: null,
              skills: [{ id: 's1', path: '/home/.claude-code/skills/React' }],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              scope: 'project',
              project_path: '/tmp/p-1',
              skills: [
                { id: 's1', path: '/tmp/p-1/.claude-code/skills/React' },
              ],
              rules: [],
              local_skills: [],
              local_rules: [],
            },
          ],
        },
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );

      // 打开受管面板并勾选 s1 待移除
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      await screen.findByTestId('ws-managed-skill-s1');
      fireEvent.click(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      );
      await waitFor(() =>
        expect(
          within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
        ).toBeChecked()
      );

      // 切换目标：global → project:p-1 → 面板关闭
      fireEvent.change(screen.getByLabelText('ws.targetLabel'), {
        target: { value: 'project:p-1' },
      });
      await waitFor(() =>
        expect(screen.queryByTestId('ws-managed-panel')).toBeNull()
      );

      // 重新打开面板：移除标记已清空
      fireEvent.click(
        screen.getByRole('button', { name: /查看|收起/ })
      );
      const summary = await screen.findByTestId('ws-managed-summary');
      expect(summary.textContent).toContain('当前待移除 0 项');
      expect(
        within(screen.getByTestId('ws-managed-skill-s1')).getByRole('checkbox')
      ).not.toBeChecked();
    });
  });
});
