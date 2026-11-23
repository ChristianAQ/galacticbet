import { Crown, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { roundKey, toAppMatch, type Competition, type CompetitionView, type ResolvedMatch } from "../lib/customCompetition";
import {
  followCompetition,
  loadMyPicks,
  loadStartedPicks,
  savePick,
  usePeople,
} from "../lib/customCompetitionData";
import {
  canPick,
  decodePick,
  encodePick,
  pickHit,
  pickLabel,
  pickPoints,
  pickRanking,
  type PickMap,
} from "../lib/customPicks";
import type { Match, PredictionValue } from "../lib/domain";
import { haptic } from "../lib/motion";
import type { AppUser } from "../lib/session";
import { FixtureButton } from "./CustomCompetition";
import PredictionCard from "./PredictionCard";
import { MyRankCard, RankAvatar, RankBadge } from "./RankingWidgets";
import { SkeletonRows } from "./Skeleton";
import { Empty, readableError } from "./ui";
import "../styles/standings.css";

const OPEN_ROUNDS = 2;
const OPEN_LIMIT = 16;

function useClock(step = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), step);
    return () => window.clearInterval(id);
  }, [step]);
  return now;
}

/**
 * Everyone's picks for started matches (fetched once per match and cached)
 * and yours for the ones still open.
 */
export function useCompetitionPicks(competition: Competition, view: CompetitionView, uid: string) {
  const now = useClock();
  const started = useMemo(
    () => view.matches.filter((m) => m.startAt <= now && m.status !== "cancelled"),
    [view.matches, now],
  );
  const open = useMemo(() => {
    const list = view.matches.filter((m) => canPick(competition, m, now));
    const rounds = [...new Set(list.map(roundKey))].slice(0, OPEN_ROUNDS);
    return list.filter((m) => rounds.includes(roundKey(m))).slice(0, OPEN_LIMIT);
  }, [view.matches, competition, now]);
  const startedKey = started.map((m) => `${m.id}@${m.startAt}`).join();
  const openKey = open.map((m) => m.id).join();
  const [revealed, setRevealed] = useState<Record<string, PickMap> | null>(null);
  const [mine, setMine] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!uid) return setRevealed({});
    let live = true;
    void loadStartedPicks(competition.id, started).then((r) => live && setRevealed(r));
    return () => {
      live = false;
    };
    // `started` changes identity every tick; its key only when a match starts or moves.
  }, [competition.id, uid, startedKey]);
  useEffect(() => {
    if (!uid) return setMine({});
    let live = true;
    loadMyPicks(competition.id, openKey ? openKey.split(",") : [], uid).then(
      (r) => live && setMine((prev) => ({ ...r, ...pendingOnly(prev, r) })),
      () => live && setMine((prev) => prev || {}),
    );
    return () => {
      live = false;
    };
  }, [competition.id, uid, openKey]);
  return { now, started, open, revealed, mine, setMine };
}
// Keep picks saved in this session that the server read may have missed.
function pendingOnly(prev: Record<string, string> | null, fresh: Record<string, string>) {
  if (!prev) return {};
  return Object.fromEntries(Object.entries(prev).filter(([id]) => !(id in fresh)));
}

