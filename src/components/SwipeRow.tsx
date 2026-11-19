import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { haptic, prefersReducedMotion, rubberBand, springTo } from "../lib/motion";

export interface SwipeAction {
  label: string;
  icon?: ReactNode;
  tone?: "destructive" | "accent" | "neutral";
  onAction: () => void;
}

/** Only one row stays open at a time, like UITableView. */
let closeOpenRow: (() => void) | null = null;

/**
 * List row with trailing swipe actions (Mail/Messages style). Drag left to
 * reveal, past ~60% of the width runs the first action, tap anywhere to close.
 * Vertical scrolling stays native thanks to `touch-action: pan-y`. The same
 * actions must exist elsewhere for keyboard and screen-reader users.
 */
export default function SwipeRow({
  actions,
  children,
  className = "",
  disabled = false,
}: {
  actions: SwipeAction[];
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const drag = useRef({
    id: -1,
    x: 0,
    y: 0,
    origin: 0,
    offset: 0,
    lastX: 0,
    lastT: 0,
    v: 0,
    active: false,
    armed: false,
  });
  const open = useRef(0);

  const traySize = () => tray.current?.offsetWidth || actions.length * 84;
  const settle = (to: number, velocity = 0) => {
    const node = content.current;
    if (!node) return;
    open.current = to;
    drag.current.offset = to;
    node.parentElement?.classList.toggle("is-open", to !== 0);
    void springTo(node, [{ transform: `translate3d(${to}px,0,0)` }], {
      response: 0.34,
      damping: 0.88,
      velocity,
    });
    if (to !== 0) {
      closeOpenRow?.();
      closeOpenRow = () => settle(0);
    } else if (closeOpenRow) closeOpenRow = null;
  };

  useEffect(() => {
    // A tap outside the open row closes it.
    const onDown = (event: PointerEvent) => {
      if (open.current && !content.current?.parentElement?.contains(event.target as Node))
        settle(0);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !actions.length || event.button !== 0) return;
    const d = drag.current;
    d.id = event.pointerId;
    d.x = d.lastX = event.clientX;
    d.y = event.clientY;
    d.lastT = event.timeStamp;
    d.v = 0;
    d.origin = open.current;
    d.active = false;
    d.armed = false;
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (event.pointerId !== d.id) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        d.id = -1;
        return;
      }
      d.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      content.current?.getAnimations().forEach((a) => a.cancel());
    }
    const dt = Math.max(1, event.timeStamp - d.lastT);
    d.v = 0.8 * ((event.clientX - d.lastX) / dt) + 0.2 * d.v;
    d.lastX = event.clientX;
    d.lastT = event.timeStamp;
    const width = content.current?.offsetWidth || 320;
    let next = d.origin + dx;
    if (next > 0) next = rubberBand(next, width, 0.3);
    const size = traySize();
    if (next < -size) next = -size + rubberBand(next + size, width, 0.6);
    d.offset = next;
    if (content.current) content.current.style.transform = `translate3d(${next}px,0,0)`;
    const full = next < -width * 0.6;
    if (full !== d.armed) {
      d.armed = full;
      haptic(full ? "medium" : "selection");
      content.current?.parentElement?.classList.toggle("is-armed", full);
    }
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (event.pointerId !== d.id) return;
    d.id = -1;
    if (!d.active) return;
    // The drag must not also open the link underneath.
    const swallow = (click: Event) => {
      click.stopPropagation();
      click.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    const width = content.current?.offsetWidth || 320;
    const size = traySize();
    const velocity = (d.v * 1000) / width;
    content.current?.parentElement?.classList.remove("is-armed");
    if (d.armed) {
      const first = actions[0];
      if (prefersReducedMotion()) {
        settle(0);
        first.onAction();
        return;
      }
      void springTo(content.current!, [{ transform: `translate3d(${-width}px,0,0)` }], {
        response: 0.3,
        damping: 1,
        velocity,
      }).then((finished) => {
        if (!finished) return;
        first.onAction();
        settle(0);
      });
      return;
    }
    const openIt = d.offset < -size / 2 || d.v < -0.35;
    settle(openIt && d.v < 0.35 ? -size : 0, velocity);
  };

  return (
    <div className={`swipe-row ${className}`}>
      <div className="swipe-actions" ref={tray} aria-hidden="true">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            tabIndex={-1}
            className={`swipe-action is-${action.tone || "neutral"}`}
            onClick={() => {
              haptic();
              settle(0);
              action.onAction();
            }}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      <div
        ref={content}
        className="swipe-content"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </div>
  );
}
