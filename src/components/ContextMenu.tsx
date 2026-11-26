import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { haptic, prefersReducedMotion, springTo } from "../lib/motion";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}
type Getter = () => { title?: string; items: MenuItem[] };

const registry = new WeakMap<Element, Getter>();
/**
 * Callback ref that gives an element a long-press menu (right click with a
 * mouse). Works inside lists without one hook per row:
 * `<a ref={menuTarget(() => ({ items }))}>`. Every action in a menu must also
 * be reachable from a visible control.
 */
export const menuTarget = (get: Getter) => (element: HTMLElement | null) => {
  if (!element) return;
  registry.set(element, get);
  element.dataset.contextMenu = "";
};
/** The element no longer has a menu (the same element can stay on screen). */
export const clearMenuTarget = (element: HTMLElement | null) => {
  if (!element) return;
  registry.delete(element);
  delete element.dataset.contextMenu;
};

interface Open {
  element: HTMLElement;
  rect: DOMRect;
  title?: string;
  items: MenuItem[];
}

const HOLD_MS = 460;

/** One host for the whole app: listens for long presses on any menu target. */
export default function ContextMenuHost() {
  const [open, setOpen] = useState<Open | null>(null);

  useEffect(() => {
    let timer = 0;
    let target: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let suppressClick = false;
    const cancel = () => {
      window.clearTimeout(timer);
      target?.classList.remove("is-holding");
      target = null;
    };
    const show = (element: HTMLElement) => {
      const get = registry.get(element);
      if (!get) return;
      const { title, items } = get();
      if (!items.length) return;
      element.classList.remove("is-holding");
      haptic("medium");
      setOpen({ element, rect: element.getBoundingClientRect(), title, items });
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || event.button !== 0) return;
      const element = (event.target as Element).closest<HTMLElement>("[data-context-menu]");
      if (!element || document.documentElement.hasAttribute("data-swiping")) return;
      target = element;
      startX = event.clientX;
      startY = event.clientY;
      element.classList.add("is-holding");
      timer = window.setTimeout(() => {
        if (!target) return;
        suppressClick = true;
        show(target);
        target = null;
      }, HOLD_MS);
    };
    const onMove = (event: PointerEvent) => {
      if (target && Math.hypot(event.clientX - startX, event.clientY - startY) > 9)
        cancel();
    };
    const onClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const onContextMenu = (event: MouseEvent) => {
      const element = (event.target as Element).closest<HTMLElement>("[data-context-menu]");
      if (!element) return;
      event.preventDefault();
      cancel();
      show(element);
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", cancel);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("scroll", cancel, { passive: true, capture: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", cancel);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("scroll", cancel, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  return open ? <Menu open={open} onClose={() => setOpen(null)} /> : null;
}

function Menu({ open, onClose }: { open: Open; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number; below: boolean }>();
  const closing = useRef(false);
  const { rect } = open;

  useLayoutEffect(() => {
    const menu = panel.current;
    if (!menu) return;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const margin = 12;
    const vh = window.innerHeight;
    const below = rect.bottom + height + margin + 90 < vh || rect.top < height + margin + 60;
    const top = below
      ? Math.min(rect.bottom + 10, vh - height - margin)
      : Math.max(margin + 50, rect.top - height - 10);
    const left = Math.min(
      Math.max(margin, rect.left + (rect.width > width ? 8 : 0)),
      window.innerWidth - width - margin,
    );
    setPlacement({ top, left, below });
  }, [rect]);

  useLayoutEffect(() => {
    if (!placement) return;
    const element = open.element;
    element.classList.add("is-lifted");
    if (panel.current)
      void springTo(
        panel.current,
        [
          { opacity: 0, transform: "scale(0.82)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { response: 0.36, damping: 0.74 },
      );
    if (scrim.current)
      void springTo(scrim.current, [{ opacity: 0 }, { opacity: 1 }], {
        response: 0.3,
        damping: 1,
      });
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({
      preventScroll: true,
    });
    return () => element.classList.remove("is-lifted");
  }, [placement]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    open.element.classList.remove("is-lifted");
    if (prefersReducedMotion()) {
      onClose();
      then?.();
      return;
    }
    if (scrim.current) void springTo(scrim.current, [{ opacity: 0 }], { response: 0.25 });
    void (panel.current
      ? springTo(panel.current, [{ opacity: 0, transform: "scale(0.9)" }], {
          response: 0.22,
          damping: 1,
        })
      : Promise.resolve()
    ).then(() => {
      onClose();
      then?.();
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const radius = getComputedStyle(open.element).borderRadius || "14px";
  return createPortal(
    <div className="context-menu" onClick={() => close()}>
      <div
        ref={scrim}
        className="context-menu-scrim"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          borderRadius: radius,
        }}
      />
      <div
        ref={panel}
        role="menu"
        aria-label={open.title || "Acciones"}
        className={`context-menu-panel${placement?.below === false ? " is-above" : ""}`}
        style={{
          top: placement?.top ?? -999,
          left: placement?.left ?? -999,
          visibility: placement ? "visible" : "hidden",
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
          event.preventDefault();
          const items = [
            ...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || []),
          ];
          const index = items.indexOf(document.activeElement as HTMLElement);
          items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        }}
      >
        {open.title && <p className="context-menu-title">{open.title}</p>}
        {open.items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={item.destructive ? "is-destructive" : undefined}
            onClick={() => {
              haptic();
              close(item.onSelect);
            }}
          >
            <span>{item.label}</span>
            {item.icon}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
