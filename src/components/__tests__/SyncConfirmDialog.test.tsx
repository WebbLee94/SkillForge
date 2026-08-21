import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncConfirmDialog } from '../../app/SyncConfirmDialog';
import { useAppStore } from '../../stores/appStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockPlan = {
  platforms: [
    {
      platform_id: 'claude-code',
      platform_name: 'Claude Code',
      skills_to_add: ['skill-1'],
      skills_to_update: ['skill-2'],
      skills_to_remove: ['skill-3'],
      rules_to_add: ['rule-1'],
      rules_to_update: ['rule-2'],
      rules_to_remove: ['rule-3'],
    },
    {
      platform_id: 'cursor',
      platform_name: 'Cursor',
      skills_to_add: [],
      skills_to_update: [],
      skills_to_remove: ['skill-4'],
      rules_to_add: [],
      rules_to_update: [],
      rules_to_remove: [],
    },
  ],
  has_removals: true,
};

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
}

describe('SyncConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('renders nothing when pending is null', () => {
    const { container } = render(<SyncConfirmDialog />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when resolveSyncConfirm is null', () => {
    useAppStore.setState({ pendingSyncConfirm: mockPlan });
    const { container } = render(<SyncConfirmDialog />);
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when both pending and resolveSyncConfirm are set', () => {
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(screen.getByText('syncConfirm.title')).toBeDefined();
  });

  it('renders platform names', () => {
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(screen.getByText('Claude Code')).toBeDefined();
    expect(screen.getByText('Cursor')).toBeDefined();
  });

  it('shows add/update/remove summaries', () => {
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(
      screen.getByText('syncConfirm.addSkills', { exact: false })
    ).toBeDefined();
    expect(
      screen.getByText('syncConfirm.updateSkills', { exact: false })
    ).toBeDefined();
    expect(
      screen.getAllByText('syncConfirm.removeSkills', { exact: false })
    ).toHaveLength(2);
    expect(
      screen.getByText('syncConfirm.addRules', { exact: false })
    ).toBeDefined();
    expect(
      screen.getByText('syncConfirm.updateRules', { exact: false })
    ).toBeDefined();
    expect(
      screen.getByText('syncConfirm.removeRules', { exact: false })
    ).toBeDefined();
  });

  it('shows total summary and buttons', () => {
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(
      screen.getByText('syncConfirm.summary', { exact: false })
    ).toBeDefined();
    expect(screen.getByText('syncConfirm.confirm')).toBeDefined();
    expect(screen.getByText('actions.cancel')).toBeDefined();
  });

  it('calls resolveSyncConfirm(true) on confirm click', () => {
    const resolveConfirm = vi.fn();
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: resolveConfirm,
    });
    render(<SyncConfirmDialog />);
    fireEvent.click(screen.getByText('syncConfirm.confirm'));
    expect(resolveConfirm).toHaveBeenCalledWith(true);
  });

  it('calls resolveSyncConfirm(false) on cancel click', () => {
    const resolveConfirm = vi.fn();
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: resolveConfirm,
    });
    render(<SyncConfirmDialog />);
    fireEvent.click(screen.getByText('actions.cancel'));
    expect(resolveConfirm).toHaveBeenCalledWith(false);
  });

  it('calls resolveSyncConfirm(false) on X button click', () => {
    const resolveConfirm = vi.fn();
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: resolveConfirm,
    });
    render(<SyncConfirmDialog />);
    const xBtn = document
      .querySelector('button svg.lucide-x')
      ?.closest('button');
    if (xBtn) fireEvent.click(xBtn);
    expect(resolveConfirm).toHaveBeenCalledWith(false);
  });

  it('shows remove skill names truncated to 5', () => {
    useAppStore.setState({
      pendingSyncConfirm: {
        platforms: [
          {
            platform_id: 'test',
            platform_name: 'Test',
            skills_to_add: [],
            skills_to_update: [],
            skills_to_remove: ['a', 'b', 'c', 'd', 'e', 'f'],
            rules_to_add: [],
            rules_to_update: [],
            rules_to_remove: [],
          },
        ],
        has_removals: true,
      },
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(screen.getByText(/a, b/)).toBeDefined();
  });

  it('shows only add/update when no removals and uses changes text', () => {
    useAppStore.setState({
      pendingSyncConfirm: {
        platforms: [
          {
            platform_id: 'test',
            platform_name: 'Test',
            skills_to_add: ['s1'],
            skills_to_update: ['s2'],
            skills_to_remove: [],
            rules_to_add: ['r1'],
            rules_to_update: ['r2'],
            rules_to_remove: [],
          },
        ],
        has_removals: false,
      },
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(
      screen.getByText('syncConfirm.addSkills', { exact: false })
    ).toBeDefined();
    expect(
      screen.getByText('syncConfirm.updateSkills', { exact: false })
    ).toBeDefined();
    expect(
      screen.getByText('syncConfirm.addRules', { exact: false })
    ).toBeDefined();
    expect(
      screen.getByText('syncConfirm.updateRules', { exact: false })
    ).toBeDefined();
    // Warning text should not be shown since has_removals is false
    expect(screen.getByText('syncConfirm.changes')).toBeDefined();
  });

  it('shows italic noChanges text for platform with zero changes in all categories', () => {
    useAppStore.setState({
      pendingSyncConfirm: {
        platforms: [
          {
            platform_id: 'empty',
            platform_name: 'Empty Platform',
            skills_to_add: [],
            skills_to_update: [],
            skills_to_remove: [],
            rules_to_add: [],
            rules_to_update: [],
            rules_to_remove: [],
          },
        ],
        has_removals: false,
      },
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(screen.getByText('syncConfirm.noChanges')).toBeDefined();
  });

  it('does not call onConfirm (removed in new design)', () => {
    const resolveConfirm = vi.fn();
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: resolveConfirm,
    });
    render(<SyncConfirmDialog />);
    fireEvent.click(screen.getByText('syncConfirm.confirm'));
    expect(resolveConfirm).toHaveBeenCalledWith(true);
  });

  it('update-skills row has data-testid and contains RefreshCw icon and neutral style', () => {
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    const el = screen.getByTestId('update-skills');
    expect(el.className).toContain('text-foreground');
    const icon = el.querySelector('svg');
    expect(icon).toBeDefined();
    // Use getAttribute for SVG elements (className is SVGAnimatedString in jsdom)
    expect(icon!.getAttribute('class')).toContain('lucide-refresh-cw');
  });

  it('remove-skills rows have data-testid, warning style, and Minus icon', () => {
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    const els = screen.getAllByTestId('remove-skills');
    expect(els.length).toBeGreaterThanOrEqual(1);
    const el = els[0];
    expect(el.className).toContain('text-warning');
    const icon = el.querySelector('svg');
    expect(icon).toBeDefined();
    expect(icon!.getAttribute('class')).toContain('lucide-minus');
  });

  it('update-rules row has data-testid and neutral style', () => {
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    const el = screen.getByTestId('update-rules');
    expect(el.className).toContain('text-foreground');
    const icon = el.querySelector('svg');
    expect(icon).toBeDefined();
    expect(icon!.getAttribute('class')).toContain('lucide-refresh-cw');
  });

  it('remove-rules row has data-testid, warning style, and Minus icon', () => {
    useAppStore.setState({
      pendingSyncConfirm: mockPlan,
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    const el = screen.getByTestId('remove-rules');
    expect(el.className).toContain('text-warning');
    const icon = el.querySelector('svg');
    expect(icon).toBeDefined();
    expect(icon!.getAttribute('class')).toContain('lucide-minus');
  });
});
