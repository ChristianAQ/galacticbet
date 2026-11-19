import { useEffect, useRef, useState } from "react";
import { haptic, prefersReducedMotion, rubberBand, springTo } from "../lib/motion";

const THRESHOLD = 76;
const HOLD = 58;
const MIN_SPIN = 900;
type Phase = "idle" | "pulling" | "armed" | "refreshing" | "done";

const copy: Record<Phase, string> = {
  idle: "",
  pulling: "Tira para actualizar",
  armed: "Suelta y lo miramos",
  refreshing: "Revisando el VAR…",
  done: "Todo al día",
};

/**
 * Pull-to-refresh for the tab roots. The page follows the finger with rubber-band
 * resistance; past the threshold it ticks and, on release, holds while the data
 * reloads. Only transform and opacity change.
 */
export default function PullToRefresh({
  enabled,
  onRefresh,
}: {
  enabled: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  const indicator = useRef<HTMLDivElement>(null);
  const ball = useRef<SVGSVGElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;
    let startX = 0;
    let startY = 0;
    let distance = 0;
    let state: "idle" | "pending" | "pulling" | "busy" = "idle";
    let armed = false;
    const view = () => document.querySelector<HTMLElement>(".route-view.is-top");
    const paint = (offset: number) => {
      const progress = Math.min(1, offset / THRESHOLD);
      const page = view();
      if (page) page.style.transform = `translate3d(0,${offset}px,0)`;
      const box = indicator.current;
      if (box) {
        box.style.opacity = String(Math.min(1, progress * 1.4));
        box.style.transform = `translate3d(0,${Math.min(offset, HOLD) - HOLD}px,0) scale(${0.6 + 0.4 * progress})`;
      }
      if (ball.current) ball.current.style.transform = `rotate(${offset * 3.2}deg)`;
    };
    const start = (event: TouchEvent) => {
      if (state === "busy") return;
      const touch = event.touches[0];
      if (
        event.touches.length !== 1 ||
        window.scrollY > 0 ||
        document.body.style.position === "fixed" ||
        document.documentElement.hasAttribute("data-swiping") ||
        (event.target as Element).closest?.("[data-no-ptr], .modal-backdrop, .context-menu")
      ) {
        state = "idle";
        return;
      }
      state = "pending";
      startX = touch.clientX;
      startY = touch.clientY;
      distance = 0;
      armed = false;
    };
    const move = (event: TouchEvent) => {
      if (state !== "pending" && state !== "pulling") return;
      const touch = event.touches[0];
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      if (state === "pending") {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) {
          state = "idle";
          return;
        }
        state = "pulling";
        setPhase("pulling");
        document.documentElement.dataset.pulling = "";
      }
      event.preventDefault();
      distance = Math.max(0, rubberBand(dy, window.innerHeight, 0.5));
      paint(distance);
      if (!armed && distance >= THRESHOLD) {
        armed = true;
        haptic("light");
        setPhase("armed");
      } else if (armed && distance < THRESHOLD - 8) {
        armed = false;
        setPhase("pulling");
      }
    };
    const settle = async (to: number) => {
      const page = view();
      const box = indicator.current;
      const progress = Math.min(1, to / THRESHOLD);
      await Promise.all([
        page &&
          springTo(page, [{ transform: `translate3d(0,${to}px,0)` }], {
            response: 0.38,
            damping: to ? 0.82 : 1,
          }),
        box &&
          springTo(
            box,
            [
              {
                opacity: String(to ? 1 : 0),
                transform: `translate3d(0,${Math.min(to, HOLD) - HOLD}px,0) scale(${0.6 + 0.4 * progress})`,
              },
            ],
            { response: 0.38, damping: 1 },
          ),
      ]);
      if (!to && page) page.style.transform = "";
    };
    const end = async () => {
      if (state !== "pulling") {
        if (state === "pending") state = "idle";
        return;
      }
      if (!armed) {
        state = "idle";
        await settle(0);
        delete document.documentElement.dataset.pulling;
        setPhase("idle");
        return;
      }
      state = "busy";
      setPhase("refreshing");
      void settle(HOLD);
      const began = performance.now();
      try {
        await refresh.current();
      } catch {
        /* Errors surface in the page; the gesture still finishes. */
      }
      const wait = MIN_SPIN - (performance.now() - began);
      if (wait > 0 && !prefersReducedMotion())
        await new Promise((r) => setTimeout(r, wait));
      haptic("success");
      setPhase("done");
      await new Promise((r) => setTimeout(r, 380));
      await settle(0);
      delete document.documentElement.dataset.pulling;
      setPhase("idle");
      state = "idle";
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
  }, [enabled]);

  return (
    <div
      ref={indicator}
      className={`ptr is-${phase}`}
      aria-hidden={phase === "idle"}
      role="status"
      aria-live="polite"
    >
      <svg
        ref={ball}
        className="ptr-ball"
        viewBox="0 0 28 28"
        width="28"
        height="28"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      >
        <circle cx="14" cy="14" r="12" />
        <path d="M14 8.6l4.6 3.3-1.8 5.4h-5.6l-1.8-5.4z" fill="currentColor" />
        <path d="M14 8.6V2.2M18.6 11.9l6-2M16.8 17.3l3.8 5.2M11.2 17.3l-3.8 5.2M9.4 11.9l-6-2" />
      </svg>
      <span className="ptr-label">{copy[phase]}</span>
    </div>
  );
}
