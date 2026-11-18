import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { loadParticipants, type Group, type Participant } from "../lib/data";
import { readableError } from "./ui";
import { euroShort, groupPotCents } from "../lib/pot";
import "../styles/pot.css";

export default function GroupList({
  groups,
  uid,
  selected,
  onSelect,
  details,
}: {
  groups: Group[];
  uid: string;
  selected?: string;
  onSelect?: (id: string) => void;
  details?: (group: Group, people: Participant[]) => ReactNode;
}) {
  const key = JSON.stringify(groups.map((g) => [g.id, g.memberIds]));
  const [state, setState] = useState<{
    key: string;
    people: Record<string, Participant[]>;
    errors: Record<string, string>;
  }>({ key: "", people: {}, errors: {} });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ key, people: {}, errors: {} });
    void Promise.all(
      groups.map(async (g) => {
        try {
          const people = await loadParticipants(g);
          if (active)
            setState((s) => ({
              ...s,
              people: { ...s.people, [g.id]: people },
            }));
        } catch (e) {
          if (active)
            setState((s) => ({
              ...s,
              errors: { ...s.errors, [g.id]: readableError(e) },
            }));
        }
      }),
    );
    return () => {
      active = false;
    };
  }, [key, retry]);
  return (
    <div className="group-list">
      {groups.map((g) => {
        const people = state.key === key ? state.people[g.id] : undefined;
        const error = state.key === key ? state.errors[g.id] : undefined;
        const open = selected === g.id;
        const content = (
          <>
            <span className="group-summary-icon">
              <Users size={22} />
            </span>
            <span className="group-summary-body">
              <strong>{g.name}</strong>
              <span>
                {g.memberIds.length} participantes ·{" "}
                {g.ownerId === uid ? "Administrador" : "Miembro"}
                {groupPotCents(g) > 0 && (
                  <>
                    {" "}
                    <span className="group-pot-badge">
                      Bote {euroShort(groupPotCents(g))}
                    </span>
                  </>
                )}
              </span>
              <span
                className="group-member-preview"
                title={people?.map((person) => person.name).join(" · ")}
              >
                {people
                  ? people
                      .map((p) => (p.id === uid ? `${p.name} (tú)` : p.name))
                      .join(" · ")
                  : error
                    ? "No se pudieron cargar los nombres"
                    : "Cargando participantes…"}
              </span>
            </span>
            {onSelect ? (
              <ChevronDown className={open ? "rotated" : ""} size={19} />
            ) : (
              <ChevronRight size={19} />
            )}
          </>
        );
        return (
          <article
            className={`panel group-list-card ${open ? "expanded" : ""}`}
            key={g.id}
          >
            {onSelect ? (
              <button
                className="group-summary"
                aria-label={`Ver detalles de ${g.name}`}
                aria-expanded={open}
                aria-controls={`group-details-${g.id}`}
                onClick={() => onSelect(open ? "" : g.id)}
              >
                {content}
              </button>
            ) : (
              <Link
                className="group-summary"
                to={`/grupos?group=${encodeURIComponent(g.id)}`}
              >
                {content}
              </Link>
            )}
            {error && (
              <p className="group-list-error" role="alert">
                {error}{" "}
                <button
                  className="text-button"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  Reintentar nombres
                </button>
              </p>
            )}
            {onSelect && (
              <div id={`group-details-${g.id}`} hidden={!open}>
                {open && details?.(g, people || [])}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
