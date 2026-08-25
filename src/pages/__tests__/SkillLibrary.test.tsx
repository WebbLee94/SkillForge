import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { SkillLibrary } from '../SkillLibrary';
import { useAppStore } from '../../stores/appStore';
import { SEARCH_INPUT_CLASSES } from '../../lib/ui-tokens';
import type { Skill, Tag } from '../../types';

/* ===== Hoisted mocks ===== */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readDir: vi.fn() }));

// zh 测试环境仅映射搜索框 placeholder 为全角中文；生产 JSX 使用 t('searchPlaceholder')（决策 9）
const { tMap } = vi.hoisted(() => ({
  tMap: {
    searchPlaceholder: '搜索技能…',
    'view.expandGroups': '展开分组',
    'view.collapseGroups': '收起分组',
  } as Record<string, string>,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty' },
  useTranslation: () => ({
    t: (key: string) => tMap[key] ?? key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

/* ===== Factories ===== */
const mkSkill = (
  id: string,
  name: string,
  overrides?: Partial<Skill>
): Skill => ({
  id,
  name,
  description: `Description for ${name}`,
  source_type: 'local',
  source_url: null,
  current_ver: '1.0.0',
  installed_at: '2025-01-15T10:00:00Z',
  local_path: `/path/${name}`,
  metadata: null,
  tags: [],
  ...overrides,
});

const mkTag = (id: number, name: string): Tag => ({
  id,
  name,
  color: '#3B82F6',
  tag_type: 'skill' as const,
  count: 2,
});

/* ===== Store reset ===== */
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
    activeNav: 'skills',
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

/* =================================================== */
/*  Tests                                              */
/* =================================================== */
describe('SkillLibrary', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('renders loading skeleton when loading is true', async () => {
    // Route the invoke mocks so the mount effect (fetchSkills/fetchTags) resolves
    // to real arrays; otherwise invoke returns undefined and fetchSkills would
    // set skills: undefined, crashing the skills.filter render.
    await setupInvoke({ list_skills: [], list_tags: [] });
    useAppStore.setState({ loading: true });
    render(<SkillLibrary />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(6);
  });

  it('shows empty state when no skills exist', async () => {
    await setupInvoke({ list_skills: [], list_tags: [] });
    render(<SkillLibrary />);
    // fetchSkills (useEffect) → invoke('list_skills') → [] → set state → re-render
    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });
  });

  it('renders skill cards populated from invoke', async () => {
    const tags: Tag[] = [mkTag(1, 'frontend'), mkTag(2, 'backend')];
    const skills: Skill[] = [
      mkSkill('s1', 'React', { tags: [tags[0]] }),
      mkSkill('s2', 'Express', { tags: [tags[1]] }),
    ];
    await setupInvoke({
      list_skills: skills,
      list_tags: tags,
    });

    render(<SkillLibrary />);

    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    expect(screen.getByText('Express')).toBeDefined();
  });

  it('filters skills by search query', async () => {
    const tags: Tag[] = [mkTag(1, 'frontend')];
    const skills: Skill[] = [
      mkSkill('s1', 'React', { tags: [tags[0]] }),
      mkSkill('s2', 'Express'),
    ];
    await setupInvoke({
      list_skills: skills,
      list_tags: tags,
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });

    // Type in the search box（决策 9：placeholder 全角省略号「搜索技能…」）
    const searchInput = screen.getByPlaceholderText('搜索技能…');
    fireEvent.change(searchInput, { target: { value: 'React' } });

    // Wait for debounce (300ms) + re-render
    await waitFor(
      () => {
        expect(screen.queryByText('Express')).toBeNull();
      },
      { timeout: 1500 }
    );
    expect(screen.getByText('React')).toBeDefined();
  });

  it('filters skills when a tag chip is clicked', async () => {
    const tags: Tag[] = [mkTag(1, 'frontend'), mkTag(2, 'backend')];
    const skills: Skill[] = [
      mkSkill('s1', 'React', { tags: [tags[0]] }),
      mkSkill('s2', 'Express', { tags: [tags[1]] }),
      mkSkill('s3', 'Node'),
    ];
    await setupInvoke({
      list_skills: skills,
      list_tags: tags,
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });

    // Click the tag filter chip for 'frontend' — exact accessible name (name + count)
    const frontendChip = screen.getByRole('button', { name: 'frontend2' });
    fireEvent.click(frontendChip);

    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    // Express and Node should be filtered out
    expect(screen.queryByText('Express')).toBeNull();
    expect(screen.queryByText('Node')).toBeNull();
  });

  it('shows detail panel when a skill is selected', async () => {
    const skills: Skill[] = [
      mkSkill('s1', 'React', { metadata: '{"author":"Test Author"}' }),
    ];
    await setupInvoke({
      list_skills: skills,
      list_tags: [],
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });

    // Click on the skill card
    const card =
      screen.getByText('React').closest('[style*="cursor: pointer"]') ||
      screen.getByText('React');
    fireEvent.click(card);

    await waitFor(() => {
      // The detail panel heading should show the skill name
      const headings = screen.getAllByText('React');
      expect(headings.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByText('detail.author')).toBeDefined();
    expect(screen.getByText('Test Author')).toBeDefined();
  });

  it('opens uninstall confirm dialog from detail panel', async () => {
    const skills: Skill[] = [mkSkill('s1', 'React')];
    await setupInvoke({
      list_skills: skills,
      list_tags: [],
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });

    // Select the skill first
    fireEvent.click(screen.getByText('React'));
    await waitFor(() => {
      const btns = screen.getAllByText('actions.uninstall');
      expect(btns.length).toBeGreaterThanOrEqual(1);
    });

    // Click the uninstall button in detail panel
    const uninstallBtns = screen.getAllByText('actions.uninstall');
    const detailUninstall = uninstallBtns[0];
    fireEvent.click(detailUninstall);

    await waitFor(() => {
      expect(screen.getByText('messages.confirmUninstall')).toBeDefined();
    });
  });

  it('handles fetch failure gracefully', async () => {
    await setupInvoke({
      list_skills: new Error('DB connection failed'),
      list_tags: new Error('DB connection failed'),
    });

    render(<SkillLibrary />);

    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });
  });
});
/* =================================================== */
/*  Phase 6 资源库交互契约（TASK-043）                 */
/* =================================================== */
describe('SkillLibrary — Phase 6 资源库交互契约', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('provides group/list view tabs with tab semantics (a11y)', async () => {
    await setupInvoke({ list_skills: [mkSkill('s1', 'React')], list_tags: [] });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    expect(screen.getByRole('tablist')).toBeDefined();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(2);
    // 默认分组视图
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabs[1]);
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('group view shows a multi-tag skill in multiple groups (same id, no copy)', async () => {
    const tags: Tag[] = [mkTag(1, 'frontend'), mkTag(2, 'backend')];
    const skills: Skill[] = [
      mkSkill('s1', 'Multi', { tags: [tags[0], tags[1]] }),
    ];
    await setupInvoke({ list_skills: skills, list_tags: tags });
    render(<SkillLibrary />);
    await waitFor(() => {
      const names = screen.getAllByText('Multi');
      expect(names.length).toBe(2);
    });
  });

  it('batch mode armed: shows compact guide + exit, no disabled action buttons', async () => {
    await setupInvoke({ list_skills: [mkSkill('s1', 'React')], list_tags: [] });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.batchSelect'));
    expect(screen.getByText('batch.guide')).toBeDefined();
    expect(screen.getByText('batch.exit')).toBeDefined();
    expect(screen.queryByText('batch.goDistribute')).toBeNull();
    expect(screen.queryByText('batch.manageTags')).toBeNull();
    expect(screen.queryByText('batch.delete')).toBeNull();
  });

  it('batch mode selected: shows the full action matrix', async () => {
    await setupInvoke({ list_skills: [mkSkill('s1', 'React')], list_tags: [] });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.batchSelect'));
    fireEvent.click(screen.getByText('React'));
    expect(screen.getByText('batch.goDistribute')).toBeDefined();
    expect(screen.getByText('batch.manageTags')).toBeDefined();
    expect(screen.getByText('batch.delete')).toBeDefined();
  });

  it('去分发 carries the selected ids into the distribution workspace', async () => {
    await setupInvoke({ list_skills: [mkSkill('s1', 'React')], list_tags: [] });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.batchSelect'));
    fireEvent.click(screen.getByText('React'));
    fireEvent.click(screen.getByText('batch.goDistribute'));
    const { pendingDistributionSelection, activeNav } = useAppStore.getState();
    expect(pendingDistributionSelection).toEqual({
      skillIds: ['s1'],
      ruleIds: [],
    });
    expect(activeNav).toBe('globalDistribution');
  });

  it('Inspector shows source + full timestamp and hides reveal when not distributed', async () => {
    const skills: Skill[] = [
      mkSkill('s1', 'React', { metadata: '{"author":"Test Author"}' }),
    ];
    await setupInvoke({
      list_skills: skills,
      list_tags: [],
      get_managed_copy_path: null,
    });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    fireEvent.click(screen.getByText('React'));
    await waitFor(() => {
      expect(screen.getByText('detail.source')).toBeDefined();
    });
    // 卡片相对时间与 Inspector 完整时间戳都可能包含年份
    expect(screen.getAllByText(/2025/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('在访达中显示')).toBeNull();
  });

  it('import dialog lists valid dirs and installs valid dirs on confirm', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    (open as any).mockResolvedValue(['/p/dir-a', '/p/dir-b']);
    const { readDir } = await import('@tauri-apps/plugin-fs');
    (readDir as any).mockResolvedValue([
      { name: 'SKILL.md', isFile: true },
      { name: 'other.txt', isFile: true },
    ]);
    await setupInvoke({ list_skills: [], list_tags: [], install_skill: {} });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });

    // 工具栏「导入技能」主操作（空态也有一个「导入」按钮）
    fireEvent.click(screen.getAllByText('actions.import')[0]);
    await waitFor(() => {
      expect(screen.getByText('install.title')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.append'));
    await waitFor(() => {
      expect(screen.getByText('dir-a')).toBeDefined();
      expect(screen.getByText('dir-b')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.confirmImport'));
    await waitFor(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      expect(invoke).toHaveBeenCalledWith('install_skill', {
        source: 'local-fs',
        skillId: '/p/dir-a',
      });
      expect(invoke).toHaveBeenCalledWith('install_skill', {
        source: 'local-fs',
        skillId: '/p/dir-b',
      });
    });
  });

  it('marks an already-imported dir as skip and does not install it', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    (open as any).mockResolvedValue(['/p/existing', '/p/new-a']);
    const { readDir } = await import('@tauri-apps/plugin-fs');
    (readDir as any).mockResolvedValue([{ name: 'SKILL.md', isFile: true }]);
    const existing = mkSkill('s1', 'Existing', { local_path: '/p/existing' });
    await setupInvoke({
      list_skills: [existing],
      list_tags: [],
      install_skill: {},
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('Existing')).toBeDefined();
    });

    fireEvent.click(screen.getAllByText('actions.import')[0]);
    await waitFor(() => {
      expect(screen.getByText('install.title')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.append'));
    await waitFor(() => {
      // 已存在目录标记 skip（附原因），新目录 valid
      expect(screen.getByText('import.reason.alreadyExists')).toBeDefined();
      expect(screen.getByText('new-a')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.confirmImport'));
    await waitFor(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      expect(invoke).not.toHaveBeenCalledWith('install_skill', {
        source: 'local-fs',
        skillId: '/p/existing',
      });
      expect(invoke).toHaveBeenCalledWith('install_skill', {
        source: 'local-fs',
        skillId: '/p/new-a',
      });
    });
  });
});

/* =================================================== */
/*  TASK-043 修复回归：Inspector 保存→刷新→脏状态清除    */
/* =================================================== */
describe('SkillLibrary — Inspector 标签保存后刷新（H1）', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('after saving a tag, the selected skill refreshes and dirty state clears', async () => {
    const tags: Tag[] = [mkTag(1, 'urgent')];
    const skill = mkSkill('s1', 'React', { tags: [] });
    const { invoke } = await import('@tauri-apps/api/core');
    let assigned = false;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'list_skills') {
        return Promise.resolve(
          assigned ? [{ ...skill, tags: [tags[0]] }] : [skill]
        );
      }
      if (cmd === 'list_tags') return Promise.resolve(tags);
      if (cmd === 'assign_tag') {
        assigned = true;
        return Promise.resolve(null);
      }
      return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    fireEvent.click(screen.getByText('React'));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'inspector.addTag' })
      ).toBeDefined();
    });

    // 通过 TagPopover 勾选标签 → 脏状态出现（filter bar 也渲染同名 chip，取 popover 行）
    fireEvent.click(screen.getByRole('button', { name: 'inspector.addTag' }));
    const urgentRows = screen.getAllByText('urgent');
    fireEvent.click(urgentRows[urgentRows.length - 1]);
    expect(screen.getByText('actions.save')).toBeDefined();

    // 保存 → assign_tag → refetch 返回带标签的 skill → 脏状态清除
    fireEvent.click(screen.getByText('actions.save'));
    await waitFor(() => {
      expect(screen.queryByText('actions.undo')).toBeNull();
      expect(screen.queryByText('actions.save')).toBeNull();
    });
    const { invoke: inv } = await import('@tauri-apps/api/core');
    expect(inv).toHaveBeenCalledWith('assign_tag', {
      targetType: 'skill',
      targetId: 's1',
      tagId: 1,
    });
  });
});

describe('SkillLibrary — 加载中禁用批量操作（M2）', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('disables the batch toggle while loading', async () => {
    await setupInvoke({ list_skills: [], list_tags: [] });
    useAppStore.setState({ loading: true });
    render(<SkillLibrary />);
    const btn = screen.getByText('actions.batchSelect').closest('button')!;
    expect(btn.disabled).toBe(true);
  });
});

describe('SkillLibrary — 混合 valid+error 导入结果（M3）', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('error dir shows failed result with retry in result phase', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    (open as any).mockResolvedValue(['/p/dir-a', '/p/dir-b']);
    const { readDir } = await import('@tauri-apps/plugin-fs');
    (readDir as any).mockImplementation((p: string) =>
      p === '/p/dir-a'
        ? Promise.resolve([{ name: 'SKILL.md', isFile: true }])
        : Promise.reject(new Error('read failed'))
    );
    await setupInvoke({ list_skills: [], list_tags: [], install_skill: {} });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });
    fireEvent.click(screen.getAllByText('actions.import')[0]);
    await waitFor(() => {
      expect(screen.getByText('install.title')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.append'));
    await waitFor(() => {
      expect(screen.getByText('dir-b')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.confirmImport'));
    await waitFor(() => {
      // 失败项徽标 + 汇总标签各出现一次；失败项可重试
      expect(
        screen.getAllByText('import.result.failed').length
      ).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('import.retry').length).toBeGreaterThanOrEqual(
        1
      );
    });
  });
});

/* =================================================== */
/*  资源 IPC 集成：get_managed_copy_path / count_scene_references */
/* =================================================== */
describe('SkillLibrary — 资源 IPC 集成（受管副本 reveal / 批量删除引用统计）', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('Skill 本地路径 reveal 走 invoke reveal_path，不再调用 plugin-opener', async () => {
    const skills: Skill[] = [mkSkill('s1', 'React')];
    await setupInvoke({
      list_skills: skills,
      list_tags: [],
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    fireEvent.click(screen.getByText('React'));

    await waitFor(() => {
      expect(screen.getByTestId('skill-local-path-row')).toBeDefined();
    });
    const row = screen.getByTestId('skill-local-path-row');
    const revealBtn = within(row).getByRole('button');
    // 33 号 P6：本地路径 reveal 按钮使用全局 .action-reveal 类，行容器为 group
    expect(row.className).toContain('group');
    expect(revealBtn.className).toContain('action-reveal');
    fireEvent.click(revealBtn);

    await waitFor(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      expect(invoke).toHaveBeenCalledWith('reveal_path', {
        path: '/path/React',
        asSkillsDir: false,
      });
    });
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    expect(revealItemInDir).not.toHaveBeenCalled();
  });

  it('Skill 本地路径 reveal 失败 → 显示错误 toast', async () => {
    const skills: Skill[] = [mkSkill('s1', 'React')];
    await setupInvoke({
      list_skills: skills,
      list_tags: [],
      reveal_path: new Error('cannot reveal'),
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    fireEvent.click(screen.getByText('React'));

    await waitFor(() => {
      expect(screen.getByTestId('skill-local-path-row')).toBeDefined();
    });
    const row = screen.getByTestId('skill-local-path-row');
    const revealBtn = within(row).getByRole('button');
    fireEvent.click(revealBtn);

    await waitFor(() => {
      const { toasts } = useAppStore.getState();
      expect(
        toasts.some(
          (t) => t.message === 'ws.revealFailed' && t.type === 'error'
        )
      ).toBe(true);
    });
  });

  it('batch delete confirmation displays summed real scene reference counts', async () => {
    const skills: Skill[] = [
      mkSkill('s1', 'Alpha'),
      mkSkill('s2', 'Beta'),
      mkSkill('s3', 'Gamma'),
    ];
    const counts: Record<string, number> = { s1: 2, s2: 1, s3: 0 };
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'list_skills') return Promise.resolve(skills);
      if (cmd === 'list_tags') return Promise.resolve([]);
      if (cmd === 'count_scene_references')
        return Promise.resolve(counts[args?.resourceId] ?? 0);
      if (cmd === 'uninstall_skill') return Promise.resolve({});
      return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.batchSelect'));
    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.click(screen.getByText('Beta'));
    fireEvent.click(screen.getByText('Gamma'));
    fireEvent.click(screen.getByText('batch.delete'));

    await waitFor(() => {
      expect(screen.getByText('messages.referenceSummary')).toBeDefined();
    });
    expect(invoke).toHaveBeenCalledWith('count_scene_references', {
      resourceType: 'skill',
      resourceId: 's1',
    });
    expect(invoke).toHaveBeenCalledWith('count_scene_references', {
      resourceType: 'skill',
      resourceId: 's3',
    });
  });

  it('batch delete confirmation tolerates reference-count errors and still allows deletion', async () => {
    const skills: Skill[] = [mkSkill('s1', 'Alpha')];
    await setupInvoke({
      list_skills: skills,
      list_tags: [],
      count_scene_references: new Error('db busy'),
      uninstall_skill: {},
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.batchSelect'));
    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.click(screen.getByText('batch.delete'));

    await waitFor(() => {
      expect(screen.getByText('actions.confirm')).toBeDefined();
    });
    expect(screen.queryByText('messages.referenceSummary')).toBeNull();

    fireEvent.click(screen.getByText('actions.confirm'));
    await waitFor(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      expect(invoke).toHaveBeenCalledWith('uninstall_skill', {
        skillId: 's1',
      });
    });
  });

  it('renders load-failure empty state with retry and re-fetches on retry', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    // First list_skills call fails; the retry (subsequent calls) succeeds.
    (invoke as any).mockImplementationOnce(() =>
      Promise.reject(new Error('backend unavailable'))
    );
    await setupInvoke({ list_skills: [mkSkill('s1', 'React')], list_tags: [] });

    render(<SkillLibrary />);

    await waitFor(() => {
      expect(screen.getByText('messages.loadSkillsFailed')).toBeDefined();
    });
    expect(screen.getByText('actions.retry')).toBeDefined();

    fireEvent.click(screen.getByText('actions.retry'));
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    expect(screen.queryByText('messages.loadSkillsFailed')).toBeNull();
  });
});

/* =================================================== */
/*  Task 5：Skills 统一底部粘性批量栏                    */
/* =================================================== */
describe('SkillLibrary — 统一底部粘性批量栏', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('batch toolbar button toggles 批量操作→完成 (actions.batchSelect / actions.exitSelect)', async () => {
    await setupInvoke({ list_skills: [mkSkill('s1', 'React')], list_tags: [] });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    expect(screen.getByText('actions.batchSelect')).toBeDefined();
    fireEvent.click(screen.getByText('actions.batchSelect'));
    expect(screen.getByText('actions.exitSelect')).toBeDefined();
  });

  it('renders BatchActionBar after the collection with sticky bottom-0 z-40', async () => {
    await setupInvoke({ list_skills: [mkSkill('s1', 'React')], list_tags: [] });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.batchSelect'));
    const bar = screen.getByTestId('batch-action-bar');
    expect(bar).toHaveClass('sticky', 'bottom-0', 'z-40');
    const card = screen.getByText('React');
    const cardPrecedesBar =
      (bar.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING) !==
      0;
    expect(cardPrecedesBar).toBe(true);
  });

  it('selected bar shows unified action order 管理所选标签→批量删除→清空→去分发→退出选择', async () => {
    await setupInvoke({ list_skills: [mkSkill('s1', 'React')], list_tags: [] });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.batchSelect'));
    fireEvent.click(screen.getByText('React'));
    const bar = screen.getByTestId('batch-action-bar');
    const labels = within(bar)
      .getAllByRole('button')
      .map((b) => (b.textContent || '').trim());
    expect(labels).toEqual([
      'batch.manageTags',
      'batch.delete',
      'batch.clear',
      'batch.goDistribute',
      'batch.exit',
    ]);
  });
});

/* =================================================== */
/*  Task 5：页头/工具栏/筛选/分组/Inspector 对齐（决策 7 + 9 搜索框部分） */
/* =================================================== */
describe('SkillLibrary — 页头/工具栏/筛选/Inspector 对齐（决策 7）', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('页头行：导入(primary+Download) → 管理标签(outline)；工具栏行：计数 → view seg → 批量', async () => {
    await setupInvoke({ list_skills: [mkSkill('s1', 'React')], list_tags: [] });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    // 页头行：仅 导入(primary+Download) → 管理标签(outline) 两个操作
    const pageActions = screen.getByTestId('lib-page-actions');
    const pageButtons = within(pageActions).getAllByRole('button');
    expect(pageButtons).toHaveLength(2);
    expect(pageButtons[0].className).toContain('bg-primary');
    expect(pageButtons[0].querySelector('svg.lucide-download')).not.toBeNull();
    expect(within(pageButtons[0]).getByText('actions.import')).toBeDefined();
    expect(pageButtons[1].className).toContain('border');
    expect(within(pageButtons[1]).getByText('tag.manageTags')).toBeDefined();
    // 产品差异：技能页无「新建技能」入口
    expect(screen.queryByText(/create/)).toBeNull();

    // 工具栏行：计数 → view seg → 批量
    const toolbarActions = screen.getByTestId('lib-toolbar-actions');
    const countSpan = within(toolbarActions).getByTestId('lib-toolbar-count');
    const seg = within(toolbarActions).getByRole('tablist');
    expect(seg).toHaveAttribute('aria-label', 'view-toggle');
    const batchBtn = within(toolbarActions)
      .getByText('actions.batchSelect')
      .closest('button')!;
    expect(
      countSpan.compareDocumentPosition(seg) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      seg.compareDocumentPosition(batchBtn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('搜索框使用全角省略号 placeholder', async () => {
    await setupInvoke({ list_skills: [], list_tags: [] });
    render(<SkillLibrary />);
    expect(screen.getByPlaceholderText('搜索技能…')).toBeDefined();
  });

  it('搜索框 placeholder 由 i18n 驱动（en-US 环境渲染英文），禁止硬编码中文', async () => {
    const prev = tMap.searchPlaceholder;
    tMap.searchPlaceholder = 'Search skills…';
    try {
      await setupInvoke({ list_skills: [], list_tags: [] });
      render(<SkillLibrary />);
      expect(screen.getByPlaceholderText('Search skills…')).toBeDefined();
      expect(screen.queryByPlaceholderText('搜索技能…')).toBeNull();
    } finally {
      tMap.searchPlaceholder = prev;
    }
  });

  it('搜索框使用共享 SEARCH_INPUT_CLASSES 令牌', async () => {
    await setupInvoke({ list_skills: [], list_tags: [] });
    render(<SkillLibrary />);
    const input = screen.getByPlaceholderText('搜索技能…');
    // 以共享 class 常量断言（决策 9）
    expect(input.className).toContain(SEARCH_INPUT_CLASSES.split(' ')[0]);
    for (const token of SEARCH_INPUT_CLASSES.split(' ')) {
      expect(input.className).toContain(token);
    }
  });

  it('工具栏显示技能计数 key', async () => {
    await setupInvoke({ list_skills: [mkSkill('s1', 'React')], list_tags: [] });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    // raw-key mock 下计数渲染为 skills 命名空间 key（count）
    expect(screen.getByTestId('lib-toolbar-count').textContent).toContain(
      'count'
    );
  });

  it('筛选行含标签 chips 与展开/收起按钮', async () => {
    await setupInvoke({ list_skills: [mkSkill('s1', 'React')], list_tags: [] });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    expect(screen.getByTestId('lib-filters')).toBeDefined();
    expect(
      screen.getByRole('button', { name: /收起分组|展开分组/i })
    ).toBeDefined();
  });

  it('未分类组数量为 0 时不渲染该分组', async () => {
    const tags = [mkTag(1, 'frontend')];
    const skills = [mkSkill('s1', 'React', { tags: [tags[0]] })];
    await setupInvoke({ list_skills: skills, list_tags: tags });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    // TagFilterBar 筛选行含硬编码「未分类」chip，断言限定在内容区（lib-content）
    const content = screen.getByTestId('lib-content');
    expect(within(content).queryByText(/未分类|tag\.untagged/)).toBeNull();
  });

  it('Inspector 操作区按分发→编辑→删除水平排列', async () => {
    const skills = [mkSkill('s1', 'React', { source_type: 'git' })];
    await setupInvoke({
      list_skills: skills,
      list_tags: [],
      get_managed_copy_path: null,
    });
    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    fireEvent.click(screen.getByText('React'));
    await waitFor(() => {
      expect(screen.getByTestId('inspector-actions')).toBeDefined();
    });
    const actions = screen.getByTestId('inspector-actions');
    const buttons = within(actions).getAllByRole('button');
    expect(buttons.map((b) => (b.textContent || '').trim())).toEqual([
      'batch.goDistribute',
      'actions.update',
      'actions.uninstall',
    ]);
    expect(actions.className).toContain('flex-row');
  });
});
