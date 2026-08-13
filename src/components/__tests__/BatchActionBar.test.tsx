import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BatchActionBar } from '../BatchActionBar';

const base = {
  enabled: true,
  selectedCount: 0,
  selectedLabel: '已选 3 项',
  guideLabel: '勾选资源后操作',
  exitLabel: '退出批量模式',
  manageTagsLabel: '管理所选标签',
  goDistributeLabel: '去分发',
  deleteLabel: '批量删除',
  onExit: vi.fn(),
  onGoDistribute: vi.fn(),
  onManageTags: vi.fn(),
  onDelete: vi.fn(),
};

describe('BatchActionBar', () => {
  it('renders nothing when batch mode is disabled (默认隐藏选择控件)', () => {
    const { container } = render(<BatchActionBar {...base} enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('armed: shows compact guide + exit, and does NOT render disabled action buttons', () => {
    render(<BatchActionBar {...base} />);
    expect(screen.getByText('勾选资源后操作')).toBeDefined();
    expect(screen.getByText('退出批量模式')).toBeDefined();
    // 不渲染禁用的动作按钮
    expect(screen.queryByText('去分发')).toBeNull();
    expect(screen.queryByText('管理所选标签')).toBeNull();
    expect(screen.queryByText('批量删除')).toBeNull();
  });

  it('armed: exit button calls onExit', () => {
    render(<BatchActionBar {...base} />);
    fireEvent.click(screen.getByText('退出批量模式'));
    expect(base.onExit).toHaveBeenCalled();
  });

  it('selected: shows the count label exactly as passed (i18n interpolation done by caller)', () => {
    render(<BatchActionBar {...base} selectedCount={3} />);
    expect(screen.getByText('已选 3 项')).toBeDefined();
    expect(screen.getByText('去分发')).toBeDefined();
    expect(screen.getByText('管理所选标签')).toBeDefined();
    expect(screen.getByText('批量删除')).toBeDefined();
    expect(screen.getByText('退出批量模式')).toBeDefined();
  });

  it('does not perform its own {{count}} replacement', () => {
    render(
      <BatchActionBar
        {...base}
        selectedLabel="已选 {{count}} 项"
        selectedCount={2}
      />
    );
    expect(screen.getByText('已选 {{count}} 项')).toBeDefined();
  });

  it('selected: actions fire their callbacks', () => {
    render(<BatchActionBar {...base} selectedCount={2} />);
    fireEvent.click(screen.getByText('去分发'));
    fireEvent.click(screen.getByText('管理所选标签'));
    fireEvent.click(screen.getByText('批量删除'));
    fireEvent.click(screen.getByText('退出批量模式'));
    expect(base.onGoDistribute).toHaveBeenCalled();
    expect(base.onManageTags).toHaveBeenCalled();
    expect(base.onDelete).toHaveBeenCalled();
    expect(base.onExit).toHaveBeenCalled();
  });
});
