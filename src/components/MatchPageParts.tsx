import { useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { haptic } from "../lib/motion";
import { Skeleton, SkeletonRows } from "./Skeleton";

/**
 * Pieces shared by every match page (official fixtures and friends'
 * competitions), so both look and behave the same.
 */

/** Ink scoreboard placeholder while the match loads. */
export function MatchSkeleton() {
  return (
    <div className="match-page" role="status" aria-label="Cargando partido">
      <div className="masthead match-hero match-hero-skeleton">
        <Skeleton width={150} height={11} className="on-ink" />
        <div className="match-hero-board">
          <Skeleton width={64} height={64} radius="50%" className="on-ink" />
          <Skeleton width={104} height={56} radius={10} className="on-ink" />
          <Skeleton width={64} height={64} radius="50%" className="on-ink" />
        </div>
        <Skeleton width="60%" height={12} className="on-ink" />
      </div>
      <SkeletonRows rows={4} variant="line" label="Cargando ficha" />
    </div>
  );
}

/** Large crest that morphs from the fixture row (shared view-transition part). */
export function HeroCrest({ src, part }: { src?: string; part: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img
      className="match-hero-crest"
      src={src}
      alt=""
      decoding="async"
      data-vt-part={part}
      onError={() => setFailed(true)}
    />
  ) : (
    <span
      className="match-hero-crest crest-placeholder"
      data-vt-part={part}
      aria-hidden="true"
    />
  );
}

/** The open section lives in `?tab=`, so «Volver» and links keep it. */
export function useMatchTab<T extends string>(tabs: T[]) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") as T | null;
  const tab = requested && tabs.includes(requested) ? requested : tabs[0];
  const setTab = (next: T) =>
    setParams(
      (previous) => {
        const value = new URLSearchParams(previous);
        value.set("tab", next);
        return value;
      },
      { replace: true },
    );
  return [tab, setTab] as const;
}

/** The section menu under the hero; it pins under the bar while scrolling. */
export function MatchTabs<T extends string>({
  tabs,
  labels,
  value,
  onChange,
  children,
}: {
  tabs: T[];
  labels: Record<T, string>;
  value: T;
  onChange: (tab: T) => void;
  /** Shortcuts next to the tabs (Porra rápida). */
  children?: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  function select(next: T) {
    if (next === value) return;
    haptic();
    onChange(next);
    // Pinned under the bar: keep the menu where it is while the panel changes.
    const bar = barRef.current;
    const anchor = anchorRef.current;
    if (bar && anchor) {
      const offset = parseFloat(getComputedStyle(bar).top) || 0;
      if (bar.getBoundingClientRect().top <= offset + 1)
        window.scrollTo({
          top: window.scrollY + anchor.getBoundingClientRect().top - offset,
        });
    }
  }
  return (
    <>
      <span ref={anchorRef} className="sticky-sentinel" aria-hidden="true" />
      <div ref={barRef} className="match-tabs">
        <div
          className="match-tabs-list"
          role="tablist"
          aria-label="Información del partido"
        >
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`match-tab-${t}`}
              aria-controls="match-panel"
              aria-selected={value === t}
              tabIndex={value === t ? 0 : -1}
              onClick={() => select(t)}
              onKeyDown={(e) => {
                const index = tabs.indexOf(t);
                const next =
                  e.key === "ArrowRight"
                    ? tabs[(index + 1) % tabs.length]
                    : e.key === "ArrowLeft"
                      ? tabs[(index - 1 + tabs.length) % tabs.length]
                      : null;
                if (!next) return;
                e.preventDefault();
                select(next);
                document.getElementById(`match-tab-${next}`)?.focus();
              }}
            >
              {labels[t]}
            </button>
          ))}
        </div>
        {children}
      </div>
    </>
  );
}
