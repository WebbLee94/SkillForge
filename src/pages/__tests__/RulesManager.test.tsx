import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    distributions: [],
    recentActivity: [],
    dashboardStats: null,
    syncStatus: null,
    globalDistStatus: null,
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
    },
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
    expect(screen.getByPlaceholderText('create.descriptionPlaceholder')).toBeDefined();
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

    fireEvent.click(screen.getByText('Editable Rule'));

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
    fireEvent.change(screen.getByPlaceholderText('create.descriptionPlaceholder'), {
      target: { value: 'A test rule' },
    });

    fireEvent.click(screen.getByText('actions.save'));

    await waitFor(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      expect(invoke).toHaveBeenCalledWith('create_rule', expect.any(Object));
    });
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
    expect(screen.getByText('actions.delete')).toBeDefined();
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
    const rules = [
      aRule('r1', 'Database Config'),
      aRule('r2', 'API Gateway'),
    ];

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
      new Error('Network error'),
    );

    render(<RulesManager />);

    await waitFor(() => {
      const { toasts } = useAppStore.getState();
      expect(toasts.length).toBeGreaterThanOrEqual(1);
    });
  });
});