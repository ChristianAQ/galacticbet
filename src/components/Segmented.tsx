import { type CSSProperties, type KeyboardEvent } from "react";
import { haptic } from "../lib/motion";

/**
 * iOS segmented control: equal segments and a thumb that slides between them
 * with a spring (transform only). `tabs` mode renders an ARIA tablist for
 * controls that switch panels.
 */
export default function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  tabs,
  className = "",
  size = "md",
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  /** Tab semantics: ids are `${tabs.idPrefix}-${value}`, panel is `tabs.controls`. */
  tabs?: { idPrefix: string; controls: string };
  className?: string;
  size?: "sm" | "md";
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const select = (next: T) => {
    if (next === value) return;
    haptic();
    onChange(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const position = enabled.findIndex((o) => o.value === value);
    const next =
      event.key === "Home"
        ? enabled[0]
        : event.key === "End"
          ? enabled[enabled.length - 1]
          : enabled[(position + step + enabled.length) % enabled.length];
    if (!next) return;
    select(next.value);
    // React clears currentTarget once the handler returns: keep the group now.
    const group = event.currentTarget;
    requestAnimationFrame(() =>
      group
        .querySelector<HTMLElement>(`[data-value="${next.value}"]`)
        ?.focus(),
    );
  };
  return (
    <div
      className={`segmented is-${size} ${className}`}
      role={tabs ? "tablist" : "radiogroup"}
      aria-label={label}
      onKeyDown={onKeyDown}
      style={
        { "--seg-index": index, "--seg-count": options.length } as CSSProperties
      }
    >
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            data-value={o.value}
            disabled={o.disabled}
            role={tabs ? "tab" : "radio"}
            id={tabs ? `${tabs.idPrefix}-${o.value}` : undefined}
            aria-controls={tabs?.controls}
            aria-selected={tabs ? selected : undefined}
            aria-checked={tabs ? undefined : selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
