import { Check, Search, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  followCompetition,
  searchPublicCompetitions,
  type PublicCompetition,
} from "../lib/customCompetitionData";
import { haptic } from "../lib/motion";
import type { AppUser } from "../lib/session";
import { CompetitionBadge } from "./CustomChips";
import Modal from "./Modal";
import { SkeletonRows } from "./Skeleton";
import { readableError } from "./ui";
import "../styles/leagueSearch.css";

const MODE_LABEL: Record<PublicCompetition["predictionMode"], string | null> = {
  exact: "Quiniela de marcador",
  classic: "Quiniela 1X2",
  off: null,
};
const followers = (n: number) => `${n} ${n === 1 ? "seguidor" : "seguidores"}`;

/**
 * The magnifier's sheet: public competitions by name or sport. «Seguir» adds
 * one to your list (it then shows next to LaLiga, Champions and Premier);
 * tapping the rest of the row opens it. Private ones never show here.
 */
export default function CompetitionSearch({
  user,
  onLogin,
  onOpen,
  onClose,
}: {
  user: AppUser | null;
  onLogin: () => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const uid = user?.uid || "";
  const [text, setText] = useState("");
  const [state, setState] = useState<{ query: string; list: PublicCompetition[] } | null>(null);
  const [error, setError] = useState("");
  const [following, setFollowing] = useState<Record<string, "busy" | "done">>({});
  // A pause between keystrokes before asking; the latest answer wins.
  const asked = useRef(0);
  useEffect(() => {
    if (!uid) return;
    const query = text.trim();
    const ticket = ++asked.current;
    const timer = window.setTimeout(
      () =>
        void searchPublicCompetitions(query).then(
          (list) => {
            if (ticket !== asked.current) return;
            setError("");
            setState({ query, list });
          },
          (e) => {
            if (ticket !== asked.current) return;
            setError(readableError(e));
            setState({ query, list: [] });
          },
        ),
      query ? 280 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [text, uid]);

  async function follow(c: PublicCompetition) {
    if (!uid) return onLogin();
    haptic();
    setFollowing((f) => ({ ...f, [c.id]: "busy" }));
    try {
      await followCompetition(uid, c.id);
      haptic("success");
      setFollowing((f) => ({ ...f, [c.id]: "done" }));
    } catch (e) {
      haptic("warning");
      setError(readableError(e));
      setFollowing(({ [c.id]: _, ...rest }) => rest);
    }
  }

  const query = text.trim();
  const loading = !state || state.query !== query;
  const list = state?.list || [];
  return (
    <Modal title="Buscar ligas" onClose={onClose} detents={["large"]} className="league-search-sheet">
      {!uid ? (
        <div className="league-search-guest">
          <p className="muted">Entra con tu cuenta para buscar ligas públicas de otros y seguirlas.</p>
          <button
            type="button"
            className="button primary full"
            onClick={() => {
              onClose();
              onLogin();
            }}
          >
            Entrar
          </button>
        </div>
      ) : (
        <>
          <form
            role="search"
            className="league-search-field"
            onSubmit={(e) => {
              e.preventDefault();
              (document.activeElement as HTMLElement | null)?.blur();
            }}
          >
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={text}
              aria-label="Nombre o deporte"
              placeholder="Nombre o deporte"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
            />
          </form>
          <p className="league-search-caption">{query ? "Resultados" : "Ligas públicas"}</p>
          {loading && !list.length ? (
            <SkeletonRows rows={3} variant="line" label="Buscando ligas" />
          ) : list.length ? (
            <ul className="league-search-results" aria-busy={loading || undefined}>
              {list.map((c) => {
                const mine = Boolean(uid && c.memberIds.includes(uid)) || following[c.id] === "done";
                const mode = MODE_LABEL[c.predictionMode];
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="league-search-open"
                      onClick={() => {
                        haptic();
                        onClose();
                        onOpen(c.id);
                      }}
                    >
                      <CompetitionBadge icon={c.icon} name={c.name} small={false} />
                      <span className="league-search-text">
                        <strong>{c.name}</strong>
                        <span>
                          {[c.sport, mode].filter(Boolean).join(" · ") || "Competición"}
                        </span>
                        <span className="league-search-count">
                          <Users size={13} aria-hidden="true" />
                          {followers(c.followers + (following[c.id] === "done" ? 1 : 0))}
                        </span>
                      </span>
                    </button>
                    {mine ? (
                      <span className="league-search-followed">
                        <Check size={15} aria-hidden="true" /> Siguiendo
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="league-search-follow"
                        disabled={following[c.id] === "busy"}
                        aria-label={`Seguir ${c.name}`}
                        onClick={() => void follow(c)}
                      >
                        {following[c.id] === "busy" ? "…" : "Seguir"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="league-search-empty">
              <strong>{query ? `Nada con «${query}»` : "Aún no hay ligas públicas"}</strong>
              <p className="muted">
                {query
                  ? "Prueba con otra palabra del nombre o con el deporte."
                  : "Cuando alguien haga pública la suya aparecerá aquí."}
              </p>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p className="footnote league-search-note">
            Las ligas privadas no salen aquí: solo se entra con su código, su enlace o el QR.
          </p>
        </>
      )}
    </Modal>
  );
}
