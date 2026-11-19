import { useSyncExternalStore } from "react";

/** App appearance. Light («papel») unless the player picks the night edition. */
export type Theme = "light" | "dark";
export const THEME_KEY = "galacticbet:theme";
/** Status bar / browser chrome colour: the masthead ink of each theme. */
const CHROME = { light: "#15140f", dark: "#0a0907" } as const;

const listeners = new Set<() => void>();

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Paints the theme on <html>; index.html runs the same before the first paint. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", CHROME[theme]);
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this session only.
  }
  current = theme;
  applyTheme(theme);
  listeners.forEach((listener) => listener());
}

let current: Theme | null = null;
const snapshot = () => (current ??= readTheme());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useTheme() {
  return useSyncExternalStore(subscribe, snapshot, () => "light" as Theme);
}
