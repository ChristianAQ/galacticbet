import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LEAGUE_TABS, type LeagueTab } from "../lib/leagueHub";

export default function LeagueNavigation({
  tab,
  onChange,
  children,
}: {
  tab: LeagueTab;
  onChange: (tab: LeagueTab) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const topbar = document.querySelector<HTMLElement>(".topbar");
    let pinned: IntersectionObserver | undefined;
    let observedOffset = -1;
    const update = () => {
      const style = topbar && getComputedStyle(topbar);
      const offset =
        topbar && style && ["sticky", "fixed"].includes(style.position)
          ? topbar.getBoundingClientRect().height + (parseFloat(style.top) || 0)
          : 0;
      ref.current?.style.setProperty("--league-header-offset", `${offset}px`);
      ref.current?.parentElement?.style.setProperty(
        "--league-header-offset",
        `${offset}px`,
      );
      ref.current?.parentElement?.style.setProperty(
        "--league-navigation-height",
        `${ref.current.getBoundingClientRect().height}px`,
      );
      if (observedOffset === offset || !sentinel.current) return;
      observedOffset = offset;
      pinned?.disconnect();
      // A fixed origin keeps the logos compact until the navigation returns to
      // its resting position, even when scrolling up or changing tabs.
      pinned = new IntersectionObserver(
        ([entry]) =>
          setCompact(
            !entry.isIntersecting && entry.boundingClientRect.top < offset,
          ),
        { rootMargin: `-${offset}px 0px 0px 0px`, threshold: 0 },
      );
      pinned.observe(sentinel.current);
    };
    update();
    const observer = new ResizeObserver(update);
    // Safe-area padding changes the outer height even when the content box stays equal.
    if (topbar) observer.observe(topbar, { box: "border-box" });
    if (ref.current) observer.observe(ref.current, { box: "border-box" });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      pinned?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  function select(next: LeagueTab) {
    if (next === tab) return;
    const panel = document.getElementById("league-panel");
    const header = ref.current;
    if (panel && header) {
      const offset =
        parseFloat(header.style.getPropertyValue("--league-header-offset")) ||
        0;
      const target =
        panel.getBoundingClientRect().top +
        window.scrollY -
        header.offsetHeight -
        offset -
        12;
      if (window.scrollY > target + 12)
        window.scrollTo({
          top: Math.max(0, target),
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
    }
    onChange(next);
  }
  return (
    <>
      <span ref={sentinel} className="sticky-sentinel" aria-hidden="true" />
      <div
        className={`league-navigation${compact ? " is-compact" : ""}`}
        ref={ref}
      >
        {children}
        <div
          className="league-tabs"
          role="tablist"
          aria-label="Información de la liga"
          onKeyDown={(e) => {
            const current = LEAGUE_TABS.findIndex((t) => t.id === tab);
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? 3
                  : e.key === "ArrowRight"
                    ? (current + 1) % 4
                    : e.key === "ArrowLeft"
                      ? (current + 3) % 4
                      : null;
            if (next === null) return;
            e.preventDefault();
            select(LEAGUE_TABS[next].id);
            ref.current
              ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [next]?.focus({ preventScroll: true });
          }}
        >
          <span
            className="league-tab-indicator"
            aria-hidden="true"
            style={{
              transform: `translateX(${LEAGUE_TABS.findIndex((t) => t.id === tab) * 100}%)`,
            }}
          />
          {LEAGUE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`league-tab-${t.id}`}
              aria-selected={t.id === tab}
              aria-controls="league-panel"
              tabIndex={t.id === tab ? 0 : -1}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
