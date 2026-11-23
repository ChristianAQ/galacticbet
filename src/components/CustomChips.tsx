import { Plus, Search, X } from "lucide-react";
import type { CompetitionChip } from "../lib/customCompetitionData";
import { menuTarget } from "./ContextMenu";
import "../styles/customBadge.css";

/** The competition's picture, or its initials, in the same badge as official ones. */
export function CompetitionBadge({ icon, name, small = true }: { icon: string | null; name: string; small?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className={`competition-logo competition-badge custom-badge${small ? " small" : ""}`} aria-hidden="true">
      {icon ? <img src={icon} alt="" /> : <span className="competition-fallback">{initials || "★"}</span>}
    </span>
  );
}

/** The magnifier on the large title: find public competitions to follow. */
export function LeagueSearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="masthead-search" aria-label="Buscar ligas públicas" onClick={onClick}>
      <Search size={20} strokeWidth={2.4} aria-hidden="true" />
    </button>
  );
}

/**
 * Your competitions after LaLiga, Champions and Premier (in Ligas, Quiniela
 * and Clasificación), and in Ligas the «＋» to create or join one.
 */
export function CustomChips({
  list,
  current,
  onSelect,
  onAdd,
  onRemove,
}: {
  list: CompetitionChip[];
  current: string;
  onSelect: (id: string) => void;
  onAdd?: () => void;
  /** Long press on one you don't follow: take it off the list (also on its masthead). */
  onRemove?: (id: string) => void;
}) {
  return (
    <>
      {list.map((c) => (
        <button
          key={c.id}
          className="is-custom"
          ref={(element) => {
            if (onRemove && c.followed === false)
              menuTarget(() => ({
                title: c.name,
                items: [
                  {
                    label: "Quitar de la lista",
                    icon: <X size={18} aria-hidden="true" />,
                    destructive: true,
                    onSelect: () => onRemove(c.id),
                  },
                ],
              }))(element);
          }}
          type="button"
          aria-pressed={current === c.id}
          onClick={() => onSelect(c.id)}
        >
          <CompetitionBadge icon={c.icon} name={c.name} />
          <span>{c.name}</span>
        </button>
      ))}
      {onAdd && (
        <button type="button" className="competition-tabs-new is-custom" onClick={onAdd} aria-label="Crear o unirse a una competición">
          <span className="competition-tabs-all" aria-hidden="true">
            <Plus size={16} />
          </span>
          <span>{list.length ? "Nueva" : "Tu competición"}</span>
        </button>
      )}
    </>
  );
}
