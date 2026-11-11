import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'skillarium-theme';
const listeners = new Set<() => void>();

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** The dark theme is the default; a stored choice replaces it. */
const DEFAULT_THEME: Theme = 'dark';

let current: Theme = stored() ?? DEFAULT_THEME;

function apply(): void {
  document.documentElement.dataset.theme = current;
}

/** Call once before the first render. */
export function initTheme(): void {
  apply();
}

export function setTheme(theme: Theme): void {
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
  apply();
  listeners.forEach((fn) => fn());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
  );
}
