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
  type RoundPlayer,
  type ScoreMode,
} from "../lib/roundBoard";
import { shareFileName } from "../lib/shareSummary";
import { ghostPlayers } from "../lib/machinePicks";
import { useMachinePicks } from "../lib/useMachinePicks";
import RoundChances, { AiMark } from "./RoundChances";

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
  deadlineClosed = false,
  loadingOwn = false,
  canShare,
  completedIds,
  mode,
  groupName,
  roundTitle,
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
  /** Nobody can seal any more: «only you sealed», not «nobody yet». */
  deadlineClosed?: boolean;
  loadingOwn?: boolean;
  canShare: boolean;
  completedIds: string[];
  mode: Mode;
  groupName: string;
  roundTitle: string;
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
  // The others' slips: once yours is sealed, and for every member once the
  // round closes, sealed or not (nobody can change one any more).
  const canSee = canShare || deadlineClosed;
  // Inside an <Activity>: a revealed page keeps what it showed while resubscribing.
  const lastKey = useRef("");
  useEffect(() => {
    const key = JSON.stringify([canSee, membersQueryKey, groupId, seasonId, roundId, demo, userId, attempt]);
    const changed = lastKey.current !== key;
    lastKey.current = key;
    if (changed) {
      setEntries({});
      setReady(false);
      setError("");
      setPending(false);
    }
    if (!canSee) return;
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
    canSee,
    membersQueryKey,
    groupId,
    seasonId,
    roundId,
    demo,
    userId,
    attempt,
  ]);
  // Your delivery first (if you sealed), then every teammate who delivered.
  const players = useMemo((): RoundPlayer[] => {
    if (!canSee || !ready || error) return [];
    const me = participants.find((p) => p.id === userId);
    return [
      ...(sealed || canShare ? [{ id: userId, name: me?.name || "Tú", picks: ownValues }] : []),
      ...participants
        .filter(
          (p) =>
            p.id !== userId && completedIds.includes(p.id) && entries[p.id],
        )
        .map((p) => ({ id: p.id, name: p.name, picks: entries[p.id] })),
    ];
  }, [
    canSee,
    canShare,
    sealed,
    ready,
    error,
    participants,
    userId,
    ownValues,
    completedIds,
    entries,
  ]);
  // The market's chances frozen with the machines' slips, for «¿Quién se lleva la jornada?».
  // «IA» plays every round with its own slip: it shows when the others' do.
  const aiVisible = canSee;
  const machines = useMachinePicks([seasonId], aiVisible && !demo);
  const machineRound = machines.get(seasonId)?.rounds[roundId];
  // In a group it is one more line; alone, it is your rival.
  const rival = useMemo(
    () => (aiVisible ? ghostPlayers(machineRound, mode).find((g) => g.id === "ghost:ai") : undefined),
    [aiVisible, machineRound, mode],
  );
  const shareReady = players.length > 0 && !loadingOwn && !pending;
  const othersSealed = participants.filter(
    (p) => p.id !== userId && completedIds.includes(p.id),
  ).length;
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
        <p className="group-view-note">No sellaste esta jornada: no suma puntos.</p>
      )}
      {/* Said once for the whole round, not under every match. */}
      {canShare && ready && !pending && !error && !othersSealed && (
        <p className="group-view-note">
          {deadlineClosed
            ? "Solo tú sellaste esta jornada en el grupo."
            : "Nadie más del grupo ha sellado todavía: sus signos aparecerán aquí en cuanto lo hagan."}
        </p>
      )}
      {shareReady && (
        <RoundChances
          matches={matches}
          players={players}
          mode={mode}
          userId={userId}
          machineRound={machineRound}
          rival={rival}
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
          canShare={canSee}
          ownValue={ownValues[m.id]}
          loadingOwn={loadingOwn}
          entries={canSee ? entries : {}}
          pending={pending}
          ready={ready}
          error={error}
          completedIds={completedIds}
          mode={mode}
          aiValue={rival?.picks[m.id]}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ))}
    </section>
  );
}

/**
 * One fixture of a board: the real match first (teams and the score that
 * decides the picks), then whatever picks go with it. Tapping the match opens
 * its page (the app's link handling navigates and morphs the crests).
 */
export function GroupMatchCard({
  match,
  history,
  started,
  to,
  plainResult = false,
  children,
}: {
  match: Match;
  history: Match[];
  started: boolean;
  /** The match page. */
  to: string;
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
    <Link className="gm-fixture" to={to} aria-label={label}>
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
    </Link>
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
      {fixture}
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
  aiValue,
  onRetry,
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
  /** The AI's pick of this match, once you can see the others'. */
  aiValue?: PredictionValue;
  onRetry: () => void;
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
          {aiValue && <PickRow name="IA" ai match={match} mode={mode} value={aiValue} />}
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
          ) : null)}
      </section>
    </GroupMatchCard>
  );
}

/** One person's pick: the sign, what it means and how it went. */
export function PickRow({
  name,
  me = false,
  ai = false,
  match,
  mode,
  value,
  loading = false,
}: {
  name: string;
  me?: boolean;
  /** The AI's own slip: last, quieter, with its mark. */
  ai?: boolean;
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
      className={`gm-pick${me ? " is-me" : ""}${ai ? " is-ai" : ""}${state ? ` is-${state}` : ""}${value ? "" : " is-missing"}`}
      aria-busy={loading}
    >
      <span className="gm-pick-name" title={ai ? "La quiniela de la IA, hecha antes del cierre" : name}>
        {ai ? <AiMark /> : name}
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
