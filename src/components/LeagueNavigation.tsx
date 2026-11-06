import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
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
  const id = useId();
  useLayoutEffect(() => {
    const topbar = document.querySelector<HTMLElement>(".topbar");
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
        `${ref.current.offsetHeight}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    // Safe-area padding changes the outer height even when the content box stays equal.
    if (topbar) observer.observe(topbar, { box: "border-box" });
    if (ref.current) observer.observe(ref.current, { box: "border-box" });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
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
    <div className="league-navigation" ref={ref}>
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
            data-tab={id}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
