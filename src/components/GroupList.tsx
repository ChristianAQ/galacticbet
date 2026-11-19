import {
  ChevronDown,
  ChevronRight,
  Coins,
  Copy,
  Share2,
  Target,
  Trophy,
  UserPlus,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { loadParticipants, type Group, type Participant } from "../lib/data";
import { readableError } from "./ui";
import { euroShort, groupPotCents } from "../lib/pot";
import { go } from "../lib/navigation";
import { haptic } from "../lib/motion";
import SwipeRow from "./SwipeRow";
import { menuTarget } from "./ContextMenu";
import "../styles/profile.css";

/** Invite link that opens the join sheet with the code already filled in. */
export function inviteLink(groupId: string) {
  return `${location.origin}${location.pathname}#/grupos?join=1&code=${encodeURIComponent(groupId)}`;
}
/** Copies the invite link and returns the line to show the user. */
export async function copyInvite(groupId: string) {
  try {
    await navigator.clipboard.writeText(inviteLink(groupId));
    haptic("success");
    return "Enlace de invitación copiado. Pásalo por el chat del grupo.";
  } catch {
    haptic("warning");
    return "No se pudo copiar. Comparte el código que aparece en el grupo.";
  }
}
/** Native share sheet with the invite; falls back to the clipboard. */
export async function shareInvite(group: Pick<Group, "id" | "name">) {
  const url = inviteLink(group.id);
  if (navigator.share) {
    try {
      await navigator.share({
        title: `Únete a ${group.name}`,
        text: `Te guardo sitio en «${group.name}» de GalacticBet. Entra con este enlace:`,
        url,
      });
      return "";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "";
    }
  }
  return copyInvite(group.id);
}

export default function GroupList({
  groups,
  uid,
  selected,
  onSelect,
  details,
  onNotify,
}: {
  groups: Group[];
  uid: string;
  selected?: string;
  onSelect?: (id: string) => void;
  details?: (group: Group, people: Participant[]) => ReactNode;
  /** Where swipe and menu actions report what happened. */
  onNotify?: (message: string) => void;
}) {
  const key = JSON.stringify(groups.map((g) => [g.id, g.memberIds]));
  const [state, setState] = useState<{
    key: string;
    people: Record<string, Participant[]>;
    errors: Record<string, string>;
  }>({ key: "", people: {}, errors: {} });
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState("");
  const notify = (message: string) => {
    if (!message) return;
    if (onNotify) onNotify(message);
    else setNotice(message);
  };
  // Pages are kept alive in hidden <Activity> boundaries: effects re-run when
  // the page is shown again, so only reload when the groups actually changed.
  const loaded = useRef("");
  useEffect(() => {
    const token = `${key}|${retry}`;
    if (loaded.current === token) return;
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
    ).then(() => {
      if (active) loaded.current = token;
    });
    return () => {
      active = false;
    };
  }, [key, retry]);
  return (
    <div className="group-list">
      {!onNotify && notice && (
        <p className="form-message" role="status">
          {notice}
        </p>
      )}
      {groups.map((g) => {
        const people = state.key === key ? state.people[g.id] : undefined;
        const error = state.key === key ? state.errors[g.id] : undefined;
        const open = selected === g.id;
        const pot = groupPotCents(g);
        const quiniela = `/quiniela?group=${encodeURIComponent(g.id)}`;
        const table = `/clasificacion?group=${encodeURIComponent(g.id)}`;
        const menu = menuTarget(() => ({
          title: g.name,
          items: [
            {
              label: "Hacer quiniela",
              icon: <Target size={18} aria-hidden="true" />,
              onSelect: () => go(quiniela),
            },
            {
              label: "Ver clasificación",
              icon: <Trophy size={18} aria-hidden="true" />,
              onSelect: () => go(table),
            },
            {
              label: "Copiar invitación",
              icon: <Copy size={18} aria-hidden="true" />,
              onSelect: () => void copyInvite(g.id).then(notify),
            },
            {
              label: "Compartir invitación",
              icon: <Share2 size={18} aria-hidden="true" />,
              onSelect: () => void shareInvite(g).then(notify),
            },
          ],
        }));
        const content = (
          <>
            <span className="group-monogram" aria-hidden="true">
              {g.name.trim().charAt(0).toUpperCase() || "G"}
            </span>
            <span className="group-summary-body">
              <strong>{g.name}</strong>
              <span className="group-summary-meta">
                {g.memberIds.length}{" "}
                {g.memberIds.length === 1 ? "jugador" : "jugadores"} ·{" "}
                {g.ownerId === uid ? "Administras tú" : "Miembro"}
                {pot > 0 && (
                  <span className="group-row-pot">
                    <Coins size={12} aria-hidden="true" />
                    {euroShort(pot)}
                  </span>
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
                    : "Llamando a la plantilla…"}
              </span>
            </span>
            {onSelect ? (
              <ChevronDown
                className={`group-chevron${open ? " rotated" : ""}`}
                size={20}
                aria-hidden="true"
              />
            ) : (
              <ChevronRight className="group-chevron" size={20} aria-hidden="true" />
            )}
          </>
        );
        return (
          <article className={`group-row${open ? " is-open" : ""}`} key={g.id}>
            <SwipeRow
              actions={[
                {
                  label: "Invitar",
                  tone: "accent",
                  icon: <UserPlus size={20} aria-hidden="true" />,
                  onAction: () => void copyInvite(g.id).then(notify),
                },
                {
                  label: "Tabla",
                  icon: <Trophy size={20} aria-hidden="true" />,
                  onAction: () => go(table),
                },
              ]}
            >
              {onSelect ? (
                <button
                  ref={menu}
                  type="button"
                  className="group-summary"
                  aria-label={`${open ? "Ocultar" : "Ver"} detalles de ${g.name}`}
                  aria-expanded={open}
                  aria-controls={`group-details-${g.id}`}
                  onClick={() => {
                    haptic();
                    onSelect(open ? "" : g.id);
                  }}
                >
                  {content}
                </button>
              ) : (
                <Link
                  ref={menu}
                  className="group-summary"
                  to={`/grupos?group=${encodeURIComponent(g.id)}`}
                >
                  {content}
                </Link>
              )}
            </SwipeRow>
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
              <div
                id={`group-details-${g.id}`}
                className="group-details"
                hidden={!open}
              >
                {open && details?.(g, people || [])}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
