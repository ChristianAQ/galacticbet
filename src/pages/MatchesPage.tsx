import LeagueNavigation from "../components/LeagueNavigation";
import CompetitionTable from "../components/CompetitionTable";
import NewsSection from "../components/NewsSection";
import {
  competitionSeasons,
  leagueTab,
  LEAGUE_TABS,
  seasonLabel,
  type LeagueTab,
} from "../lib/leagueHub";
import "../styles/leagues.css";
import { competitionName, type CompetitionCode } from "../lib/competitions";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, CalendarPlus, Share2, Target } from "lucide-react";
import DayTitle from "../components/DayTitle";
import CustomCompetitionView, {
  CompetitionEntrySheet,
  competitionEyebrow,
  CustomChips,
  CustomSummary,
} from "../components/CustomCompetition";
import { useCompetition, useMyCompetitions } from "../lib/customCompetitionData";
import type { AppUser } from "../lib/session";
import { knockoutContext } from "../lib/matchInsights";
import CompetitionTabs from "../components/CompetitionTabs";
import { LeagueSearchButton } from "../components/CustomChips";
import RoundSelector from "../components/RoundSelector";
import SwipeRow from "../components/SwipeRow";
import { menuTarget } from "../components/ContextMenu";
import { SkeletonRows } from "../components/Skeleton";
import { Empty, MatchRow, PageTitle } from "../components/ui";
import { canPredict, preferredRound, type Match } from "../lib/domain";
import { canAddMatchToCalendar } from "../lib/matchPresentation";
import { downloadMatchCalendar, shareMatch } from "../lib/matchActions";
import { haptic, prefersReducedMotion, springEasing } from "../lib/motion";
import { go } from "../lib/navigation";
import { preferenceStore } from "../lib/preferences";
import { roundOptions } from "../lib/roundOptions";
import { useLeagueChoice } from "../lib/useLeagueChoice";

const CompetitionStats = lazy(() => import("../components/CompetitionStats"));
const CompetitionSearch = lazy(() => import("../components/CompetitionSearch"));
const dayTitle = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * One fixture of the list: tap for the match page (the crests morph into it),
 * swipe left to add it to the calendar, long-press for every shortcut.
 */
function FixtureItem({
  match: m,
  matches,
  userId,
  onNotice,
}: {
  match: Match;
  matches: Match[];
  userId: string;
  onNotice: (message: string) => void;
}) {
  const tie = knockoutContext(m, matches);
  const path = `/partido/${encodeURIComponent(m.id)}`;
  const calendar = canAddMatchToCalendar(m);
  const addToCalendar = () => {
    const message = downloadMatchCalendar(m);
    if (!message) return;
    haptic("success");
    onNotice(message);
  };
  const link = (
    <Link
      ref={menuTarget(() => ({
        title: `${m.home} – ${m.away}`,
        items: [
          {
            label: "Ver ficha",
            icon: <ArrowUpRight size={18} aria-hidden="true" />,
            onSelect: () =>
              go(path, {
                sharedFrom: document.querySelector(
                  `.route-view.is-top .fixture-card-button [data-vt-match="${CSS.escape(m.id)}"]`,
                ),
              }),
          },
          ...(canPredict(m.utcDate, Date.now(), m.status)
            ? [
                {
                  label: "Hacer mi quiniela",
                  icon: <Target size={18} aria-hidden="true" />,
                  onSelect: () => {
                    preferenceStore.update(userId, {
                      competition: m.competition,
                      liga: "",
                    });
                    go(`/quiniela?round=${encodeURIComponent(m.roundId)}`);
                  },
                },
              ]
            : []),
          ...(canAddMatchToCalendar(m)
            ? [
                {
                  label: "Añadir al calendario",
                  icon: <CalendarPlus size={18} aria-hidden="true" />,
                  onSelect: addToCalendar,
                },
              ]
            : []),
          {
            label: "Compartir partido",
            icon: <Share2 size={18} aria-hidden="true" />,
            onSelect: () =>
              void shareMatch(m).then((message) => message && onNotice(message)),
          },
        ],
      }))}
      className="fixture-card-button"
      aria-label={`Ver ficha de ${m.home} contra ${m.away}`}
      to={path}
    >
      <MatchRow match={m} history={matches} as="span" />
      {tie?.leg ? (
        <span className="fixture-leg">
          {tie.leg === 1 ? "Ida" : "Vuelta"}
        </span>
      ) : null}
    </Link>
  );
  return (
    <li className="fixture-item">
      {calendar ? (
        <SwipeRow
          actions={[
            {
              label: "Calendario",
              icon: <CalendarPlus size={20} aria-hidden="true" />,
              tone: "accent",
              onAction: addToCalendar,
            },
          ]}
        >
          {link}
        </SwipeRow>
      ) : (
        link
      )}
    </li>
  );
}

