import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router-dom";
import { haptic, prefersReducedMotion } from "./motion";
import { preloadPage } from "./pages";

/* ---------- Route map ---------- */

export const TAB_ROOTS = ["/", "/ligas", "/quiniela", "/clasificacion"] as const;
export const tabIndex = (pathname: string) =>
  TAB_ROOTS.indexOf(pathname as (typeof TAB_ROOTS)[number]);
export const isTabRoot = (pathname: string) => tabIndex(pathname) >= 0;

const titles: Record<string, string> = {
  "/": "Inicio",
  "/ligas": "Ligas",
  "/quiniela": "Mi quiniela",
  "/clasificacion": "Clasificación",
  "/perfil": "Perfil",
  "/grupos": "Mis grupos",
  "/porra": "Porra rápida",
  "/equipos": "Equipos",
  "/partido": "Partido",
  "/competiciones/nueva": "Nueva competición",
};
export const routeTitle = (pathname: string) =>
  titles[pathname] || (pathname.startsWith("/partido/") ? titles["/partido"] : "");

/** Where «Atrás» leads when the page was opened directly (shared link, reload). */
export function parentOf(pathname: string) {
  if (pathname.startsWith("/partido/")) return "/ligas";
  if (pathname === "/grupos") return "/perfil";
  if (pathname.startsWith("/competiciones")) return "/ligas";
  return "/";
}

/* ---------- Tab memory ---------- */

const tabLocations = new Map<string, string>();
/** Last URL of each tab root, so switching back restores its filters. */
export const rememberTab = (path: string, href: string) =>
  tabLocations.set(path, href);
export const tabHref = (path: string) => tabLocations.get(path) || path;

/* ---------- Navigator bridge ---------- */

export type Direction = "push" | "pop" | "forward" | "back" | "fade" | "none";
export interface Intent {
  /** Tab switch: the new page replaces the whole stack. */
  reset?: boolean;
  /** The gesture already animated the page; skip the view transition. */
  silent?: boolean;
}

let navigator: NavigateFunction | null = null;
let currentPath = "/";
let depth = 1;
let pendingIntent: Intent | null = null;
let commitWaiters: (() => void)[] = [];

export const bindNavigator = (fn: NavigateFunction) => {
  navigator = fn;
};
/** Called by the stack after each committed location. */
export function notifyCommit(pathname: string, stackDepth: number) {
  currentPath = pathname;
  depth = stackDepth;
  const waiters = commitWaiters;
  commitWaiters = [];
  for (const resolve of waiters) resolve();
}
export const takeIntent = () => {
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
};
export const stackDepth = () => depth;
const nextCommit = (timeout = 700) =>
  new Promise<void>((resolve) => {
    commitWaiters.push(resolve);
    window.setTimeout(resolve, timeout);
  });

/* ---------- Shared elements ---------- */

let named: HTMLElement[] = [];
/** Names the parts of one fixture so they morph into the next screen. */
function nameShared(container: Element | null) {
  if (!container) return;
  for (const part of container.querySelectorAll<HTMLElement>("[data-vt-part]")) {
    part.style.viewTransitionName = `vt-${part.dataset.vtPart}`;
    named.push(part);
  }
}
function clearShared() {
  for (const part of named) part.style.viewTransitionName = "";
  named = [];
}
const inViewport = (element: Element) => {
  const box = element.getBoundingClientRect();
  return box.bottom > 0 && box.top < window.innerHeight && box.height > 0;
};
/** First visible fixture with this id in the page on top of the stack. */
function findFixture(id: string) {
  const candidates = document.querySelectorAll(
    `.route-view.is-top [data-vt-match="${CSS.escape(id)}"]`,
  );
  return [...candidates].find(inViewport) || null;
}

/* ---------- Transitions ---------- */

const supportsTransitions = () =>
  typeof document !== "undefined" &&
  typeof document.startViewTransition === "function" &&
  !prefersReducedMotion();

/**
 * Same-document View Transition around a navigation. The update callback waits
 * for React to commit the new location, so the new snapshot is the new page.
 */
