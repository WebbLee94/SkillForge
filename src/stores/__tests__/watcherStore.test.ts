import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWatcherStore } from '../watcherStore';

// Mock @tauri-apps/api/core invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/event listen
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

describe('watcherStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWatcherStore.setState({
      events: [],
      unhandledCount: 0,
      loading: false,
    });
  });

  it('fetchEvents loads events and count on success', async () => {
    const mockStatus = {
      unhandled_count: 3,
      events: [
        { id: 1, event_type: 'modified', capability: 'skill', path: '/tmp/test', handled: 0 },
        { id: 2, event_type: 'created', capability: 'rule', path: '/tmp/test2', handled: 0 },
      ],
    };
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue(mockStatus);

    await useWatcherStore.getState().fetchEvents();

    const state = useWatcherStore.getState();
    expect(state.events).toHaveLength(2);
    expect(state.unhandledCount).toBe(3);
    expect(state.loading).toBe(false);
  });

  it('fetchEvents handles empty events gracefully', async () => {
    const mockStatus = { unhandled_count: 0, events: [] };
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue(mockStatus);

    await useWatcherStore.getState().fetchEvents();

    expect(useWatcherStore.getState().events).toEqual([]);
    expect(useWatcherStore.getState().unhandledCount).toBe(0);
  });

  it('fetchEvents handles error gracefully', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockRejectedValue(new Error('Network error'));

    await useWatcherStore.getState().fetchEvents();

    expect(useWatcherStore.getState().loading).toBe(false);
    // State events remain empty on error
    expect(useWatcherStore.getState().events).toEqual([]);
  });

  it('handleEvent calls invoke and resets state', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue({});

    await useWatcherStore.getState().handleEvent(1, 1);

    expect(invoke).toHaveBeenCalledWith('handle_watcher_event', {
      eventId: 1,
      action: 1,
    });
    expect(useWatcherStore.getState().events).toEqual([]);
    expect(useWatcherStore.getState().unhandledCount).toBe(0);
  });

  it('batchMarkHandled calls invoke with first id and resets state', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue({});

    await useWatcherStore.getState().batchMarkHandled([1, 2, 3]);

    expect(invoke).toHaveBeenCalledWith('handle_watcher_event', {
      eventId: 1,
      action: 2,
    });
    expect(useWatcherStore.getState().events).toEqual([]);
  });

  it('batchMarkHandled does nothing with empty ids', async () => {
    const { invoke } = await import('@tauri-apps/api/core');

    await useWatcherStore.getState().batchMarkHandled([]);

    // invoke should not be called with empty array
    const calls = (invoke as any).mock.calls.filter(
      (c: any[]) => c[0] === 'handle_watcher_event'
    );
    expect(calls).toHaveLength(0);
  });

  it('listenToWatcher registers event listener and returns unlisten', async () => {
    const unlistenFn = vi.fn();
    const { listen } = await import('@tauri-apps/api/event');
    (listen as any).mockResolvedValue(unlistenFn);

    const result = await useWatcherStore.getState().listenToWatcher();

    expect(listen).toHaveBeenCalledWith('app-fs-changed', expect.any(Function));
    expect(result).toBe(unlistenFn);
  });
});