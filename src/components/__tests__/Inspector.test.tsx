import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { Inspector } from '../common/Inspector';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { pushModalScope, popModalScope } from '../../lib/modalScope';
import type { Tag } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { name?: string }) => {
      // T10 精确键名：mock 输出与断言一一对应（zh mock，不依赖 en 分支）
      if (key === 'inspector.addTag') return '添加标签';
      if (key === 'inspector.removeTagLabel')
        return `移除标签 ${params?.name ?? ''}`;
      if (key === 'nav.tags') return '标签';
      if (key === 'messages.noData') return '暂无数据';
      return key;
    },
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

const mkTag = (id: number, name: string): Tag => ({
  id,
  name,
  color: null,
  tag_type: 'skill',
});

const baseProps = {
  resourceType: 'rule' as const,
  title: 'My Rule',
  updatedAt: '2026-07-24T10:30:00Z',
  contentPreview: 'rule body preview',
  tags: [] as Tag[],
  allTags: [] as Tag[],
  onSaveTags: vi.fn().mockResolvedValue(undefined),
  onDelete: vi.fn(),
  onClose: vi.fn(),
};

function renderInspector(overrides: Record<string, unknown> = {}) {
  return render(<Inspector {...(baseProps as any)} {...overrides} />);
}

function DirtyInspectorWithDialog({
  onClose,
  onCancel,
}: {
  onClose: () => void;
  onCancel: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(true);
  return (
    <>
      <Inspector
        {...baseProps}
        tags={[]}
        allTags={[mkTag(2, 'react')]}
        onClose={onClose}
      />
      <ConfirmDialog
        open={dialogOpen}
        title="确认删除"
        message="确定删除？"
        onConfirm={() => setDialogOpen(false)}
        onCancel={() => {
          onCancel();
          setDialogOpen(false);
        }}
      />
    </>
  );
}

describe('Inspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the resource title and a full timestamp', () => {
    renderInspector();
    expect(screen.getByText('My Rule')).toBeDefined();
    expect(screen.getByText(/2026/)).toBeDefined();
  });

  it('does NOT render a source row for rules (Rule 无来源)', () => {
    renderInspector({ source: undefined });
    expect(screen.queryByText('detail.source')).toBeNull();
  });

  it('renders a source row for skills', () => {
    renderInspector({ resourceType: 'skill', source: '本地' });
    expect(screen.getByText('detail.source')).toBeDefined();
    expect(screen.getByText('本地')).toBeDefined();
  });

  it('Inspector 不再渲染底部全宽 reveal 按钮，且不依赖 plugin-opener', () => {
    // 传入 managedCopyPath 模拟旧行为；实现后该 prop 已被删除（TS 编译即校验），底部按钮不再渲染
    renderInspector({ managedCopyPath: '/platform/skills/foo' });
    expect(
      screen.queryByRole('button', {
        name: /在访达中显示|在文件夹中显示|Show in/i,
      })
    ).toBeNull();
  });

  it('starts clean and reveals save/undo only after a tag edit (dirty)', () => {
    const tags = [mkTag(1, 'urgent'), mkTag(2, 'refactor')];
    renderInspector({ tags: [tags[0]], allTags: tags });
    expect(screen.queryByText('actions.save')).toBeNull();
    expect(screen.queryByText('actions.undo')).toBeNull();

    // 打开 TagPopover 勾选未分配标签 → 脏状态出现
    fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
    fireEvent.click(screen.getByText('refactor'));
    expect(screen.getByText('actions.save')).toBeDefined();
    expect(screen.getByText('actions.undo')).toBeDefined();
  });

  it('save calls onSaveTags with added/removed tag ids', async () => {
    const tags = [mkTag(1, 'urgent'), mkTag(2, 'refactor')];
    const onSaveTags = vi.fn().mockResolvedValue(undefined);
    renderInspector({ tags: [tags[0]], allTags: tags, onSaveTags });

    fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
    fireEvent.click(screen.getByText('refactor'));
    fireEvent.click(screen.getByText('actions.save'));

    await waitFor(() => {
      expect(onSaveTags).toHaveBeenCalledWith([2], []);
    });
  });

  it('undo restores the saved tag set and clears dirty state', () => {
    const tags = [mkTag(1, 'urgent'), mkTag(2, 'refactor')];
    renderInspector({ tags: [tags[0]], allTags: tags });

    fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
    fireEvent.click(screen.getByText('refactor'));
    expect(screen.getByText('actions.undo')).toBeDefined();

    fireEvent.click(screen.getByText('actions.undo'));
    expect(screen.queryByText('actions.undo')).toBeNull();
    expect(screen.queryByText('actions.save')).toBeNull();
  });

  it('close while dirty opens 保存/放弃/取消离开 confirm; 放弃 leaves', () => {
    const tags = [mkTag(1, 'urgent')];
    const onClose = vi.fn();
    renderInspector({ tags, allTags: tags, onClose });

    fireEvent.click(screen.getByRole('button', { name: '移除标签 urgent' }));
    fireEvent.click(screen.getByLabelText('close'));

    // 面板内脏状态保存按钮 + 离开确认对话框的保存按钮
    expect(screen.getAllByText('actions.save').length).toBeGreaterThanOrEqual(
      2
    );
    expect(screen.getByText('inspector.discard')).toBeDefined();
    expect(screen.getByText('inspector.stay')).toBeDefined();

    fireEvent.click(screen.getByText('inspector.discard'));
    expect(onClose).toHaveBeenCalled();
  });

  it('close while dirty then 取消离开 keeps inspector open', () => {
    const tags = [mkTag(1, 'urgent')];
    const onClose = vi.fn();
    renderInspector({ tags, allTags: tags, onClose });

    fireEvent.click(screen.getByRole('button', { name: '移除标签 urgent' }));
    fireEvent.click(screen.getByLabelText('close'));
    fireEvent.click(screen.getByText('inspector.stay'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('close while clean calls onClose directly', () => {
    const onClose = vi.fn();
    renderInspector({ onClose });
    fireEvent.click(screen.getByLabelText('close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('标签区渲染为 chips + 添加标签；不再渲染全量 checkbox 列表', async () => {
    render(
      <Inspector
        {...baseProps}
        tags={[mkTag(1, 'frontend')]}
        allTags={[mkTag(1, 'frontend'), mkTag(2, 'react')]}
      />
    );
    expect(screen.getByText('frontend')).toBeDefined();
    // chip × 移除按钮：可访问性名称（mock 输出）+ tooltip
    const removeBtn = screen.getByRole('button', { name: '移除标签 frontend' });
    expect(removeBtn.getAttribute('title')).toBe('移除标签 frontend');
    fireEvent.click(removeBtn);
    await waitFor(() => expect(screen.queryByText('frontend')).toBeNull());
    // 添加标签按钮：由 TagPopover 触发按钮承载，aria-label = inspector.addTag（mock 输出）
    expect(screen.getByRole('button', { name: '添加标签' })).toBeDefined();
    // 不再有全量 checkbox 列表
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('「添加标签」打开 TagPopover；勾选加入 draft', async () => {
    render(
      <Inspector {...baseProps} tags={[]} allTags={[mkTag(2, 'react')]} />
    );
    fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
    await waitFor(() =>
      expect(screen.getByTestId('tag-popover-trigger')).toBeDefined()
    );
    // popover 内点击 react → draft 加入 → chips 出现 react
    fireEvent.click(screen.getByText('react'));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('inspector-tag-chips')).getByText('react')
      ).toBeDefined()
    );
  });

  it('Inspector 打开后焦点落位到容器', () => {
    render(<Inspector {...baseProps} />);
    const container = screen.getByTestId('inspector-root');
    expect(container).toHaveFocus();
  });

  it('Esc 关闭 Inspector；存在未保存标签改动时先弹离开确认', () => {
    const onClose = vi.fn();
    render(
      <Inspector
        {...baseProps}
        tags={[]}
        allTags={[mkTag(2, 'react')]}
        onClose={onClose}
      />
    );
    // 干净状态 Esc → 直接关闭
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // 脏状态：勾选一个标签后 Esc → 不直接关闭，弹出 leaveConfirm
    fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
    fireEvent.click(screen.getByText('react')); // 变为 dirty
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1); // 未新增调用
    expect(screen.getByText('inspector.unsavedTitle')).toBeDefined();
  });

  it('Inspector Header/Footer 结构存在（inspector-header / inspector-actions）', () => {
    render(<Inspector {...baseProps} />);
    expect(screen.getByTestId('inspector-header')).toBeDefined();
    expect(screen.getByTestId('inspector-actions')).toBeDefined();
  });

  it('模态作用域打开时 Esc 不触发 Inspector 关闭/离开确认；作用域关闭后恢复', () => {
    const onClose = vi.fn();
    pushModalScope();
    try {
      render(<Inspector {...baseProps} onClose={onClose} />);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByText('inspector.unsavedTitle')).toBeNull();
    } finally {
      popModalScope();
    }
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dirty Inspector + 打开 ConfirmDialog：单次 Esc 仅关闭 ConfirmDialog，不弹离开确认', () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    render(<DirtyInspectorWithDialog onClose={onClose} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
    fireEvent.click(screen.getByText('react'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('inspector.unsavedTitle')).toBeNull();
  });
});

describe('Inspector — 离开确认对话框语义（M10）', () => {
  it('leave-confirm renders with role=dialog + aria-modal', () => {
    const tags = [mkTag(1, 'urgent')];
    renderInspector({ tags, allTags: tags });
    fireEvent.click(screen.getByRole('button', { name: '移除标签 urgent' }));
    fireEvent.click(screen.getByLabelText('close'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });
});
