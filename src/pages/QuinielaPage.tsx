import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import CompetitionTabs from "../components/CompetitionTabs";
import { CustomChips, LeagueSearchButton } from "../components/CustomChips";
import LeagueNavigation from "../components/LeagueNavigation";
import { PageTitle, PrivateGate } from "../components/ui";
import { COMPETITION_CODES, type CompetitionCode } from "../lib/competitions";
import { loadGameSeasons, SEASONS_CHANGED, type Group } from "../lib/data";
import type { Match, Mode } from "../lib/domain";
import { useFollowedCompetitions } from "../lib/followedCompetitions";
import { haptic, prefersReducedMotion, springEasing } from "../lib/motion";
import { go } from "../lib/navigation";
import type { AppUser } from "../lib/session";
import { preferenceStore } from "../lib/preferences";
import { useGroupSelection } from "../lib/useGroupSelection";
import { useLeagueChoice } from "../lib/useLeagueChoice";
import PredictionsPage from "./PredictionsPage";
import StandingsPage from "./StandingsPage";
import "../styles/leagues.css";
import "../styles/quiniela.css";

const CompetitionSearch = lazy(() => import("../components/CompetitionSearch"));

export type QuinielaView = "boleto" | "clasificacion";
export const quinielaView = (value: string | null): QuinielaView =>
  value === "clasificacion" ? "clasificacion" : "boleto";
const VIEWS: QuinielaView[] = ["boleto", "clasificacion"];

