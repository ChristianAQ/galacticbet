import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { haptic, prefersReducedMotion, rubberBand, springTo } from "../lib/motion";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import "../styles/cardDeck.css";

interface Drag {
  id: number;
  x: number;
  y: number;
  t: number;
  axis: "x" | "y" | null;
  dx: number;
  dy: number;
  scrolls: boolean;
}

/**
 * Cards of a list (top scorers, a squad, a league table) over the page. The
 * card grows out of the row you tapped; swipe sideways for the next or
 * previous one, down to put it away. Arrows and Esc do the same from a
 * keyboard, and focus goes back to the row on closing.
 *
 * `render` draws card `index`; its heading carries `titleId`. With `tilt`,
 * the card leans and its `--mx/--my` light follows the finger. An element
 * marked `data-deck-scroll` scrolls on its own (vertical drags there scroll
 * instead of closing).
 */
export default function CardDeck({
  count,
  start,
  origin,
  onClose,
  render,
  itemLabel,
  tilt = false,
  className = "",
  label,
}: {
  count: number;
  start: number;
  /** The row that was tapped: the card grows from it and focus returns to it. */
  origin?: HTMLElement | null;
  onClose: () => void;
  render: (index: number, titleId: string) => ReactNode;
  /** Who is on card `index`, for screen readers («Kylian Mbappé, 1 de 20»). */
  itemLabel: (index: number) => string;
  tilt?: boolean;
  className?: string;
  /** What the pager browses: «Más jugadores», «Más equipos». */
  label: string;
}) {
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), count - 1));
  const titleId = useId();
  const backdrop = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);
  const entering = useRef(0);
  const closing = useRef(false);
  const busy = useRef(false);
  useBodyScrollLock(true);

  // Open: out of the tapped row, into the middle.
  useLayoutEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
    const card = stage.current;
    if (!card || prefersReducedMotion()) return;
    backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
    const from = origin?.getBoundingClientRect();
    const to = card.getBoundingClientRect();
    const startTransform =
      from && from.width && from.bottom > 0 && from.top < innerHeight
        ? `translate3d(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${
            from.top + from.height / 2 - (to.top + to.height / 2)
          }px, 0) scale(${Math.max(0.18, from.height / to.height)})`
        : "translate3d(0, 48px, 0) scale(0.92)";
    void springTo(
      card,
      [
        { transform: startTransform, opacity: 0.3 },
        { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
      ],
      { response: 0.44, damping: 0.8 },
    );
    return () => origin?.focus({ preventScroll: true });
  }, []);

  // A new card slides in from the side it comes from.
  useLayoutEffect(() => {
    const from = entering.current;
    entering.current = 0;
    const card = stage.current;
    if (!from || !card) return;
    void springTo(
      card,
      [
        { transform: `translate3d(${from * (card.offsetWidth + 40)}px, 0, 0) rotate(${from * 6}deg)`, opacity: 0 },
        { transform: "translate3d(0, 0, 0) rotate(0deg)", opacity: 1 },
      ],
      { response: 0.38, damping: 0.86 },
    ).then(() => (busy.current = false));
  }, [index]);

  function close() {
    if (closing.current) return;
    closing.current = true;
    const card = stage.current;
    if (!card || prefersReducedMotion()) return onClose();
    backdrop.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" });
    void springTo(
      card,
      [
        { transform: getComputedStyle(card).transform === "none" ? "none" : getComputedStyle(card).transform, opacity: 1 },
        { transform: "translate3d(0, 72px, 0) scale(0.9)", opacity: 0 },
      ],
      { response: 0.3, damping: 1 },
    ).then(onClose);
  }

  function step(direction: 1 | -1) {
    const next = index + direction;
    const card = stage.current;
    if (!card || busy.current) return;
    if (next < 0 || next >= count) {
      // Nothing that way: a small nudge and back.
      void springTo(card, [
        { transform: `translate3d(${-direction * 18}px, 0, 0)` },
        { transform: "translate3d(0, 0, 0)" },
      ]);
      return;
    }
    haptic();
    busy.current = true;
    const out = () => {
      entering.current = direction;
      setIndex(next);
    };
    if (prefersReducedMotion()) return out();
    void springTo(
      card,
      [
        { transform: getComputedStyle(card).transform === "none" ? "none" : getComputedStyle(card).transform, opacity: 1 },
        { transform: `translate3d(${-direction * (card.offsetWidth + 40)}px, 0, 0) rotate(${-direction * 6}deg)`, opacity: 0 },
      ],
      { response: 0.26, damping: 1 },
    ).then(out);
  }

  // The finger moves the card; with `tilt`, the light follows it across.
  function shine(event: PointerEvent<HTMLDivElement>) {
    const card = tilt ? (stage.current?.firstElementChild as HTMLElement | null) : null;
    if (!card) return;
    const box = card.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    card.style.setProperty("--mx", `${Math.round(x * 100)}%`);
    card.style.setProperty("--my", `${Math.round(y * 100)}%`);
    if (!prefersReducedMotion()) {
      card.style.setProperty("--ry", `${((x - 0.5) * 14).toFixed(2)}deg`);
      card.style.setProperty("--rx", `${((0.5 - y) * 12).toFixed(2)}deg`);
    }
    card.dataset.lit = "";
  }
  function rest() {
    const card = tilt ? (stage.current?.firstElementChild as HTMLElement | null) : null;
    if (!card) return;
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
    delete card.dataset.lit;
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (busy.current || closing.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    // Inside a scrolling part, vertical moves belong to the scroll.
    const scrolls = Boolean((event.target as HTMLElement).closest?.("[data-deck-scroll]"));
    if (!scrolls) event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
      axis: null,
      dx: 0,
      dy: 0,
      scrolls,
    };
    shine(event);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    shine(event);
    const d = drag.current;
    const card = stage.current;
    if (!d || d.id !== event.pointerId || !card) return;
    d.dx = event.clientX - d.x;
    d.dy = event.clientY - d.y;
    if (!d.axis && Math.hypot(d.dx, d.dy) > 8) {
      d.axis = Math.abs(d.dx) > Math.abs(d.dy) ? "x" : "y";
      if (d.axis === "x" && d.scrolls) event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (d.axis === "y" && d.scrolls) return;
    if (d.axis === "x") {
      const edge = (d.dx > 0 && index === 0) || (d.dx < 0 && index === count - 1);
      const x = edge ? rubberBand(d.dx, card.offsetWidth) : d.dx;
      card.style.transform = `translate3d(${x}px, 0, 0) rotate(${x / 26}deg)`;
    } else if (d.axis === "y") {
      const y = d.dy > 0 ? d.dy : rubberBand(d.dy, card.offsetHeight, 0.3);
      card.style.transform = `translate3d(0, ${y}px, 0) scale(${Math.max(0.86, 1 - Math.max(0, y) / 1600)})`;
      if (backdrop.current) backdrop.current.style.opacity = String(Math.max(0.35, 1 - Math.max(0, y) / 420));
    }
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    rest();
    const card = stage.current;
    if (!d || d.id !== event.pointerId || !card) return;
    const elapsed = Math.max(1, performance.now() - d.t);
    const vx = d.dx / elapsed;
    const vy = d.dy / elapsed;
    if (d.axis === "x" && (Math.abs(d.dx) > 90 || Math.abs(vx) > 0.55)) return step(d.dx < 0 ? 1 : -1);
    if (d.axis === "y" && !d.scrolls && (d.dy > 120 || vy > 0.65)) return close();
    if (backdrop.current) backdrop.current.style.opacity = "";
    void springTo(card, [
      { transform: card.style.transform || "none" },
      { transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)" },
    ], { response: 0.36, damping: 0.78 });
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "Tab") {
      // Focus stays on the card's controls.
      const controls = [...(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)"))];
      const at = controls.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? at - 1 : at + 1;
      event.preventDefault();
      controls[(next + controls.length) % controls.length]?.focus();
    }
  }
  useEffect(() => {
    // Announce the card that is showing for screen readers.
    stage.current?.setAttribute("aria-label", `${itemLabel(index)}, ${index + 1} de ${count}`);
  }, [index, count]);

  if (index < 0 || index >= count) return null;
  return createPortal(
    <div
      className={`card-deck ${className}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
    >
      <div ref={backdrop} className="card-deck-backdrop" onClick={close} />
      <button ref={closeButton} type="button" className="card-deck-close" aria-label="Cerrar" onClick={close}>
        <X size={22} aria-hidden="true" />
      </button>
      <div className="card-deck-center">
        <div
          ref={stage}
          className="card-deck-stage"
          role="group"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={(event) => !drag.current && event.pointerType === "mouse" && rest()}
        >
          {render(index, titleId)}
        </div>
        {count > 1 && (
          <nav className="card-deck-pager" aria-label={label}>
            <button type="button" aria-label="Anterior" disabled={index === 0} onClick={() => step(-1)}>
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
            <span aria-live="polite">
              {index + 1} <small>de {count}</small>
            </span>
            <button
              type="button"
              aria-label="Siguiente"
              disabled={index === count - 1}
              onClick={() => step(1)}
            >
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          </nav>
        )}
        <p className="card-deck-hint" aria-hidden="true">
          {count > 1 ? "Desliza para ver otro · abajo para cerrar" : "Desliza hacia abajo para cerrar"}
        </p>
      </div>
    </div>,
    document.body,
  );
}
