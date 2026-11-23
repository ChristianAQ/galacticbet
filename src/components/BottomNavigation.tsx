import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import { chrome, useChrome } from "../lib/chrome";
import { haptic, prefersReducedMotion } from "../lib/motion";
import { go, popToRoot, tabHref, tabIndex } from "../lib/navigation";

function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement;
        const editing =
          focused instanceof HTMLElement &&
          (focused.matches(
            'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea',
          ) ||
            focused.isContentEditable);
        setOpen(
          Boolean(
            editing &&
              viewport.scale === 1 &&
              window.innerHeight - viewport.height > 150,
          ),
        );
      });
    };
    update();
    viewport.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return open;
}

/** Scroll down this far (in one direction) to compact the bar… */
const COMPACT_AFTER = 28;
/** …and up this far to bring it back. Near the top it is always full. */
const EXPAND_AFTER = 14;
const TOP_ZONE = 48;

/**
 * Compact bar while reading: a deliberate scroll down tucks it in, any scroll
 * up brings it back. The change itself is a CSS transition of transform and
 * opacity only, which iOS animates off the main thread: smooth even mid-scroll
 * (following the finger pixel by pixel stuttered on the iPhone).
 */
function useCompactOnScroll(nav: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    let compact = false;
    let lastY: number | null = null;
    let travel = 0;
    let page = chrome.stack[chrome.stack.length - 1];
    const set = (next: boolean) => {
      if (next === compact) return;
      compact = next;
      // A data attribute React does not manage: re-renders never reset it.
      el.toggleAttribute("data-compact", next);
    };
    // Another page: full size again, its scroll position is a new baseline.
    const onPage = () => {
      const top = chrome.stack[chrome.stack.length - 1];
      if (top === page) return;
      page = top;
      lastY = null;
      travel = 0;
      set(false);
    };
    const onScroll = () => {
      onPage();
      // A sheet locks the body (and zeroes scrollY): ignore until it unlocks.
      if (document.body.style.position === "fixed") {
        lastY = null;
        return;
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      // Clamp the rubber band at both ends so the bounce does not count.
      const y = Math.min(Math.max(window.scrollY, 0), Math.max(max, 0));
      if (lastY === null) {
        lastY = y;
        return;
      }
      const dy = y - lastY;
      lastY = y;
      if (!dy) return;
      if (Math.sign(dy) !== Math.sign(travel)) travel = 0;
      travel += dy;
      if (y < TOP_ZONE) set(false);
      else if (travel >= COMPACT_AFTER) set(true);
      else if (travel <= -EXPAND_AFTER) set(false);
    };
    const unsubscribe = chrome.subscribe(onPage);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      unsubscribe();
      window.removeEventListener("scroll", onScroll);
    };
  }, [nav]);
}

/**
 * Floating tab bar. The tab of the screen at the bottom of the stack stays lit
 * while you browse deeper; tapping it again pops back to that first screen, and
 * once there, scrolls to the top — like UITabBarController.
 */
export default function BottomNavigation({
  items,
  inactive,
  onPrefetch,
}: {
  items: { to: string; label: string; short?: string; icon: LucideIcon }[];
  inactive: boolean;
  onPrefetch: (path: string) => void;
}) {
  const { rootPath, depth } = useChrome();
  const keyboardOpen = useKeyboardOpen();
  const index = tabIndex(rootPath);
  const hidden = inactive || keyboardOpen;
  const ref = useRef<HTMLElement>(null);
  useCompactOnScroll(ref);
  return (
    <nav
      ref={ref}
      className={`bottom-nav${keyboardOpen ? " keyboard-open" : ""}${inactive ? " is-concealed" : ""}`}
      aria-label="Secciones"
      inert={hidden || undefined}
      aria-hidden={hidden || undefined}
      data-no-intercept
      style={
        {
          "--nav-index": Math.max(0, index),
          "--nav-count": items.length,
        } as CSSProperties
      }
    >
      <div className="bottom-nav-items">
        <span
          className={`bottom-nav-indicator${index < 0 ? " is-hidden" : ""}`}
          aria-hidden="true"
        />
        {items.map((item, position) => {
          const active = position === index;
          return (
            <a
              key={item.to}
              href={`#${item.to}`}
              className={active ? "active" : undefined}
              aria-current={active && depth === 1 ? "page" : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                if (active) {
                  if (depth > 1) {
                    haptic();
                    popToRoot();
                  } else
                    window.scrollTo({
                      top: 0,
                      behavior: prefersReducedMotion() ? "auto" : "smooth",
                    });
                  return;
                }
                haptic();
                go(tabHref(item.to), { reset: true });
              }}
              onPointerEnter={() => onPrefetch(item.to)}
              onPointerDown={() => onPrefetch(item.to)}
              onFocus={() => onPrefetch(item.to)}
            >
              <item.icon
                size={22}
                strokeWidth={active ? 2.4 : 1.9}
                aria-hidden="true"
              />
              <span>{item.short ?? item.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
