import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme, THEME_STORAGE_KEY } from '../useTheme';

describe('useTheme (DM 暗色主题切换, 19 号报告 D-02)', () => {
  const originalClass = document.documentElement.className;
  const originalStorage = globalThis.localStorage;

  beforeEach(() => {
    document.documentElement.className = '';
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  });

  afterEach(() => {
    document.documentElement.className = originalClass;
    globalThis.localStorage = originalStorage;
  });

  it('defaults to light theme and does not add dark class', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggle() adds the dark class and persists preference', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(result.current.isDark).toBe(true);
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('re-initializes from persisted dark preference', () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(result.current.isDark).toBe(true);
  });
});
