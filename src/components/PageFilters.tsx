import { ChevronDown, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { CompetitionCode } from "../lib/competitions";
import CompetitionTabs from "./CompetitionTabs";

/**
 * Shared filters for Quiniela and Clasificación: group, a page-specific control and
 * the competition tabs, always visible so the current selection is obvious.
 */
export default function PageFilters({
  groups,
  groupId,
  groupLabel,
  onGroup,
  disabled = false,
  competition,
  available,
  onCompetition,
  onAll,
  aside,
  children,
}: {
  groups: { id: string; name: string }[];
  groupId: string;
  /** Static name when there is nothing to choose (demo or a single group). */
  groupLabel?: string;
  onGroup: (id: string) => void;
  disabled?: boolean;
  competition: CompetitionCode | "global";
  available?: readonly CompetitionCode[];
  onCompetition: (code: CompetitionCode) => void;
  onAll?: () => void;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const current = groups.find((g) => g.id === groupId);
  return (
    <section className="page-filters" aria-label="Filtros">
      <div className="page-filters-top">
        {groups.length > 1 ? (
          <label className="group-picker">
            <Users size={16} aria-hidden="true" />
            <span className="sr-only">Grupo</span>
            <select
              value={groupId}
              disabled={disabled}
              onChange={(e) => onGroup(e.target.value)}
            >
              {!current && <option value="">Selecciona tu grupo</option>}
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </label>
        ) : (
          <span className="group-picker is-static">
            <Users size={16} aria-hidden="true" />
            <span>{groupLabel || current?.name || "Sin grupo"}</span>
          </span>
        )}
        {aside}
      </div>
      <CompetitionTabs
        value={competition}
        available={available}
        onChange={(code) => {
          if (!disabled) onCompetition(code);
        }}
        onAll={onAll && !disabled ? onAll : undefined}
      />
      {children}
    </section>
  );
}

/** Two or three mutually exclusive options in a compact pill. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
