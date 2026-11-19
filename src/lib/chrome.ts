import { useEffect, useSyncExternalStore } from "react";
import { createContext, useContext } from "react";

/**
 * App chrome state shared by the stacked pages and the fixed bars: each page of
 * the navigation stack registers its title and whether its large title has
 * scrolled under the navigation bar.
 */
interface EntryChrome {
  title?: string;
  collapsed?: boolean;
}
let entries = new Map<string, EntryChrome>();
let stack: string[] = [];
let rootPath = "/";
const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const chrome = {
  setStack(ids: string[], root: string) {
    if (ids.join() === stack.join() && root === rootPath) return;
    stack = ids;
    rootPath = root;
    entries = new Map([...entries].filter(([id]) => ids.includes(id)));
    emit();
  },
  set(id: string, patch: EntryChrome) {
    const current = entries.get(id) || {};
    if (Object.entries(patch).every(([k, v]) => current[k as keyof EntryChrome] === v))
      return;
    entries.set(id, { ...current, ...patch });
    emit();
  },
  get: (id: string | undefined) => (id ? entries.get(id) : undefined),
  /** Called on every change; non-React listeners (e.g. scroll effects) use it. */
  subscribe,
  get stack() {
    return stack;
  },
};

export function useChrome() {
  useSyncExternalStore(subscribe, () => version);
  const top = stack[stack.length - 1];
  const previous = stack[stack.length - 2];
  return {
    depth: stack.length,
    /** Pathname of the bottom of the stack: decides the active tab. */
    rootPath,
    top: chrome.get(top) || {},
    previous: previous ? chrome.get(previous) || {} : undefined,
  };
}

/** Id of the stack entry a component renders in. */
export const EntryContext = createContext("");

/** Registers the compact title shown in the navigation bar for this page. */
export function useNavTitle(title: string | undefined) {
  const id = useContext(EntryContext);
  useEffect(() => {
    if (id && title) chrome.set(id, { title });
  }, [id, title]);
}

/** Window event pages listen to when the user pulls to refresh. */
export const REFRESH_EVENT = "galacticbet:refresh";

/** Pull-to-refresh and other «reload everything» gestures call this. */
export const RefreshContext = createContext<() => Promise<void>>(async () => {});
export const useRefresh = () => useContext(RefreshContext);
