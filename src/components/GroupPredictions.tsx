import {
  collection,
  documentId,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { Check, Trophy, X } from "lucide-react";
import { Link } from "react-router-dom";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  hasMatchStarted,
  matchStatusLabel,
  outcome,
  predictionSummary,
  type Match,
  type Mode,
  type PredictionValue,
} from "../lib/domain";
import type { Participant } from "../lib/data";
import { db } from "../lib/firebase";
import { kickoffLabel } from "../lib/matchInsights";
import { Team, readableError } from "./ui";
import TeamForm from "./TeamForm";
import { finishedMatchResult } from "../lib/matchResult";
import { decodeDelivery } from "../lib/roundDelivery";
import { LiveEvents, LiveMinute } from "./LiveStatus";
import ShareTrigger from "./ShareTrigger";
import {
  pickPoints,
  pickState,
  roundBoard,
  roundHasStarted,
  type RoundPlayer,
  type ScoreMode,
} from "../lib/roundBoard";
import { shareFileName } from "../lib/shareSummary";

const ShareDialog = lazy(() => import("./ShareDialog"));

type SharedEntries = Record<string, Record<string, PredictionValue>>;
export default function GroupPredictions({
  matches,
  history,
  participants,
  userId,
  groupId,
  seasonId,
  roundId,
  clock,
  demo,
  ownValues,
  sealed = false,
  missed = false,
  loadingOwn = false,
  canShare,
  completedIds,
  mode,
  groupName,
  roundTitle,
  onOpen,
}: {
  matches: Match[];
  history: Match[];
  participants: Participant[];
  userId: string;
  groupId: string;
  seasonId: string;
  roundId: string;
  clock: number;
  demo: boolean;
  ownValues: Record<string, PredictionValue>;
  sealed?: boolean;
  /** The round closed without your slip: same board, nothing of yours. */
  missed?: boolean;
  loadingOwn?: boolean;
  canShare: boolean;
  completedIds: string[];
  mode: Mode;
  groupName: string;
  roundTitle: string;
  /** Opens the match page (keeping the round to come back to). */
  onOpen?: (id: string, from: Element | null) => void;
}) {
  const [sharing, setSharing] = useState(false);
  const [entries, setEntries] = useState<SharedEntries>({});
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const membersKey = participants
    .filter((p) => p.id !== userId)
    .map((p) => p.id)
    .sort();
  const membersQueryKey = JSON.stringify(membersKey);
  // Inside an <Activity>: a revealed page keeps what it showed while resubscribing.
  const lastKey = useRef("");
  useEffect(() => {
    const key = JSON.stringify([canShare, membersQueryKey, groupId, seasonId, roundId, demo, userId, attempt]);
    const changed = lastKey.current !== key;
    lastKey.current = key;
    if (changed) {
      setEntries({});
      setReady(false);
      setError("");
      setPending(false);
    }
    if (!canShare) return;
    if (membersQueryKey === "[]") {
      setReady(true);
      return;
    }
    if (demo) {
      setEntries(
        Object.fromEntries(
          completedIds
            .filter((id) => id !== userId)
            .map((id, i) => [
              id,
              Object.fromEntries(
                matches.map((m) => [
                  m.id,
                  (["1", "X", "2"] as const)[(i + m.id.length) % 3],
                ]),
              ),
            ]),
        ),
      );
      setReady(true);
      return;
    }
    if (!db) return;
    if (changed) setPending(true);
    // One round listener shares each immutable entry across all fixture cards.
    return onSnapshot(
      query(
        collection(
          db,
          "groups",
          groupId,
          "gameSeasons",
          seasonId,
          "roundEntries",
          roundId,
          "players",
        ),
        where(documentId(), "in", JSON.parse(membersQueryKey)),
      ),
      (snap) => {
        try {
          setEntries(
            Object.fromEntries(
              snap.docs.map((d) => [d.id, decodeDelivery(d.data())]),
            ),
          );
          setError("");
        } catch (e) {
          setEntries({});
          setError(readableError(e));
        }
        setPending(false);
        setReady(true);
      },
      (e) => {
        setError(readableError(e));
        setPending(false);
        setReady(true);
      },
    );
  }, [
    canShare,
    membersQueryKey,
    groupId,
    seasonId,
    roundId,
    demo,
    userId,
    attempt,
  ]);
  // Own delivery first, then every teammate who also delivered (reciprocal privacy).
  const players = useMemo((): RoundPlayer[] => {
    if (!canShare || !ready || error) return [];
    const me = participants.find((p) => p.id === userId);
    return [
      { id: userId, name: me?.name || "Tú", picks: ownValues },
      ...participants
        .filter(
          (p) =>
            p.id !== userId && completedIds.includes(p.id) && entries[p.id],
        )
        .map((p) => ({ id: p.id, name: p.name, picks: entries[p.id] })),
    ];
  }, [
    canShare,
    ready,
    error,
    participants,
    userId,
    ownValues,
    completedIds,
    entries,
  ]);
  const board = useMemo(
    () => roundBoard(matches, mode, players),
    [matches, mode, players],
  );
  const shareReady = players.length > 0 && !loadingOwn && !pending;
  const share = { groupName, title: roundTitle, mode, matches, players, demo };
  return (
    <section className="group-predictions" aria-label="Pronósticos del grupo">
      <div className="group-view-heading">
        <div className="group-view-title">
          <span className="eyebrow">
            {missed ? "Jornada cerrada sin tu boleto" : "Tu boleto y el de los demás"}
          </span>
          <h2 tabIndex={-1}>El grupo</h2>
        </div>
        {sealed && (
          <span className="sealed-stamp" role="status">
            Sellada
          </span>
        )}
        <span className="group-view-actions">
          {canShare && (
            <ShareTrigger
              label="Compartir quiniela"
              disabled={!shareReady}
              onClick={() => setSharing(true)}
            />
          )}
        </span>
      </div>
      {missed && (
        <p className="group-view-note">
          No sellaste esta jornada: no suma puntos y los boletos del grupo solo
          se ven entre quienes sellan.
        </p>
      )}
      {shareReady && roundHasStarted(matches) && (
        <RoundBoardPanel
          rows={board}
          userId={userId}
          live={matches.some((m) => ["IN_PLAY", "PAUSED"].includes(m.status))}
        />
      )}
      {sharing && (
        <Suspense fallback={null}>
          <ShareDialog
            title={`Quiniela · ${roundTitle}`}
            filename={shareFileName("quiniela", groupName, roundTitle)}
            text={`Quiniela · ${roundTitle}`}
            render={() =>
              import("../lib/shareImage").then((m) => m.quinielaImage(share))
            }
            onClose={() => setSharing(false)}
          />
        </Suspense>
      )}
      {matches.map((m) => (
        <RivalsCard
          key={m.id}
          match={m}
          history={history}
          participants={participants}
          userId={userId}
          started={hasMatchStarted(m, clock)}
          canShare={canShare}
          ownValue={ownValues[m.id]}
          loadingOwn={loadingOwn}
          entries={canShare ? entries : {}}
          pending={pending}
          ready={ready}
          error={error}
          completedIds={completedIds}
          mode={mode}
          onRetry={() => setAttempt((n) => n + 1)}
          onOpen={onOpen}
        />
      ))}
    </section>
  );
}

