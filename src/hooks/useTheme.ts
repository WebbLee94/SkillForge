import { useSyncExternalStore } from 'react';

export const THEME_STORAGE_KEY = 'skillforge-theme';

export type Theme = 'light' | 'dark';

const listeners = new Set<() => void>();

function readStoredTheme(): Theme {
  try {
    const stored = globalThis.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* storage unavailable — fall back to light */
  }
  return 'light';
}

function applyThemeClass(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function persistTheme(theme: Theme) {
  try {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage unavailable — theme applies for this session only */
  }
}

let currentTheme: Theme = readStoredTheme();
applyThemeClass(currentTheme);

function reconcileWithStorage() {
  const stored = readStoredTheme();
  if (stored !== currentTheme) {
    currentTheme = stored;
    listeners.forEach((l) => l());
  }
  applyThemeClass(currentTheme);
}

function subscribe(listener: () => void) {
  reconcileWithStorage();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getTheme(): Theme {
  return currentTheme;
}

export function setTheme(theme: Theme) {
  if (theme === currentTheme) return;
  currentTheme = theme;
  applyThemeClass(theme);
  persistTheme(theme);
  listeners.forEach((l) => l());
}

export function toggleTheme() {
  setTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme);
  return { isDark: theme === 'dark', theme, toggle: toggleTheme, setTheme };
}
