import { ChevronLeft, ChevronRight, LocateFixed } from "lucide-react";
import { haptic } from "../lib/motion";
import { memo, useEffect, useLayoutEffect, useRef } from "react";
import {
  roundDateRange,
  roundStateLabel,
  type RoundOption,
} from "../lib/roundOptions";

function RoundSelector({
  rounds,
  value,
  current,
  disabled = false,
  onChange,
}: {
  rounds: RoundOption[];
  value: string;
  current?: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const index = rounds.findIndex((r) => r.id === value);
  const selected = rounds[index];
  const animate = useRef(false);
  /**
   * Centre the selected chip. Positions come from layout boxes, not offsetLeft
   * (relative to the selector, not the strip), and snapping is off on the strip:
   * iOS re-snapped a smooth programmatic scroll and the chip jumped at the end.
   */
  const centre = (smooth: boolean) => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !chip || !strip.clientWidth) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const offset =
      chip.getBoundingClientRect().left -
      strip.getBoundingClientRect().left +
      strip.scrollLeft;
    strip.scrollTo({
      left: offset - (strip.clientWidth - chip.offsetWidth) / 2,
      behavior: smooth && !reduce ? "smooth" : "auto",
    });
  };
  useLayoutEffect(() => {
    centre(animate.current);
    animate.current = true;
  }, [value, rounds.length]);
  // A page prepared off screen has no width yet: centre once it gets one.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === "undefined") return;
    let width = strip.clientWidth;
    const observer = new ResizeObserver(() => {
      if (strip.clientWidth === width) return;
      width = strip.clientWidth;
      centre(false);
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);
  const go = (step: number) => {
    const next = rounds[index + step];
    if (!next) return;
    haptic();
    onChange(next.id);
  };
  if (!rounds.length)
    return (
      <section className="round-selector panel" aria-label="Jornada">
        <p className="round-selector-empty">Sin jornadas disponibles</p>
      </section>
    );
  return (
    <section className="round-selector panel" aria-label="Jornada">
      <header className="round-selector-heading">
        <div>
          <strong>{selected?.label || "Selecciona jornada"}</strong>
          {selected && (
            <span className={`round-state round-state-${selected.state}`}>
              <i aria-hidden="true" />
              {[
                roundStateLabel[selected.state],
                roundDateRange(selected.start, selected.end),
                selected.matches ? `${selected.matches} partidos` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>
        {current && current !== value && (
          <button
            type="button"
            className="round-current"
            disabled={disabled}
            onClick={() => onChange(current)}
          >
            <LocateFixed size={14} aria-hidden="true" />
            Actual
          </button>
        )}
      </header>
      <div className="round-selector-track">
        <button
          type="button"
          className="round-step"
          aria-label="Jornada anterior"
          disabled={disabled || index <= 0}
          onClick={() => go(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <div
          ref={stripRef}
          className="round-strip"
          role="group"
          aria-label="Elegir jornada"
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            go(e.key === "ArrowLeft" ? -1 : 1);
            requestAnimationFrame(() =>
              stripRef.current
                ?.querySelector<HTMLElement>('[aria-pressed="true"]')
                ?.focus(),
            );
          }}
        >
          {rounds.map((r, i) => (
            <button
              key={r.id}
              type="button"
              className={`round-chip round-chip-${r.state}`}
              aria-pressed={r.id === value}
              aria-label={[
                r.label,
                roundStateLabel[r.state],
                roundDateRange(r.start, r.end),
              ]
                .filter(Boolean)
                .join(", ")}
              tabIndex={i === Math.max(index, 0) ? 0 : -1}
              disabled={disabled}
              onClick={() => {
                if (r.id !== value) haptic();
                onChange(r.id);
              }}
            >
              <strong>{r.short}</strong>
              <small>{roundDateRange(r.start, r.end) || "—"}</small>
              <i className="round-chip-dot" aria-hidden="true" />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="round-step"
          aria-label="Jornada siguiente"
          disabled={disabled || index < 0 || index >= rounds.length - 1}
          onClick={() => go(1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}
export default memo(RoundSelector);
