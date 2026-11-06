import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(false);
  const holdUntil = useRef(0);
  function expand() {
    compactRef.current = false;
    holdUntil.current = performance.now() + 400;
    setCompact(false);
  }
  useEffect(() => {
    let frame = 0;
    let lastY = Math.max(0, window.scrollY);
    let direction = 0;
    let distance = 0;
    function update() {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      const delta = y - lastY;
      lastY = y;
      if (y < 16) {
        if (compactRef.current) {
          compactRef.current = false;
          setCompact(false);
        }
        distance = 0;
        return;
      }
      if (performance.now() < holdUntil.current) return;
      const nextDirection = Math.sign(delta);
      if (!nextDirection) return;
      distance =
        nextDirection === direction
          ? distance + Math.abs(delta)
          : Math.abs(delta);
      direction = nextDirection;
      const keyboardFocus =
        ref.current?.contains(document.activeElement) &&
        document.activeElement?.matches(":focus-visible");
      const next =
        direction < 0 && distance > 18
          ? false
          : y > 80 && direction > 0 && distance > 32 && !keyboardFocus
            ? true
            : compactRef.current;
      if (next === compactRef.current) return;
      compactRef.current = next;
      setCompact(next);
      // Ignore layout-induced scrolling during the height transition.
      holdUntil.current = performance.now() + 300;
      distance = 0;
    }
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
    };
  }, []);
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
        `${ref.current.getBoundingClientRect().height}px`,
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
    expand();
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
    <div
      className={`league-navigation${compact ? " is-compact" : ""}`}
      ref={ref}
      onFocusCapture={expand}
    >
      {children}
      <div
        className="league-tabs-wrap"
        inert={compact}
        aria-hidden={compact || undefined}
      >
        <div className="league-tabs-clip">
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
      </div>
    </div>
  );
}
