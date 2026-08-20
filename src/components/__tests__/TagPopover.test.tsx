import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagPopover } from '../TagPopover';
import type { Tag } from '../../types';

const mockTags: Tag[] = [
  { id: 1, name: 'Java', color: '#ff6600', tag_type: 'skill', count: 3 },
  { id: 2, name: 'React', color: '#3B82F6', tag_type: 'skill', count: 5 },
  { id: 3, name: 'TypeScript', color: '#3178C6', tag_type: 'skill', count: 0 },
];

const assignedTags: Tag[] = [mockTags[0]];

describe('TagPopover', () => {
  const baseProps = {
    tagType: 'skill' as const,
    targetId: 'skill-1',
    assignedTags,
    allTags: mockTags,
    onAssign: vi.fn(),
    onRemove: vi.fn(),
    onCreate: vi.fn<() => Promise<number | void>>().mockResolvedValue(42),
  };

  it('渲染触发器按钮', () => {
    render(<TagPopover {...baseProps} />);
    expect(screen.getByTestId('tag-popover-trigger')).toBeDefined();
  });

  it('ariaLabel 应用于触发按钮的可访问性名称（N4）', () => {
    render(<TagPopover {...baseProps} ariaLabel="添加标签" />);
    expect(screen.getByRole('button', { name: '添加标签' })).toBeDefined();
  });

  it('点击触发器打开弹出层', () => {
    render(<TagPopover {...baseProps} />);
    fireEvent.click(screen.getByTestId('tag-popover-trigger'));
    expect(screen.getByPlaceholderText('搜索或输入标签名...')).toBeDefined();
    expect(screen.getByText('Java')).toBeDefined();
    expect(screen.getByText('React')).toBeDefined();
    expect(screen.getByText('TypeScript')).toBeDefined();
  });

  it('已分配的标签显示勾选标记', () => {
    render(<TagPopover {...baseProps} />);
    fireEvent.click(screen.getByTestId('tag-popover-trigger'));
    // Java (assigned) should have check icon in the checkbox
    const checkIcons = document.querySelectorAll('svg.lucide-check');
    expect(checkIcons.length).toBeGreaterThan(0);
  });

  it('搜索过滤标签列表', () => {
    render(<TagPopover {...baseProps} />);
    fireEvent.click(screen.getByTestId('tag-popover-trigger'));
    const searchInput = screen.getByPlaceholderText('搜索或输入标签名...');
    fireEvent.change(searchInput, { target: { value: 'React' } });
    expect(screen.getByText('React')).toBeDefined();
    expect(screen.queryByText('Java')).toBeNull();
    expect(screen.queryByText('TypeScript')).toBeNull();
  });

  it('搜索无匹配时显示空列表', () => {
    render(<TagPopover {...baseProps} />);
    fireEvent.click(screen.getByTestId('tag-popover-trigger'));
    const searchInput = screen.getByPlaceholderText('搜索或输入标签名...');
    fireEvent.change(searchInput, { target: { value: 'XYZ' } });
    expect(screen.queryByText('Java')).toBeNull();
    expect(screen.queryByText('React')).toBeNull();
  });

  it('无标签时显示"无可用标签"', () => {
    render(<TagPopover {...baseProps} allTags={[]} />);
    fireEvent.click(screen.getByTestId('tag-popover-trigger'));
    expect(screen.getByText('无可用标签')).toBeDefined();
  });

  it('已分配标签点击触发 onRemove', () => {
    const onRemove = vi.fn();
    render(<TagPopover {...baseProps} onRemove={onRemove} />);
    fireEvent.click(screen.getByTestId('tag-popover-trigger'));
    // Click Java (already assigned)
    fireEvent.click(screen.getByText('Java'));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('未分配标签点击触发 onAssign', () => {
    const onAssign = vi.fn();
    render(<TagPopover {...baseProps} onAssign={onAssign} />);
    fireEvent.click(screen.getByTestId('tag-popover-trigger'));
    // Click React (not assigned)
    fireEvent.click(screen.getByText('React'));
    expect(onAssign).toHaveBeenCalledWith(2);
  });

  it('搜索新名称时显示创建按钮', () => {
    render(<TagPopover {...baseProps} />);
    fireEvent.click(screen.getByTestId('tag-popover-trigger'));
    const searchInput = screen.getByPlaceholderText('搜索或输入标签名...');
    fireEvent.change(searchInput, { target: { value: 'NewTag' } });
    expect(screen.getByText(/创建/)).toBeDefined();
  });

  it('onCreate 缺失时不显示创建入口（守卫）', () => {
    render(<TagPopover {...baseProps} onCreate={undefined} />);
    fireEvent.click(screen.getByTestId('tag-popover-trigger'));
    const searchInput = screen.getByPlaceholderText('搜索或输入标签名...');
    fireEvent.change(searchInput, { target: { value: 'NewTag' } });
    expect(screen.queryByText(/创建/)).toBeNull();
  });

  it('回车键触发创建', () => {
    const onCreate = vi.fn().mockResolvedValue(99);
    render(<TagPopover {...baseProps} onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('tag-popover-trigger'));
    const searchInput = screen.getByPlaceholderText('搜索或输入标签名...');
    fireEvent.change(searchInput, { target: { value: 'NewTag' } });
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith('NewTag', expect.any(String));
  });

  it('显示标签关联计数', () => {
    render(<TagPopover {...baseProps} />);
    fireEvent.click(screen.getByTestId('tag-popover-trigger'));
    expect(screen.getByText('3')).toBeDefined(); // Java count
    expect(screen.getByText('5')).toBeDefined(); // React count
  });
});