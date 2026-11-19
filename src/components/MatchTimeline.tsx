import { ArrowLeftRight, Goal } from "lucide-react";
import type { Match } from "../lib/domain";
import type { MatchInsight } from "../lib/matchInsightsData";
import { chronologicalGoals } from "../lib/matchPresentation";
import { Empty } from "./ui";
import "../styles/matchExtras.css";

const labels = {
  "yellow-card": "Tarjeta amarilla",
  "red-card": "Tarjeta roja",
  "second-yellow": "Segunda amarilla",
  substitution: "Cambio",
};

/**
 * Minute-by-minute record: a ruled centre column with the minute, home events
 * to its left and away events to its right, like a match report.
 */
export default function MatchTimeline({
  match,
  insight,
}: {
  match: Match;
  insight: MatchInsight;
}) {
  const events = chronologicalGoals([
    ...insight.goals.map((g) => ({
      ...g,
      player: g.scorer,
      playerOut: undefined as string | undefined,
      label:
        g.kind === "penalty"
          ? "Gol de penalti"
          : g.kind === "own-goal"
            ? "Gol en propia puerta"
            : "Gol",
    })),
    ...(insight.incidents || []).map((i) => ({
      ...i,
      assist: undefined as string | undefined,
      label: labels[i.kind],
    })),
  ]);
  if (!events.length)
    return (
      <Empty art="net" title="Acta en blanco">
        Todavía no hay eventos publicados para este partido.
      </Empty>
    );
  return (
    <section className="match-block" aria-label="Goles, tarjetas y cambios">
      <div className="timeline-teams" aria-hidden="true">
        <span>{match.home}</span>
        <span>{match.away}</span>
      </div>
      <ol className="match-extra-goals">
        {events.map((e, index) => {
          const goal = !e.kind.includes("card") && e.kind !== "substitution";
          const content = (
            <div className="timeline-content">
              <span className="timeline-icon" aria-hidden="true">
                {e.kind === "substitution" ? (
                  <ArrowLeftRight size={15} />
                ) : e.kind.includes("card") || e.kind === "second-yellow" ? (
                  <i className={`incident-card ${e.kind}`} />
                ) : (
                  <Goal size={15} />
                )}
              </span>
              <span className="timeline-text">
                <small className="incident-label">{e.label}</small>
                <strong>{e.player}</strong>
                <span className="sr-only">
                  {e.side === "home" ? match.home : match.away}
                </span>
                {e.playerOut && <small>Sale {e.playerOut}</small>}
                {e.assist && <small>Asistencia: {e.assist}</small>}
              </span>
            </div>
          );
          return (
            <li
              className={`goal-event ${e.side}${goal ? " is-goal" : ""}`}
              key={`${e.minute}-${e.kind}-${e.player}-${index}`}
            >
              <span className="timeline-side is-home">
                {e.side === "home" && content}
              </span>
              <span className="match-extra-minute">{e.minute}</span>
              <span className="timeline-side is-away">
                {e.side === "away" && content}
              </span>
            </li>
          );
        })}
      </ol>
      {["EXTRA_TIME", "PENALTY_SHOOTOUT"].includes(
        match.scoreDuration || "",
      ) && (
        <p className="match-extra-note">
          Incluye la prórroga cuando está disponible. La tanda de penaltis no se
          incluye.
        </p>
      )}
    </section>
  );
}
