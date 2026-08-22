import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResourceCollection } from '../../domains/resources/ResourceCollection';
import { BOUNDED_STEP } from '../../lib/useBoundedReveal';
import type { Tag, Skill } from '../../types';

const mkTag = (id: number, name: string): Tag => ({
  id,
  name,
  color: null,
  tag_type: 'skill',
});

const mkItem = (id: string, tagIds: number[] = []): Skill => ({
  id,
  name: id,
  description: null,
  source_type: 'local',
  source_url: null,
  current_ver: null,
  installed_at: '2026-01-01T00:00:00Z',
  local_path: `/p/${id}`,
  metadata: null,
  tags: tagIds.map((tid) => mkTag(tid, `tag-${tid}`)),
});

function renderCollection(overrides: Record<string, unknown> = {}) {
  const props = {
    items: [] as Skill[],
    tags: [] as Tag[],
    view: 'group' as const,
    batchMode: false,
    selectedIds: new Set<string>(),
    untaggedLabel: '未分类',
    collapseAllLabel: '全部折叠',
    expandAllLabel: '全部展开',
    showMoreLabel: '显示更多 ({{count}})',
    onToggleSelect: vi.fn(),
    onOpenDetail: vi.fn(),
    renderItem: (item: Skill) => <span>{item.name}</span>,
    ...overrides,
  };
  return render(<ResourceCollection {...(props as any)} />);
}

describe('ResourceCollection', () => {
  it('group view renders untagged group first', () => {
    const tags = [mkTag(1, 'frontend')];
    renderCollection({
      items: [mkItem('tagged', [1]), mkItem('plain')],
      tags,
    });
    expect(screen.getByText('未分类')).toBeDefined();
    expect(screen.getByText('frontend')).toBeDefined();
    expect(screen.getByText('plain')).toBeDefined();
    expect(screen.getByText('tagged')).toBeDefined();
  });

  it('multi-tag resource appears in multiple groups (same id, no copy)', () => {
    const tags = [mkTag(1, 'review'), mkTag(2, 'standards')];
    const item = mkItem('code-review', [1, 2]);
    renderCollection({ items: [item], tags });
    // untagged + review + standards
    const reviews = screen.getAllByText('code-review');
    expect(reviews.length).toBe(2);
  });

  it('collapses a single group on header click', () => {
    const tags = [mkTag(1, 'frontend')];
    renderCollection({
      items: [mkItem('tagged', [1]), mkItem('plain')],
      tags,
    });
    fireEvent.click(screen.getByText('frontend'));
    expect(screen.queryByText('tagged')).toBeNull();
    expect(screen.getByText('plain')).toBeDefined();
  });

  it('list view renders every item exactly once (no grouping)', () => {
    const tags = [mkTag(1, 'frontend')];
    renderCollection({
      view: 'list',
      items: [mkItem('multi', [1]), mkItem('plain')],
      tags,
    });
    expect(screen.getByText('multi')).toBeDefined();
    expect(screen.getByText('plain')).toBeDefined();
    expect(screen.queryByText('未分类')).toBeNull();
  });

  it('clicking a card opens detail when batch mode is off', () => {
    const onOpenDetail = vi.fn();
    renderCollection({
      items: [mkItem('a')],
      onOpenDetail,
    });
    fireEvent.click(screen.getByText('a'));
    expect(onOpenDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' })
    );
  });

  it('clicking a card toggles selection in batch mode', () => {
    const onToggleSelect = vi.fn();
    renderCollection({
      items: [mkItem('a')],
      batchMode: true,
      onToggleSelect,
    });
    fireEvent.click(screen.getByText('a'));
    expect(onToggleSelect).toHaveBeenCalledWith('a');
  });

  it('Enter key opens detail (keyboard access)', () => {
    const onOpenDetail = vi.fn();
    renderCollection({
      items: [mkItem('a')],
      onOpenDetail,
    });
    fireEvent.keyDown(screen.getByText('a'), { key: 'Enter' });
    expect(onOpenDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' })
    );
  });

  it('renders empty label when no items', () => {
    renderCollection({ items: [], emptyLabel: <p>empty-label</p> });
    expect(screen.getByText('empty-label')).toBeDefined();
  });
});

