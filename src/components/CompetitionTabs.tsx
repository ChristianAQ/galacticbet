import { Layers } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  COMPETITION_CODES,
  competitionName,
  type CompetitionCode,
} from "../lib/competitions";
import { prefersReducedMotion } from "../lib/motion";
import CompetitionLogo from "./CompetitionLogo";

/**
 * Keeps the highlight under the chosen chip: it slides (and stretches) from
 * one chip to the next with a spring, and the row glides so the chosen one
 * sits in view. Chips can be official or friends' ones (children), so the
 * chosen chip is read from the DOM after every change.
 */
function useSlidingThumb() {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const row = track.current;
    const bar = thumb.current;
    if (!row || !bar) return;
    let shown: HTMLElement | null = null;
    let frame = 0;
    const place = () => {
      frame = 0;
      const active = row.querySelector<HTMLElement>(':scope > button[aria-pressed="true"]');
      if (!active || !active.offsetWidth) {
        bar.dataset.hidden = "";
        shown = null;
        return;
      }
      const moved = shown !== active;
      const first = !("ready" in bar.dataset);
      // Sub-pixel exact, and right even while the chip is pressed (it scales
      // around its centre): from the centre on screen and the unscaled size.
      const box = active.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      const width = active.offsetWidth;
      const left = box.left + box.width / 2 - rowBox.left - row.clientLeft + row.scrollLeft - width / 2;
      bar.style.width = `${width}px`;
      bar.style.height = `${active.offsetHeight}px`;
      bar.style.transform = `translate3d(${left}px, ${active.offsetTop}px, 0)`;
      delete bar.dataset.hidden;
      if (moved) {
        // Centre the chosen chip; the first time (or reduced motion) in place.
        const left = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
        const max = row.scrollWidth - row.clientWidth;
        const target = Math.max(0, Math.min(max, left));
        if (Math.abs(row.scrollLeft - target) > 1)
          row.scrollTo({ left: target, behavior: first || !shown || prefersReducedMotion() ? "auto" : "smooth" });
      }
      shown = active;
      // Transitions only from the second placement: nothing slides in on load.
      if (first) requestAnimationFrame(() => (bar.dataset.ready = ""));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    const sizes = new ResizeObserver(schedule);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(row);
      for (const chip of row.children) if (chip instanceof HTMLElement) sizes.observe(chip);
    };
    watch();
    const changes = new MutationObserver((records) => {
      if (records.some((r) => r.type === "childList")) watch();
      schedule();
    });
    changes.observe(row, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed", "disabled"],
      characterData: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      changes.disconnect();
      // Shown again (another tab, back): place it without sliding.
      delete bar.dataset.ready;
    };
  }, []);
  return { track, thumb };
}

export default function CompetitionTabs({
  value,
  onChange,
  available,
  onAll,
  children,
}: {
  /** "none": another kind of competition (a friends' one) is selected. */
  value: CompetitionCode | "global" | "none";
  onChange: (value: CompetitionCode) => void;
  available?: readonly CompetitionCode[];
  onAll?: () => void;
  /** More chips after the official competitions. */
  children?: ReactNode;
}) {
  const { track, thumb } = useSlidingThumb();
  return (
    <div ref={track} className="competition-tabs" role="group" aria-label="Competición">
      <span ref={thumb} className="competition-tabs-thumb" data-hidden="" aria-hidden="true" />
      {onAll && (
        <button
          type="button"
          aria-pressed={value === "global"}
          onClick={onAll}
        >
          <span className="competition-tabs-all" aria-hidden="true">
            <Layers size={15} />
          </span>
          <span>Todas</span>
        </button>
      )}
      {COMPETITION_CODES.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={value === code}
          disabled={available ? !available.includes(code) : false}
          onClick={() => onChange(code)}
        >
          <CompetitionLogo code={code} small />
          <span>{competitionName(code, true)}</span>
        </button>
      ))}
      {children}
    </div>
  );
}