export default function MatchesPage({
  matches,
  demo,
  onDemo,
  loading,
  userId,
  user,
  onLogin,
}: {
  matches: Match[];
  demo: boolean;
  onDemo: () => void;
  loading: boolean;
  userId: string;
  user: AppUser | null;
  onLogin: () => void;
}) {
  const [params, setParams] = useSearchParams();
  // One choice for Ligas, Quiniela and Clasificación: an official league or
  // a friends' one (?liga=), shown like one more league.
  const choice = useLeagueChoice(userId, { officialParam: true });
  const liga = choice.liga;
  const custom = useCompetition(liga);
  const { competitions: mine, ready: mineReady } = useMyCompetitions(userId);
  // Off the list: back to the official league in the three views.
  const removeCustom = (id: string) => choice.forgetLiga(id);
  // Only yours show up: one you looked at without following doesn't come back
  // the next time you open Ligas (a link still opens it, and it shows then).
  const linked = params.get("liga") || "";
  useEffect(() => {
    if (!userId || !mineReady || !liga || linked) return;
    if (!mine.some((c) => c.id === liga)) choice.forgetLiga(liga);
  }, [userId, mineReady, liga, linked, mine]);
  const [entry, setEntry] = useState(false);
  const [search, setSearch] = useState(false);
  const chips = useMemo(() => {
    if (!liga || mine.some((c) => c.id === liga) || !custom.competition) return mine;
    const c = custom.competition;
    return [{ id: c.id, name: c.name, icon: c.icon, followed: Boolean(userId && c.memberIds.includes(userId)) }, ...mine];
  }, [mine, liga, custom.competition, userId]);
  function openCustom(id: string) {
    haptic();
    choice.chooseLiga(id, (next) => next.delete("tab"));
  }
  const competition: CompetitionCode = choice.competition;
  const round = params.get("round") || "";
  const tab = leagueTab(params.get("tab"));
  const ids = useId();
  const panelId = `${ids}-panel`;
  const tabPrefix = `${ids}-tab`;
  const panel = useRef<HTMLDivElement>(null);
  const previousTab = useRef(tab);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useLayoutEffect(() => {
    const previous = previousTab.current;
    previousTab.current = tab;
    if (previous === tab || prefersReducedMotion()) return;
    const direction =
      LEAGUE_TABS.findIndex((t) => t.id === tab) >
      LEAGUE_TABS.findIndex((t) => t.id === previous)
        ? 1
        : -1;
    const { easing, duration } = springEasing({ response: 0.4, damping: 0.92 });
    const animation = panel.current?.animate(
      [
        { opacity: 0, transform: `translate3d(${direction * 28}px,0,0)` },
        { opacity: 1, transform: "translate3d(0,0,0)" },
      ],
      { duration, easing },
    );
    return () => animation?.cancel();
  }, [tab]);
  const seasons = useMemo(
    () => competitionSeasons(matches, competition),
    [matches, competition],
  );
  const requestedSeason = params.get("season") || "";
  const linkedSeason = matches.find(
    (m) => m.roundId === round && m.competition === competition,
  )?.seasonId;
  const seasonId = seasons.includes(requestedSeason)
    ? requestedSeason
    : linkedSeason && seasons.includes(linkedSeason)
      ? linkedSeason
      : seasons[0] || "";
  function changeTab(value: LeagueTab) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("tab", value);
      return next;
    });
  }
  const filtered = useMemo(
    () =>
      matches.filter(
        (m) => m.competition === competition && m.seasonId === seasonId,
      ),
    [matches, competition, seasonId],
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
    <section className="leagues-page" aria-label="Ligas">
      <PageTitle
        title={liga ? custom.competition?.name || "Competición" : "Ligas"}
        navTitle={liga ? custom.competition?.name || "Competición" : competitionName(competition, true)}
        eyebrow={
          liga
            ? competitionEyebrow(custom.competition)
            : seasonId
              ? `Temporada ${seasonLabel(seasonId)}`
              : "Calendario y resultados"
        }
        titleControl={
          <LeagueSearchButton
            onClick={() => {
              haptic();
              setSearch(true);
            }}
          />
        }
      >
        <div className="league-selection">
          <CompetitionTabs
            value={liga ? "none" : competition}
            onChange={(code) => {
              if (code !== competition || liga) haptic();
              choice.chooseOfficial(code, (next) => {
                next.delete("season");
                if (liga) next.delete("tab");
              });
            }}
          >
            <CustomChips
              list={chips}
              current={liga}
              onSelect={openCustom}
              onAdd={() => setEntry(true)}
              onRemove={removeCustom}
            />
          </CompetitionTabs>
        </div>
        {liga && (
          <CustomSummary data={custom} user={user} onLogin={onLogin} onRemove={() => removeCustom(liga)} />
        )}
      </PageTitle>
      {entry && (
        <CompetitionEntrySheet user={user} onLogin={onLogin} onCode={openCustom} onClose={() => setEntry(false)} />
      )}
      {search && (
        <Suspense fallback={null}>
          <CompetitionSearch user={user} onLogin={onLogin} onOpen={openCustom} onClose={() => setSearch(false)} />
        </Suspense>
      )}
      {liga ? (
        <CustomCompetitionView
          data={custom}
          user={user}
          tab={params.get("tab") || ""}
          onTab={(value) =>
            setParams((previous) => {
              const next = new URLSearchParams(previous);
              next.set("tab", value);
              return next;
            })
          }
          round={round}
          onRound={(id) =>
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.set("round", id);
                return next;
              },
              { replace: true },
            )
          }
          onLogin={onLogin}
        />
      ) : (
      <>
      <LeagueNavigation
        tab={tab}
        onChange={changeTab}
        panel={panel}
        idPrefix={tabPrefix}
        panelId={panelId}
      />
      <div
        ref={panel}
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${tabPrefix}-${tab}`}
        className="league-content"
        key={`${competition}:${seasonId}:${tab}`}
        tabIndex={-1}
      >
        {tab === "clasificacion" ? (
          <CompetitionTable
            matches={filtered}
            competition={competition}
            seasonId={seasonId}
            loading={loading}
          />
        ) : tab === "noticias" ? (
          loading ? (
            <SkeletonRows rows={4} variant="card" label="Cargando temporada" />
          ) : !seasonId ? (
            <Empty art="paper" title="Sin temporada en portada">
              Las noticias llegarán cuando se publique el calendario de esta
              competición.
            </Empty>
          ) : (
            <NewsSection
              demo={demo}
              competition={competition}
              seasonId={seasonId}
            />
          )
        ) : tab === "estadisticas" ? (
          loading ? (
            <SkeletonRows rows={5} variant="line" label="Cargando estadísticas" />
          ) : !seasonId ? (
            <Empty art="podium" title="Sin números todavía">
              Aún no hay datos para esta competición. Vuelve cuando ruede el
              balón.
            </Empty>
          ) : (
            <Suspense
              fallback={
                <SkeletonRows
                  rows={5}
                  variant="line"
                  label="Cargando estadísticas"
                />
              }
            >
              <CompetitionStats
                matches={filtered}
                competition={competition}
                seasonId={seasonId}
                demo={demo}
              />
            </Suspense>
          )
        ) : (
          <>
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
            {notice && (
              <p className="league-toast" role="status">
                <CalendarPlus size={16} aria-hidden="true" />
                {notice}
              </p>
            )}
            <div className="match-calendar-list">
              {loading ? (
                <SkeletonRows rows={6} label="Cargando partidos" />
              ) : filtered.length ? (
                <>
                  {days.map((items) => (
                    <section
                      key={items[0].utcDate}
                      className="match-day"
                      aria-label={dayTitle.format(new Date(items[0].utcDate))}
                    >
                      <DayTitle date={items[0].utcDate} count={items.length} />
                      <ul className="fixture-list">
                        {items.map((m) => (
                          <FixtureItem
                            key={m.id}
                            match={m}
                            matches={matches}
                            userId={userId}
                            onNotice={setNotice}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                  <p className="league-hint">
                    Desliza un partido a la izquierda para llevarlo a tu
                    calendario, o mantenlo pulsado para ver más opciones.
                  </p>
                </>
              ) : (
                <Empty
                  art="whistle"
                  title="El árbitro aún no ha pitado"
                  action={
                    !demo && (
                      <button className="button secondary" onClick={onDemo}>
                        Explorar modo demo
                      </button>
                    )
                  }
                >
                  {demo
                    ? "La demo solo trae una jornada de LaLiga. Prueba con esa."
                    : "La sincronización traerá los calendarios y resultados reales desde Football-Data.org."}
                </Empty>
              )}
            </div>
            {!loading && filtered.length > 0 && (
              <p className="league-more">
                <Link to={`/quiniela?round=${encodeURIComponent(selected)}`}
                  onClick={() =>
                    preferenceStore.update(userId, { competition, liga: "" })
                  }
                >
                  Ir a mi quiniela de esta jornada
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </p>
            )}
          </>
        )}
      </div>
      </>
      )}
    </section>
  );
}