export function RoundBoardPanel({
  rows,
  userId,
  live,
}: {
  rows: ReturnType<typeof roundBoard>;
  userId: string;
  live: boolean;
}) {
  return (
    <section className="panel round-board" aria-label="Puntos de la jornada">
      <header className="round-board-heading">
        <h3>Puntos de la jornada</h3>
        <small>
          {live ? (
            <>
              <i className="live-dot" aria-hidden="true" /> Provisional · en
              directo
            </>
          ) : (
            "Provisional"
          )}
        </small>
      </header>
      <ol>
        {rows.map((r) => (
          <li key={r.id} className={r.id === userId ? "is-me" : undefined}>
            <span className="rb-pos">{r.position}</span>
            <span className="rb-name">
              {r.name}
              {r.id === userId && <small> · Tú</small>}
            </span>
            <span className="rb-hits">
              {r.hits} {r.hits === 1 ? "acierto" : "aciertos"}
            </span>
            <span className="rb-points">
              <b>{r.points}</b> pts
              {r.livePoints > 0 && (
                <span className="rb-live" title="Si terminaran así">
                  +{r.livePoints}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
/**
 * One fixture of a board: the real match first (teams and the score that
 * decides the picks), then whatever picks go with it. Tapping the match opens
 * its ficha.
 */
export function GroupMatchCard({
  match,
  history,
  started,
  to,
  onOpen,
  plainResult = false,
  children,
}: {
  match: Match;
  history: Match[];
  started: boolean;
  /** The match page; without it the fixture is a button for `onOpen`. */
  to?: string;
  onOpen?: (id: string, from: Element | null) => void;
  /** Friends' matches (any sport): no «a 90 minutos». */
  plainResult?: boolean;
  children: ReactNode;
}) {
  const live = ["IN_PLAY", "PAUSED"].includes(match.status);
  const finished = match.status === "FINISHED";
  const scheduled = ["TIMED", "SCHEDULED"].includes(match.status);
  const result = finishedMatchResult(match);
  const score =
    match.homeScore !== null && match.awayScore !== null && (live || finished)
      ? { home: match.homeScore, away: match.awayScore }
      : null;
  const sign = score ? outcome(score.home, score.away) : null;
  const label = `${scheduled && !plainResult ? "Previa" : "Ficha"} de ${match.home} contra ${match.away}`;
  const fixture = (
    <>
      <div className="saved-team">
        <Team name={match.home} crest={match.homeCrest} part="home-crest" />
        <TeamForm match={match} side="home" matches={history} />
      </div>
      <div
        className={`gm-score${live ? " is-live" : ""}${score ? "" : " is-pending"}`}
        data-vt-part="score"
      >
        <strong
          aria-label={
            score
              ? `${live ? "Marcador en juego" : plainResult ? "Resultado" : "Resultado a 90 minutos"}: ${score.home} a ${score.away}`
              : "Sin resultado todavía"
          }
        >
          {score ? `${score.home} – ${score.away}` : "vs"}
        </strong>
        {sign && (
          <small>
            {live ? "Ahora" : "Signo"} <b>{sign}</b>
          </small>
        )}
      </div>
      <div className="saved-team">
        <Team name={match.away} crest={match.awayCrest} part="away-crest" />
        <TeamForm match={match} side="away" matches={history} />
      </div>
    </>
  );
  return (
    <article className="group-match-card" data-vt-match={match.id}>
      <header className="saved-match-heading">
        <time dateTime={match.utcDate}>{kickoffLabel(match.utcDate)}</time>
        <span className={`saved-match-status${live ? " is-live" : ""}`}>
          {scheduled ? (
            started ? (
              "Esperando el resultado"
            ) : (
              "Aún no ha rodado el balón"
            )
          ) : live ? (
            <LiveMinute match={match} />
          ) : (
            matchStatusLabel[match.status] || match.status
          )}
        </span>
      </header>
      {to ? (
        <Link
          className="gm-fixture"
          to={to}
          aria-label={label}
          onClick={
            onOpen &&
            ((event) => {
              event.preventDefault();
              onOpen(match.id, event.currentTarget.closest("article"));
            })
          }
        >
          {fixture}
        </Link>
      ) : (
        <button
          type="button"
          className="gm-fixture"
          aria-label={label}
          onClick={(event) =>
            onOpen?.(match.id, event.currentTarget.closest("article"))
          }
        >
          {fixture}
        </button>
      )}
      {result?.extended && result.winnerName && (
        <p className="gm-decision">
          <Trophy size={13} aria-hidden="true" />
          Pasa {result.winnerName} {result.decision.toLowerCase()}.{" "}
          {plainResult
            ? "Los pronósticos cuentan el marcador sin los penaltis."
            : "La quiniela cuenta el resultado a 90 minutos."}
        </p>
      )}
      <LiveEvents match={match} />
      {children}
    </article>
  );
}

function RivalsCard({
  match,
  history,
  participants,
  userId,
  started,
  canShare,
  ownValue,
  loadingOwn,
  entries,
  pending,
  ready,
  error,
  completedIds,
  mode,
  onRetry,
  onOpen,
}: {
  match: Match;
  history: Match[];
  participants: Participant[];
  userId: string;
  started: boolean;
  canShare: boolean;
  ownValue?: PredictionValue;
  loadingOwn: boolean;
  entries: SharedEntries;
  pending: boolean;
  ready: boolean;
  error: string;
  completedIds: string[];
  mode: Mode;
  onRetry: () => void;
  onOpen?: (id: string, from: Element | null) => void;
}) {
  const visible = participants.filter(
    (p) => p.id !== userId && completedIds.includes(p.id),
  );
  return (
    <GroupMatchCard
      match={match}
      history={history}
      started={started}
      to={`/partido/${encodeURIComponent(match.id)}`}
      onOpen={onOpen}
    >
      {/* Then every pick of the group against that score. */}
      <section className="gm-picks" aria-label="Pronósticos del grupo">
        <ul className="gm-pick-list">
          <PickRow
            name="Tú"
            me
            match={match}
            mode={mode}
            value={ownValue}
            loading={loadingOwn}
          />
          {canShare &&
            ready &&
            !pending &&
            !error &&
            visible.map((person) => (
              <PickRow
                key={person.id}
                name={person.name}
                match={match}
                mode={mode}
                value={entries[person.id]?.[match.id]}
              />
            ))}
        </ul>
        {canShare &&
          (pending || !ready ? (
            <p className="gm-picks-loading" role="status">
              <span className="sr-only">Cargando pronósticos</span>
              <span className="skeleton" aria-hidden="true" />
            </p>
          ) : error ? (
            <div className="rivals-error">
              <p role="alert">{error}</p>
              <button className="button secondary" onClick={onRetry}>
                Volver a intentar
              </button>
            </div>
          ) : (
            !visible.length && (
              <p className="gm-picks-note">
                Nadie más ha sellado todavía. Sus signos saldrán aquí.
              </p>
            )
          ))}
      </section>
    </GroupMatchCard>
  );
}

/** One person's pick: the sign, what it means and how it went. */
export function PickRow({
  name,
  me = false,
  match,
  mode,
  value,
  loading = false,
}: {
  name: string;
  me?: boolean;
  match: Match;
  mode: ScoreMode;
  value?: PredictionValue;
  loading?: boolean;
}) {
  const sign = value
    ? typeof value === "string"
      ? value
      : outcome(value.home, value.away)
    : null;
  const meaning =
    sign === "1"
      ? `Gana ${match.home}`
      : sign === "2"
        ? `Gana ${match.away}`
        : sign === "X"
          ? "Empate"
          : "Sin pronóstico";
  const state = pickState(mode, value, match);
  const points = pickPoints(mode, value, match);
  const verdict =
    state === "hit"
      ? `+${points} ${points === 1 ? "pto" : "ptos"}`
      : state === "miss"
        ? "Fallo"
        : state === "live-hit"
          ? "Acertando"
          : state === "live-miss"
            ? "Fallando"
            : "";
  return (
    <li
      className={`gm-pick${me ? " is-me" : ""}${state ? ` is-${state}` : ""}${value ? "" : " is-missing"}`}
      aria-busy={loading}
    >
      <span className="gm-pick-name" title={name}>
        {name}
      </span>
      {loading ? (
        <span className="gm-pick-what">
          <span className="skeleton gm-pick-skeleton" aria-hidden="true" />
          <span className="sr-only">Cargando tu pronóstico</span>
        </span>
      ) : (
        <span className="gm-pick-what">
          <b className="gm-pick-sign">
            {value ? predictionSummary(value) : "—"}
          </b>
          <span className="gm-pick-meaning" title={meaning}>
            {meaning}
          </span>
        </span>
      )}
      <span className="gm-pick-verdict">
        {(state === "hit" || state === "live-hit") && (
          <Check size={13} strokeWidth={3} aria-hidden="true" />
        )}
        {(state === "miss" || state === "live-miss") && (
          <X size={13} strokeWidth={3} aria-hidden="true" />
        )}
        {verdict}
      </span>
    </li>
  );
}
