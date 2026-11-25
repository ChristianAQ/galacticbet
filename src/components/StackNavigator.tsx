import {
  Activity,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  useLocation,
  useNavigate,
  useNavigationType,
  type Location,
} from "react-router-dom";
import { chrome, EntryContext } from "../lib/chrome";
import { haptic, prefersReducedMotion, springTo } from "../lib/motion";
import {
  bindNavigator,
  isTabRoot,
  notifyCommit,
  popSilently,
  rememberTab,
  takeIntent,
} from "../lib/navigation";
import { PageSkeleton } from "./Skeleton";

interface Entry {
  id: string;
  location: Location;
  keys: string[];
  scroll: number;
}
const MAX_DEPTH = 6;
let sequence = 0;
const entryFor = (location: Location): Entry => ({
  id: `p${++sequence}`,
  location,
  keys: [location.key],
  scroll: 0,
});

interface Stacks {
  /** Visible navigation stack, root first. */
  stack: Entry[];
  /** Roots of the other tabs, kept alive (hidden) so switching back is instant. */
  parked: Entry[];
}
const sameUrl = (a: Location, b: Location) =>
  a.pathname === b.pathname && a.search === b.search;

/** Puts the current tab root aside before another stack takes over. */
function park(state: Stacks): Entry[] {
  const root = state.stack[0];
  const others = state.parked.filter(
    (e) => e.location.pathname !== root.location.pathname,
  );
  return isTabRoot(root.location.pathname) ? [...others, root] : others;
}
/** Activates a parked root (same URL) or starts a fresh page. */
function activate(parked: Entry[], location: Location): Stacks {
  const match = parked.find(
    (e) => e.keys.includes(location.key) || sameUrl(e.location, location),
  );
  const rest = parked.filter(
    (e) => e !== match && e.location.pathname !== location.pathname,
  );
  if (!match) return { stack: [entryFor(location)], parked: rest };
  return {
    stack: [{ ...match, location, keys: [...match.keys, location.key] }],
    parked: rest,
  };
}

/** Next stack for a committed location, like a UINavigationController. */
function reduce(
  state: Stacks,
  location: Location,
  type: string,
  intent: ReturnType<typeof takeIntent>,
): Stacks {
  const { stack } = state;
  const top = stack[stack.length - 1];
  if (top.location === location) return state;
  if (type === "POP") {
    const index = stack.findIndex((e) => e.keys.includes(location.key));
    if (index < 0) return activate(park(state), location);
    const kept = stack.slice(0, index + 1);
    kept[index] = { ...kept[index], location };
    return { ...state, stack: kept };
  }
  // Query changes (tabs, filters, sheets) keep the page instance.
  if (location.pathname === top.location.pathname && !intent?.reset) {
    const next = [...stack];
    next[next.length - 1] = {
      ...top,
      location,
      keys:
        type === "REPLACE"
          ? [...top.keys.slice(0, -1), location.key]
          : [...top.keys, location.key],
    };
    return { ...state, stack: next };
  }
  if (intent?.reset) {
    if (stack.length === 1 && sameUrl(top.location, location))
      return { ...state, stack: [{ ...top, location, keys: [...top.keys, location.key] }] };
    return activate(park(state), location);
  }
  if (type === "REPLACE")
    return { ...state, stack: [...stack.slice(0, -1), entryFor(location)] };
  return { ...state, stack: [...stack, entryFor(location)].slice(-MAX_DEPTH) };
}

const bodyLocked = () => document.body.style.position === "fixed";
const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Pages live in a stack: the previous screens stay mounted inside hidden
 * <Activity> boundaries (state and DOM kept, effects paused), so going back is
 * instant, keeps scroll and filters, and the edge swipe can reveal the real
 * page underneath.
 */
export default function StackNavigator({
  render,
}: {
  render: (location: Location) => ReactNode;
}) {
  const location = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  bindNavigator(navigate);
  const [stacks, setStacks] = useState<Stacks>(() => ({
    stack: [entryFor(location)],
    parked: [],
  }));
  // Reduced in a layout effect (once per location, StrictMode-safe): the
  // follow-up render still lands before paint and inside flushSync.
  useLayoutEffect(() => {
    const intent = takeIntent();
    setStacks((value) => reduce(value, location, type, intent));
  }, [location, type]);
  const [revealing, setRevealing] = useState(false);
  const current = stacks.stack;
  const top = current[current.length - 1];
  const previous = current[current.length - 2];
  const shownTop = useRef(top.id);
  const views = useRef(new Map<string, HTMLDivElement>());

  useLayoutEffect(() => {
    if (top.location !== location) return;
    chrome.setStack(
      current.map((e) => e.id),
      current[0].location.pathname,
      current.map((e) => e.location.pathname),
    );
    for (const entry of [...stacks.parked, current[0]])
      if (isTabRoot(entry.location.pathname))
        rememberTab(entry.location.pathname, entry.location.pathname + entry.location.search);
    const view = views.current.get(top.id);
    if (view) {
      view.removeAttribute("style");
      view.classList.remove("is-revealed");
    }
    if (shownTop.current !== top.id) {
      shownTop.current = top.id;
      setRevealing(false);
      if (!bodyLocked()) window.scrollTo(0, top.scroll);
    }
    notifyCommit(top.location.pathname, current.length);
  });

  // Remember where each page was scrolled to.
  useEffect(() => {
    let frame = 0;
    const save = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // A stray event after switching pages must not overwrite the old page.
        if (!bodyLocked() && shownTop.current === top.id) top.scroll = window.scrollY;
      });
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", save);
    };
  }, [top]);

  useEdgeSwipe({
    enabled: Boolean(previous),
    views,
    top,
    previous,
    onReveal: setRevealing,
  });

  return (
    <>
      {[...stacks.parked, ...current].map((entry) => {
        const isTop = entry === top;
        const visible = isTop || (revealing && entry === previous);
        return (
          <Activity key={entry.id} mode={visible ? "visible" : "hidden"}>
            <EntryContext.Provider value={entry.id}>
              <div
                ref={(node) => {
                  if (node) views.current.set(entry.id, node);
                  else views.current.delete(entry.id);
                }}
                className={`route-view${isTop ? " is-top" : ""}${isTabRoot(entry.location.pathname) ? " is-tab-root" : ""}`}
                data-entry={entry.id}
                inert={!isTop || undefined}
              >
                <Suspense fallback={<PageSkeleton />}>
                  {render(entry.location)}
                </Suspense>
              </div>
            </EntryContext.Provider>
          </Activity>
        );
      })}
    </>
  );
}

