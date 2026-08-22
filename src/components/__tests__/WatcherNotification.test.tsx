import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../../stores/appStore';
import { useWatcherStore } from '../../stores/watcherStore';
import { WatcherNotification } from '../../domains/dashboard/WatcherNotification';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'watcher.changesDetected' && typeof options?.count === 'number') {
        return `检测到 ${options.count} 个文件变更`;
      }
      if (key === 'watcher.newFiles' && typeof options?.count === 'number') {
        return `${options.count} 个新增`;
      }
      if (key === 'watcher.deletedFiles' && typeof options?.count === 'number') {
        return `${options.count} 个删除`;
      }
      if (key === 'watcher.modifiedFiles' && typeof options?.count === 'number') {
        return `${options.count} 个修改`;
      }
      const map: Record<string, string> = {
        'watcher.importHint': '文件变更通知，前往概览查看可导入的技能和规则',
        'watcher.goToDashboard': '去概览查看可导入内容',
        'watcher.dismiss': '忽略',
      };
      return map[key] ?? key;
    },
  }),
}));

const makeEvent = (id: number, event_type: string) => ({
  id,
  event_type,
  capability: 'skills',
  path: `/path/${id}.md`,
  platform: null,
  old_hash: null,
  new_hash: `hash${id}`,
  handled: 0,
  created_at: '2026-08-03T10:00:00Z',
});

beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.setState({
    toasts: [],
    setActiveNav: vi.fn(),
  });
  useWatcherStore.setState({
    events: [],
    unhandledCount: 0,
    loading: false,
  });
});

describe('WatcherNotification', () => {
  it('returns null when there are no events', () => {
    const { container } = render(<WatcherNotification />);
    expect(container.innerHTML).toBe('');
  });

  it('renders notification when events are present', () => {
    useWatcherStore.setState({
      events: [makeEvent(1, 'NEW')],
    });
    render(<WatcherNotification />);
    expect(screen.getByText('检测到 1 个文件变更')).toBeDefined();
    expect(screen.getByText((c: string) => c.includes('1 个新增'))).toBeDefined();
  });

  it('shows breakdown for multiple event types', () => {
    useWatcherStore.setState({
      events: [
        makeEvent(2, 'NEW'),
        makeEvent(3, 'DELETED'),
        makeEvent(4, 'MODIFIED'),
      ],
    });
    render(<WatcherNotification />);
    expect(screen.getByText('检测到 3 个文件变更')).toBeDefined();
    const breakdownEl = screen.getByText((c: string) =>
      c.includes('1 个新增') && c.includes('1 个删除') && c.includes('1 个修改')
    );
    expect(breakdownEl).toBeDefined();
  });

  it('renders go-to-dashboard and dismiss buttons', () => {
    useWatcherStore.setState({
      events: [makeEvent(5, 'NEW')],
    });
    render(<WatcherNotification />);
    expect(screen.getByText('去概览查看可导入内容')).toBeDefined();
    expect(screen.getByText('忽略')).toBeDefined();
  });

  it('go to dashboard button calls setActiveNav with dashboard', () => {
    const setActiveNav = vi.fn();
    useAppStore.setState({ setActiveNav });
    useWatcherStore.setState({
      events: [makeEvent(6, 'NEW')],
    });
    render(<WatcherNotification />);
    fireEvent.click(screen.getByText('去概览查看可导入内容'));
    expect(setActiveNav).toHaveBeenCalledWith('dashboard');
  });

  it('dismiss button hides the notification', () => {
    useWatcherStore.setState({
      events: [makeEvent(7, 'NEW')],
    });
    const { container } = render(<WatcherNotification />);
    expect(screen.getByText('检测到 1 个文件变更')).toBeDefined();

    fireEvent.click(screen.getByText('忽略'));
    expect(container.innerHTML).toBe('');
  });

  it('renders import hint text that does not imply all events will be imported', () => {
    useWatcherStore.setState({
      events: [makeEvent(10, 'NEW')],
    });
    render(<WatcherNotification />);
    const hint = screen.getByText((c: string) =>
      c.includes('文件变更通知') && c.includes('查看可导入')
    );
    expect(hint).toBeDefined();
  });

  it('shows activeCount, new, deleted, modified counts separately without implying import', () => {
    useWatcherStore.setState({
      events: [
        makeEvent(20, 'NEW'),
        makeEvent(21, 'DELETED'),
        makeEvent(22, 'MODIFIED'),
        makeEvent(23, 'NEW'),
      ],
    });
    render(<WatcherNotification />);
    expect(screen.getByText('检测到 4 个文件变更')).toBeDefined();
    expect(screen.getByText((c: string) => c.includes('2 个新增'))).toBeDefined();
    expect(screen.getByText((c: string) => c.includes('1 个删除'))).toBeDefined();
    expect(screen.getByText((c: string) => c.includes('1 个修改'))).toBeDefined();
    // Verify the hint does NOT say "全部导入" — watcher events are file changes, not imports
    const hintEl = screen.getByText((c: string) => c.includes('文件变更通知'));
    expect(hintEl).toBeDefined();
    expect(hintEl.textContent).not.toContain('全部导入');
  });

  it('renders AlertTriangle icon', () => {
    useWatcherStore.setState({
      events: [makeEvent(11, 'NEW')],
    });
    const { container } = render(<WatcherNotification />);
    const alertSvg = container.querySelector('svg.lucide-alert-triangle');
    expect(alertSvg).toBeDefined();
  });

  it('dismiss via X close button hides notification', () => {
    useWatcherStore.setState({
      events: [makeEvent(12, 'NEW')],
    });
    const { container } = render(<WatcherNotification />);
    expect(screen.getByText('检测到 1 个文件变更')).toBeDefined();

    const buttons = screen.getAllByRole('button');
    const lastBtn = buttons[buttons.length - 1];
    fireEvent.click(lastBtn);
    expect(container.innerHTML).toBe('');
  });
});
