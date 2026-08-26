import { create } from 'zustand';
import { ipc, type WatcherEvent } from '../lib/ipc';

interface WatcherStore {
  events: WatcherEvent[];
  unhandledCount: number;
  loading: boolean;
  fetchEvents: () => Promise<void>;
  handleEvent: (eventId: number, action: number) => Promise<void>;
  batchMarkHandled: (ids: number[]) => Promise<void>;
  listenToWatcher: () => Promise<() => void>;
}

export const useWatcherStore = create<WatcherStore>((set, get) => ({
  events: [],
  unhandledCount: 0,
  loading: false,

  fetchEvents: async () => {
    set({ loading: true });
    try {
      const status = await ipc.getWatcherEvents();
      set({
        events: status.events,
        unhandledCount: status.unhandled_count,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  handleEvent: async (eventId, action) => {
    await ipc.handleWatcherEvent(eventId, action);
    set({ events: [], unhandledCount: 0 });
  },

  batchMarkHandled: async (ids) => {
    if (ids.length > 0) {
      await ipc.handleWatcherEvent(ids[0], 2);
    }
    set({ events: [], unhandledCount: 0 });
  },

  listenToWatcher: async () => {
    const { listen } = await import('@tauri-apps/api/event');
    let lastCall = 0;
    const unlisten = await listen('app-fs-changed', () => {
      const now = Date.now();
      if (now - lastCall < 2000) return;
      lastCall = now;
      get().fetchEvents();
    });
    return unlisten;
  },
}));
