import { useEffect, useState, type CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { useChrome } from "../lib/chrome";
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
  return (
    <nav
      className={`bottom-nav${keyboardOpen ? " keyboard-open" : ""}`}
      aria-label="Secciones"
      inert={hidden || undefined}
      aria-hidden={hidden || undefined}
      data-no-intercept
    >
      <div
        className="bottom-nav-items"
        style={
          {
            "--nav-index": Math.max(0, index),
            "--nav-count": items.length,
          } as CSSProperties
        }
      >
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
