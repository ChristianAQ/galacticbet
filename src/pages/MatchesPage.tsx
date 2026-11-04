import { isCompetition, type CompetitionCode } from "../lib/competitions";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Target, Trophy } from "lucide-react";
import { knockoutContext } from "../lib/matchInsights";
import CompetitionTabs from "../components/CompetitionTabs";
import RoundSelector from "../components/RoundSelector";
import { Empty, MatchRow, PageTitle } from "../components/ui";
import { preferredRound, type Match } from "../lib/domain";
import { LEAGUE_STAGES } from "../lib/leagueTable";
import { countdownLabel } from "../lib/matchPreview";
import { preferenceStore } from "../lib/preferences";
import { roundOptions } from "../lib/roundOptions";
import { usePreferences } from "../lib/useGroupSelection";

const MatchDetails = lazy(() => import("../components/MatchDetails"));
const dayTitle = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

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
  const [detailId, setDetailId] = useState("");
  const detail = matches.find((m) => m.id === detailId);
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
  const selectedRound = rounds.find((r) => r.id === selected);
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
  const isLeague = LEAGUE_STAGES.includes(days[0]?.[0]?.stage || "");
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
      {selectedRound && (selectedRound.state === "open" || isLeague) && (
        <nav className="round-actions" aria-label="Acciones de la jornada">
          {selectedRound.state === "open" && (
            <Link
              className="round-action is-primary"
              to={`/quiniela?round=${encodeURIComponent(selectedRound.id)}`}
            >
              <Target size={16} aria-hidden="true" />
              <span>
                <strong>Hacer mi quiniela</strong>
                <small>Cierra en {countdownLabel(selectedRound.start)}</small>
              </span>
            </Link>
          )}
          {isLeague && (
            <Link className="round-action" to="/clasificacion?vista=liga">
              <Trophy size={16} aria-hidden="true" />
              <span>
                <strong>Clasificación</strong>
                <small>Tabla de la competición</small>
              </span>
            </Link>
          )}
        </nav>
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
              <h2 className="match-day-title">
                {dayTitle.format(new Date(items[0].utcDate))}
              </h2>
              {items.map((m) => {
                const tie = knockoutContext(m, matches);
                return (
                  <button
                    key={m.id}
                    className="panel fixture-card-button"
                    aria-label={`Ver ficha de ${m.home} contra ${m.away}`}
                    onClick={() => setDetailId(m.id)}
                  >
                    <MatchRow match={m} history={matches} as="span" />
                    <span className="fixture-card-footer">
                      {tie?.leg ? `${tie.leg === 1 ? "Ida" : "Vuelta"} · ` : ""}
                      Ver ficha del partido
                      <ArrowUpRight size={15} />
                    </span>
                  </button>
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
      {detail && (
        <Suspense fallback={null}>
          <MatchDetails
            key={detail.id}
            match={detail}
            matches={matches}
            demo={demo}
            onClose={() => setDetailId("")}
          />
        </Suspense>
      )}
    </>
  );
}
