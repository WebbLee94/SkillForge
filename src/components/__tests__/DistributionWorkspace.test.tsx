import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { DistributionWorkspace } from '../DistributionWorkspace';
import { useAppStore } from '../../stores/appStore';
import { SELECT_CLASSES } from '../../lib/ui-tokens';
import type { Platform, Project, Scene, Rule, Skill } from '../../types';

/* Hoisted mocks */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const openerMocks = vi.hoisted(() => ({
  openPath: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: openerMocks.openPath,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'ws.sourceFromScene') {
        return `来自 Scene：${params?.name ?? ''}`;
      }
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
  await waitFor(() => expect(screen.getByText('ws.planTarget')).toBeDefined());
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
    openerMocks.openPath.mockClear();
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

    it('项目目标下 Rules 路径按 project_rules_pattern 解析 {project}', async () => {
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
      expect(screen.getByTestId('ws-rules-path').textContent).toBe(
        '/tmp/p-1/.cursor/rules'
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
      expect(projectPath).toContain('/tmp/p-1');
    });

    it('preserves the full backend project skills pattern for project targets', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByLabelText('ws.targetLabel')).toBeDefined()
      );

      // Regression: {project} substitution must keep the full pattern incl. the "skills" segment
      fireEvent.change(screen.getByLabelText('ws.targetLabel'), {
        target: { value: 'project:p-1' },
      });
      expect(screen.getByTestId('ws-skills-path').textContent).toBe(
        '/tmp/p-1/.claude-code/skills'
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
      expect(screen.getByTestId('ws-skills-path').textContent).toContain(
        '/tmp/p-1'
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
      expect(screen.getByText('ws.planTarget')).toBeDefined();

      fireEvent.click(screen.getByText('ws.backStep'));
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.backStep'));
      await waitFor(() =>
        expect(screen.getByLabelText('ws.targetLabel')).toBeDefined()
      );

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
      expect(screen.getByText('/tmp/p-1/.claude-code/skills')).toBeDefined();
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

      fireEvent.click(screen.getByText('ws.managedToggle'));
      await waitFor(() =>
        expect(screen.getByText('ws.managedPanelTitle')).toBeDefined()
      );
      expect(screen.getByText('ws.revealMac')).toBeDefined();
      expect(screen.getByText('ws.managedSkills')).toBeDefined();
      expect(screen.getByText('ws.managedRules')).toBeDefined();
      expect(screen.getByText('user-skill')).toBeDefined();
    });

    it('calls the platform-native reveal action when the reveal button is clicked', async () => {
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
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.managedToggle'));
      await waitFor(() =>
        expect(screen.getByText('ws.revealMac')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.revealMac'));
      await waitFor(() => expect(openerMocks.openPath).toHaveBeenCalled());
      expect(openerMocks.openPath.mock.calls[0][0]).toContain('.claude-code');
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
        expect(screen.getByText('ws.planTitle')).toBeDefined()
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

    it('labels removal count and requires double confirmation when removals present', async () => {
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
        preview_distribution: mkPlan({
          platforms: [
            {
              platform_id: 'claude-code',
              platform_name: 'Claude Code',
              skills_to_add: [],
              skills_to_update: [],
              skills_to_remove: ['s1'],
              rules_to_add: [],
              rules_to_update: [],
              rules_to_remove: [],
            },
          ],
          has_removals: true,
        }),
        execute_distribution: mkResult({ removed: ['s1'] }),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );

      // Enter managed panel and toggle a removal
      fireEvent.click(screen.getByText('ws.managedToggle'));
      await waitFor(() => expect(screen.getByText('React')).toBeDefined());
      fireEvent.click(
        screen.getByLabelText('ws.removeSkill', { exact: false })
      );

      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('ws.nextToPlan'));

      await waitForPlanReady();
      const confirmLabel = screen.getByText(/ws.confirmDistributeRemove/);
      expect(confirmLabel).toBeDefined();

      // C17: remove-count is announced via a live region (role=status + aria-live)
      const liveRegion = confirmLabel.closest(
        '[role="status"], [aria-live="polite"]'
      );
      expect(liveRegion).toBeTruthy();
      expect(liveRegion?.getAttribute('role')).toBe('status');
      expect(liveRegion?.getAttribute('aria-live')).toBe('polite');

      // Double confirmation dialog appears before executing
      fireEvent.click(confirmLabel.closest('button')!);
      await waitFor(() =>
        expect(screen.getByText('ws.confirmRemoveTitle')).toBeDefined()
      );
      expect(invoke).not.toHaveBeenCalledWith(
        'execute_distribution',
        expect.anything()
      );
      fireEvent.click(screen.getByText('ws.confirmRemoveConfirm'));
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          'execute_distribution',
          expect.anything()
        )
      );
    });
  });

  describe('step 4 — execute and result', () => {
    it('executes distribution and shows the five-category result grid', async () => {
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
      expect(screen.getByText('ws.resultInstalled')).toBeDefined();
      expect(screen.getByText('ws.resultUpdated')).toBeDefined();
      expect(screen.getByText('ws.resultRemoved')).toBeDefined();
      expect(screen.getByText('ws.resultSkipped')).toBeDefined();
      expect(screen.getByText('ws.resultErrors')).toBeDefined();
      expect(screen.queryByText('ws.retryFailed')).toBeNull();
      expect(screen.getByText('ws.distributeAgain')).toBeDefined();
      expect(screen.getByText('ws.closeWorkspace')).toBeDefined();
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

    it('back at step 1 cancels the distribution with a no-rollback toast', async () => {
      await setupInvoke({
        ...baseRoutes(),
        preview_distribution: mkPlan(),
        execute_distribution: mkResult(),
      });
      render(<DistributionWorkspace />);
      await waitFor(() =>
        expect(screen.getByText('ws.step1.title')).toBeDefined()
      );
      fireEvent.click(screen.getByText('ws.backStep'));
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes('ws.cancelNoRollback'))
      ).toBe(true);
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
      expect(screen.getByText('来自 Scene：React 基础')).toBeDefined();
      expect(screen.getByText('ws.noWritebackHint')).toBeDefined();
      expect(screen.getByTestId('ws-scene-source')).toBeDefined();
      expect(screen.getAllByText('ws.sourceHint').length).toBeGreaterThan(0);
      expect(useAppStore.getState().pendingDistributionSelection).toBeNull();
    });
  });

  describe('mixed add/remove intent', () => {
    it('blocks advancing when skill additions and managed skill removals are both selected, instead of silently discarding additions', async () => {
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

      // Mark managed skill s1 for removal
      fireEvent.click(screen.getByText('ws.managedToggle'));
      await waitFor(() => expect(screen.getByText('React')).toBeDefined());
      fireEvent.click(
        screen.getByLabelText('ws.removeSkill', { exact: false })
      );

      // Select s2 as an addition in step 2
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('Vue'));

      fireEvent.click(screen.getByText('ws.nextToPlan'));

      // Blocked: still on step 2, conflict toast shown, no preview submitted
      expect(screen.getByLabelText('ws.sourceLabel')).toBeDefined();
      expect(screen.queryByText('ws.planTitle')).toBeNull();
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes('ws.mixedAddRemoveBlocked'))
      ).toBe(true);
      const previewCalls = (invoke as any).mock.calls.filter(
        (c: string[]) => c[0] === 'preview_distribution'
      );
      expect(previewCalls.length).toBe(0);
    });

    it('blocks advancing when rule additions and managed rule removals are both selected, instead of silently discarding additions', async () => {
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

      // Mark managed rule r1 for removal
      fireEvent.click(screen.getByText('ws.managedToggle'));
      await waitFor(() => expect(screen.getByText('Style.md')).toBeDefined());
      fireEvent.click(screen.getByLabelText('ws.removeRule', { exact: false }));

      // Select r2 as an addition in step 2
      fireEvent.click(screen.getByText('ws.nextToResources'));
      await waitForStep2();
      fireEvent.click(screen.getByText('Lint'));

      fireEvent.click(screen.getByText('ws.nextToPlan'));

      // Blocked: still on step 2, conflict toast shown, no preview submitted
      expect(screen.getByLabelText('ws.sourceLabel')).toBeDefined();
      expect(screen.queryByText('ws.planTitle')).toBeNull();
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes('ws.mixedAddRemoveBlocked'))
      ).toBe(true);
      const previewCalls = (invoke as any).mock.calls.filter(
        (c: string[]) => c[0] === 'preview_distribution'
      );
      expect(previewCalls.length).toBe(0);
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
        expect(screen.getByText('ws.planTitle')).toBeDefined()
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
      fireEvent.click(screen.getByText('ws.managedToggle'));
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
});
