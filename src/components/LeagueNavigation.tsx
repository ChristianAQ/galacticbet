import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { LEAGUE_TABS, type LeagueTab } from "../lib/leagueHub";
import Segmented from "./Segmented";

/** Short labels so four segments fit a phone; the panel titles stay complete. */
const shortLabels: Partial<Record<LeagueTab, string>> = {
  clasificacion: "Tabla",
  estadisticas: "Datos",
};

/**
 * The four sections of a competition as a segmented control pinned under the
 * navigation bar. It publishes its height so day headers and the table header
 * can pin right below it.
 */
export default function LeagueNavigation<T extends string = LeagueTab>({
  tab,
  onChange,
  panel,
  idPrefix,
  panelId,
  tabs = LEAGUE_TABS as unknown as readonly { id: T; label: string }[],
}: {
  tab: T;
  onChange: (tab: T) => void;
  /** Sections to offer; the four league sections by default. */
  tabs?: readonly { id: T; label: string }[];
  /** The tab panel, to scroll back to its top when switching far down. */
  panel: RefObject<HTMLElement | null>;
  idPrefix: string;
  panelId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLSpanElement>(null);
  const [stuck, setStuck] = useState(false);
  useLayoutEffect(() => {
    const nav = ref.current;
    const mark = sentinel.current;
    if (!nav || !mark) return;
    const page = nav.closest<HTMLElement>(".leagues-page");
    let observer: IntersectionObserver | undefined;
    let offset = -1;
    const update = () => {
      page?.style.setProperty(
        "--league-navigation-height",
        `${nav.getBoundingClientRect().height}px`,
      );
      const bar = document.querySelector<HTMLElement>(".nav-bar");
      const next = Math.round(bar?.getBoundingClientRect().height || 0);
      if (next === offset) return;
      offset = next;
      observer?.disconnect();
      observer = new IntersectionObserver(
        ([entry]) =>
          setStuck(!entry.isIntersecting && entry.boundingClientRect.top < offset + 1),
        { rootMargin: `-${offset + 1}px 0px 0px 0px`, threshold: 0 },
      );
      observer.observe(mark);
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(nav, { box: "border-box" });
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  function select(next: T) {
    if (next === tab) return;
    const target = panel.current;
    const header = ref.current;
    if (target && header) {
      const bar =
        document.querySelector<HTMLElement>(".nav-bar")?.getBoundingClientRect()
          .height || 0;
      const top =
        target.getBoundingClientRect().top +
        window.scrollY -
        header.offsetHeight -
        bar -
        8;
      if (window.scrollY > top + 8)
        window.scrollTo({
          top: Math.max(0, top),
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
        ref={ref}
        className={`league-navigation${stuck ? " is-stuck" : ""}`}
      >
        <Segmented<T>
          label="Información de la liga"
          value={tab}
          options={tabs.map((t) => ({
            value: t.id,
            label: shortLabels[t.id as LeagueTab] || t.label,
          }))}
          onChange={select}
          tabs={{ idPrefix, controls: panelId }}
        />
      </div>
    </>
  );
}
