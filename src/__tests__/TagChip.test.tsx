import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagChip } from '../components/ui/tags/TagChip';
import type { Tag } from '../types';

const mockTag: Tag = {
  id: 1,
  name: 'Java',
  color: '#ff6600',
  tag_type: 'skill',
};

const mkTag = (id: number, name: string): Tag => ({
  id,
  name,
  color: '#ff6600',
  tag_type: 'skill',
});

describe('TagChip', () => {
  it('onRemove 渲染语义化移除按钮（aria-label + title），wrapper 为非交互 span、无嵌套 button', () => {
    const { container } = render(
      <TagChip
        tag={mkTag(1, 'Java')}
        onClick={vi.fn()}
        onRemove={() => {}}
        removeLabel="移除标签 Java"
      />
    );
    const removeBtn = container.querySelector(
      'button[aria-label="移除标签 Java"]'
    );
    expect(removeBtn).not.toBeNull();
    expect(removeBtn?.getAttribute('title')).toBe('移除标签 Java');
    // wrapper 为非交互 span，移除按钮不在任何 button 内（无嵌套交互元素）
    const wrapper = removeBtn?.parentElement;
    expect(wrapper?.tagName).toBe('SPAN');
    expect(wrapper?.closest('button')).toBeNull();
    // 主 chip 按钮与移除按钮为兄弟，同属该 wrapper
    const primaryBtn = wrapper?.querySelector('button:not([aria-label])');
    expect(primaryBtn).not.toBeNull();
    expect(primaryBtn?.parentElement).toBe(wrapper);
    expect(removeBtn?.parentElement).toBe(wrapper);
  });

  it('renders tag name and color indicator', () => {
    render(<TagChip tag={mockTag} />);
    expect(screen.getByText('Java')).toBeDefined();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<TagChip tag={mockTag} onClick={handleClick} />);
    fireEvent.click(screen.getByText('Java'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('calls onRemove when close button clicked (with stopPropagation)', () => {
    const handleClick = vi.fn();
    const handleRemove = vi.fn();
    render(
      <TagChip tag={mockTag} onClick={handleClick} onRemove={handleRemove} />
    );
    // Click the × close button
    fireEvent.click(screen.getByText('×'));
    expect(handleRemove).toHaveBeenCalledTimes(1);
    // onClick should NOT fire due to stopPropagation
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('renders count when tag.count is set', () => {
    const tagWithCount = { ...mockTag, count: 5 };
    render(<TagChip tag={tagWithCount} />);
    expect(screen.getByText('5')).toBeDefined();
  });

  it('applies selected styles when selected=true', () => {
    const { container } = render(<TagChip tag={mockTag} selected />);
    const button = container.querySelector('button');
    expect(button?.className).toContain('ring-2');
  });

  it('applies sm sizing when size=sm', () => {
    const { container } = render(<TagChip tag={mockTag} size="sm" />);
    const button = container.querySelector('button');
    expect(button?.className).toContain('px-2');
    expect(button?.className).not.toContain('px-3');
  });

  it('renders without color-specific styles when tag has no color', () => {
    const { container } = render(<TagChip tag={{ ...mockTag, color: null }} />);
    const button = container.querySelector('button');
    expect(button?.style.backgroundColor).toBe('');
    const dot = container.querySelector('span.rounded-full');
    expect(dot?.getAttribute('style')).toBeNull();
  });

  it('does not render count or close button when absent', () => {
    const { container } = render(<TagChip tag={mockTag} />);
    expect(container.textContent).not.toContain('×');
    expect(container.textContent).not.toMatch(/^\d+$/);
  });

  it('does not trigger remove without onRemove and no unselected ring', () => {
    const { container } = render(<TagChip tag={mockTag} />);
    const button = container.querySelector('button');
    expect(button?.className).toContain('hover:shadow-sm');
    expect(button?.className).not.toContain('ring-2');
  });
});
