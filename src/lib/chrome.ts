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
let paths: string[] = [];
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
  setStack(ids: string[], root: string, entryPaths: string[] = []) {
    if (ids.join() === stack.join() && root === rootPath && entryPaths.join() === paths.join()) return;
    stack = ids;
    paths = entryPaths;
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

const MATCH_PAGE = /^\/(partido|competicion\/[^/]+\/partido)\//;
export const isMatchPage = (pathname: string) => MATCH_PAGE.test(pathname);

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
    /** Match pages opened one from another on top of the stack… */
    matchTrail: (() => {
      let n = 0;
      while (n < paths.length && isMatchPage(paths[paths.length - 1 - n])) n++;
      return n;
    })(),
    /** …and the screen they were opened from (if it is in the stack). */
    beforeMatches: (() => {
      let i = paths.length - 1;
      while (i >= 0 && isMatchPage(paths[i])) i--;
      return i >= 0 ? { title: chrome.get(stack[i])?.title, path: paths[i] } : undefined;
    })(),
  };
}

/** Id of the stack entry a component renders in. */
export const EntryContext = createContext("");

/**
 * Whether the page a component renders in is the one on top. A page under
 * the top one is shown again during the back swipe and re-runs its effects:
 * overlays of its own (a card) must stay out of the way until it is on top.
 */
export function useIsTopEntry() {
  const id = useContext(EntryContext);
  return useSyncExternalStore(subscribe, () => !id || !stack.length || stack[stack.length - 1] === id);
}

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
