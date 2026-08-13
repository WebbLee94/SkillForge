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
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

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
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) return Promise.resolve(routes[cmd]);
    return Promise.reject(new Error(`Unexpected: ${cmd}`));
  });
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

  it('「去工作区分发」carries the project context and navigates to the shared workspace', async () => {
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
});
