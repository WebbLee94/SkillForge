import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty' },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'actions.cancel': '取消',
        'actions.confirm': '确认',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('ConfirmDialog', () => {
  const baseProps = {
    open: true,
    title: '确认删除',
    message: '确定要删除此技能吗？',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('returns null when open is false', () => {
    const { container } = render(<ConfirmDialog {...baseProps} open={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders title and message when open is true', () => {
    render(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText('确认删除')).toBeDefined();
    expect(screen.getByText('确定要删除此技能吗？')).toBeDefined();
  });

  it('renders default button labels from i18n', () => {
    render(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText('取消')).toBeDefined();
    expect(screen.getByText('确认')).toBeDefined();
  });

  it('renders custom button labels when provided', () => {
    render(
      <ConfirmDialog
        {...baseProps}
        confirmLabel="确定删除"
        cancelLabel="再想想"
      />
    );
    expect(screen.getByText('确定删除')).toBeDefined();
    expect(screen.getByText('再想想')).toBeDefined();
  });

  it('applies danger variant class', () => {
    render(<ConfirmDialog {...baseProps} variant="danger" />);
    const buttons = screen.getAllByRole('button');
    const confirmBtn = buttons[buttons.length - 1];
    expect(confirmBtn.className).toContain('bg-error');
  });

  it('applies primary variant class by default', () => {
    render(<ConfirmDialog {...baseProps} />);
    const buttons = screen.getAllByRole('button');
    const confirmBtn = buttons[buttons.length - 1];
    expect(confirmBtn.className).toContain('bg-primary');
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when X close button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
    const xButton = document.querySelector('button') as HTMLElement;
    fireEvent.click(xButton);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    const buttons = screen.getAllByRole('button');
    const confirmBtn = buttons[buttons.length - 1];
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Escape is pressed while open', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not react to Escape when closed', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} open={false} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog when it opens and restores it on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(<ConfirmDialog {...baseProps} />);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    rerender(<ConfirmDialog {...baseProps} open={false} />);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
