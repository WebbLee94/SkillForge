import { useCallback, useEffect, useState } from 'react';

export const THEME_STORAGE_KEY = 'skillforge-theme';

type Theme = 'light' | 'dark';

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

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const initial = readStoredTheme();
    return initial;
  });

  useEffect(() => {
    applyThemeClass(theme);
    try {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage unavailable — theme applies for this session only */
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { isDark: theme === 'dark', theme, toggle };
}
