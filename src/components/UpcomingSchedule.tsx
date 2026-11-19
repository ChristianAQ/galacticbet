import { competitionName } from "../lib/competitions";
import { ArrowRight, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import { roundLabel, type Match } from "../lib/domain";
import { kickoffCountdown, roundHasStarted } from "../lib/schedule";
import CompetitionLogo from "./CompetitionLogo";
import { Crest } from "./ui";
import { SkeletonRows } from "./Skeleton";
import EmptyArt from "./EmptyArt";

const weekday = new Intl.DateTimeFormat("es", { weekday: "short" });
const monthDay = new Intl.DateTimeFormat("es", { month: "short" });
const time = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });

/**
 * The next kick-off as a ticket stub: the date torn off on the left, the
 * fixture on the right. Tapping the fixture morphs it into the match page.
 */
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
    ? `/ligas?competition=${competition}&round=${encodeURIComponent(next.roundId)}`
    : "/ligas";
  const date = next ? new Date(next.utcDate) : null;
  return (
    <section
      className="schedule-board"
      aria-labelledby="schedule-title"
      aria-busy={loading}
    >
      <div className="section-heading">
        <h2 id="schedule-title">Próximo saque</h2>
        <Link to={href}>
          {next && !loading ? `Ver ${roundName}` : "Calendario"}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {loading ? (
        <SkeletonRows rows={1} label="Cargando próximos encuentros" />
      ) : next && date ? (
        <article className="schedule-card">
          <div className="schedule-stub" aria-hidden="true">
            <span className="schedule-stub-day">{weekday.format(date)}</span>
            <b className="numeral">{date.getDate()}</b>
            <span className="schedule-stub-month">{monthDay.format(date)}</span>
          </div>
          <div className="schedule-main">
            <header className="schedule-competition">
              <CompetitionLogo code={competition} small />
              <span>
                <strong>{competitionName(competition, true)}</strong>
                <small>
                  {roundLabel(next)} ·{" "}
                  {started
                    ? `${isLeagueRound ? "jornada" : "ronda"} en marcha`
                    : `abre la ${roundName}`}
                </small>
              </span>
            </header>
            <Link
              className="schedule-fixture"
              to={`/partido/${encodeURIComponent(next.id)}`}
              data-vt-match={next.id}
              aria-label={`Previa de ${next.home} contra ${next.away}`}
            >
              <span className="schedule-team">
                <span data-vt-part="home-crest">
                  <Crest src={next.homeCrest} />
                </span>
                <span>{next.home}</span>
              </span>
              <time
                className="schedule-time numeral"
                dateTime={next.utcDate}
                data-vt-part="score"
              >
                {time.format(date)}
              </time>
              <span className="schedule-team is-away">
                <span>{next.away}</span>
                <span data-vt-part="away-crest">
                  <Crest src={next.awayCrest} />
                </span>
              </span>
            </Link>
            <p className="schedule-kickoff">
              <Clock3 size={14} aria-hidden="true" />
              {kickoffCountdown(next.utcDate, now)}
              {next.status === "SCHEDULED" && (
                <span className="schedule-provisional">· horario provisional</span>
              )}
            </p>
          </div>
        </article>
      ) : (
        <div className="schedule-empty">
          <EmptyArt kind="whistle" />
          <strong>Nadie ha pitado todavía</strong>
          <span>No hay próximos partidos confirmados. Mira el calendario y los últimos resultados.</span>
        </div>
      )}
    </section>
  );
}