describe('ResourceCollection — 批量选择 a11y（M5）', () => {
  it('batch mode: card exposes checkbox role with aria-checked, no nested input', () => {
    renderCollection({
      items: [mkItem('a')],
      batchMode: true,
      selectedIds: new Set(['a']),
    });
    const card = screen.getByRole('checkbox', { name: /a/ });
    expect(card.getAttribute('aria-checked')).toBe('true');
    expect(card.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('non-batch mode: card exposes button role', () => {
    renderCollection({ items: [mkItem('a')] });
    expect(screen.getByRole('button', { name: /a/ })).toBeDefined();
  });
});

describe('ResourceCollection — 分组头无障碍名称（M6）', () => {
  it('group header accessible name includes the visible name and count', () => {
    const tags = [mkTag(1, 'frontend')];
    renderCollection({ items: [mkItem('tagged', [1])], tags });
    // 可访问名来自可见文本（名称 + 数量），不再被 aria-label 覆盖
    expect(screen.getByRole('button', { name: /frontend\s*1/ })).toBeDefined();
  });
});

describe('ResourceCollection — A16 有界渲染', () => {
  const manyItems = (n: number): Skill[] =>
    Array.from({ length: n }, (_, i) => mkItem(`item-${i}`));

  it('list view renders only a bounded subset of a large list', () => {
    renderCollection({ view: 'list', items: manyItems(120) });
    expect(screen.getAllByTestId('resource-item').length).toBe(BOUNDED_STEP);
    expect(screen.getByText('item-0')).toBeDefined();
    expect(screen.queryByText(`item-${BOUNDED_STEP}`)).toBeNull();
    expect(screen.queryByText('item-119')).toBeNull();
  });

  it('list view "show more" reveals the next bounded batch until exhausted', () => {
    renderCollection({ view: 'list', items: manyItems(120) });
    fireEvent.click(screen.getByTestId('show-more'));
    expect(screen.getAllByTestId('resource-item').length).toBe(BOUNDED_STEP * 2);
    expect(screen.getByText(`item-${BOUNDED_STEP}`)).toBeDefined();
    fireEvent.click(screen.getByTestId('show-more'));
    expect(screen.getAllByTestId('resource-item').length).toBe(120);
    expect(screen.getByText('item-119')).toBeDefined();
    expect(screen.queryByTestId('show-more')).toBeNull();
  });

  it('group view bounds each group but keeps the full count in the header', () => {
    const tags = [mkTag(1, 'frontend')];
    renderCollection({
      items: manyItems(120).map((it) => ({ ...it, tags: [mkTag(1, 'frontend')] })),
      tags,
    });
    const group = screen.getByRole('button', { name: /frontend\s*120/ });
    expect(group).toBeDefined();
    expect(screen.getAllByTestId('resource-item').length).toBe(BOUNDED_STEP);
    expect(screen.getByText('item-0')).toBeDefined();
    expect(screen.queryByText(`item-${BOUNDED_STEP}`)).toBeNull();
  });

  it('group view "show more" reveals the rest of a large group', () => {
    const tags = [mkTag(1, 'frontend')];
    renderCollection({
      items: manyItems(120).map((it) => ({ ...it, tags: [mkTag(1, 'frontend')] })),
      tags,
    });
    fireEvent.click(screen.getByTestId('show-more'));
    expect(screen.getAllByTestId('resource-item').length).toBe(BOUNDED_STEP * 2);
    expect(screen.getByText(`item-${BOUNDED_STEP}`)).toBeDefined();
    expect(screen.getByRole('button', { name: /frontend\s*120/ })).toBeDefined();
  });

  it('small lists render in full with no show-more button', () => {
    renderCollection({ view: 'list', items: manyItems(3) });
    expect(screen.getAllByTestId('resource-item').length).toBe(3);
    expect(screen.queryByTestId('show-more')).toBeNull();
  });

  it('a filtered (small) result set is rendered in full — search still works on the full data upstream', () => {
    const all = manyItems(120);
    const filtered = all.filter((it) => it.name.startsWith('item-1'));
    renderCollection({ view: 'list', items: filtered });
    expect(screen.getAllByTestId('resource-item').length).toBe(filtered.length);
    expect(screen.getByText('item-10')).toBeDefined();
    expect(screen.queryByText('item-0')).toBeNull();
    expect(screen.queryByTestId('show-more')).toBeNull();
  });

  it('batch selection still works on a large bounded list (visible item toggles)', () => {
    const onToggleSelect = vi.fn();
    renderCollection({
      view: 'list',
      items: manyItems(120),
      batchMode: true,
      onToggleSelect,
    });
    fireEvent.click(screen.getByText('item-3'));
    expect(onToggleSelect).toHaveBeenCalledWith('item-3');
    fireEvent.click(screen.getByTestId('show-more'));
    fireEvent.click(screen.getByText(`item-${BOUNDED_STEP}`));
    expect(onToggleSelect).toHaveBeenCalledWith(`item-${BOUNDED_STEP}`);
  });

  it('keyboard access still works on the bounded list', () => {
    const onOpenDetail = vi.fn();
    renderCollection({
      view: 'list',
      items: manyItems(120),
      onOpenDetail,
    });
    fireEvent.keyDown(screen.getByText('item-7'), { key: 'Enter' });
    expect(onOpenDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-7' })
    );
  });
});