function transition(
  update: () => Promise<void> | void,
  direction: Direction,
  shared?: { from: Element | null; id: string },
) {
  if (!supportsTransitions() || direction === "none") {
    void update();
    return;
  }
  const root = document.documentElement;
  root.dataset.nav = direction;
  clearShared();
  if (shared) nameShared(shared.from);
  const vt = document.startViewTransition(async () => {
    await update();
    if (shared) {
      // The source keeps its names in the old snapshot; release them in the DOM.
      clearShared();
      nameShared(findFixture(shared.id));
    }
  });
  void vt.finished.finally(() => {
    if (root.dataset.nav === direction) delete root.dataset.nav;
    clearShared();
  });
}

function resolveDirection(to: string, reset: boolean): Direction {
  const target = to.split(/[?#]/)[0];
  if (target === currentPath) return "fade";
  if (reset) {
    const a = tabIndex(currentPath);
    const b = tabIndex(target);
    if (a >= 0 && b >= 0) return b > a ? "forward" : "back";
    return "fade";
  }
  return "push";
}

export interface GoOptions {
  replace?: boolean;
  reset?: boolean;
  direction?: Direction;
  /** Fixture element the user tapped, for the shared-element morph. */
  sharedFrom?: Element | null;
}
/** In-app navigation with view transitions. Falls back to a plain navigate. */
export function go(to: string, options: GoOptions = {}) {
  if (!navigator) return;
  const { replace = false, reset = false } = options;
  const direction = options.direction || resolveDirection(to, reset);
  const target = to.split(/[?#]/)[0];
  const ready = preloadPage(target);
  const matchId = target.startsWith("/partido/")
    ? decodeURIComponent(target.slice("/partido/".length))
    : "";
  const run = async () => {
    // A slow network must not freeze the screen: give the chunk a moment only.
    await Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]);
    pendingIntent = { reset };
    const committed = nextCommit(120);
    flushSync(() => navigator!(to, { replace }));
    await committed;
  };
  const shared =
    matchId && options.sharedFrom
      ? { from: options.sharedFrom, id: matchId }
      : undefined;
  void Promise.race([ready, new Promise((r) => setTimeout(r, 180))]).then(() =>
    transition(run, direction, shared),
  );
}

/** «Atrás»: pops the stack, or opens the parent when there is nothing behind. */
export function goBack(fallback?: string) {
  if (!navigator) return;
  const idx = (window.history.state?.idx as number | undefined) ?? 0;
  if (depth > 1 && idx > 0) {
    const hero = document.querySelector(".route-view.is-top [data-vt-hero]");
    const id = hero?.getAttribute("data-vt-match") || "";
    transition(
      async () => {
        const committed = nextCommit();
        navigator!(-1);
        await committed;
      },
      "pop",
      id ? { from: hero, id } : undefined,
    );
    return;
  }
  const to = fallback || parentOf(currentPath);
  transition(
    async () => {
      pendingIntent = { reset: true };
      const committed = nextCommit(120);
      flushSync(() => navigator!(to, { replace: true }));
      await committed;
    },
    "pop",
  );
}

/** Tapping the current tab again: back to its first screen, state intact. */
export function popToRoot() {
  if (!navigator) return;
  const steps = depth - 1;
  const idx = (window.history.state?.idx as number | undefined) ?? 0;
  if (steps < 1 || idx < steps) return;
  transition(async () => {
    const committed = nextCommit();
    navigator!(-steps);
    await committed;
  }, "pop");
}

/** Back gesture finished its own animation: pop without a transition. */
export function popSilently() {
  if (!navigator) return;
  pendingIntent = { silent: true };
  navigator(-1);
}

/* ---------- Link interception ---------- */

/**
 * Every internal link goes through `go`, so pushes, tab switches and fixture
 * morphs all animate. Modified clicks and external links behave natively.
 */
export function interceptLinks() {
  const onClick = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = (event.target as Element | null)?.closest?.("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    const href = link.getAttribute("href") || "";
    if (!href.startsWith("#/") || link.target || link.hasAttribute("download"))
      return;
    if (link.closest("[data-no-intercept]")) return;
    event.preventDefault();
    const kind = link.dataset.nav;
    const path = href.slice(1);
    // Plain tab links return to the tab as it was left (filters included).
    const to = kind === "tab" && !path.includes("?") ? tabHref(path) : path;
    if (kind === "tab") haptic();
    go(to, {
      reset: kind === "tab",
      replace: kind === "replace",
      sharedFrom:
        link.closest("[data-vt-match]") || link.querySelector("[data-vt-match]"),
    });
  };
  // Capture phase: runs before React Router's own Link handler.
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
