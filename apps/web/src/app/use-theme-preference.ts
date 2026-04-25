'use client';

import { useSyncExternalStore } from 'react';
import { THEME_STORAGE_KEY, type Theme } from './theme';

const themeListeners = new Set<() => void>();

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.dataset.theme = theme;
}

function getThemeSnapshot(): Theme {
  if (typeof document === 'undefined') {
    return 'light';
  }

  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function getThemeServerSnapshot(): Theme {
  return 'light';
}

function subscribeToTheme(listener: () => void): () => void {
  themeListeners.add(listener);

  return () => {
    themeListeners.delete(listener);
  };
}

function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme selection is a convenience; failing to persist should not block use.
  }
}

function setThemePreference(theme: Theme): void {
  applyTheme(theme);
  storeTheme(theme);
  themeListeners.forEach((listener) => listener());
}

export function useThemePreference(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );

  return [theme, setThemePreference];
}
