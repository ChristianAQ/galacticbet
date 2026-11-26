import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  MapPin,
  NotebookPen,
  Tv,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CompetitionLogo from "../components/CompetitionLogo";
import LeagueTable from "../components/LeagueTable";
import LineupPitch from "../components/LineupPitch";
import { LiveMinute } from "../components/LiveStatus";
import TeamLineup from "../components/TeamLineup";
import MatchCalendarAction from "../components/MatchCalendarAction";
import MatchMeta from "../components/MatchMeta";
import MatchOddsPanel from "../components/MatchOddsPanel";
import MatchPreview from "../components/MatchPreview";
import MatchProbability from "../components/MatchProbability";
import MatchStatistics from "../components/MatchStatistics";
import MatchTimeline from "../components/MatchTimeline";
import Matchups from "../components/Matchups";
import TeamForm from "../components/TeamForm";
import { SkeletonRows } from "../components/Skeleton";
import {
  HeroCrest,
  MatchSkeleton,
  MatchTabs,
  useMatchTab,
} from "../components/MatchPageParts";
import { Empty, PageTitle, useCollapsingTitle } from "../components/ui";
import { competitionCode, competitionName, isCompetition } from "../lib/competitions";
import {
  canPredict,
  matchStatusLabel,
  roundLabel,
  type Match,
} from "../lib/domain";
import { LEAGUE_STAGES, leagueTable, seasonLeagueTable, teamKey } from "../lib/leagueTable";
import { haptic } from "../lib/motion";
import { useLeagueStats } from "../lib/useLeagueStats";
import { matchPageTabLabels, matchPageTabs } from "../lib/matchDetailTabs";
import { headToHead, knockoutContext } from "../lib/matchInsights";
import {
  insightFitsMatch,
  matchExternalLinks,
  type MatchInsight,
} from "../lib/matchInsightsData";
import { chronologicalGoals } from "../lib/matchPresentation";
import { finishedMatchResult } from "../lib/matchResult";
import { countdownLabel } from "../lib/matchPreview";
import { preferenceStore } from "../lib/preferences";
import { useNavTitle } from "../lib/chrome";
import { useLiveMatch } from "../lib/useLiveBoard";
import { useMatchInsight } from "../lib/useMatchInsight";
import { useMatchOdds } from "../lib/useMatchOdds";
import "../styles/matchExtras.css";
import "../styles/matchPage.css";

const kickoffTime = new Intl.DateTimeFormat("es", {
  hour: "2-digit",
  minute: "2-digit",
});
const kickoffDay = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const SingleTeamSheet = lazy(() =>
  import("../components/TeamCard").then((m) => ({ default: m.SingleTeamSheet })),
);

export default function MatchPage({
  matches,
  loading,
  demo,
  userId,
}: {
  matches: Match[];
  loading: boolean;
  demo: boolean;
  userId: string;
}) {
  const { id = "" } = useParams();
  const match = matches.find((m) => m.id === id);
  if (!match)
    return loading ? (
      <MatchSkeleton />
    ) : (
      <>
        <PageTitle eyebrow="Fuera de juego" title="Partido" />
        <Empty
          art="flag"
          title="Este partido no está en el calendario"
          action={
            <Link className="button primary" to="/ligas">
              Ver el calendario <ArrowRight size={16} aria-hidden="true" />
            </Link>
          }
        >
          Puede que sea de otra temporada o que el enlace haya caducado.
        </Empty>
      </>
    );
  return (
    <MatchView
      key={match.id}
      match={match}
      matches={matches}
      demo={demo}
      userId={userId}
    />
  );
}

/** Scorers under each team: live board while in play, ESPN details otherwise. */
function useScorers(match: Match, insight: MatchInsight | null) {
  const live = useLiveMatch(match.id);
  return useMemo(() => {
    const fromLive = (live?.events || [])
      .filter((e) => ["goal", "penalty", "own-goal"].includes(e.kind))
      .map((e) => ({
        side: e.side,
        minute: e.minute,
        player: e.player,
        kind: e.kind,
      }));
    const fromInsight =
      insight && insightFitsMatch(insight, match)
        ? insight.goals.map((g) => ({
            side: g.side,
            minute: g.minute,
            player: g.scorer,
            kind: g.kind,
          }))
        : [];
    const goals = chronologicalGoals(
      fromLive.length >= fromInsight.length ? fromLive : fromInsight,
    );
    return {
      home: goals.filter((g) => g.side === "home"),
      away: goals.filter((g) => g.side === "away"),
    };
  }, [live, insight, match]);
}

