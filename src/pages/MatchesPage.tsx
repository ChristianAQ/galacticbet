import { isCompetition, type CompetitionCode } from "../lib/competitions";
import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { knockoutContext } from "../lib/matchInsights";
import CompetitionTabs from "../components/CompetitionTabs";
import RoundSelector from "../components/RoundSelector";
import { Empty, MatchRow, PageTitle } from "../components/ui";
import { preferredRound, type Match } from "../lib/domain";
import { preferenceStore } from "../lib/preferences";
import { roundOptions } from "../lib/roundOptions";
import { usePreferences } from "../lib/useGroupSelection";

const dayTitle = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const weekday = new Intl.DateTimeFormat("es", { weekday: "long" });
const dayMonth = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "long",
});

/** Day separator: «Hoy»/«Mañana» or the weekday, the date and the fixture count. */
function DayTitle({ date, count }: { date: string; count: number }) {
  const day = new Date(date);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const relative =
    day.toDateString() === today.toDateString()
      ? "Hoy"
      : day.toDateString() === tomorrow.toDateString()
        ? "Mañana"
        : "";
  return (
    <h2 className={`match-day-title${relative ? " is-near" : ""}`}>
      <span className="match-day-name">{relative || weekday.format(day)}</span>
      <span className="match-day-date">{dayMonth.format(day)}</span>
      <i className="match-day-rule" aria-hidden="true" />
      <span className="match-day-count">
        {count} {count === 1 ? "partido" : "partidos"}
      </span>
    </h2>
  );
}

export default function MatchesPage({
  matches,
  demo,
  onDemo,
  loading,
  userId,
}: {
  matches: Match[];
  demo: boolean;
  onDemo: () => void;
  loading: boolean;
  userId: string;
}) {
  const [params, setParams] = useSearchParams();
  const preferences = usePreferences(userId);
  const requested = params.get("competition");
  const competition: CompetitionCode = isCompetition(requested)
    ? requested
    : preferences.competition;
  const round = params.get("round") || "";
  // A competition opened from a link becomes the shared choice for quiniela and standings.
  useEffect(() => {
    if (isCompetition(requested))
      preferenceStore.update(userId, { competition: requested });
  }, [userId, requested]);
  const filtered = useMemo(
    () => matches.filter((m) => m.competition === competition),
    [matches, competition],
  );
  const rounds = useMemo(() => roundOptions(filtered), [filtered]);
  const current = useMemo(() => preferredRound(filtered), [filtered]);
  const selected = rounds.some((r) => r.id === round) ? round : current;
  const days = useMemo(() => {
    const byDay = new Map<string, Match[]>();
    for (const m of filtered
      .filter((m) => m.roundId === selected)
      .sort((a, b) => a.utcDate.localeCompare(b.utcDate))) {
      const key = new Date(m.utcDate).toDateString();
      byDay.set(key, [...(byDay.get(key) || []), m]);
    }
    return [...byDay.values()];
  }, [filtered, selected]);
  return (
    <>
      <PageTitle eyebrow="CALENDARIO Y RESULTADOS" title="Partidos" />
      <CompetitionTabs
        value={competition}
        onChange={(code) => {
          preferenceStore.update(userId, { competition: code });
          setParams({ competition: code }, { replace: true });
        }}
      />
      {!loading && filtered.length > 0 && (
        <RoundSelector
          rounds={rounds}
          value={selected}
          current={current}
          onChange={(id) =>
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.set("round", id);
                return next;
              },
              { replace: true },
            )
          }
        />
      )}
      <div className="match-calendar-list">
        {loading ? (
          <Empty title="Cargando partidos…">Consultando Firestore.</Empty>
        ) : filtered.length ? (
          days.map((items) => (
            <section
              key={items[0].utcDate}
              className="match-day"
              aria-label={dayTitle.format(new Date(items[0].utcDate))}
            >
              <DayTitle date={items[0].utcDate} count={items.length} />
              {items.map((m) => {
                const tie = knockoutContext(m, matches);
                return (
                  <Link
                    key={m.id}
                    className="panel fixture-card-button"
                    aria-label={`Ver ficha de ${m.home} contra ${m.away}`}
                    to={`/partido/${encodeURIComponent(m.id)}`}
                  >
                    <MatchRow match={m} history={matches} as="span" />
                    <span className="fixture-card-footer">
                      {tie?.leg ? `${tie.leg === 1 ? "Ida" : "Vuelta"} · ` : ""}
                      Ver ficha del partido
                      <ArrowUpRight size={15} />
                    </span>
                  </Link>
                );
              })}
            </section>
          ))
        ) : (
          <Empty title="Aún no hay partidos disponibles">
            {demo
              ? "La demo contiene únicamente una jornada de LaLiga."
              : "La sincronización cargará los calendarios y resultados reales desde Football-Data.org."}
            <br />
            {!demo && (
              <button className="button secondary" onClick={onDemo}>
                Explorar modo demo
              </button>
            )}
          </Empty>
        )}
      </div>
    </>
  );
}
