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

/** Pixels of scroll that take the bar from full size to compact. */
const SHRINK_RANGE = 72;

/**
 * Scroll-linked compact bar: scrolling down shrinks it pixel by pixel, scrolling
 * up grows it back, and when the scroll comes to rest it settles to the nearest
 * state in the direction you were going. Writes one CSS variable (--nav-shrink,
 * 0 → 1) straight to the element, so React never re-renders while you scroll.
 */
function useScrollShrink(nav: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    let progress = 0;
    let lastY: number | null = null;
    let page = chrome.stack[chrome.stack.length - 1];
    let direction = 0;
    let touching = false;
    let settling = false;
    let timer = 0;

    const paint = () => el.style.setProperty("--nav-shrink", progress.toFixed(4));
    const animateTo = (target: number) => {
      if (progress === target) return;
      settling = true;
      el.classList.add("is-settling");
      progress = target;
      paint();
    };
    const settleSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (touching || progress === 0 || progress === 1) return;
        animateTo(progress > (direction > 0 ? 0.3 : 0.7) ? 1 : 0);
      }, 120);
    };
    // Another page: full size again, and its scroll position is a new baseline.
    const onPage = () => {
      const top = chrome.stack[chrome.stack.length - 1];
      if (top === page) return;
      page = top;
      lastY = null;
      window.clearTimeout(timer);
      animateTo(0);
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
      const previousY = lastY;
      lastY = y;
      if (dy === 0) return;
      if (settling) {
        // Pick up from wherever the settle animation is right now.
        const shown = parseFloat(getComputedStyle(el).getPropertyValue("--nav-shrink"));
        if (Number.isFinite(shown)) progress = shown;
        settling = false;
        el.classList.remove("is-settling");
      }
      direction = Math.sign(dy);
      let next = progress + dy / SHRINK_RANGE;
      // Near the top, growing back keeps pace so it is full exactly at 0.
      if (dy < 0 && y < SHRINK_RANGE && previousY > 0)
        next = Math.min(next, progress * (y / previousY));
      next = Math.min(1, Math.max(0, next));
      if (next !== progress) {
        progress = next;
        paint();
      }
      settleSoon();
    };
    const onTouchStart = () => {
      touching = true;
      window.clearTimeout(timer);
    };
    const onTouchEnd = () => {
      touching = false;
      settleSoon();
    };
    paint();
    const unsubscribe = chrome.subscribe(onPage);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
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
  useScrollShrink(ref);
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
