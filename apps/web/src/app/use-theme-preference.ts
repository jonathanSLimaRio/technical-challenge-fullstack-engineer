'use client';

import { useSyncExternalStore } from 'react';
import { THEME_STORAGE_KEY, type Theme } from './theme';

const themeListeners = new Set<() => void>();
let themeTransitionTimeout: ReturnType<typeof setTimeout> | null = null;

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const shouldTransition =
    typeof window !== 'undefined' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (themeTransitionTimeout) {
    clearTimeout(themeTransitionTimeout);
    themeTransitionTimeout = null;
  }

  if (shouldTransition) {
    root.classList.add('theme-transitioning');
  }

  root.dataset.theme = theme;

  if (shouldTransition) {
    themeTransitionTimeout = setTimeout(() => {
      root.classList.remove('theme-transitioning');
      themeTransitionTimeout = null;
    }, 220);
  } else {
    root.classList.remove('theme-transitioning');
  }
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
