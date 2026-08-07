import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { DistributeDialog } from '../DistributeDialog';
import { useAppStore } from '../../stores/appStore';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

// t mock: returns distinguishable strings so we can target buttons/text
const mockT = vi.fn((key: string, params?: Record<string, unknown>) => {
  if (key === 'distributeDialogTitle') return 'Distribute Dialog Title';
  if (key === 'distributeTo') return '→ Distribute';
  if (key === 'selectPlatformFirst') return 'Please select a platform';
  if (key === 'distributing') return 'Distributing…';
  if (key === 'scenePackageOptional') return 'Scene Package (Optional)';
  if (key === 'allSkillsRules') return 'All Skills + Rules';
  if (key === 'searchSkillsRules') return 'Search skills/rules';
  if (key === 'distributeSuccess') return '✓ Success';
  if (key === 'distributeWarning') return '⚠ Warning';
  if (key === 'noChanges') return 'No changes';
  if (key === 'missingProjectId') return 'Please select a project';
  if (key === 'skillsCount') return `Skills (${String(params?.count ?? 0)})`;
  if (key === 'rulesCount') return `Rules (${String(params?.count ?? 0)})`;
  if (key === 'manageDistributedContent') return 'Manage distributed content';
  if (key === 'backToDistribute') return 'Back to distribution';
  if (key === 'managedRemovalWarning') return 'Only SkillForge-managed content can be removed';
  if (key === 'managedOnlyHint') return 'Unknown content cannot be selected';
  if (key === 'managedSkills') return 'Distributed skills';
  if (key === 'managedRules') return 'Distributed rules';
  if (key === 'noManagedSkills') return 'No managed skills';
  if (key === 'noManagedRules') return 'No managed rules';
  if (key === 'unknownContent') return 'Unknown content';
  if (key === 'localUnmanagedContent') return 'Local unmanaged content';
  if (key === 'localUnmanagedHint') return 'Local content cannot be selected';
  if (key === 'removeSelected') return `Confirm distribution and remove ${String(params?.count ?? 0)} items`;
  // For common namespace keys used via "common:actions.cancel"
  const last = key.split('.').pop() || key;
  return last;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}));

// ---- Fixtures ----

const mockPlatforms: any[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    adapter: 'fs',
    enabled: true,
    icon: null,
    paths: {
      global_skills_dir: '/x',
      project_skills_pattern: 'x',
      global_rules_dir: null,
      project_rules_pattern: null,
      global_rules_format: null,
      project_rules_format: null,
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    adapter: 'fs',
    enabled: true,
    icon: null,
    paths: {
      global_skills_dir: '/x',
      project_skills_pattern: 'x',
      global_rules_dir: null,
      project_rules_pattern: null,
      global_rules_format: null,
      project_rules_format: null,
    },
  },
];

const mockSkills: any[] = [
  {
    id: 's1',
    name: 'React',
    description: null,
    source_type: 'custom',
    source_url: null,
    current_ver: null,
    installed_at: '',
    local_path: '',
    metadata: null,
  },
  {
    id: 's2',
    name: 'Vue',
    description: null,
    source_type: 'custom',
    source_url: null,
    current_ver: null,
    installed_at: '',
    local_path: '',
    metadata: null,
  },
];

const mockRules: any[] = [
  {
    id: 'r1',
    name: 'Style',
    description: null,
    format: 'md',
    content: '# style',
    platform: null,
    scope: 'global',
    version: 1,
    updated_at: '',
  },
  {
    id: 'r2',
    name: 'Lint',
    description: null,
    format: 'yaml',
    content: 'rules: []',
    platform: null,
    scope: 'global',
    version: 1,
    updated_at: '',
  },
];

const mockScenes: any[] = [
  {
    id: 'scene-1',
    name: 'Frontend',
    description: null,
    icon: null,
    is_template: false,
    is_system: false,
    created_at: '',
    updated_at: '',
  },
];

// ---- Helpers ----

function resetStore() {
  useAppStore.setState({
    skills: mockSkills,
    rules: mockRules,
    tags: [],
    scenes: mockScenes,
    projects: [],
    platforms: mockPlatforms,
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
    managedDistributionState: null,
    pendingRemovalConfirmation: false,
    pendingSyncConfirm: null,
    resolveSyncConfirm: null,
  });
}

