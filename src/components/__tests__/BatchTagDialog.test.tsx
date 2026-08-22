import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BatchTagDialog } from '../../domains/tags/BatchTagDialog';
import type { Tag } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

const mkTag = (id: number, name: string): Tag => ({
  id,
  name,
  color: null,
  tag_type: 'skill',
});

const base = {
  open: true,
  allTags: [mkTag(1, 'frontend'), mkTag(2, 'backend'), mkTag(3, 'urgent')],
  initialTagIds: [2],
  title: '管理所选标签',
  applyLabel: '应用',
  onApply: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

describe('BatchTagDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<BatchTagDialog {...base} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows all tags with initial (intersection) tags checked', () => {
    render(<BatchTagDialog {...base} />);
    expect(screen.getByText('frontend')).toBeDefined();
    expect(screen.getByText('backend')).toBeDefined();
    expect(screen.getByText('urgent')).toBeDefined();
    const backend = screen.getByLabelText('backend') as HTMLInputElement;
    const frontend = screen.getByLabelText('frontend') as HTMLInputElement;
    expect(backend.checked).toBe(true);
    expect(frontend.checked).toBe(false);
  });

  it('confirm calls onApply with added/removed tag ids', async () => {
    render(<BatchTagDialog {...base} />);
    // 勾选 frontend（新增），取消 backend（移除）
    fireEvent.click(screen.getByLabelText('frontend'));
    fireEvent.click(screen.getByLabelText('backend'));
    fireEvent.click(screen.getByText('应用'));
    expect(base.onApply).toHaveBeenCalledWith([1], [2]);
  });

  it('close calls onClose', () => {
    render(<BatchTagDialog {...base} />);
    fireEvent.click(screen.getByText('actions.cancel'));
    expect(base.onClose).toHaveBeenCalled();
  });

  it('Escape closes the dialog only', () => {
    render(<BatchTagDialog {...base} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(base.onClose).toHaveBeenCalledTimes(1);
    expect(base.onApply).not.toHaveBeenCalled();
  });
});

describe('BatchTagDialog — 对话框语义与焦点（M10）', () => {
  it('renders role=dialog + aria-modal and moves focus into the dialog', () => {
    render(<BatchTagDialog {...base} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement).toBe(dialog);
  });
});
