import type { Match } from "../lib/domain";
import { liveMinuteLabel, type LiveEvent } from "../lib/liveBoard";
import { useLiveMatch, useMinuteClock } from "../lib/useLiveBoard";
import "../styles/live.css";

/** Minute label ("67'", "Descanso") while a fixture is in play; empty otherwise. */
export function useLiveLabel(match: Match) {
  const live = useLiveMatch(match.id);
  const playing = ["IN_PLAY", "PAUSED"].includes(match.status);
  const now = useMinuteClock(playing && live?.status === "IN_PLAY");
  return playing ? liveMinuteLabel(live, now) || "En juego" : "";
}

export function LiveMinute({ match }: { match: Match }) {
  const label = useLiveLabel(match);
  if (!label) return null;
  return (
    <span className="live-minute" aria-label={`En directo: ${label}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

const eventNames: Record<LiveEvent["kind"], string> = {
  goal: "Gol",
  penalty: "Gol de penalti",
  "own-goal": "Gol en propia puerta",
  "yellow-card": "Tarjeta amarilla",
  "second-yellow": "Segunda amarilla",
  "red-card": "Tarjeta roja",
};

/** Goals and cards from the live board, newest last, without substitutions. */
export function LiveEvents({ match }: { match: Match }) {
  const live = useLiveMatch(match.id);
  const events = live?.events || [];
  if (
    !events.length ||
    match.status === "TIMED" ||
    match.status === "SCHEDULED"
  )
    return null;
  return (
    <ul className="live-events" aria-label="Goles y tarjetas">
      {events.map((event, i) => (
        <li
          key={`${event.minute}-${event.player}-${i}`}
          className={`live-event live-event-${event.side}`}
          title={eventNames[event.kind]}
        >
          <span
            className={`live-event-icon live-icon-${event.kind}`}
            aria-label={eventNames[event.kind]}
          />
          <span className="live-event-minute">{event.minute}</span>
          <span className="live-event-player">
            {event.player}
            {event.kind === "penalty"
              ? " (p.)"
              : event.kind === "own-goal"
                ? " (p.p.)"
                : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