/** Configure invoke mock to respond to given command routes. */
async function setupInvoke(routes: Record<string, unknown | Error>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) {
      const v = routes[cmd];
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    }
    return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
  });
}

/** Find the distribute button (last button in dialog, text "→ Distribute") */
function findDistributeBtn(): HTMLElement | null {
  const all = screen.getAllByRole('button');
  return all.find((b) => b.textContent?.includes('→ Distribute')) ?? null;
}

// ---- Tests ----

describe('DistributeDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });

  // ----- Basic rendering -----

  it('renders nothing when closed', () => {
    const { container } = render(
      <DistributeDialog open={false} onClose={vi.fn()} scope="global" />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when closed in project mode', () => {
    const project = {
      id: 'p1',
      name: 'MyProj',
      path: '/tmp/p',
      scene_id: null,
      description: null,
      created_at: '',
      updated_at: '',
    };
    const { container } = render(
      <DistributeDialog
        open={false}
        onClose={vi.fn()}
        scope="project"
        project={project}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog content when open', () => {
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);
    expect(screen.getByText('Distribute Dialog Title')).toBeDefined();
  });

  it('renders with scene select options', () => {
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);
    expect(screen.getByText('Frontend')).toBeDefined();
  });

  it('disables distribute button when no platform selected', () => {
    useAppStore.setState({ platforms: [] });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);
    const btn = screen.getByText('Please select a platform');
    expect(btn.closest('button')).toBeDisabled();
  });

  // ----- Selection parameters -----

  it('passes null scene and no projectId to requestSyncConfirm in global scope', async () => {
    await setupInvoke({ preview_distribution: { platforms: [], has_removals: false } });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);

    const btn = findDistributeBtn();
    expect(btn).not.toBeNull();
    expect(btn!.closest('button')).not.toBeDisabled();
    fireEvent.click(btn!);

    const { invoke } = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('preview_distribution', {
        sceneId: null,
        platformIds: ['claude-code'],
        scope: 'global',
        skills: { mode: 'preserve', ids: [] },
        rules: { mode: 'preserve', ids: [] },
      });
    });
  });

  it('passes correct selection with projectId in project scope', async () => {
    await setupInvoke({ preview_distribution: { platforms: [], has_removals: false } });
    const project = {
      id: 'p-42',
      name: 'Acme',
      path: '/tmp/acme',
      scene_id: null,
      description: null,
      created_at: '',
      updated_at: '',
    };
    render(
      <DistributeDialog
        open
        onClose={vi.fn()}
        scope="project"
        project={project}
      />
    );

    const btn = findDistributeBtn();
    fireEvent.click(btn!);

    const { invoke } = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('preview_distribution', {
        sceneId: null,
        platformIds: ['claude-code'],
        scope: 'project',
        projectId: 'p-42',
        skills: { mode: 'preserve', ids: [] },
        rules: { mode: 'preserve', ids: [] },
      });
    });
  });

  it('sends preserve Skills and add_or_update Rules for Rules-only distribution', async () => {
    await setupInvoke({ preview_distribution: { platforms: [], has_removals: false } });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);

    fireEvent.click(screen.getByText('Style.md'));
    fireEvent.click(findDistributeBtn()!);

    const { invoke } = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('preview_distribution', {
        sceneId: null,
        platformIds: ['claude-code'],
        scope: 'global',
        skills: { mode: 'preserve', ids: [] },
        rules: { mode: 'add_or_update', ids: ['r1'] },
      });
    });
  });

  // ----- Flow: confirmed path -----

  it('calls executeDistribution only when confirmed', async () => {
    const plan = {
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
    };
    await setupInvoke({
      preview_distribution: plan,
      execute_distribution: { installed: ['s1'], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);

    fireEvent.click(screen.getByText('React'));
    const btn = findDistributeBtn();
    fireEvent.click(btn!);

    await vi.waitFor(() => {
      expect(useAppStore.getState().pendingSyncConfirm).not.toBeNull();
    });

    const resolve = useAppStore.getState().resolveSyncConfirm;
    resolve!(true);

    const { invoke } = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'execute_distribution',
        expect.objectContaining({
          selection: expect.objectContaining({
            skills: { mode: 'add_or_update', ids: ['s1'] },
            rules: { mode: 'preserve', ids: [] },
          }),
          plan,
        })
      );
    });
  });

  it('calls executeDistribution exactly once on confirmed', async () => {
    const plan = {
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
    };
    await setupInvoke({
      preview_distribution: plan,
      execute_distribution: { installed: ['s1'], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);

    fireEvent.click(screen.getByText('React'));
    const btn = findDistributeBtn();
    fireEvent.click(btn!);

    await vi.waitFor(() => {
      expect(useAppStore.getState().pendingSyncConfirm).not.toBeNull();
    });

    const resolve = useAppStore.getState().resolveSyncConfirm;
    resolve!(true);

    const { invoke } = await import('@tauri-apps/api/core');
    await vi.waitFor(() => {
      const executeCalls = (invoke as any).mock.calls.filter(
        (c: any[]) => c[0] === 'execute_distribution'
      );
      expect(executeCalls).toHaveLength(1);
    });
  });

  it('executes confirmed Rules-only selection with Skills preserved', async () => {
    const plan = {
      platforms: [
        {
          platform_id: 'claude-code',
          platform_name: 'Claude Code',
          skills_to_add: [],
          skills_to_update: [],
          skills_to_remove: [],
          rules_to_add: ['r1'],
          rules_to_update: [],
          rules_to_remove: [],
        },
      ],
      has_removals: false,
    };
    await setupInvoke({
      preview_distribution: plan,
      execute_distribution: { installed: [], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);

    fireEvent.click(screen.getByText('Style.md'));
    fireEvent.click(findDistributeBtn()!);
    await vi.waitFor(() => {
      expect(useAppStore.getState().pendingSyncConfirm).not.toBeNull();
    });
    useAppStore.getState().resolveSyncConfirm?.(true);

    const { invoke } = await import('@tauri-apps/api/core');
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'execute_distribution',
        expect.objectContaining({
          selection: expect.objectContaining({
            scope: 'global',
            skills: { mode: 'preserve', ids: [] },
            rules: { mode: 'add_or_update', ids: ['r1'] },
          }),
          plan,
        })
      );
    });
  });

  it('executes confirmed project selection with its projectId', async () => {
    const plan = {
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
    };
    await setupInvoke({
      preview_distribution: plan,
      execute_distribution: { installed: ['s1'], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });
    const project = {
      id: 'p-42',
      name: 'Acme',
      path: '/tmp/acme',
      scene_id: null,
      description: null,
      created_at: '',
      updated_at: '',
    };
    render(
      <DistributeDialog
        open
        onClose={vi.fn()}
        scope="project"
        project={project}
      />
    );

    fireEvent.click(screen.getByText('React'));
    fireEvent.click(findDistributeBtn()!);
    await vi.waitFor(() => {
      expect(useAppStore.getState().pendingSyncConfirm).not.toBeNull();
    });
    useAppStore.getState().resolveSyncConfirm?.(true);

    const { invoke } = await import('@tauri-apps/api/core');
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'execute_distribution',
        expect.objectContaining({
          selection: expect.objectContaining({
            scope: 'project',
            projectId: 'p-42',
          }),
          plan,
        })
      );
    });
  });

  // ----- Flow: no_changes / cancelled / preview_failed -----

  it('does not call executeDistribution when result is no_changes', async () => {
    await setupInvoke({ preview_distribution: { platforms: [], has_removals: false } });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);

    const btn = findDistributeBtn();
    fireEvent.click(btn!);

    const { invoke } = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('preview_distribution', expect.anything());
    });

    await vi.waitFor(() => {
      const executeCalls = (invoke as any).mock.calls.filter(
        (c: any[]) => c[0] === 'execute_distribution'
      );
      expect(executeCalls).toHaveLength(0);
    });
  });

  it('does not call executeDistribution when user cancels', async () => {
    const plan = {
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
    };
    await setupInvoke({ preview_distribution: plan });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);

    const btn = findDistributeBtn();
    fireEvent.click(btn!);

    await vi.waitFor(() => {
      expect(useAppStore.getState().pendingSyncConfirm).not.toBeNull();
    });

    // Cancel
    const resolve = useAppStore.getState().resolveSyncConfirm;
    resolve!(false);

    const { invoke } = await import('@tauri-apps/api/core');
    await vi.waitFor(() => {
      const executeCalls = (invoke as any).mock.calls.filter(
        (c: any[]) => c[0] === 'execute_distribution'
      );
      expect(executeCalls).toHaveLength(0);
    });
  });

  it('cancels a pending confirmation when the dialog closes externally', async () => {
    const plan = {
      platforms: [{
        platform_id: 'claude-code',
        platform_name: 'Claude Code',
        skills_to_add: ['s1'],
        skills_to_update: [],
        skills_to_remove: [],
        rules_to_add: [],
        rules_to_update: [],
        rules_to_remove: [],
      }],
      has_removals: false,
    };
    const onClose = vi.fn();
    await setupInvoke({ preview_distribution: plan });
    render(<DistributeDialog open onClose={onClose} scope="global" />);
    fireEvent.click(screen.getByText('React'));
    fireEvent.click(findDistributeBtn()!);
    await vi.waitFor(() => expect(useAppStore.getState().resolveSyncConfirm).not.toBeNull());

    fireEvent.click(screen.getByText('cancel'));

    await vi.waitFor(() => {
      expect(useAppStore.getState().pendingSyncConfirm).toBeNull();
      expect(useAppStore.getState().resolveSyncConfirm).toBeNull();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call executeDistribution when preview fails', async () => {
    await setupInvoke({ preview_distribution: new Error('preview error') });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);

    const btn = findDistributeBtn();
    fireEvent.click(btn!);

    const { invoke } = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('preview_distribution', expect.anything());
    });

    await vi.waitFor(() => {
      const executeCalls = (invoke as any).mock.calls.filter(
        (c: any[]) => c[0] === 'execute_distribution'
      );
      expect(executeCalls).toHaveLength(0);
    });
  });

  // ----- Duplicate click guard -----

  it('prevents duplicate clicks during the flow', async () => {
    const plan = {
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
    };
    await setupInvoke({
      preview_distribution: plan,
      execute_distribution: { installed: ['s1'], updated: [], removed: [], errors: [] },
      get_distributions: [],
      get_sync_status: { platforms: [] },
      get_global_distribution_status: { platforms: [] },
    });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);

    const btn = findDistributeBtn();
    // Click twice rapidly
    fireEvent.click(btn!);
    fireEvent.click(btn!);

    const { invoke } = await import('@tauri-apps/api/core');
    await vi.waitFor(() => {
      const previewCalls = (invoke as any).mock.calls.filter(
        (c: any[]) => c[0] === 'preview_distribution'
      );
      expect(previewCalls).toHaveLength(1);
    });

    useAppStore.getState().resolveSyncConfirm?.(true);
    useAppStore.getState().resolveSyncConfirm?.(true);
    await vi.waitFor(() => {
      const executeCalls = (invoke as any).mock.calls.filter(
        (c: any[]) => c[0] === 'execute_distribution'
      );
      expect(executeCalls).toHaveLength(1);
    });
  });

  // ----- Missing projectId guard -----

  it('blocks preview/sync when scope is project but no projectId', async () => {
    await setupInvoke({ preview_distribution: { platforms: [], has_removals: false } });
    render(
      <DistributeDialog
        open
        onClose={vi.fn()}
        scope="project"
        // no project prop — projectId will be undefined
      />
    );

    const btn = findDistributeBtn();
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);

    const { invoke } = await import('@tauri-apps/api/core');
    // Wait a tick for the async handler
    await vi.waitFor(() => {
      const previewCalls = (invoke as any).mock.calls.filter(
        (c: any[]) => c[0] === 'preview_distribution'
      );
      expect(previewCalls).toHaveLength(0);
    });
    const syncCalls = (invoke as any).mock.calls.filter(
        (c: any[]) => c[0] === 'execute_distribution'
    );
    expect(syncCalls).toHaveLength(0);

    // Error toast should have been added
    const toasts = useAppStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0].type).toBe('error');
  });

  it('loads global managed content and makes library entries selectable while unknown entries are not', async () => {
    await setupInvoke({
      get_managed_distribution_state: {
        platforms: [{
          platform_id: 'claude-code', platform_name: 'Claude Code', scope: 'global', project_path: null,
          skills: [{ id: 's1', path: '/managed/react' }, { id: 'unknown-skill', path: '/user/custom' }],
          rules: [{ id: 'r1', path: '/managed/style.md' }, { id: 'unknown-rule', path: '/user/rule.md' }],
        }],
      },
    });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);

    fireEvent.click(screen.getByText('Manage distributed content'));
    await waitFor(() => expect(screen.getByText('React')).toBeDefined());
    expect(screen.getByText('Style.md')).toBeDefined();
    expect(screen.getByText('/user/custom')).toBeDefined();
    expect(screen.getByText('/user/rule.md')).toBeDefined();
    expect(screen.queryByRole('button', { name: /unknown-skill/i })).toBeNull();
  });

  it('shows local unmanaged content as read-only entries', async () => {
    await setupInvoke({
      get_managed_distribution_state: {
        platforms: [{
          platform_id: 'claude-code', platform_name: 'Claude Code', scope: 'global', project_path: null,
          skills: [], rules: [],
          local_skills: [{ name: 'custom-skill', path: '/user/custom-skill' }],
          local_rules: [{ name: 'custom-rule.md', path: '/user/custom-rule.md' }],
        }],
      },
    });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);

    fireEvent.click(screen.getByText('Manage distributed content'));
    await waitFor(() => expect(screen.getByText('Local unmanaged content')).toBeDefined());
    expect(screen.getByText('custom-skill')).toBeDefined();
    expect(screen.getByText('custom-rule.md')).toBeDefined();
    expect(screen.queryByRole('button', { name: /custom-skill/i })).toBeNull();
  });

  it('loads project managed content with the projectId and sends exact remove_selected IDs', async () => {
    const plan = {
      platforms: [{ platform_id: 'claude-code', platform_name: 'Claude Code', skills_to_add: [], skills_to_update: [], skills_to_remove: ['s1'], rules_to_add: [], rules_to_update: [], rules_to_remove: ['r1'] }],
      has_removals: true,
    };
    await setupInvoke({
      get_managed_distribution_state: { platforms: [{ platform_id: 'claude-code', platform_name: 'Claude Code', scope: 'project', project_path: '/tmp/p', skills: [{ id: 's1', path: '/managed/react' }], rules: [{ id: 'r1', path: '/managed/style.md' }] }] },
      preview_distribution: plan,
    });
    const project = { id: 'p1', name: 'Project', path: '/tmp/p', scene_id: null, description: null, created_at: '', updated_at: '' };
    render(<DistributeDialog open onClose={vi.fn()} scope="project" project={project} />);

    fireEvent.click(screen.getByText('Manage distributed content'));
    await waitFor(() => expect(screen.getByText('React')).toBeDefined());
    fireEvent.click(screen.getByText('React'));
    fireEvent.click(screen.getByText('Style.md'));
    fireEvent.click(screen.getByText(/Confirm distribution and remove 2 items/));

    const { invoke } = await import('@tauri-apps/api/core');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_managed_distribution_state', {
      platformIds: ['claude-code'], scope: 'project', projectId: 'p1',
    }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('preview_distribution', expect.objectContaining({
      scope: 'project', projectId: 'p1',
      skills: { mode: 'remove_selected', ids: ['s1'] },
      rules: { mode: 'remove_selected', ids: ['r1'] },
    })));
  });

  it('filters a managed ID that disappears from the library before submission', async () => {
    const plan = { platforms: [{ platform_id: 'claude-code', platform_name: 'Claude Code', skills_to_add: [], skills_to_update: [], skills_to_remove: ['s1'], rules_to_add: [], rules_to_update: [], rules_to_remove: [] }], has_removals: true };
    await setupInvoke({
      get_managed_distribution_state: { platforms: [{ platform_id: 'claude-code', platform_name: 'Claude Code', scope: 'global', project_path: null, skills: [{ id: 's1', path: '/managed/react' }, { id: 's2', path: '/managed/vue' }], rules: [] }] },
      preview_distribution: plan,
    });
    render(<DistributeDialog open onClose={vi.fn()} scope="global" />);
    fireEvent.click(screen.getByText('Manage distributed content'));
    await waitFor(() => expect(screen.getByText('React')).toBeDefined());
    fireEvent.click(screen.getByText('Vue'));
    fireEvent.click(screen.getByText('React'));
    act(() => useAppStore.setState({ skills: [mockSkills[0]] }));
    await waitFor(() => expect(useAppStore.getState().skills).toHaveLength(1));
    fireEvent.click(screen.getByText(/Confirm distribution and remove 2 items/));

    const { invoke } = await import('@tauri-apps/api/core');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('preview_distribution', expect.objectContaining({
      skills: { mode: 'remove_selected', ids: ['s1'] },
    })));
  });
});
