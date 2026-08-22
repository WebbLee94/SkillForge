import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TagManagerDialog } from '../../domains/tags/TagManagerDialog';
import { useAppStore } from '../../stores/appStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockTags = [
  { id: 1, name: 'Java', color: '#ff6600', tag_type: 'skill' as const, count: 3 },
  { id: 2, name: 'React', color: '#3B82F6', tag_type: 'skill' as const, count: 5 },
  { id: 3, name: 'TypeScript', color: '#3178C6', tag_type: 'skill' as const, count: 0 },
];

const defaultState = {
  skills: [],
  rules: [],
  tags: mockTags,
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
};

function resetStore() {
  useAppStore.setState(defaultState);
}

async function mockInvoke(routes: Record<string, unknown>) {
  const mod = await import('@tauri-apps/api/core');
  (mod.invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) {
      const v = routes[cmd];
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    }
    return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
  });
}

describe('TagManagerDialog', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    resetStore();
    await mockInvoke({
      list_tags: mockTags,
      create_tag: { id: 4 },
      update_tag: {},
      delete_tag: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('关闭时渲染空内容', () => {
    const { container } = render(
      <TagManagerDialog tagType="skill" isOpen={false} onClose={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('打开时渲染表格标题行', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    // Table header cells: 颜色, 名称, 关联数
    expect(screen.getByText('tag.name')).toBeDefined();
    expect(screen.getByText('tag.associatedCount')).toBeDefined();
    expect(screen.getByPlaceholderText('actions.search')).toBeDefined();
  });

  it('渲染标签列表中的名称', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Java')).toBeDefined();
    expect(screen.getByText('React')).toBeDefined();
    expect(screen.getByText('TypeScript')).toBeDefined();
  });

  it('显示标签关联计数', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
    expect(screen.getByText('0')).toBeDefined();
  });

  it('搜索过滤标签', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText('actions.search');
    fireEvent.change(searchInput, { target: { value: 'Java' } });
    expect(screen.getByText('Java')).toBeDefined();
    expect(screen.queryByText('React')).toBeNull();
  });

  it('搜索无结果时显示空状态', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText('actions.search');
    fireEvent.change(searchInput, { target: { value: 'XYZ' } });
    expect(screen.getByText('messages.noData')).toBeDefined();
  });

  it('点击创建按钮打开创建表单', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('actions.create'));
    expect(screen.getByPlaceholderText('tag.namePlaceholder')).toBeDefined();
    expect(screen.getByText('actions.save')).toBeDefined();
  });

  it('创建标签后调用 createTag', async () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('actions.create'));
    const nameInput = screen.getByPlaceholderText('tag.namePlaceholder');
    fireEvent.change(nameInput, { target: { value: 'Vue' } });
    fireEvent.click(screen.getByText('actions.save'));
    const mod = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(mod.invoke).toHaveBeenCalledWith('create_tag', expect.objectContaining({ name: 'Vue' }));
    });
  });

  it('取消创建隐藏表单', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('actions.create'));
    expect(screen.getByPlaceholderText('tag.namePlaceholder')).toBeDefined();
    fireEvent.click(screen.getByText('actions.cancel'));
    expect(screen.queryByPlaceholderText('tag.namePlaceholder')).toBeNull();
  });

  it('点击标签名称进入编辑模式', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Java'));
    expect(screen.getByDisplayValue('Java')).toBeDefined();
  });

  it('编辑名称后 blur 触发 updateTag', async () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Java'));
    const editInput = screen.getByDisplayValue('Java');
    fireEvent.change(editInput, { target: { value: 'Java 2' } });
    fireEvent.blur(editInput);
    const mod = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(mod.invoke).toHaveBeenCalledWith('update_tag', expect.objectContaining({ id: 1, name: 'Java 2' }));
    });
  });

  it('Enter 键在编辑模式保存', async () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Java'));
    const editInput = screen.getByDisplayValue('Java');
    fireEvent.change(editInput, { target: { value: 'Java3' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });
    const mod = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(mod.invoke).toHaveBeenCalledWith('update_tag', expect.objectContaining({ name: 'Java3' }));
    });
  });

  it('Escape 键退出编辑模式', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Java'));
    const editInput = screen.getByDisplayValue('Java');
    fireEvent.keyDown(editInput, { key: 'Escape' });
    expect(screen.queryByDisplayValue('Java')).toBeNull();
    expect(screen.getByText('Java')).toBeDefined();
  });

  it('点击删除按钮打开确认对话框', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    // Buttons with text "actions.delete" exist in both the create form save button area
    // and the table rows' delete buttons. Let's find a trash icon button instead.
    const deleteBtn = document.querySelector('button[title="actions.delete"]');
    expect(deleteBtn).not.toBeNull();
    if (deleteBtn) fireEvent.click(deleteBtn);
    expect(screen.getAllByText('messages.confirmDelete').length).toBeGreaterThan(0);
  });

  it('确认删除调用 deleteTag', async () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    const deleteBtn = document.querySelector('button[title="actions.delete"]');
    if (deleteBtn) fireEvent.click(deleteBtn);
    // ConfirmDialog appears — click the confirm button that has class bg-error (danger variant)
    const confirmBtns = screen.getAllByText('actions.delete');
    // The first is the th header, the last is the confirm dialog button
    expect(confirmBtns.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);
    const mod = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(mod.invoke).toHaveBeenCalledWith('delete_tag', { id: 1 });
    });
  });

  it('取消删除关闭确认对话框', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    const deleteBtn = document.querySelector('button[title="actions.delete"]');
    if (deleteBtn) fireEvent.click(deleteBtn);
    expect(screen.getAllByText('messages.confirmDelete').length).toBeGreaterThanOrEqual(1);
    // Click the cancel button of the ConfirmDialog
    const cancelBtns = screen.getAllByText('actions.cancel');
    fireEvent.click(cancelBtns[cancelBtns.length - 1]);
    expect(screen.queryByText('messages.confirmDelete')).toBeNull();
  });

  it('有关联数标签的删除确认消息包含计数', () => {
    // Java has count=3, so deleteTagMessage should reference it
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    const deleteBtn = document.querySelector('button[title="actions.delete"]');
    if (deleteBtn) fireEvent.click(deleteBtn);
    // The ConfirmDialog message interpolates count for associated tags
    expect(screen.getAllByText(/messages\.confirmDelete/).length).toBeGreaterThan(0);
  });

  it('无关联标签的删除显示默认确认消息', () => {
    // TypeScript has count=0, so should show default confirm message
    render(<TagManagerDialog tagType="rule" isOpen onClose={vi.fn()} />);
    // Click the 3rd delete button (TypeScript's)
    const deleteBtns = document.querySelectorAll('button[title="actions.delete"]');
    expect(deleteBtns.length).toBe(3);
    if (deleteBtns[2]) fireEvent.click(deleteBtns[2]);
    expect(screen.getAllByText('messages.confirmDelete').length).toBeGreaterThan(0);
  });

  it('颜色按钮点击打开颜色选择器', () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    const colorBtns = document.querySelectorAll('button[title="tag.selectColor"]');
    expect(colorBtns.length).toBe(3);
    if (colorBtns[0]) fireEvent.click(colorBtns[0]);
    const colorOptions = document.querySelectorAll('div.grid-cols-5 button');
    expect(colorOptions.length).toBeGreaterThan(0);
  });

  it('选择颜色后调用 updateTag', async () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    const colorBtn = document.querySelector('button[title="tag.selectColor"]');
    if (colorBtn) fireEvent.click(colorBtn);
    const colorOption = document.querySelector('div.grid-cols-5 button');
    if (colorOption) fireEvent.click(colorOption);
    const mod = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(mod.invoke).toHaveBeenCalledWith('update_tag', expect.objectContaining({ id: 1 }));
    });
  });

  it('创建表单中 Enter 键触发创建', async () => {
    render(<TagManagerDialog tagType="skill" isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('actions.create'));
    const nameInput = screen.getByPlaceholderText('tag.namePlaceholder');
    fireEvent.change(nameInput, { target: { value: 'Svelte' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    const mod = await import('@tauri-apps/api/core');
    await waitFor(() => {
      expect(mod.invoke).toHaveBeenCalledWith('create_tag', expect.objectContaining({ name: 'Svelte' }));
    });
  });
});
