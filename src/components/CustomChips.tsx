import { Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
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
  // The chosen competition sits after the official ones: bring it into view.
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [current, list.length]);
  return (
    <>
      {list.map((c) => (
        <button
          key={c.id}
          ref={(element) => {
            if (current === c.id) active.current = element;
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
        <button type="button" className="competition-tabs-new" onClick={onAdd} aria-label="Crear o unirse a una competición">
          <span className="competition-tabs-all" aria-hidden="true">
            <Plus size={16} />
          </span>
          <span>{list.length ? "Nueva" : "Tu competición"}</span>
        </button>
      )}
    </>
  );
}
