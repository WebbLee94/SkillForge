import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagFilterBar } from '../common/TagFilterBar';
import type { Tag } from '../../types';

const sampleTags: Tag[] = [
  { id: 1, name: 'Java', color: '#ff6600', tag_type: 'skill', count: 5 },
  { id: 2, name: 'TypeScript', color: '#3178c6', tag_type: 'skill', count: 3 },
  { id: 3, name: 'React', color: '#61dafb', tag_type: 'skill', count: 8 },
  { id: 4, name: 'Rust', color: '#dea584', tag_type: 'skill', count: 2 },
  { id: 5, name: 'Python', color: '#3572a5', tag_type: 'skill', count: 6 },
];

const fewTags = sampleTags.slice(0, 3); // under COLLAPSE_THRESHOLD (4)

describe('TagFilterBar', () => {
  it('renders "全部" chip and all tags when under threshold', () => {
    render(
      <TagFilterBar
        tags={fewTags}
        selectedTagIds={[]}
        onToggleTag={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    expect(screen.getByText('全部')).toBeDefined();
    expect(screen.getByText('Java')).toBeDefined();
    expect(screen.getByText('TypeScript')).toBeDefined();
    expect(screen.getByText('React')).toBeDefined();
    // No expand button when under threshold
    expect(screen.queryByText(/^\+/)).toBeNull();
    expect(screen.queryByText('收起')).toBeNull();
  });

  it('shows expand button when tags exceed threshold and collapses by default', () => {
    render(
      <TagFilterBar
        tags={sampleTags}
        selectedTagIds={[]}
        onToggleTag={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    expect(screen.getByText('全部')).toBeDefined();
    // Sorted by count descending: React(8), Python(6), Java(5), TypeScript(3), Rust(2)
    // First 4 visible (React, Python, Java, TypeScript)
    expect(screen.getByText('React')).toBeDefined();
    expect(screen.getByText('Python')).toBeDefined();
    expect(screen.getByText('Java')).toBeDefined();
    expect(screen.getByText('TypeScript')).toBeDefined();
    // Rust is 5th, hidden by collapse
    expect(screen.queryByText('Rust')).toBeNull();
    // Expand button shows "+1" (5 - 4 = 1)
    expect(screen.getByText('+1')).toBeDefined();
  });

  it('expands to show all tags when "+N" button clicked', () => {
    render(
      <TagFilterBar
        tags={sampleTags}
        selectedTagIds={[]}
        onToggleTag={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    expect(screen.getByText('+1')).toBeDefined();
    fireEvent.click(screen.getByText('+1'));
    // Now all tags visible including Rust
    expect(screen.getByText('Rust')).toBeDefined();
    // Now "收起" button shows
    expect(screen.getByText('收起')).toBeDefined();
  });

  it('collapses when "收起" is clicked', () => {
    render(
      <TagFilterBar
        tags={sampleTags}
        selectedTagIds={[]}
        onToggleTag={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('+1'));
    expect(screen.getByText('Rust')).toBeDefined();
    fireEvent.click(screen.getByText('收起'));
    expect(screen.queryByText('Rust')).toBeNull();
  });

  it('highlights "全部" when no selection', () => {
    render(
      <TagFilterBar
        tags={fewTags}
        selectedTagIds={[]}
        onToggleTag={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    const allButton = screen.getByText('全部');
    expect(allButton.className).toContain('bg-primary');
  });

  it('dims "全部" when tags are selected', () => {
    render(
      <TagFilterBar
        tags={fewTags}
        selectedTagIds={[1]}
        onToggleTag={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    const allButton = screen.getByText('全部');
    expect(allButton.className).not.toContain('bg-primary');
    expect(allButton.className).toContain('bg-secondary');
  });

  it('calls onToggleTag when a tag chip is clicked', () => {
    const onToggleTag = vi.fn();
    render(
      <TagFilterBar
        tags={fewTags}
        selectedTagIds={[]}
        onToggleTag={onToggleTag}
        onClearAll={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Java'));
    expect(onToggleTag).toHaveBeenCalledWith(1);
  });

  it('calls onClearAll when "全部" is clicked', () => {
    const onClearAll = vi.fn();
    render(
      <TagFilterBar
        tags={fewTags}
        selectedTagIds={[1]}
        onToggleTag={vi.fn()}
        onClearAll={onClearAll}
      />
    );
    fireEvent.click(screen.getByText('全部'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('renders "未分类" button when showUntagged and onToggleUntagged provided', () => {
    render(
      <TagFilterBar
        tags={fewTags}
        selectedTagIds={[]}
        onToggleTag={vi.fn()}
        onClearAll={vi.fn()}
        showUntagged={true}
        untaggedFilter={false}
        onToggleUntagged={vi.fn()}
      />
    );
    expect(screen.getByText('未分类')).toBeDefined();
  });

  it('hides "未分类" button when showUntagged is false', () => {
    render(
      <TagFilterBar
        tags={fewTags}
        selectedTagIds={[]}
        onToggleTag={vi.fn()}
        onClearAll={vi.fn()}
        showUntagged={false}
      />
    );
    expect(screen.queryByText('未分类')).toBeNull();
  });

  it('highlights "未分类" when untaggedFilter is active', () => {
    render(
      <TagFilterBar
        tags={fewTags}
        selectedTagIds={[]}
        onToggleTag={vi.fn()}
        onClearAll={vi.fn()}
        showUntagged={true}
        untaggedFilter={true}
        onToggleUntagged={vi.fn()}
      />
    );
    const untaggedBtn = screen.getByText('未分类');
    expect(untaggedBtn.className).toContain('bg-primary');
  });

  it('calls onToggleUntagged when "未分类" is clicked', () => {
    const onToggleUntagged = vi.fn();
    render(
      <TagFilterBar
        tags={fewTags}
        selectedTagIds={[]}
        onToggleTag={vi.fn()}
        onClearAll={vi.fn()}
        showUntagged={true}
        untaggedFilter={false}
        onToggleUntagged={onToggleUntagged}
      />
    );
    fireEvent.click(screen.getByText('未分类'));
    expect(onToggleUntagged).toHaveBeenCalledTimes(1);
  });
});
