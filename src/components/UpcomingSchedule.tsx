import { competitionName } from "../lib/competitions";
import { ArrowRight, CalendarDays, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import { roundLabel, type Match } from "../lib/domain";
import { kickoffLabel } from "../lib/matchInsights";
import { kickoffCountdown, roundHasStarted } from "../lib/schedule";
import CompetitionLogo from "./CompetitionLogo";
import { Team } from "./ui";

export default function UpcomingSchedule({
  matches,
  upcoming,
  now,
  loading,
}: {
  matches: Match[];
  upcoming: Match[];
  now: number;
  loading: boolean;
}) {
  const next = upcoming[0];
  const competition = next?.competition || "PD";
  const started = next && roundHasStarted(matches, next, now);
  const isLeagueRound =
    !next ||
    ["REGULAR_SEASON", "LEAGUE_STAGE", "GROUP_STAGE"].includes(next.stage);
  const roundName = isLeagueRound ? "jornada" : "ronda";
  const href = next
    ? `/partidos?competition=${competition}&round=${encodeURIComponent(next.roundId)}`
    : "/partidos";
  return (
    <section
      className="schedule-board"
      aria-label="Próximo partido"
      aria-busy={loading}
    >
      <div className="schedule-board-heading">
        <div>
          <span className="eyebrow">AGENDA DE JUEGO</span>
          <h2>El próximo saque inicial</h2>
        </div>
        <Link to="/partidos">
          Calendario <ArrowRight size={15} />
        </Link>
      </div>
      <div className="schedule-grid schedule-single">
        <article className="schedule-card">
          {next && !loading && (
            <header className="schedule-competition">
              <CompetitionLogo code={competition} small />
              <h3>{competitionName(competition)}</h3>
            </header>
          )}
          {loading ? (
            <div className="schedule-empty" role="status">
              Cargando próximos encuentros…
            </div>
          ) : next ? (
            <>
              <div className="schedule-round">
                <strong>{roundLabel(next)}</strong>
                <span>
                  {started
                    ? `${isLeagueRound ? "Jornada" : "Ronda"} en curso · próximo partido`
                    : `Comienza la ${roundName}`}
                </span>
              </div>
              <div className="schedule-kickoff">
                <span>
                  <Clock3 size={14} /> {kickoffCountdown(next.utcDate, now)}
                </span>
                <time dateTime={next.utcDate}>
                  {kickoffLabel(next.utcDate, now)}
                </time>
              </div>
              <Link
                className="schedule-fixture"
                to={`/partido/${encodeURIComponent(next.id)}`}
                aria-label={`Previa de ${next.home} contra ${next.away}`}
              >
                <Team name={next.home} crest={next.homeCrest} />
                <span className="schedule-versus">vs</span>
                <Team name={next.away} crest={next.awayCrest} />
              </Link>
              {next.status === "SCHEDULED" && (
                <p className="schedule-provisional">Horario provisional</p>
              )}
            </>
          ) : (
            <div className="schedule-empty">
              <CalendarDays size={20} />
              <strong>Sin próximos partidos confirmados</strong>
              <span>Consulta el calendario y los resultados disponibles.</span>
            </div>
          )}
          <Link className="schedule-action" to={href}>
            {next && !loading ? `Ver ${roundName}` : "Ver calendario"}
            <ArrowRight size={15} />
          </Link>
        </article>
      </div>
    </section>
  );
}
