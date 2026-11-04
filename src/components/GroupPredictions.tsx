import {
  collection,
  documentId,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import {
  hasMatchStarted,
  matchStatusLabel,
  outcome,
  predictionSummary,
  type Match,
  type PredictionValue,
} from "../lib/domain";
import type { Participant } from "../lib/data";
import { db } from "../lib/firebase";
import { kickoffLabel } from "../lib/matchInsights";
import { Team, readableError } from "./ui";
import TeamForm from "./TeamForm";
import MatchResult from "./MatchResult";
import { decodeDelivery } from "../lib/roundDelivery";

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
  loadingOwn = false,
  canShare,
  completedIds,
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
  loadingOwn?: boolean;
  canShare: boolean;
  completedIds: string[];
}) {
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
  useEffect(() => {
    setEntries({});
    setReady(false);
    setError("");
    setPending(false);
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
    setPending(true);
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
  return (
    <section className="group-predictions" aria-label="Pronósticos del grupo">
      <div className="group-view-heading">
        <h2 tabIndex={-1}>El grupo</h2>
        {sealed && (
          <span className="round-state saved" role="status">
            Guardada
          </span>
        )}
      </div>
      {matches.map((m) => (
        <RivalsCard
          demo={demo}
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
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ))}
    </section>
  );
}
function RivalsCard({
  demo,
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
  onRetry,
}: {
  demo: boolean;
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
  onRetry: () => void;
}) {
  const visible = participants.filter(
    (p) => p.id !== userId && completedIds.includes(p.id),
  );
  const hasScore =
    match.homeScore !== null &&
    match.awayScore !== null &&
    ["FINISHED", "IN_PLAY", "PAUSED"].includes(match.status);
  const scheduled = ["TIMED", "SCHEDULED"].includes(match.status);
  return (
    <article className="panel group-match-card">
      <header className="saved-match-heading">
        <time dateTime={match.utcDate}>{kickoffLabel(match.utcDate)}</time>
        <span
          className={`saved-match-status ${["IN_PLAY", "PAUSED"].includes(match.status) ? "is-live" : ""}`}
        >
          {scheduled
            ? started
              ? "Pendiente de actualización"
              : "A la espera del inicio"
            : matchStatusLabel[match.status] || match.status}
        </span>
      </header>
      <div className="saved-fixture">
        <div className="saved-team">
          <Team name={match.home} crest={match.homeCrest} />
          <TeamForm match={match} side="home" matches={history} />
        </div>
        <div
          className="match-own-pick"
          role="group"
          aria-label="Tu pronóstico"
          aria-busy={loadingOwn}
        >
          <span>Tu pronóstico</span>
          {loadingOwn ? (
            <span className="saved-pick-loading" role="status">
              Cargando…
            </span>
          ) : (
            <PickValue match={match} value={ownValue} compact />
          )}
        </div>
        <div className="saved-team">
          <Team name={match.away} crest={match.awayCrest} />
          <TeamForm match={match} side="away" matches={history} />
        </div>
      </div>
      {match.status === "FINISHED" && <MatchResult match={match} demo={demo} />}
      {hasScore && match.status !== "FINISHED" && (
        <div className="saved-match-footer">
          <div
            className="saved-match-result"
            aria-label="Resultado real a 90 minutos"
          >
            <span>Marcador · 90 min</span>
            <strong>
              {match.homeScore} – {match.awayScore}
            </strong>
          </div>
        </div>
      )}
      {canShare && (
        <section
          className="shared-predictions"
          aria-label="Pronósticos compartidos"
        >
          <header className="shared-predictions-heading">
            <h3>
              <Users size={13} aria-hidden="true" /> Pronósticos compartidos
            </h3>
            <span
              className="shared-predictions-count"
              aria-label={`${visible.length} compañeros`}
            >
              {visible.length}
            </span>
          </header>
          <div className="rivals-content" aria-busy={pending || !ready}>
            {pending || !ready ? (
              <p className="rivals-loading" role="status">
                Cargando pronósticos…
              </p>
            ) : error ? (
              <div className="rivals-error">
                <p role="alert">{error}</p>
                <button className="button secondary" onClick={onRetry}>
                  Volver a intentar
                </button>
              </div>
            ) : (
              <>
                {visible.length === 0 && (
                  <p className="rivals-empty">
                    Aquí aparecerán cuando guarden su quiniela.
                  </p>
                )}
                <ul
                  className="rivals-grid"
                  aria-label="Pronósticos de tus compañeros"
                >
                  {visible.map((person) => (
                    <li className="rival-player" key={person.id}>
                      <span className="rival-name" title={person.name}>
                        {person.name}
                      </span>
                      <PickValue
                        match={match}
                        value={entries[person.id]?.[match.id]}
                        condensed
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}
    </article>
  );
}

function PickValue({
  match,
  value,
  compact = false,
  condensed = false,
}: {
  match: Match;
  value?: PredictionValue;
  compact?: boolean;
  condensed?: boolean;
}) {
  const sign = value
    ? typeof value === "string"
      ? value
      : outcome(value.home, value.away)
    : null;
  const label =
    sign === "1"
      ? match.home
      : sign === "2"
        ? match.away
        : sign === "X"
          ? "Empate"
          : "Sin pronóstico";
  return (
    <div
      role="group"
      aria-label={`Pronóstico: ${value ? predictionSummary(value) : "sin pronóstico"}, ${label}`}
      title={condensed ? label : undefined}
      className={`rival-selection ${condensed ? "condensed" : ""} ${compact ? "compact" : ""} ${sign === "1" ? "pick-home" : sign === "X" ? "pick-draw" : sign === "2" ? "pick-away" : "pick-missing"}`}
    >
      <strong>{value ? predictionSummary(value) : "—"}</strong>
      <span>
        {compact && value
          ? sign === "1"
            ? "Local"
            : sign === "2"
              ? "Visitante"
              : "Empate"
          : label}
      </span>
    </div>
  );
}
