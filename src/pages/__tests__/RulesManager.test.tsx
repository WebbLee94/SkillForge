import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { RulesManager } from '../RulesManager';
import { useAppStore } from '../../stores/appStore';
import type { Rule, Tag } from '../../types';

/* ===== Module-level mocks ===== */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn() }));

/* ===== Factories ===== */
const aRule = (id: string, name: string, overrides?: Partial<Rule>): Rule => ({
  id,
  name,
  description: null,
  format: 'mdc',
  content: `# ${name}\n\nsome rule content`,
  platform: null,
  scope: 'global',
  version: 1,
  updated_at: '2025-06-15T10:00:00Z',
  tags: [],
  ...overrides,
});

const aTag = (id: number, name: string): Tag => ({
  id,
  name,
  color: '#3B82F6',
  tag_type: 'rule',
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
    activeNav: 'rules',
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

/** Configure invoke mock: known commands resolve, unknown reject. */
async function seedInvoke(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cmd: string) => {
      if (cmd in routes) return Promise.resolve(routes[cmd]);
      return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
    }
  );
}

/* ============================== */
/*  Tests                         */
/* ============================== */
describe('RulesManager', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('renders loading skeleton when data is loading', async () => {
    await seedInvoke({ list_rules: [], list_tags: [] });
    useAppStore.setState({ loading: true });

    render(<RulesManager />);

    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(4);
  });

  it('shows empty state when no rules exist', async () => {
    await seedInvoke({ list_rules: [], list_tags: [] });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });

    const createBtns = screen.getAllByText('createRule');
    expect(createBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('opens create dialog from empty state button', async () => {
    await seedInvoke({ list_rules: [], list_tags: [] });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });

    fireEvent.click(screen.getAllByText('createRule')[0]);

    await waitFor(() => {
      expect(screen.getByText('create.title')).toBeDefined();
    });
    expect(screen.getByPlaceholderText('create.namePlaceholder')).toBeDefined();
    expect(
      screen.getByPlaceholderText('create.descriptionPlaceholder')
    ).toBeDefined();
  });

  it('renders rule cards when rules are loaded', async () => {
    const rules = [
      aRule('r1', 'Rule One'),
      aRule('r2', 'Rule Two', { format: 'md' }),
    ];

    await seedInvoke({
      list_rules: rules,
      list_tags: [],
    });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('Rule One')).toBeDefined();
    });
    expect(screen.getByText('Rule Two')).toBeDefined();
    expect(screen.getByText('.mdc')).toBeDefined();
    expect(screen.getByText('.md')).toBeDefined();
  });

  it('selects a rule to open the edit panel', async () => {
    const rule = aRule('r1', 'Editable Rule', {
      content: '# Editable Rule\n\nedit me',
    });

    await seedInvoke({ list_rules: [rule], list_tags: [] });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('Editable Rule')).toBeDefined();
    });

    // Inspector 读取态 → 编辑按钮 → 编辑面板
    fireEvent.click(screen.getByText('Editable Rule'));
    await waitFor(() => {
      expect(screen.getByText('actions.edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.edit'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Editable Rule')).toBeDefined();
    });
  });

  it('saves edits through the editor panel', async () => {
    const rule = aRule('r1', 'Editable Rule', {
      content: '# Editable Rule\n\nedit me',
    });

    await seedInvoke({
      list_rules: [rule],
      list_tags: [],
      update_rule: null,
    });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('Editable Rule')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Editable Rule'));

    await waitFor(() => {
      expect(screen.getByText('actions.edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.edit'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Editable Rule')).toBeDefined();
    });

    const saveBtn = screen.getByText('actions.save');
    fireEvent.click(saveBtn);
  });

  it('opens create dialog from top bar and submits', async () => {
    await seedInvoke({
      list_rules: [],
      list_tags: [],
      create_rule: null,
    });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });

    fireEvent.click(screen.getAllByText('createRule')[0]);

    await waitFor(() => {
      expect(screen.getByText('create.title')).toBeDefined();
    });

    fireEvent.change(screen.getByPlaceholderText('create.namePlaceholder'), {
      target: { value: 'New Test Rule' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('create.descriptionPlaceholder'),
      {
        target: { value: 'A test rule' },
      }
    );
    fireEvent.change(
      screen.getByPlaceholderText('Write rule content here...'),
      { target: { value: '# New Test Rule\n\nrule body' } }
    );

    fireEvent.click(screen.getByText('actions.save'));

    await waitFor(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      expect(invoke).toHaveBeenCalledWith('create_rule', expect.any(Object));
    });
  });

  it('blocks create_rule when content is empty and shows error toast', async () => {
    await seedInvoke({
      list_rules: [],
      list_tags: [],
      create_rule: null,
    });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });

    fireEvent.click(screen.getAllByText('createRule')[0]);

    await waitFor(() => {
      expect(screen.getByText('create.title')).toBeDefined();
    });

    fireEvent.change(screen.getByPlaceholderText('create.namePlaceholder'), {
      target: { value: 'Empty Content Rule' },
    });

    fireEvent.click(screen.getByText('actions.save'));

    await waitFor(() => {
      const { toasts } = useAppStore.getState();
      expect(
        toasts.some(
          (t) => t.message === 'create.contentRequired' && t.type === 'error'
        )
      ).toBe(true);
    });

    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).not.toHaveBeenCalledWith('create_rule', expect.any(Object));
  });

  it('blocks create_rule when content is only whitespace and shows error toast', async () => {
    await seedInvoke({
      list_rules: [],
      list_tags: [],
      create_rule: null,
    });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });

    fireEvent.click(screen.getAllByText('createRule')[0]);

    await waitFor(() => {
      expect(screen.getByText('create.title')).toBeDefined();
    });

    fireEvent.change(screen.getByPlaceholderText('create.namePlaceholder'), {
      target: { value: 'Whitespace Content Rule' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('Write rule content here...'),
      { target: { value: '   \n \t ' } }
    );

    fireEvent.click(screen.getByText('actions.save'));

    await waitFor(() => {
      const { toasts } = useAppStore.getState();
      expect(
        toasts.some(
          (t) => t.message === 'create.contentRequired' && t.type === 'error'
        )
      ).toBe(true);
    });

    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).not.toHaveBeenCalledWith('create_rule', expect.any(Object));
  });

  it('enters batch mode, selects rules, shows delete bar', async () => {
    const rules = [
      aRule('r1', 'Rule A'),
      aRule('r2', 'Rule B'),
      aRule('r3', 'Rule C'),
    ];

    await seedInvoke({ list_rules: rules, list_tags: [] });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('Rule A')).toBeDefined();
    });

    fireEvent.click(screen.getByText('actions.batchSelect'));

    await waitFor(() => {
      expect(screen.getByText('actions.exitSelect')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Rule A'));

    await waitFor(() => {
      expect(screen.getByText(/messages.selectedCount/)).toBeDefined();
    });
    expect(screen.getByText('batch.delete')).toBeDefined();
  });

  it('exits batch mode with Escape key', async () => {
    const rules = [aRule('r1', 'Rule A'), aRule('r2', 'Rule B')];

    await seedInvoke({ list_rules: rules, list_tags: [] });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('Rule A')).toBeDefined();
    });

    fireEvent.click(screen.getByText('actions.batchSelect'));
    await waitFor(() => {
      expect(screen.getByText('actions.exitSelect')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Rule A'));
    await waitFor(() => {
      expect(screen.getByText(/messages.selectedCount/)).toBeDefined();
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByText('actions.batchSelect')).toBeDefined();
    });
  });

  it('displays tags on rule cards when present', async () => {
    const tags = [aTag(1, 'urgent'), aTag(2, 'refactor')];
    const rules = [
      aRule('r1', 'Tagged Rule', {
        tags: [{ ...aTag(1, 'urgent') }],
      }),
    ];

    await seedInvoke({ list_rules: rules, list_tags: tags });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('Tagged Rule')).toBeDefined();
    });

    const urgentChips = screen.getAllByText('urgent');
    expect(urgentChips.length).toBeGreaterThanOrEqual(1);
  });

  it('filters rules by search query', async () => {
    const rules = [aRule('r1', 'Database Config'), aRule('r2', 'API Gateway')];

    await seedInvoke({ list_rules: rules, list_tags: [] });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('Database Config')).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText('searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'API' } });

    await waitFor(() => {
      expect(screen.queryByText('Database Config')).toBeNull();
    });
    expect(screen.getByText('API Gateway')).toBeDefined();
  });

  it('toggles history panel in editor panel', async () => {
    const rule = aRule('r1', 'Rule With History', {
      content: '# Hist\\n\\ncontent',
    });

    await seedInvoke({ list_rules: [rule], list_tags: [] });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('Rule With History')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Rule With History'));

    await waitFor(() => {
      expect(screen.getByText('actions.edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.edit'));
    await waitFor(() => {
      expect(screen.getByDisplayValue('Rule With History')).toBeDefined();
    });

    // The version history button is in the editor header
    fireEvent.click(screen.getByText('versionHistory'));

    await waitFor(() => {
      // History panel shows version heading
      const historyElements = screen.getAllByText('versionHistory');
      expect(historyElements.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('opens fullscreen editor from editor panel', async () => {
    const rule = aRule('r1', 'Fullscreen Rule', {
      content: '# Fullscreen\\n\\ncontent',
    });

    await seedInvoke({ list_rules: [rule], list_tags: [] });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('Fullscreen Rule')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Fullscreen Rule'));

    await waitFor(() => {
      expect(screen.getByText('actions.edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.edit'));
    await waitFor(() => {
      expect(screen.getByDisplayValue('Fullscreen Rule')).toBeDefined();
    });

    // Click the maximize button in the editor header
    // Using getByTitle since the button has title={t('fullscreenEdit')}
    const maxBtn = screen.getByTitle('fullscreenEdit');
    fireEvent.click(maxBtn);

    await waitFor(() => {
      expect(screen.getByTitle('exitFullscreen')).toBeDefined();
    });
  });

  it('cancels create dialog', async () => {
    await seedInvoke({ list_rules: [], list_tags: [] });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });

    fireEvent.click(screen.getAllByText('createRule')[0]);

    await waitFor(() => {
      expect(screen.getByText('create.title')).toBeDefined();
    });

    fireEvent.click(screen.getByText('actions.cancel'));

    await waitFor(() => {
      expect(screen.queryByText('create.title')).toBeNull();
    });
  });

  it('handles error when fetchRules fails', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );

    render(<RulesManager />);

    await waitFor(() => {
      const { toasts } = useAppStore.getState();
      expect(toasts.length).toBeGreaterThanOrEqual(1);
    });
  });
});
/* ============================== */
/*  Phase 6 资源库交互契约（TASK-043） */
/* ============================== */
describe('RulesManager — Phase 6 资源库交互契约', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('group view rule card hides tags; list view shows tags (A17)', async () => {
    const tags = [aTag(1, 'urgent')];
    const rules = [
      aRule('r1', 'Tagged Rule', { tags: [{ ...aTag(1, 'urgent') }] }),
    ];
    await seedInvoke({ list_rules: rules, list_tags: tags });

    render(<RulesManager />);
    await waitFor(() => {
      expect(screen.getByText('Tagged Rule')).toBeDefined();
    });
    // 分组视图：卡片（role=button 外壳）内不显示标签
    const groupCard = screen
      .getByText('Tagged Rule')
      .closest('[role="button"]') as HTMLElement;
    expect(within(groupCard).queryByText('urgent')).toBeNull();

    // 切到列表视图：行内显示标签
    fireEvent.click(screen.getAllByRole('tab')[1]);
    const listRow = screen
      .getByText('Tagged Rule')
      .closest('[role="button"]') as HTMLElement;
    expect(within(listRow).getByText('urgent')).toBeDefined();
  });

  it('Inspector shows no source + full timestamp for rules; 编辑 opens editor', async () => {
    const rules = [aRule('r1', 'Rule One')];
    await seedInvoke({ list_rules: rules, list_tags: [] });

    render(<RulesManager />);
    await waitFor(() => {
      expect(screen.getByText('Rule One')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Rule One'));
    await waitFor(() => {
      expect(screen.getByText('detail.updatedAt')).toBeDefined();
    });
    expect(screen.queryByText('detail.source')).toBeNull();
    expect(screen.getAllByText(/2025/).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByText('actions.edit'));
    await waitFor(() => {
      expect(screen.getByDisplayValue('Rule One')).toBeDefined();
    });
  });

  it('批量去分发 carries rule ids into the distribution workspace', async () => {
    const rules = [aRule('r1', 'Rule A')];
    await seedInvoke({ list_rules: rules, list_tags: [] });

    render(<RulesManager />);
    await waitFor(() => {
      expect(screen.getByText('Rule A')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.batchSelect'));
    fireEvent.click(screen.getByText('Rule A'));
    fireEvent.click(screen.getByText('batch.goDistribute'));
    expect(useAppStore.getState().pendingDistributionSelection).toEqual({
      skillIds: [],
      ruleIds: ['r1'],
    });
    expect(useAppStore.getState().activeNav).toBe('globalDistribution');
  });

  it('import dialog validates .md/.mdc files and creates rules per file on confirm', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    (open as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      '/p/a.mdc',
      '/p/b.md',
    ]);
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    (readTextFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      '# rule content'
    );
    await seedInvoke({ list_rules: [], list_tags: [], create_rule: null });

    render(<RulesManager />);
    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });

    fireEvent.click(screen.getByText('importRules'));
    await waitFor(() => {
      expect(screen.getByText('importPreview')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.append'));
    await waitFor(() => {
      expect(screen.getByText('a.mdc')).toBeDefined();
      expect(screen.getByText('b.md')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.confirmImport'));
    await waitFor(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      expect(invoke).toHaveBeenCalledWith('create_rule', expect.any(Object));
    });
  });
});

/* ============================== */
/*  TASK-043 修复回归（H1/M1/M2/M3/M7） */
/* ============================== */
describe('RulesManager — Inspector 标签保存后刷新（H1）', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('after saving a rule tag, the selected rule refreshes and dirty state clears', async () => {
    const tags = [aTag(1, 'urgent')];
    const rule = aRule('r1', 'Rule A', { tags: [] });
    const { invoke } = await import('@tauri-apps/api/core');
    let assigned = false;
    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string) => {
        if (cmd === 'list_rules')
          return Promise.resolve(
            assigned ? [{ ...rule, tags: [tags[0]] }] : [rule]
          );
        if (cmd === 'list_tags') return Promise.resolve(tags);
        if (cmd === 'assign_tag') {
          assigned = true;
          return Promise.resolve(null);
        }
        return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
      }
    );

    render(<RulesManager />);
    await waitFor(() => {
      expect(screen.getByText('Rule A')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Rule A'));
    await waitFor(() => {
      expect(screen.getByLabelText('urgent')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('urgent'));
    expect(screen.getByText('actions.save')).toBeDefined();

    fireEvent.click(screen.getByText('actions.save'));
    await waitFor(() => {
      expect(screen.queryByText('actions.undo')).toBeNull();
      expect(screen.queryByText('actions.save')).toBeNull();
    });
    const { invoke: inv } = await import('@tauri-apps/api/core');
    expect(inv).toHaveBeenCalledWith('assign_tag', {
      targetType: 'rule',
      targetId: 'r1',
      tagId: 1,
    });
  });
});

describe('RulesManager — 未保存编辑关闭保护（M1）', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('closing the editor with unsaved content shows 保存/放弃/取消离开 and discard leaves without saving', async () => {
    await seedInvoke({
      list_rules: [
        aRule('r1', 'Editable Rule', { content: '# Editable Rule\n\nedit me' }),
      ],
      list_tags: [],
    });
    render(<RulesManager />);
    await waitFor(() =>
      expect(screen.getByText('Editable Rule')).toBeDefined()
    );
    fireEvent.click(screen.getByText('Editable Rule'));
    await waitFor(() => expect(screen.getByText('actions.edit')).toBeDefined());
    fireEvent.click(screen.getByText('actions.edit'));
    await waitFor(() =>
      expect(screen.getByDisplayValue('Editable Rule')).toBeDefined()
    );

    // 修改名称 → 未保存
    fireEvent.change(screen.getByDisplayValue('Editable Rule'), {
      target: { value: 'Renamed Rule' },
    });
    fireEvent.click(screen.getByLabelText('close-editor'));

    expect(screen.getAllByText('actions.save').length).toBeGreaterThanOrEqual(
      1
    );
    expect(screen.getByText('inspector.discard')).toBeDefined();
    expect(screen.getByText('inspector.stay')).toBeDefined();

    fireEvent.click(screen.getByText('inspector.discard'));
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Renamed Rule')).toBeNull();
    });
    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).not.toHaveBeenCalledWith('update_rule', expect.any(Object));
  });

  it('closing the editor with unsaved content and choosing 保存 persists the edit', async () => {
    await seedInvoke({
      list_rules: [
        aRule('r1', 'Editable Rule', { content: '# Editable Rule\n\nedit me' }),
      ],
      list_tags: [],
      update_rule: null,
    });
    render(<RulesManager />);
    await waitFor(() =>
      expect(screen.getByText('Editable Rule')).toBeDefined()
    );
    fireEvent.click(screen.getByText('Editable Rule'));
    await waitFor(() => expect(screen.getByText('actions.edit')).toBeDefined());
    fireEvent.click(screen.getByText('actions.edit'));
    await waitFor(() =>
      expect(screen.getByDisplayValue('Editable Rule')).toBeDefined()
    );

    fireEvent.change(screen.getByDisplayValue('Editable Rule'), {
      target: { value: 'Renamed Rule' },
    });
    fireEvent.click(screen.getByLabelText('close-editor'));
    fireEvent.click(screen.getAllByText('actions.save')[1]);

    await waitFor(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      expect(invoke).toHaveBeenCalledWith('update_rule', expect.any(Object));
    });
  });

  it('closing the editor without changes closes directly (no confirm)', async () => {
    await seedInvoke({
      list_rules: [
        aRule('r1', 'Editable Rule', { content: '# Editable Rule\n\nedit me' }),
      ],
      list_tags: [],
    });
    render(<RulesManager />);
    await waitFor(() =>
      expect(screen.getByText('Editable Rule')).toBeDefined()
    );
    fireEvent.click(screen.getByText('Editable Rule'));
    await waitFor(() => expect(screen.getByText('actions.edit')).toBeDefined());
    fireEvent.click(screen.getByText('actions.edit'));
    await waitFor(() =>
      expect(screen.getByDisplayValue('Editable Rule')).toBeDefined()
    );

    fireEvent.click(screen.getByLabelText('close-editor'));
    expect(screen.queryByText('inspector.discard')).toBeNull();
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Editable Rule')).toBeNull();
    });
  });
});

describe('RulesManager — 加载中禁用批量操作（M2）', () => {
  it('disables the batch toggle while loading', async () => {
    await seedInvoke({ list_rules: [], list_tags: [] });
    useAppStore.setState({ loading: true });
    render(<RulesManager />);
    const btn = screen.getByText('actions.batchSelect').closest('button')!;
    expect(btn.disabled).toBe(true);
  });
});

describe('RulesManager — 混合 valid+失败 导入结果（M3）', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('failing file shows failed result with retry in result phase', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    (open as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      '/p/ok.mdc',
      '/p/bad.md',
    ]);
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    (readTextFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (p: string) =>
        p === '/p/ok.mdc'
          ? Promise.resolve('# ok')
          : Promise.reject(new Error('boom'))
    );
    await seedInvoke({ list_rules: [], list_tags: [], create_rule: null });

    render(<RulesManager />);
    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });
    fireEvent.click(screen.getByText('importRules'));
    await waitFor(() => {
      expect(screen.getByText('importPreview')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.append'));
    await waitFor(() => {
      expect(screen.getByText('bad.md')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.confirmImport'));
    await waitFor(() => {
      expect(
        screen.getAllByText('import.result.failed').length
      ).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('import.retry').length).toBeGreaterThanOrEqual(
        1
      );
    });
  });
});

describe('RulesManager — 批量导入避免 N+1 fetchRules（M7）', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('imports N files with only mount + final list_rules calls', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    (open as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      '/p/a.mdc',
      '/p/b.md',
    ]);
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    (readTextFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      '# rule content'
    );
    await seedInvoke({ list_rules: [], list_tags: [], create_rule: null });

    render(<RulesManager />);
    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });
    fireEvent.click(screen.getByText('importRules'));
    await waitFor(() => {
      expect(screen.getByText('importPreview')).toBeDefined();
    });
    fireEvent.click(screen.getByText('import.append'));
    await waitFor(() => {
      expect(screen.getByText('a.mdc')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.confirmImport'));
    await waitFor(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const listCalls = (
        invoke as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.filter((c: string[]) => c[0] === 'list_rules');
      // 挂载 1 次 + 导入完成后最终刷新 1 次（不按文件逐次 fetchRules）
      expect(listCalls.length).toBe(2);
    });
  });
});

/* ===== 资源 IPC 集成：受管副本 reveal / 批量删除引用统计 ===== */
describe('RulesManager — 资源 IPC 集成（受管副本 reveal / 批量删除引用统计）', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('selecting a rule fetches managed copy path and reveals the reveal button when a copy exists', async () => {
    const rules = [aRule('r1', 'Rule One')];
    await seedInvoke({
      list_rules: rules,
      list_tags: [],
      get_managed_copy_path: '/platform/rules/rule-one',
    });

    render(<RulesManager />);
    await waitFor(() => {
      expect(screen.getByText('Rule One')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Rule One'));

    await waitFor(() => {
      expect(screen.getByText('在文件夹中显示')).toBeDefined();
    });
    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('get_managed_copy_path', {
      resourceType: 'rule',
      resourceId: 'r1',
    });
  });

  it('does not reveal the reveal button when get_managed_copy_path resolves null', async () => {
    const rules = [aRule('r1', 'Rule One')];
    await seedInvoke({
      list_rules: rules,
      list_tags: [],
      get_managed_copy_path: null,
    });

    render(<RulesManager />);
    await waitFor(() => {
      expect(screen.getByText('Rule One')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Rule One'));
    await waitFor(() => {
      expect(screen.getByText('detail.updatedAt')).toBeDefined();
    });
    expect(screen.queryByText('在文件夹中显示')).toBeNull();
  });

  it('batch delete confirmation displays summed real scene reference counts', async () => {
    const rules = [aRule('r1', 'Rule A'), aRule('r2', 'Rule B')];
    const counts: Record<string, number> = { r1: 3, r2: 1 };
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, args?: any) => {
        if (cmd === 'list_rules') return Promise.resolve(rules);
        if (cmd === 'list_tags') return Promise.resolve([]);
        if (cmd === 'count_scene_references')
          return Promise.resolve(counts[args?.resourceId] ?? 0);
        if (cmd === 'delete_rule') return Promise.resolve(null);
        return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
      }
    );

    render(<RulesManager />);
    await waitFor(() => {
      expect(screen.getByText('Rule A')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.batchSelect'));
    fireEvent.click(screen.getByText('Rule A'));
    fireEvent.click(screen.getByText('Rule B'));
    fireEvent.click(screen.getByText('batch.delete'));

    await waitFor(() => {
      expect(screen.getByText(/messages\.referenceSummary/)).toBeDefined();
    });
    expect(invoke).toHaveBeenCalledWith('count_scene_references', {
      resourceType: 'rule',
      resourceId: 'r1',
    });
    expect(invoke).toHaveBeenCalledWith('count_scene_references', {
      resourceType: 'rule',
      resourceId: 'r2',
    });
  });

  it('batch delete confirmation tolerates reference-count errors and still allows deletion', async () => {
    const rules = [aRule('r1', 'Rule A')];
    await seedInvoke({
      list_rules: rules,
      list_tags: [],
      count_scene_references: new Error('db busy'),
      delete_rule: null,
    });

    render(<RulesManager />);
    await waitFor(() => {
      expect(screen.getByText('Rule A')).toBeDefined();
    });
    fireEvent.click(screen.getByText('actions.batchSelect'));
    fireEvent.click(screen.getByText('Rule A'));
    fireEvent.click(screen.getByText('batch.delete'));

    await waitFor(() => {
      expect(screen.getByText('actions.confirm')).toBeDefined();
    });
    expect(screen.queryByText(/messages\.referenceSummary/)).toBeNull();

    fireEvent.click(screen.getByText('actions.confirm'));
    await waitFor(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      expect(invoke).toHaveBeenCalledWith('delete_rule', { id: 'r1' });
    });
  });

  it('renders load-failure empty state with retry and re-fetches on retry', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockImplementationOnce(() =>
      Promise.reject(new Error('backend unavailable'))
    );
    await seedInvoke({ list_rules: [aRule('r1', 'Style')], list_tags: [] });

    render(<RulesManager />);

    await waitFor(() => {
      expect(screen.getByText('messages.loadRulesFailed')).toBeDefined();
    });
    expect(screen.getByText('actions.retry')).toBeDefined();

    fireEvent.click(screen.getByText('actions.retry'));
    await waitFor(() => {
      expect(screen.getByText('Style')).toBeDefined();
    });
    expect(screen.queryByText('messages.loadRulesFailed')).toBeNull();
  });
});