/* ---------- Interactive back gesture from the left edge ---------- */

const EDGE = 24;
function useEdgeSwipe({
  enabled,
  views,
  top,
  previous,
  onReveal,
}: {
  enabled: boolean;
  views: RefObject<Map<string, HTMLDivElement>>;
  top: Entry;
  previous?: Entry;
  onReveal: (value: boolean) => void;
}) {
  useEffect(() => {
    if (!enabled || !previous) return;
    const root = document.documentElement;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastTime = 0;
    let velocity = 0;
    let state: "idle" | "pending" | "dragging" = "idle";
    let width = window.innerWidth;
    const current = () => views.current.get(top.id);
    const below = () => views.current.get(previous.id);
    const place = (dx: number) => {
      const p = Math.min(1, Math.max(0, dx / width));
      const view = current();
      const under = below();
      if (view) view.style.transform = `translate3d(${dx}px,0,0)`;
      if (under) {
        under.style.transform = `translate3d(${-0.3 * width * (1 - p)}px,0,0)`;
        under.style.setProperty("--dim", String(1 - p));
      }
      root.style.setProperty("--swipe", String(p));
    };
    const prepare = () => {
      const view = current();
      const under = below();
      if (!view || !under) return false;
      const box = view.getBoundingClientRect();
      const documentTop = box.top + window.scrollY;
      view.classList.add("is-swiping");
      under.classList.add("is-revealed");
      Object.assign(under.style, {
        top: `${documentTop - previous.scroll}px`,
        left: `${box.left}px`,
        width: `${box.width}px`,
      });
      root.dataset.swiping = "";
      return true;
    };
    const finish = () => {
      current()?.classList.remove("is-swiping");
      root.style.removeProperty("--swipe");
      delete root.dataset.swiping;
    };
    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (
        event.touches.length !== 1 ||
        touch.clientX > EDGE ||
        bodyLocked() ||
        !standaloneOrTouch()
      )
        return;
      state = "pending";
      width = window.innerWidth;
      startX = lastX = touch.clientX;
      startY = touch.clientY;
      lastTime = event.timeStamp;
      velocity = 0;
    };
    const move = (event: TouchEvent) => {
      if (state === "idle") return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (state === "pending") {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
          state = "idle";
          return;
        }
        // Position the hidden page first, then let React show it in place.
        if (!prepare()) {
          state = "idle";
          return;
        }
        state = "dragging";
        onReveal(true);
      }
      event.preventDefault();
      const dt = Math.max(1, event.timeStamp - lastTime);
      velocity = 0.8 * ((touch.clientX - lastX) / dt) + 0.2 * velocity;
      lastX = touch.clientX;
      lastTime = event.timeStamp;
      place(Math.max(0, dx));
    };
    const end = () => {
      if (state !== "dragging") {
        state = "idle";
        return;
      }
      state = "idle";
      const dx = Math.max(0, lastX - startX);
      const view = current();
      const under = below();
      const complete = dx > width * 0.42 || (velocity > 0.45 && dx > 24);
      const v = Math.abs(velocity * 1000) / width;
      if (!view || !under) {
        finish();
        onReveal(false);
        return;
      }
      if (complete) {
        haptic("light");
        void Promise.all([
          springTo(view, [{ transform: `translate3d(${width}px,0,0)` }], {
            response: 0.36,
            damping: 1,
            velocity: v,
          }),
          springTo(under, [{ transform: "translate3d(0,0,0)" }], {
            response: 0.36,
            damping: 1,
            velocity: v,
          }),
        ]).then(() => {
          under.style.removeProperty("--dim");
          finish();
          popSilently();
        });
      } else {
        void Promise.all([
          springTo(view, [{ transform: "translate3d(0,0,0)" }], {
            response: 0.32,
            damping: 0.9,
          }),
          springTo(under, [{ transform: `translate3d(${-0.3 * width}px,0,0)` }], {
            response: 0.32,
            damping: 0.9,
          }),
        ]).then(() => {
          view.style.transform = "";
          finish();
          onReveal(false);
          // Hidden again by React first, then back to normal flow.
          requestAnimationFrame(() => {
            under.removeAttribute("style");
            under.classList.remove("is-revealed");
          });
        });
      }
    };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
    };
  }, [enabled, top, previous]);
}

/**
 * Safari in a browser tab has its own edge-swipe back; only the installed app
 * (or a touch browser without one) gets ours. Reduced motion keeps it too: the
 * page follows the finger, there is no autonomous animation to avoid.
 */
function standaloneOrTouch() {
  if (standalone()) return true;
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  return !iOS && !prefersReducedMotion() && matchMedia("(pointer: coarse)").matches;
}
