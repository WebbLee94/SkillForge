import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagChip } from '../components/TagChip';
import type { Tag } from '../types';

const mockTag: Tag = {
  id: 1,
  name: 'Java',
  color: '#ff6600',
  tag_type: 'skill',
};

describe('TagChip', () => {
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
});
