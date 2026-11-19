import { flushSync } from "react-dom";
import { prefersReducedMotion } from "./motion";

/**
 * Screen and tab changes through the View Transitions API (Chrome 111+,
 * Safari 18+). `kind` and `dir` are written on <html> so CSS picks the right
 * choreography; browsers without support, or with reduced motion, just update.
 *
 * - next / prev: sideways between sibling tabs (bottom bar, in-page tabs).
 * - push / pop: into a detail screen and back out of it.
 * - fade: anything without a clear spatial relation.
 */
export type TransitionKind = "page" | "tab";
export type TransitionDirection = "next" | "prev" | "push" | "pop" | "fade";

let running = 0;

export const canTransition = () =>
  typeof document !== "undefined" &&
  typeof document.startViewTransition === "function" &&
  !prefersReducedMotion();

export function withViewTransition(
  kind: TransitionKind,
  direction: TransitionDirection,
  update: () => void | Promise<void>,
) {
  if (!canTransition()) {
    void update();
    return;
  }
  const root = document.documentElement;
  const id = ++running;
  root.dataset.vt = kind;
  root.dataset.vtDir = direction;
  const transition = document.startViewTransition(async () => {
    const result = update();
    if (result instanceof Promise) await result;
  });
  // A skipped or failed transition still applies the update; only clean up.
  transition.ready.catch(() => {});
  void transition.finished.finally(() => {
    if (id !== running) return;
    delete root.dataset.vt;
    delete root.dataset.vtDir;
  });
}

/** Router navigation committed synchronously inside the transition. */
export function navigateWithTransition(
  go: () => void,
  direction: TransitionDirection,
  ready?: Promise<unknown>,
) {
  const commit = () => {
    flushSync(go);
    window.scrollTo(0, 0);
  };
  if (!canTransition()) {
    go();
    return;
  }
  // Wait (briefly) for the lazy page so the snapshot is the page, not a skeleton.
  const wait = ready
    ? Promise.race([ready, new Promise((r) => setTimeout(r, 350))])
    : Promise.resolve();
  void wait.then(() => withViewTransition("page", direction, commit));
}

/** history.back() is asynchronous: resolve once the router has rendered. */
export function backWithTransition(go: () => void) {
  if (!canTransition()) {
    go();
    return;
  }
  withViewTransition(
    "page",
    "pop",
    () =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          // React flushes the discrete popstate update before the next task.
          setTimeout(() => {
            window.scrollTo(0, 0);
            resolve();
          }, 0);
        };
        const timer = setTimeout(done, 400);
        window.addEventListener("popstate", done, { once: true });
        go();
      }),
  );
}

/** In-page tab change: state is flushed inside the transition. */
export function switchTab(direction: TransitionDirection, update: () => void) {
  withViewTransition("tab", direction, () => flushSync(update));
}

export const tabDirection = (from: number, to: number): TransitionDirection =>
  from < 0 || to < 0 || from === to ? "fade" : to > from ? "next" : "prev";

const TAB_ROUTES = ["/", "/ligas", "/quiniela", "/clasificacion"];
const depth = (path: string) =>
  TAB_ROUTES.includes(path) ? 0 : path.startsWith("/partido/") ? 2 : 1;

/** Spatial relation between two app paths (pathname only). */
export function routeDirection(from: string, to: string): TransitionDirection {
  if (from === to) return "fade";
  const a = depth(from);
  const b = depth(to);
  if (a === 0 && b === 0)
    return tabDirection(TAB_ROUTES.indexOf(from), TAB_ROUTES.indexOf(to));
  if (b > a) return "push";
  if (b < a) return "pop";
  return "fade";
}
