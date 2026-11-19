import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import { MOBILE_LAYOUT_QUERY } from "../lib/mobileViewport";
import { haptic, prefersReducedMotion, rubberBand, springTo } from "../lib/motion";

export type Detent = "fit" | "medium" | "large";

function useMobileLayout() {
  const [mobile, setMobile] = useState(
    () => window.matchMedia(MOBILE_LAYOUT_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

/**
 * Bottom sheet with detents on phones (UISheetPresentationController-like):
 * «medium» and «large» stops, drag between them, flick down to dismiss, spring
 * physics carry the finger's velocity. A centred dialog on larger screens.
 * `footer` stays pinned to the visible bottom edge at every detent.
 */
export default function Modal({
  title,
  busy = false,
  onClose,
  children,
  footer,
  className = "",
  detents = ["fit"],
  role = "dialog",
  describedBy,
  initialFocus,
}: {
  title: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  detents?: Detent[];
  role?: "dialog" | "alertdialog";
  describedBy?: string;
  /** Selector of the control focused on open (defaults to the first field). */
  initialFocus?: string;
}) {
  const panel = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const mobile = useMobileLayout();
  const closing = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Geometry of the sheet: translateY of each stop, smallest first.
  const geo = useRef({ height: 0, stops: [0], y: 0, medium: 0 });
  useBodyScrollLock(true);

  const moveTo = (y: number, velocity = 0, done?: () => void) => {
    const sheet = panel.current;
    if (!sheet) return;
    const g = geo.current;
    g.y = y;
    const lowest = g.stops[g.stops.length - 1];
    const options = { response: 0.4, damping: y >= g.height ? 1 : 0.86, velocity };
    const fade = y <= lowest ? 1 : Math.max(0, 1 - (y - lowest) / (g.height - lowest || 1));
    const jobs = [
      springTo(sheet, [{ transform: `translate3d(0,${y}px,0)` }], options),
    ];
    if (foot.current)
      jobs.push(
        springTo(
          foot.current,
          [{ transform: `translate3d(0,${-Math.min(y, g.medium)}px,0)` }],
          options,
        ),
      );
    if (backdrop.current)
      jobs.push(
        springTo(backdrop.current, [{ opacity: String(fade) }], {
          response: 0.4,
          damping: 1,
        }),
      );
    void Promise.all(jobs).then(([sheetDone]) => {
      if (sheetDone) done?.();
    });
  };
  const place = (y: number) => {
    const g = geo.current;
    g.y = y;
    const lowest = g.stops[g.stops.length - 1];
    if (panel.current) panel.current.style.transform = `translate3d(0,${y}px,0)`;
    if (foot.current)
      foot.current.style.transform = `translate3d(0,${-Math.min(Math.max(y, 0), g.medium)}px,0)`;
    if (backdrop.current)
      backdrop.current.style.opacity = String(
        y <= lowest ? 1 : Math.max(0, 1 - (y - lowest) / (g.height - lowest || 1)),
      );
  };
  const requestClose = (velocity = 0) => {
    if (busyRef.current || closing.current) return;
    closing.current = true;
    if (!mobile || prefersReducedMotion()) {
      closeRef.current();
      return;
    }
    moveTo(geo.current.height + 24, velocity, () => closeRef.current());
  };

  // Measure stops and present from below.
  useLayoutEffect(() => {
    const sheet = panel.current;
    if (!mobile || !sheet) return;
    const height = sheet.offsetHeight;
    const mediumVisible = Math.round(window.innerHeight * 0.55);
    const stops = [0];
    let medium = 0;
    if (detents.includes("medium") && height - mediumVisible > 80) {
      medium = height - mediumVisible;
      stops.push(medium);
    }
    geo.current = { height, stops, y: height, medium };
    place(height + 24);
    if (backdrop.current) backdrop.current.style.opacity = "0";
    moveTo(stops[stops.length - 1]);
  }, [mobile]);

  // Touch gestures: drag between detents, or down to dismiss.
  useEffect(() => {
    const sheet = panel.current;
    if (!mobile || !sheet) return;
    let startY = 0;
    let originY = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let state: "idle" | "pending" | "dragging" = "idle";
    let fromContent = false;
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1 || busyRef.current || closing.current) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [data-no-sheet-drag]")) return;
      state = "pending";
      fromContent = Boolean(body.current?.contains(target));
      startY = lastY = event.touches[0].clientY;
      // Grabbing mid-animation continues from where the sheet really is.
      originY = new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;
      lastTime = event.timeStamp;
      velocity = 0;
    };
    const move = (event: TouchEvent) => {
      if (state === "idle") return;
      const y = event.touches[0].clientY;
      const dy = y - startY;
      const g = geo.current;
      if (state === "pending") {
        if (Math.abs(dy) < 5) return;
        const scrolled = (body.current?.scrollTop || 0) > 0;
        const atTop = g.y <= 0.5;
        // Content scrolls when the sheet is fully up, unless pulling down from its top.
        if (fromContent && atTop && (dy < 0 || scrolled)) {
          state = "idle";
          return;
        }
        state = "dragging";
        for (const element of [sheet, foot.current, backdrop.current])
          element?.getAnimations().forEach((a) => a.cancel());
        startY = y;
      }
      event.preventDefault();
      const dt = Math.max(1, event.timeStamp - lastTime);
      velocity = 0.75 * ((y - lastY) / dt) + 0.25 * velocity;
      lastY = y;
      lastTime = event.timeStamp;
      let next = originY + (y - startY);
      if (next < 0) next = rubberBand(next, g.height, 0.4);
      place(next);
    };
    const end = () => {
      if (state !== "dragging") {
        state = "idle";
        return;
      }
      state = "idle";
      const g = geo.current;
      const projected = g.y + velocity * 200;
      const lowest = g.stops[g.stops.length - 1];
      const springVelocity = (velocity * 1000) / Math.max(1, g.height);
      if (projected > lowest + Math.min(140, (g.height - lowest) * 0.4)) {
        haptic("light");
        requestClose(springVelocity);
        return;
      }
      const target = g.stops.reduce((best, stop) =>
        Math.abs(stop - projected) < Math.abs(best - projected) ? stop : best,
      );
      if (target !== originY) haptic();
      moveTo(target, springVelocity);
    };
    sheet.addEventListener("touchstart", start, { passive: true });
    sheet.addEventListener("touchmove", move, { passive: false });
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
    return () => {
      sheet.removeEventListener("touchstart", start);
      sheet.removeEventListener("touchmove", move);
      sheet.removeEventListener("touchend", end);
      sheet.removeEventListener("touchcancel", end);
    };
  }, [mobile]);

  // Typing needs the whole sheet above the keyboard.
  useEffect(() => {
    const sheet = panel.current;
    const viewport = window.visualViewport;
    if (!mobile || !sheet) return;
    const onFocus = (event: FocusEvent) => {
      if ((event.target as HTMLElement).matches("input, textarea, select") && geo.current.y > 0)
        moveTo(0);
    };
    const onResize = () => {
      if (!viewport) return;
      const keyboard = Math.max(0, window.innerHeight - viewport.height);
      sheet.style.setProperty("--kb", `${keyboard > 120 ? keyboard : 0}px`);
    };
    sheet.addEventListener("focusin", onFocus);
    viewport?.addEventListener("resize", onResize);
    return () => {
      sheet.removeEventListener("focusin", onFocus);
      viewport?.removeEventListener("resize", onResize);
    };
  }, [mobile]);

  // Focus management: trap inside, restore on close, keep the page inert.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    const wasInert = root?.inert || false;
    if (root) root.inert = true;
    const first =
      (initialFocus && panel.current?.querySelector<HTMLElement>(initialFocus)) ||
      (!mobile && panel.current?.querySelector<HTMLElement>("input, select")) ||
      panel.current;
    first?.focus({ preventScroll: true });
    return () => {
      if (root) root.inert = wasInert;
      previous?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      className={`modal-layer${mobile ? " is-sheet" : " is-dialog"}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          requestClose();
        }
        if (e.key !== "Tab") return;
        const controls = panel.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
        );
        if (!controls?.length) {
          e.preventDefault();
          panel.current?.focus();
          return;
        }
        const first = controls[0],
          last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <div
        ref={backdrop}
        className="modal-backdrop"
        onClick={() => requestClose()}
        aria-hidden="true"
      />
      <section
        ref={panel}
        tabIndex={-1}
        className={`modal sheet ${detents.includes("fit") && detents.length === 1 ? "is-fit" : "is-tall"} ${className}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy}
      >
        <header className="sheet-header">
          <span className="sheet-grabber" aria-hidden="true" />
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="modal-close icon-button"
            aria-label="Cerrar"
            disabled={busy}
            onClick={() => requestClose()}
          >
            <X size={18} strokeWidth={2.4} />
          </button>
        </header>
        <div ref={body} className="sheet-body">
          {children}
        </div>
        {footer && (
          <div ref={foot} className="sheet-footer">
            {footer}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