function MatchView({
  match,
  matches,
  demo,
  userId,
}: {
  match: Match;
  matches: Match[];
  demo: boolean;
  userId: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useNavTitle(`${match.home} – ${match.away}`);
  const board = useCollapsingTitle<HTMLDivElement>();
  const { insight, loading, error, onRetry } = useMatchInsight(match, demo);
  const upcoming =
    ["TIMED", "SCHEDULED"].includes(match.status) &&
    Date.parse(match.utcDate) > now;
  const playing = ["IN_PLAY", "PAUSED"].includes(match.status);
  const scored = match.homeScore !== null && match.awayScore !== null;
  const odds = useMatchOdds(match.id, upcoming && !demo);
  const table = useMemo(
    () =>
      LEAGUE_STAGES.includes(match.stage)
        ? leagueTable(
            matches.filter(
              (m) =>
                m.competition === match.competition &&
                m.seasonId === match.seasonId &&
                m.stage === match.stage &&
                Date.parse(m.utcDate) <= Date.now(),
            ),
          )
        : [],
    [matches, match],
  );
  const tabs = matchPageTabs(
    match,
    demo ? null : insight,
    table.length > 0,
    now,
  );
  const [tab, selectTab] = useMatchTab(tabs);
  // Tap a crest: that team's sheet in this competition and season.
  const season = useMemo(
    () => (isCompetition(match.competition) ? seasonLeagueTable(matches, match.competition, match.seasonId) : []),
    [matches, match.competition, match.seasonId],
  );
  const seasonMatches = useMemo(
    () => matches.filter((m) => m.competition === match.competition && m.seasonId === match.seasonId),
    [matches, match.competition, match.seasonId],
  );
  const sheetIndex = (side: "home" | "away") => season.findIndex((r) => r.key === teamKey(match, side));
  // The side, not the row: the table re-sorts when results come in.
  const [sheet, setSheet] = useState<{ side: "home" | "away"; origin: HTMLElement } | null>(null);
  const sheetAt = sheet ? sheetIndex(sheet.side) : -1;
  const sheetStats = useLeagueStats(sheet ? match.seasonId : "", demo);
  const openSheet = (side: "home" | "away", origin: HTMLElement) => {
    if (sheetIndex(side) < 0) return;
    haptic();
    setSheet({ side, origin });
  };
  const scorers = useScorers(match, demo ? null : insight);
  const tie = knockoutContext(match, matches);
  const links = matchExternalLinks(match, insight);
  const fits = Boolean(insight && insightFitsMatch(insight, match));
  const official = headToHead(match, matches).map((m) => ({
    id: m.id,
    date: m.utcDate,
    home: m.home,
    away: m.away,
    homeScore: m.homeScore!,
    awayScore: m.awayScore!,
  }));
  const result = finishedMatchResult(match);
  const canPlay = !demo && canPredict(match.utcDate, now, match.status);
  const status = playing ? (
    <LiveMinute match={match} />
  ) : upcoming ? (
    <>
      Empieza en <b>{countdownLabel(match.utcDate, now)}</b>
    </>
  ) : result ? (
    result.extended && result.winnerName ? (
      `Gana ${result.winnerName} ${result.decision.toLowerCase()}`
    ) : (
      "Final"
    )
  ) : (
    matchStatusLabel[match.status] || match.status
  );
  return (
    <article
      className="match-page"
      aria-label={`${match.home} contra ${match.away}`}
    >
      <header
        className={`masthead match-hero${playing ? " is-live" : ""}${scored ? " is-scored" : ""}`}
        data-vt-match={match.id}
        data-vt-hero
      >
        <h1 className="sr-only">
          {match.home} contra {match.away}
        </h1>
        <p className="match-hero-meta">
          <CompetitionLogo code={match.competition} small />
          <span className="eyebrow">
            {competitionName(match.competition)} · {roundLabel(match)}
            {tie?.leg ? ` · ${tie.leg === 1 ? "Ida" : "Vuelta"}` : ""}
          </span>
        </p>
        <div className="match-hero-board" ref={board}>
          <div className="match-hero-team is-home">
            {sheetIndex("home") >= 0 ? (
              <button
                type="button"
                className="match-hero-team-open"
                aria-label={`${match.home}: ver su ficha`}
                onClick={(event) => openSheet("home", event.currentTarget)}
              >
                <HeroCrest src={match.homeCrest} part="home-crest" />
                <strong className="match-hero-name">{match.home}</strong>
              </button>
            ) : (
              <>
                <HeroCrest src={match.homeCrest} part="home-crest" />
                <strong className="match-hero-name">{match.home}</strong>
              </>
            )}
            <TeamForm match={match} side="home" matches={matches} />
          </div>
          <div className="match-hero-center">
            {scored ? (
              <strong
                className="match-hero-score"
                data-vt-part="score"
                aria-label={`${match.homeScore} a ${match.awayScore}`}
              >
                <span>{match.homeScore}</span>
                <i aria-hidden="true">–</i>
                <span>{match.awayScore}</span>
              </strong>
            ) : (
              <strong className="match-hero-time" data-vt-part="score">
                {["POSTPONED", "CANCELLED"].includes(match.status)
                  ? "—"
                  : kickoffTime.format(new Date(match.utcDate))}
              </strong>
            )}
            <span className="match-hero-status">{status}</span>
            {result?.halfTime && (
              <small className="match-hero-half">
                Descanso {result.halfTime.home}–{result.halfTime.away}
              </small>
            )}
          </div>
          <div className="match-hero-team is-away">
            {sheetIndex("away") >= 0 ? (
              <button
                type="button"
                className="match-hero-team-open"
                aria-label={`${match.away}: ver su ficha`}
                onClick={(event) => openSheet("away", event.currentTarget)}
              >
                <HeroCrest src={match.awayCrest} part="away-crest" />
                <strong className="match-hero-name">{match.away}</strong>
              </button>
            ) : (
              <>
                <HeroCrest src={match.awayCrest} part="away-crest" />
                <strong className="match-hero-name">{match.away}</strong>
              </>
            )}
            <TeamForm match={match} side="away" matches={matches} />
          </div>
        </div>
        {(scorers.home.length > 0 || scorers.away.length > 0) && (
          <div className="match-hero-scorers" aria-label="Goleadores">
            {(["home", "away"] as const).map((side) => (
              <ul key={side} className={`is-${side}`}>
                {scorers[side].map((g, i) => (
                  <li key={`${g.minute}-${g.player}-${i}`}>
                    <span>
                      {g.player}
                      {g.kind === "penalty"
                        ? " (p.)"
                        : g.kind === "own-goal"
                          ? " (p.p.)"
                          : ""}
                    </span>
                    <small>{g.minute.replace(/[’′']$/, "")}'</small>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        )}
        <p className="match-hero-date">
          <CalendarDays size={14} aria-hidden="true" />
          <time dateTime={match.utcDate}>
            {kickoffDay.format(new Date(match.utcDate))} ·{" "}
            {kickoffTime.format(new Date(match.utcDate))}
          </time>
          {fits && insight?.venue && (
            <>
              <MapPin size={14} aria-hidden="true" />
              <span>{insight.venue}</span>
            </>
          )}
        </p>
        {canPlay && (
          <Link
            className="button primary full match-hero-cta"
            to={`/quiniela?round=${encodeURIComponent(match.roundId)}`}
            onClick={() =>
              preferenceStore.update(userId, { competition: match.competition, liga: "" })
            }
          >
            Hacer mi quiniela <ArrowRight size={17} aria-hidden="true" />
          </Link>
        )}
      </header>
      {sheet && sheetAt >= 0 && (
        <Suspense fallback={null}>
          <SingleTeamSheet
            rows={season}
            index={sheetAt}
            origin={sheet.origin}
            matches={seasonMatches}
            scorers={sheetStats.data?.scorers || []}
            competition={competitionCode(match.competition)}
            seasonId={match.seasonId}
            onClose={() => setSheet(null)}
          />
        </Suspense>
      )}

      <MatchTabs
        tabs={tabs}
        labels={matchPageTabLabels}
        value={tab}
        onChange={selectTab}
      >
        {/* Not a tab: opens Porra rápida with this fixture already chosen.
            Only before kick-off: a porra on a played match makes no sense. */}
        {upcoming && (
          <Link
            className="match-tabs-porra"
            to={`/porra?partido=${encodeURIComponent(match.id)}`}
          >
            <NotebookPen size={15} aria-hidden="true" />
            Porra rápida
          </Link>
        )}
      </MatchTabs>

      <section
        className="match-page-panel"
        role="tabpanel"
        id="match-panel"
        aria-labelledby={`match-tab-${tab}`}
        key={tab}
      >
        {tab === "preview" && (
          <>
            {fits && (
              <MatchProbability
                match={match}
                probability={insight!.probability}
                now={now}
              />
            )}
            <MatchPreview match={match} matches={matches} />
            <Matchups
              matches={
                fits && insight!.matchups?.length
                  ? insight!.matchups
                  : official.slice(0, 5)
              }
              source={
                fits && insight!.matchups?.length ? "ESPN" : "Football-Data.org"
              }
            />
            {!demo && <MatchMeta insight={insight} />}
            {!demo && <MatchCalendarAction match={match} />}
          </>
        )}
        {tab === "odds" && (
          <MatchOddsPanel
            match={match}
            odds={odds.odds}
            loading={odds.loading}
            error={odds.error}
            demo={demo}
          />
        )}
        {tab === "events" && (
          <>
            {demo ? (
              <Empty art="whistle" title="El VAR no mira la demo">
                En modo demo no consultamos goles ni tarjetas de partidos
                reales.
              </Empty>
            ) : loading ? (
              <SkeletonRows rows={4} variant="line" label="Cargando eventos" />
            ) : error ? (
              <div className="match-extra-empty" role="status">
                <p>{error}</p>
                <button
                  type="button"
                  className="match-extra-retry"
                  onClick={onRetry}
                >
                  Reintentar
                </button>
              </div>
            ) : fits &&
              (insight!.goals.length || insight!.incidents?.length) ? (
              <MatchTimeline match={match} insight={insight!} />
            ) : (
              <Empty
                art={playing ? "whistle" : "net"}
                title={playing ? "Se juega, pero sin noticias" : "Acta sin eventos"}
              >
                {playing
                  ? "Los goles y tarjetas aparecerán aquí en cuanto se publiquen."
                  : "No hay goles, tarjetas ni cambios publicados para este partido."}
              </Empty>
            )}
            {!demo && <MatchMeta insight={insight} />}
          </>
        )}
        {tab === "lineups" && fits && (
          <>
            <LineupPitch match={match} lineups={insight!.lineups} />
            <details className="lineup-full-list">
              <summary>
                Lista completa y suplentes
                <ArrowRight size={16} aria-hidden="true" />
              </summary>
              <div className="match-extra-lineups">
                <TeamLineup
                  name={match.home}
                  lineup={insight!.lineups.find((l) => l.side === "home")}
                />
                <TeamLineup
                  name={match.away}
                  lineup={insight!.lineups.find((l) => l.side === "away")}
                />
              </div>
            </details>
          </>
        )}
        {tab === "statistics" && fits && (
          <MatchStatistics match={match} statistics={insight!.statistics} />
        )}
        {tab === "table" && (
          <div className="match-page-table">
            <LeagueTable
              rows={table}
              code={match.competition}
              highlight={[teamKey(match, "home"), teamKey(match, "away")]}
            />
          </div>
        )}
      </section>

      {!demo && (
        <nav className="match-page-links" aria-label="Enlaces externos">
          <a href={links.television} target="_blank" rel="noopener noreferrer">
            <Tv size={18} aria-hidden="true" />
            <span>Dónde verlo</span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
          <a href={links.details} target="_blank" rel="noopener noreferrer">
            <CalendarDays size={18} aria-hidden="true" />
            <span>Más información</span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
          {links.source && (
            <a href={links.source} target="_blank" rel="noopener noreferrer">
              <MapPin size={18} aria-hidden="true" />
              <span>Ficha en ESPN</span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          )}
        </nav>
      )}
    </article>
  );
}
