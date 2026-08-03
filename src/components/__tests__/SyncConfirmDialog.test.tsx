import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncConfirmDialog } from '../SyncConfirmDialog';
import { useAppStore } from '../../stores/appStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockPlatforms = [
  {
    platform_id: 'claude-code',
    platform_name: 'Claude Code',
    skills_to_add: ['skill-1'],
    skills_to_remove: ['skill-2'],
    rules_to_add: ['rule-1'],
    rules_to_remove: ['rule-2'],
  },
  {
    platform_id: 'cursor',
    platform_name: 'Cursor',
    skills_to_add: [],
    skills_to_remove: ['skill-3'],
    rules_to_add: [],
    rules_to_remove: [],
  },
];

function resetStore() {
  useAppStore.setState({
    skills: [], rules: [], tags: [], scenes: [], projects: [],
    platforms: [], distributions: [], recentActivity: [],
    dashboardStats: null, syncStatus: null, globalDistStatus: null,
    selectedSkill: null, currentScene: null, currentSceneDetail: null,
    editingRule: null, activeNav: 'dashboard', sidebarCollapsed: false,
    searchQuery: '', tagFilter: [], loading: false, toasts: [],
    globalDistSelectedPlatform: null, projectDistSelectedProjectId: null,
    projectDistSelectedPlatform: null,
    pendingSyncConfirm: null, resolveSyncConfirm: null,
  });
}

describe('SyncConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('pending 为 null 时渲染空内容', () => {
    const { container } = render(<SyncConfirmDialog />);
    expect(container.innerHTML).toBe('');
  });

  it('pending 有数据时渲染对话框', () => {
    useAppStore.setState({
      pendingSyncConfirm: { platforms: mockPlatforms, onConfirm: vi.fn() },
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(screen.getByText('syncConfirm.title')).toBeDefined();
  });

  it('渲染平台名称', () => {
    useAppStore.setState({
      pendingSyncConfirm: { platforms: mockPlatforms },
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(screen.getByText('Claude Code')).toBeDefined();
    expect(screen.getByText('Cursor')).toBeDefined();
  });

  it('显示新增和移除摘要', () => {
    useAppStore.setState({
      pendingSyncConfirm: { platforms: mockPlatforms },
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    // Text is followed by colon in the DOM, so use exact: false
    expect(screen.getByText('syncConfirm.addSkills', { exact: false })).toBeDefined();
    expect(screen.getAllByText('syncConfirm.removeSkills', { exact: false }).length).toBe(2);
    expect(screen.getByText('syncConfirm.addRules', { exact: false })).toBeDefined();
    expect(screen.getByText('syncConfirm.removeRules', { exact: false })).toBeDefined();
  });

  it('显示总计摘要和按钮', () => {
    useAppStore.setState({
      pendingSyncConfirm: { platforms: mockPlatforms },
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(screen.getByText('syncConfirm.summary', { exact: false })).toBeDefined();
    expect(screen.getByText('syncConfirm.confirm')).toBeDefined();
    expect(screen.getByText('actions.cancel')).toBeDefined();
  });

  it('点击确认调用 resolveSyncConfirm(true) 和 onConfirm', () => {
    const onConfirm = vi.fn();
    const resolveConfirm = vi.fn();
    useAppStore.setState({
      pendingSyncConfirm: { platforms: mockPlatforms, onConfirm },
      resolveSyncConfirm: resolveConfirm,
    });
    render(<SyncConfirmDialog />);
    fireEvent.click(screen.getByText('syncConfirm.confirm'));
    expect(resolveConfirm).toHaveBeenCalledWith(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('点击取消调用 resolveSyncConfirm(false)', () => {
    const resolveConfirm = vi.fn();
    useAppStore.setState({
      pendingSyncConfirm: { platforms: mockPlatforms },
      resolveSyncConfirm: resolveConfirm,
    });
    render(<SyncConfirmDialog />);
    fireEvent.click(screen.getByText('actions.cancel'));
    expect(resolveConfirm).toHaveBeenCalledWith(false);
  });

  it('点击 X 按钮调用 resolveSyncConfirm(false)', () => {
    const resolveConfirm = vi.fn();
    useAppStore.setState({
      pendingSyncConfirm: { platforms: mockPlatforms },
      resolveSyncConfirm: resolveConfirm,
    });
    render(<SyncConfirmDialog />);
    const xBtn = document.querySelector('button svg.lucide-x')?.closest('button');
    if (xBtn) fireEvent.click(xBtn);
    expect(resolveConfirm).toHaveBeenCalledWith(false);
  });

  it('显示移除技能名称预览（最多5个）', () => {
    useAppStore.setState({
      pendingSyncConfirm: {
        platforms: [{
          platform_id: 'test',
          platform_name: 'Test',
          skills_to_add: [],
          skills_to_remove: ['a', 'b', 'c', 'd', 'e', 'f'],
          rules_to_add: [],
          rules_to_remove: [],
        }],
      },
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(screen.getByText(/a, b/)).toBeDefined();
  });

  it('无移除内容的平台不显示移除区域', () => {
    useAppStore.setState({
      pendingSyncConfirm: {
        platforms: [{
          platform_id: 'test',
          platform_name: 'Test',
          skills_to_add: ['s1'],
          skills_to_remove: [],
          rules_to_add: ['r1'],
          rules_to_remove: [],
        }],
      },
      resolveSyncConfirm: vi.fn(),
    });
    render(<SyncConfirmDialog />);
    expect(screen.getByText('syncConfirm.addSkills', { exact: false })).toBeDefined();
    expect(screen.getByText('syncConfirm.addRules', { exact: false })).toBeDefined();
    expect(screen.queryByText('syncConfirm.removeSkills', { exact: false })).toBeNull();
    expect(screen.queryByText('syncConfirm.removeRules', { exact: false })).toBeNull();
  });
});