/** The competitions a group plays (its seasons), for the header's chips and mode. */
function useGroupSeasons(groupId: string) {
  const [state, setState] = useState<{ group: string; seasons: { competition: string; mode: Mode }[] }>({
    group: "",
    seasons: [],
  });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const reload = (event: Event) => {
      if ((event as CustomEvent<string>).detail === groupId) setVersion((n) => n + 1);
    };
    window.addEventListener(SEASONS_CHANGED, reload);
    return () => window.removeEventListener(SEASONS_CHANGED, reload);
  }, [groupId]);
  useEffect(() => {
    if (!groupId) return;
    let live = true;
    loadGameSeasons(groupId).then(
      (seasons) => live && setState({ group: groupId, seasons }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [groupId, version]);
  return state.group === groupId
    ? { seasons: state.seasons, ready: true }
    : { seasons: [] as { competition: string; mode: Mode }[], ready: !groupId };
}

/**
 * Quiniela and Clasificación in one tab. The header is shared and stays put:
 * the selected group is the title (tap it to change group) and the
 * competitions, official and your own, are the chips under it. Below,
 * «Mi boleto | Clasificación» switches the view over the same round.
 */
export default function QuinielaPage({
  matches,
  groups,
  groupsReady,
  user,
  demo,
  onLogin,
  onDemo,
}: {
  matches: Match[];
  groups: Group[];
  groupsReady: boolean;
  user: AppUser | null;
  demo: boolean;
  loading: boolean;
  onLogin: () => void;
  onDemo: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const view = quinielaView(params.get("vista"));
  const uid = demo ? "" : user?.uid || "";
  const { groupId, preferences } = useGroupSelection(uid, demo ? [] : groups);
  const selectedGroup = groups.find((g) => g.id === groupId);
  const { list: followed, ready: followedReady } = useFollowedCompetitions(uid);
  // One choice for Ligas and Quiniela: an official competition or one of yours.
  const choice = useLeagueChoice(uid);
  // A friends' league shows here only if you follow it (and it has predictions).
  const chosen =
    choice.liga && (!followedReady || followed.some((c) => c.id === choice.liga)) ? choice.liga : "";
  // Without a group the official competitions have no slip or table: open your league.
  const liga = demo || !user ? "" : chosen || (groupsReady && !groups.length ? followed[0]?.id || "" : "");
  const ligaInfo = followed.find((c) => c.id === liga);
  const { seasons, ready: seasonsReady } = useGroupSeasons(demo || !user ? "" : groupId);
  const [demoCompetition, setDemoCompetition] = useState<CompetitionCode>("PD");
  const [search, setSearch] = useState(false);
  const competition = demo ? demoCompetition : preferences.competition;
  const period = params.get("period") === "all" ? "all" : "round";
  const combined = view === "clasificacion" && period === "all" && params.get("todas") === "1";
  const mode: Mode | undefined = liga
    ? ligaInfo?.predictionMode
    : demo
      ? "classic"
      : seasons.find((s) => s.competition === competition)?.mode;
  const available: readonly CompetitionCode[] = demo
    ? COMPETITION_CODES
    : COMPETITION_CODES.filter((code) => seasons.some((s) => s.competition === code));
  // A group that doesn't play the chosen competition: its first one, everywhere.
  const playable = available.join();
  useEffect(() => {
    if (demo || liga || !uid || !seasonsReady || !available.length) return;
    if (!available.includes(preferences.competition))
      preferenceStore.update(uid, { competition: available[0] });
  }, [demo, liga, uid, seasonsReady, playable, preferences.competition]);

  // The header: what you play (group or your league) and in which competition.
  const title = liga
    ? ligaInfo?.name || "Tu liga"
    : demo
      ? "Grupo de demostración"
      : selectedGroup?.name || "Quiniela";
  const eyebrow = [
    liga ? "Liga propia" : "Quiniela",
    mode ? (mode === "classic" ? "1X2" : "Marcador exacto") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const update = (edit: (next: URLSearchParams) => void) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        edit(next);
        return next;
      },
      { replace: true },
    );
  const header = (
    <PageTitle
      eyebrow={eyebrow}
      title={title}
      navTitle={title}
      titlePicker={
        !liga && !demo && groups.length > 1
          ? {
              label: "Grupo",
              value: groupId,
              options: groups.map((g) => ({ value: g.id, label: g.name })),
              onChange: (id) => {
                haptic();
                if (uid) preferenceStore.update(uid, { groupId: id });
                // One URL update: another group, with its own rounds and totals.
                update((next) => {
                  next.set("group", id);
                  next.delete("round");
                  next.delete("todas");
                });
              },
            }
          : undefined
      }
      titleControl={
        !demo && (
          <LeagueSearchButton
            onClick={() => {
              haptic();
              setSearch(true);
            }}
          />
        )
      }
    >
      {(user || demo) && (
        <div className="league-selection">
          <CompetitionTabs
            value={liga ? "none" : combined ? "global" : competition}
            available={available}
            onChange={(code) => {
              if (code !== competition || liga || combined) haptic();
              if (demo) setDemoCompetition(code);
              choice.chooseOfficial(code, (next) => next.delete("todas"));
            }}
            onAll={
              view === "clasificacion" && period === "all" && !liga
                ? () => {
                    haptic();
                    update((next) => next.set("todas", "1"));
                  }
                : undefined
            }
          >
            {followed.length > 0 && (
              <CustomChips
                list={followed}
                current={liga}
                onSelect={(id) => {
                  if (id !== liga) haptic();
                  choice.chooseLiga(id, (next) => next.delete("todas"));
                }}
              />
            )}
          </CompetitionTabs>
        </div>
      )}
    </PageTitle>
  );

  // Switching views slides the content the way the tabs read; the header stays.
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef(view);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = view;
    if (from === view || prefersReducedMotion()) return;
    const direction = VIEWS.indexOf(view) > VIEWS.indexOf(from) ? 1 : -1;
    const { easing, duration } = springEasing({ response: 0.4, damping: 0.92 });
    const animation = panel.current?.animate(
      [
        { opacity: 0, transform: `translate3d(${direction * 28}px,0,0)` },
        { opacity: 1, transform: "translate3d(0,0,0)" },
      ],
      { duration, easing },
    );
    return () => animation?.cancel();
  }, [view]);
  const switchView = (next: QuinielaView) =>
    update((url) => {
      if (next === "clasificacion") url.set("vista", next);
      else url.delete("vista");
    });

  return (
    <div className="quiniela-page leagues-page">
      {header}
      {search && (
        <Suspense fallback={null}>
          <CompetitionSearch
            user={user}
            onLogin={onLogin}
            // Yours with a quiniela opens here; any other in Ligas.
            onOpen={(id) => {
              if (followed.some((c) => c.id === id)) choice.chooseLiga(id, (next) => next.delete("todas"));
              else go(`/ligas?liga=${encodeURIComponent(id)}`);
            }}
            onClose={() => setSearch(false)}
          />
        </Suspense>
      )}
      {/* Pinned under the bar like Ligas' sections: switch from anywhere in the slip. */}
      <LeagueNavigation<QuinielaView>
        tab={view}
        onChange={switchView}
        panel={panel}
        idPrefix="quiniela-view"
        panelId="quiniela-panel"
        label="Quiniela"
        tabs={[
          { id: "boleto", label: "Mi boleto" },
          { id: "clasificacion", label: "Clasificación" },
        ]}
      />
      <div
        ref={panel}
        id="quiniela-panel"
        role="tabpanel"
        aria-labelledby={`quiniela-view-${view}`}
        className="league-content quiniela-view"
        tabIndex={-1}
      >
        {view === "clasificacion" ? (
          <StandingsPage
            groups={groups}
            matches={matches}
            user={user}
            onLogin={onLogin}
            liga={liga}
            hasFollowed={followed.length > 0}
          />
        ) : !user && !demo ? (
          <PrivateGate onLogin={onLogin} onDemo={onDemo} />
        ) : (
          <PredictionsPage
            matches={matches}
            groups={groups}
            user={user}
            demo={demo}
            liga={liga}
            hasFollowed={followed.length > 0}
            demoCompetition={demoCompetition}
          />
        )}
      </div>
    </div>
  );
}
