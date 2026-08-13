import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Inspector } from '../Inspector';
import type { Tag } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

const mkTag = (id: number, name: string): Tag => ({
  id,
  name,
  color: null,
  tag_type: 'skill',
});

function renderInspector(overrides: Record<string, unknown> = {}) {
  const props = {
    resourceType: 'rule' as const,
    title: 'My Rule',
    updatedAt: '2026-07-24T10:30:00Z',
    contentPreview: 'rule body preview',
    tags: [] as Tag[],
    allTags: [] as Tag[],
    revealLabel: '在访达中显示',
    onSaveTags: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return render(<Inspector {...(props as any)} />);
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

  it('hides the managed-copy reveal when no managed copy exists (未分发不显示)', () => {
    renderInspector({ managedCopyPath: null });
    expect(screen.queryByText('在访达中显示')).toBeNull();
  });

  it('shows exactly one managed-copy reveal label when a managed copy exists', () => {
    renderInspector({ managedCopyPath: '/platform/skills/foo' });
    const buttons = screen.getAllByText('在访达中显示');
    expect(buttons).toHaveLength(1);
  });

  it('starts clean and reveals save/undo only after a tag edit (dirty)', () => {
    const tags = [mkTag(1, 'urgent'), mkTag(2, 'refactor')];
    renderInspector({ tags: [tags[0]], allTags: tags });
    expect(screen.queryByText('actions.save')).toBeNull();
    expect(screen.queryByText('actions.undo')).toBeNull();

    // toggle the unassigned tag
    fireEvent.click(screen.getByLabelText('refactor'));
    expect(screen.getByText('actions.save')).toBeDefined();
    expect(screen.getByText('actions.undo')).toBeDefined();
  });

  it('save calls onSaveTags with added/removed tag ids', async () => {
    const tags = [mkTag(1, 'urgent'), mkTag(2, 'refactor')];
    const onSaveTags = vi.fn().mockResolvedValue(undefined);
    renderInspector({ tags: [tags[0]], allTags: tags, onSaveTags });

    fireEvent.click(screen.getByLabelText('refactor'));
    fireEvent.click(screen.getByText('actions.save'));

    await waitFor(() => {
      expect(onSaveTags).toHaveBeenCalledWith([2], []);
    });
  });

  it('undo restores the saved tag set and clears dirty state', () => {
    const tags = [mkTag(1, 'urgent'), mkTag(2, 'refactor')];
    renderInspector({ tags: [tags[0]], allTags: tags });

    fireEvent.click(screen.getByLabelText('refactor'));
    expect(screen.getByText('actions.undo')).toBeDefined();

    fireEvent.click(screen.getByText('actions.undo'));
    expect(screen.queryByText('actions.undo')).toBeNull();
    expect(screen.queryByText('actions.save')).toBeNull();
  });

  it('close while dirty opens 保存/放弃/取消离开 confirm; 放弃 leaves', () => {
    const tags = [mkTag(1, 'urgent')];
    const onClose = vi.fn();
    renderInspector({ tags, allTags: tags, onClose });

    fireEvent.click(screen.getByLabelText('urgent'));
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

    fireEvent.click(screen.getByLabelText('urgent'));
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
});

describe('Inspector — 离开确认对话框语义（M10）', () => {
  it('leave-confirm renders with role=dialog + aria-modal', () => {
    const tags = [mkTag(1, 'urgent')];
    renderInspector({ tags, allTags: tags });
    fireEvent.click(screen.getByLabelText('urgent'));
    fireEvent.click(screen.getByLabelText('close'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });
});
