import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../../stores/appStore';
import { ToastProvider } from '../ToastProvider';

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAppStore.setState({ toasts: [] });
  });

  it('returns null when there are no toasts', () => {
    const { container } = render(<ToastProvider />);
    expect(container.innerHTML).toBe('');
  });

  it('renders all toasts from store', () => {
    useAppStore.setState({
      toasts: [
        { id: '1', message: '操作成功', type: 'success' as const },
        { id: '2', message: '操作失败', type: 'error' as const },
      ],
    });
    render(<ToastProvider />);
    expect(screen.getByText('操作成功')).toBeDefined();
    expect(screen.getByText('操作失败')).toBeDefined();
  });

  it('renders correct icon for success type', () => {
    useAppStore.setState({
      toasts: [{ id: '1', message: '成功', type: 'success' as const }],
    });
    const { container } = render(<ToastProvider />);
    const checkIcon = container.querySelector('svg.lucide-check-circle');
    expect(checkIcon).toBeDefined();
  });

  it('renders correct icon for error type', () => {
    useAppStore.setState({
      toasts: [{ id: '1', message: '错误', type: 'error' as const }],
    });
    const { container } = render(<ToastProvider />);
    const alertIcon = container.querySelector('svg.lucide-alert-circle');
    expect(alertIcon).toBeDefined();
  });

  it('renders correct icon for info type', () => {
    useAppStore.setState({
      toasts: [{ id: '1', message: '信息', type: 'info' as const }],
    });
    const { container } = render(<ToastProvider />);
    const infoIcon = container.querySelector('svg.lucide-info');
    expect(infoIcon).toBeDefined();
  });

  it('renders correct icon for warning type', () => {
    useAppStore.setState({
      toasts: [{ id: '1', message: '警告', type: 'warning' as const }],
    });
    const { container } = render(<ToastProvider />);
    const warnIcon = container.querySelector('svg.lucide-alert-triangle');
    expect(warnIcon).toBeDefined();
  });

  it('calls removeToast when dismiss button is clicked', () => {
    const removeToast = vi.fn();
    useAppStore.setState({
      toasts: [{ id: '42', message: '可关闭', type: 'info' as const }],
      removeToast,
    });
    render(<ToastProvider />);
    const dismissBtn = document.querySelector('button');
    expect(dismissBtn).toBeDefined();
    fireEvent.click(dismissBtn!);
    expect(removeToast).toHaveBeenCalledWith('42');
  });

  it('applies correct color class for each toast type', () => {
    useAppStore.setState({
      toasts: [
        { id: '1', message: '成功', type: 'success' as const },
        { id: '2', message: '错误', type: 'error' as const },
        { id: '3', message: '信息', type: 'info' as const },
        { id: '4', message: '警告', type: 'warning' as const },
      ],
    });
    render(<ToastProvider />);
    // Each toast message text is a direct child of the toast row
    const successToast = screen.getByText('成功').closest('div');
    const errorToast = screen.getByText('错误').closest('div');
    const infoToast = screen.getByText('信息').closest('div');
    const warningToast = screen.getByText('警告').closest('div');

    expect(successToast?.className).toContain('border-success');
    expect(errorToast?.className).toContain('border-error');
    expect(infoToast?.className).toContain('border-primary');
    expect(warningToast?.className).toContain('border-warning');
  });
});