/** «Pronósticos»: your picks for what's next, the table and your history. */
export default function CustomPicks({
  competition: c,
  view,
  user,
  onOpen,
  onLogin,
}: {
  competition: Competition;
  view: CompetitionView;
  user: AppUser | null;
  onOpen: (id: string) => void;
  onLogin: () => void;
}) {
  const uid = user?.uid || "";
  const { open, started, revealed, mine, setMine } = useCompetitionPicks(c, view, uid);
  const following = Boolean(uid && c.memberIds.includes(uid));
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [joining, setJoining] = useState(false);
  const predictors = useMemo(
    () => [...new Set([...c.memberIds, ...Object.values(revealed || {}).flatMap((p) => Object.keys(p))])],
    [c.memberIds, revealed],
  );
  const people = usePeople(uid ? predictors : []);
  const rows = useMemo(
    () =>
      revealed
        ? pickRanking(
            view.matches,
            revealed,
            predictors.map((id) => people[id] || { id, name: "Jugador", avatar: null }),
          )
        : null,
    [revealed, view.matches, predictors, people],
  );
  const appMatches = useMemo(
    () => Object.fromEntries(open.map((m) => [m.id, toAppMatch(c.id, m)])),
    [open, c.id],
  );
  const byId = useMemo(() => new Map(view.matches.map((m) => [m.id, m])), [view.matches]);
  const onChoose = useCallback(
    async (match: Match, value: PredictionValue) => {
      const mid = match.id;
      const raw = encodePick(value);
      if (!uid || !following) return;
      if (mine?.[mid] === raw) return;
      const before = mine?.[mid];
      setMine((m) => ({ ...(m || {}), [mid]: raw }));
      setSaving((s) => ({ ...s, [mid]: true }));
      try {
        await savePick(c.id, mid, uid, raw);
        haptic("success");
      } catch (e) {
        setMine((m) => {
          const next = { ...(m || {}) };
          if (before) next[mid] = before;
          else delete next[mid];
          return next;
        });
        setNotice(
          (e as { code?: string })?.code === "permission-denied"
            ? "No se guardó: el partido ya ha empezado o ha cambiado. Revisa el calendario."
            : readableError(e),
        );
      } finally {
        setSaving((s) => ({ ...s, [mid]: false }));
      }
    },
    [c.id, uid, following, mine, setMine],
  );
  const onDetails = useCallback((id: string) => onOpen(id), [onOpen]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (!user)
    return (
      <Empty
        art="podium"
        title="Pronostica con tus amigos"
        action={
          <button type="button" className="button primary" onClick={onLogin}>
            Entrar para pronosticar
          </button>
        }
      >
        Acierta los resultados antes de que empiece cada partido y compite en la clasificación de pronósticos.
      </Empty>
    );

  const history = started
    .filter((m) => revealed?.[m.id]?.[uid])
    .sort((a, b) => b.startAt - a.startAt)
    .slice(0, 30);
  const mode = c.predictionMode === "exact" ? "exact" : "classic";
  const hasPoints = Boolean(rows?.some((r) => r.points > 0));
  const leader = rows?.[0]?.points || 0;
  const showExact = mode === "exact" || Boolean(rows?.some((r) => r.exact > 0));
  return (
    <div className="custom-picks">
      {notice && (
        <p className="league-toast" role="status">
          {notice}
        </p>
      )}
      {!following && (
        <section className="custom-picks-join">
          <p>Para pronosticar, primero sigue la competición.</p>
          <button
            type="button"
            className="button primary"
            disabled={joining}
            onClick={async () => {
              setJoining(true);
              try {
                await followCompetition(uid, c.id);
                haptic("success");
              } catch (e) {
                setNotice(readableError(e));
              } finally {
                setJoining(false);
              }
            }}
          >
            <Plus size={17} aria-hidden="true" /> Seguir
          </button>
        </section>
      )}
      {rows && following && <MyRankCard rows={rows} userId={uid} showHits />}

      <section className="custom-manage-section" aria-labelledby="picks-next">
        <div className="section-heading">
          <h2 id="picks-next">Próximos partidos</h2>
          {open.length > 0 && (
            <span className="cc-count">
              {open.filter((m) => mine?.[m.id]).length}/{open.length}
            </span>
          )}
        </div>
        {mine === null ? (
          <SkeletonRows rows={3} variant="card" label="Cargando tus pronósticos" />
        ) : open.length ? (
          <div className="prediction-list slip" aria-label="Tus pronósticos">
            {open.map((m, index) => (
              <PredictionCard
                key={m.id}
                number={index + 1}
                match={appMatches[m.id]}
                history={[]}
                value={mine[m.id] ? decodePick(mine[m.id]) ?? undefined : undefined}
                mode={mode}
                lock={null}
                disabled={!following}
                saving={Boolean(saving[m.id])}
                demo={false}
                onChoose={onChoose}
                onDetails={onDetails}
                detailsLabel="Ficha del partido"
              />
            ))}
          </div>
        ) : (
          <p className="muted custom-picks-empty">
            No hay partidos abiertos: se puede pronosticar cuando se conocen los dos rivales y hasta que empieza el
            partido.
          </p>
        )}
        {open.length > 0 && (
          <p className="league-hint">
            {mode === "exact"
              ? "Marcador exacto: 3 puntos; solo quién gana o el empate: 1."
              : "1X2: 1 punto por acierto."}{" "}
            Se cierra al empezar cada partido y nadie ve los pronósticos de los demás hasta entonces.
          </p>
        )}
      </section>

      <section className="standings-card" aria-labelledby="picks-table" hidden={!rows?.length}>
        <header className="standings-heading">
          <h2 id="picks-table">Clasificación de pronósticos</h2>
          <span>
            {rows?.length} {rows?.length === 1 ? "jugador" : "jugadores"}
          </span>
        </header>
        {rows && (
          <table className="standings-table">
            <caption className="sr-only">Clasificación de pronósticos de {c.name}</caption>
            <thead>
              <tr>
                <th scope="col">Pos.</th>
                <th scope="col">Jugador</th>
                {showExact && (
                  <th scope="col" title="Marcadores exactos">
                    Ex.
                  </th>
                )}
                <th scope="col" title="Aciertos">
                  Ac.
                </th>
                <th scope="col">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.id === uid ? "standings-me" : undefined}>
                  <td>
                    <span className="standings-position">
                      <RankBadge position={r.position} />
                    </span>
                  </td>
                  <th scope="row">
                    <span className="standings-player">
                      <RankAvatar name={r.name} avatar={r.avatar} />
                      <span className="standings-name">
                        <span>
                          {r.position === 1 && hasPoints && (
                            <Crown className="standings-crown" size={14} strokeWidth={2.4} aria-label="Líder" />
                          )}
                          {r.name}
                          {r.id === uid && <small> · Tú</small>}
                        </span>
                        <span className="standings-bar" aria-hidden="true">
                          <i style={{ transform: `scaleX(${leader ? r.points / leader : 0})` }} />
                        </span>
                      </span>
                    </span>
                  </th>
                  {showExact && <td>{r.exact}</td>}
                  <td>{r.hits}</td>
                  <td>
                    <strong>{r.points}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {history.length > 0 && (
        <section className="custom-manage-section" aria-labelledby="picks-history">
          <div className="section-heading">
            <h2 id="picks-history">Tu historial</h2>
          </div>
          <ul className="fixture-list">
            {history.map((m) => (
              <HistoryRow key={m.id} match={byId.get(m.id)!} competition={c} raw={revealed![m.id][uid]} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HistoryRow({
  match: m,
  competition,
  raw,
  onOpen,
}: {
  match: ResolvedMatch;
  competition: Competition;
  raw: string;
  onOpen: (id: string) => void;
}) {
  const points = pickPoints(raw, m);
  const hit = pickHit(raw, m);
  return (
    <FixtureButton
      match={m}
      competition={competition}
      onOpen={onOpen}
      extra={
        <span className={`custom-pick-line${hit ? ` is-${hit}` : ""}`}>
          Tu pronóstico <strong>{pickLabel(raw)}</strong>
          <em>
            {points === null
              ? m.status === "postponed"
                ? "Aplazado"
                : "Pendiente"
              : `${points > 0 ? "+" : ""}${points} ${points === 1 ? "punto" : "puntos"}`}
          </em>
        </span>
      }
    />
  );
}
