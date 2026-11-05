import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  MapPin,
  Target,
  Tv,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
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
import MatchResult from "../components/MatchResult";
import MatchStatistics from "../components/MatchStatistics";
import MatchTimeline from "../components/MatchTimeline";
import Matchups from "../components/Matchups";
import TeamForm from "../components/TeamForm";
import { Crest, Empty } from "../components/ui";
import { competitionName } from "../lib/competitions";
import {
  canPredict,
  matchStatusLabel,
  roundLabel,
  type Match,
} from "../lib/domain";
import { LEAGUE_STAGES, leagueTable, teamKey } from "../lib/leagueTable";
import {
  matchPageTabLabels,
  matchPageTabs,
  type MatchPageTab,
} from "../lib/matchDetailTabs";
import { headToHead, knockoutContext } from "../lib/matchInsights";
import {
  insightFitsMatch,
  matchExternalLinks,
  type MatchInsight,
} from "../lib/matchInsightsData";
import { chronologicalGoals } from "../lib/matchPresentation";
import { countdownLabel } from "../lib/matchPreview";
import { preferenceStore } from "../lib/preferences";
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
      <div className="match-page-skeleton" role="status" aria-label="Cargando">
        <span />
        <span />
        <span />
      </div>
    ) : (
      <Empty title="Partido no encontrado">
        Puede que pertenezca a otra temporada.{" "}
        <Link to="/partidos">Ver el calendario</Link>
      </Empty>
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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
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
  const requested = params.get("tab") as MatchPageTab | null;
  const tab = requested && tabs.includes(requested) ? requested : tabs[0];
  const tabsRef = useRef<HTMLElement>(null);
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
  function selectTab(next: MatchPageTab) {
    setParams(
      (previous) => {
        const value = new URLSearchParams(previous);
        value.set("tab", next);
        return value;
      },
      { replace: true },
    );
    // Keep the menu in view when switching from far down a long section.
    const bar = tabsRef.current;
    if (bar && bar.getBoundingClientRect().top <= 0) {
      const offset = parseFloat(getComputedStyle(bar).top) || 0;
      window.scrollTo({
        top: window.scrollY + bar.getBoundingClientRect().top - offset,
      });
    }
  }
  function back() {
    // React Router keeps the history index: only go back inside the app.
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(`/partidos?competition=${match.competition}`);
  }
  const canPlay = !demo && canPredict(match.utcDate, now, match.status);
  return (
    <article
      className="match-page"
      aria-label={`${match.home} contra ${match.away}`}
    >
      <div className="match-page-bar">
        <button
          type="button"
          className="icon-button match-page-back"
          aria-label="Volver"
          onClick={back}
        >
          <ArrowLeft size={20} />
        </button>
        <span className="match-page-competition">
          <CompetitionLogo code={match.competition} small />
          <span>
            <strong>{competitionName(match.competition)}</strong>
            <small>
              {roundLabel(match)}
              {tie?.leg ? ` · ${tie.leg === 1 ? "Ida" : "Vuelta"}` : ""}
            </small>
          </span>
        </span>
      </div>

      <header className={`match-hero${playing ? " is-live" : ""}`}>
        <div className="match-hero-team">
          <span className="match-hero-crest">
            <Crest src={match.homeCrest} />
          </span>
          <strong>{match.home}</strong>
          <TeamForm match={match} side="home" matches={matches} />
        </div>
        <div className="match-hero-center">
          {scored ? (
            <strong className="match-hero-score">
              {match.homeScore}
              <i>–</i>
              {match.awayScore}
            </strong>
          ) : (
            <strong className="match-hero-time">
              {["POSTPONED", "CANCELLED"].includes(match.status)
                ? "—"
                : kickoffTime.format(new Date(match.utcDate))}
            </strong>
          )}
          <span className="match-hero-status">
            {playing ? (
              <LiveMinute match={match} />
            ) : upcoming ? (
              `Empieza en ${countdownLabel(match.utcDate, now)}`
            ) : match.status === "FINISHED" ? (
              "Final · 90 min"
            ) : (
              matchStatusLabel[match.status] || match.status
            )}
          </span>
        </div>
        <div className="match-hero-team">
          <span className="match-hero-crest">
            <Crest src={match.awayCrest} />
          </span>
          <strong>{match.away}</strong>
          <TeamForm match={match} side="away" matches={matches} />
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
          <CalendarDays size={13} aria-hidden="true" />
          <time dateTime={match.utcDate}>
            {kickoffDay.format(new Date(match.utcDate))} ·{" "}
            {kickoffTime.format(new Date(match.utcDate))}
          </time>
          {fits && insight?.venue && (
            <>
              <MapPin size={13} aria-hidden="true" />
              <span>{insight.venue}</span>
            </>
          )}
        </p>
        {canPlay && (
          <Link
            className="match-hero-cta"
            to={`/quiniela?round=${encodeURIComponent(match.roundId)}`}
            onClick={() =>
              preferenceStore.update(userId, { competition: match.competition })
            }
          >
            <Target size={15} aria-hidden="true" /> Hacer mi quiniela
          </Link>
        )}
      </header>

      <nav
        ref={tabsRef}
        className="match-tabs"
        role="tablist"
        aria-label="Información del partido"
      >
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => selectTab(t)}
          >
            {matchPageTabLabels[t]}
          </button>
        ))}
      </nav>

      <section className="match-page-panel" role="tabpanel" key={tab}>
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
            {match.status === "FINISHED" && (
              <MatchResult
                match={match}
                insight={insight}
                loading={loading}
                demo={demo}
              />
            )}
            {demo ? (
              <p className="match-extra-empty">
                La demo no consulta información de partidos reales.
              </p>
            ) : loading ? (
              <p className="match-extra-empty" role="status">
                Cargando eventos…
              </p>
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
              <p className="match-extra-empty">
                {playing
                  ? "Los eventos aparecerán en cuanto se publiquen."
                  : "Eventos de este partido no disponibles."}
              </p>
            )}
            {!demo && <MatchMeta insight={insight} />}
          </>
        )}
        {tab === "lineups" && fits && (
          <>
            <LineupPitch match={match} lineups={insight!.lineups} />
            <details className="lineup-full-list">
              <summary>Ver lista completa y suplentes</summary>
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
        <div className="match-page-links">
          <a href={links.television} target="_blank" rel="noopener noreferrer">
            <Tv size={17} aria-hidden="true" /> Dónde verlo
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <a href={links.details} target="_blank" rel="noopener noreferrer">
            Más información <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          {links.source && (
            <a href={links.source} target="_blank" rel="noopener noreferrer">
              Ficha en ESPN <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </article>
  );
}
