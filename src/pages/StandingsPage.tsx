import { competitionName, isCompetition, type CompetitionCode } from "../lib/competitions";
import type { AppUser as User } from "../lib/session";
import { ChevronDown, ChevronUp, Crown } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import GroupActions from "../components/GroupActions";
import { CustomChips } from "../components/CustomChips";
import { useFollowedCompetitions } from "../lib/followedCompetitions";
import { useLeagueChoice } from "../lib/useLeagueChoice";
import { haptic } from "../lib/motion";
import { Empty, PageTitle, PrivateGate } from "../components/ui";
import { SkeletonRows } from "../components/Skeleton";
import { type Group } from "../lib/data";
import { useGroupRankings } from "../lib/useGroupRankings";
import {
  hasMatchStarted,
  isRoundComplete,
  type Match,
} from "../lib/domain";
import PotCard from "../components/PotCard";
import RoundRecap from "../components/RoundRecap";
import { roundRecap } from "../lib/roundRecap";
import { groupPotCents, roundPot } from "../lib/pot";
import { useRoundAttendance } from "../lib/useRoundAttendance";
import PageFilters, { Segmented } from "../components/PageFilters";
import RoundSelector from "../components/RoundSelector";
import ShareTrigger from "../components/ShareTrigger";
import { shareFileName, standingsText } from "../lib/shareSummary";
import {
  MyRankCard,
  RankAvatar,
  RankBadge,
} from "../components/RankingWidgets";
import { preferenceStore } from "../lib/preferences";
import { useGroupSelection } from "../lib/useGroupSelection";
import {
  buildRanking,
  currentRankingRound,
  isClassicRanking,
  latestScoredRound,
  rankingMovement,
  rankingRounds,
} from "../lib/rankings";
import {
  roundOptions,
  roundShortLabel,
  type RoundOption,
} from "../lib/roundOptions";
import "../styles/standings.css";

const ShareDialog = lazy(() => import("../components/ShareDialog"));
const CustomStandings = lazy(() => import("../components/CustomStandings"));

/** The group ranking only: competition tables live in each match page. */
export default function StandingsPage({
  groups,
  groupsReady,
  matches,
  user,
  onLogin,
  viewTabs,
}: {
  groups: Group[];
  /** Your groups have loaded (an empty list means you really have none). */
  groupsReady: boolean;
  matches: Match[];
  loading: boolean;
  user: User | null;
  onLogin: () => void;
  /** «Mi boleto | Clasificación»: the same tab shows your slip with these filters. */
  viewTabs?: ReactNode;
}) {
  // Your friends' competitions sit next to LaLiga, Champions and Premier.
  const { list: followed, ready: followedReady } = useFollowedCompetitions(user?.uid || "");
  // The competition chosen in Ligas, Quiniela or Clasificación: one choice for all.
  const choice = useLeagueChoice(user?.uid || "");
  // A friends' league has a table here only if you follow it (and it has predictions).
  const chosen =
    choice.liga && (!followedReady || followed.some((c) => c.id === choice.liga)) ? choice.liga : "";
  // Without a group there is no official table: open your league.
  const liga = user
    ? chosen || (groupsReady && !groups.length ? followed[0]?.id || "" : "")
    : "";
  const setLiga = (id: string) => choice.chooseLiga(id);
  const chips = followed.length > 0 && (
    <CustomChips
      list={followed}
      current={liga}
      onSelect={(id) => {
        if (id !== liga) haptic();
        setLiga(id);
      }}
    />
  );
  if (user && liga)
    return (
      <CustomStandingsPage
        cid={liga}
        user={user}
        chips={chips}
        hasGroups={groups.length > 0}
        onOfficial={(code) => choice.chooseOfficial(code)}
        viewTabs={viewTabs}
      />
    );
  if (user && groups.length)
    return (
      <GroupStandings
        groups={groups}
        matches={matches}
        user={user}
        chips={chips}
        viewTabs={viewTabs}
      />
    );
  return (
    <>
      <StandingsTitle viewTabs={viewTabs} />
      {!user ? (
        <PrivateGate onLogin={onLogin} />
      ) : (
        <>
          {chips && (
            <PageFilters
              groups={[]}
              groupId=""
              onGroup={() => undefined}
              competition="none"
              available={[]}
              onCompetition={() => undefined}
              chips={chips}
            />
          )}
          <Empty
            art="podium"
            title="Un podio sin nadie encima"
            action={<GroupActions />}
          >
            {chips
              ? "Toca tu liga arriba para ver su tabla. Para LaLiga, Champions y Premier hace falta un grupo: crea el tuyo o únete con el código de un amigo."
              : "La tabla cobra vida con un grupo. Crea el tuyo o únete con el código de un amigo y que empiece el pique."}
          </Empty>
        </>
      )}
    </>
  );
}

/** One of your friends' competitions: its followers' table, by round or in total. */
function CustomStandingsPage({
  cid,
  user,
  chips,
  hasGroups,
  onOfficial,
  viewTabs,
}: {
  cid: string;
  user: User;
  chips: ReactNode;
  /** Without a group the official tables don't exist: their chips stay off. */
  hasGroups: boolean;
  onOfficial: (code: CompetitionCode) => void;
  viewTabs?: ReactNode;
}) {
  const [period, setPeriod] = usePeriod();
  return (
    <>
      <StandingsTitle viewTabs={viewTabs} />
      <PageFilters
        groups={[]}
        groupId=""
        groupLabel="Seguidores"
        onGroup={() => undefined}
        competition="none"
        available={hasGroups ? undefined : []}
        onCompetition={onOfficial}
        chips={chips}
        aside={
          <Segmented<Period>
            label="Periodo de clasificación"
            value={period}
            options={[
              { value: "round", label: "Jornada" },
              { value: "all", label: "Total" },
            ]}
            onChange={setPeriod}
          />
        }
      />
      <Suspense
        fallback={
          <SkeletonRows rows={6} variant="line" label="Cargando clasificación" />
        }
      >
        <CustomStandings key={cid} cid={cid} user={user} period={period} />
      </Suspense>
    </>
  );
}

function StandingsTitle({
  action,
  viewTabs,
  eyebrow = "Clasificación",
}: {
  action?: ReactNode;
  viewTabs?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <>
      <PageTitle
        eyebrow={eyebrow}
        title="Quiniela"
        titleControl={action}
      />
      {viewTabs}
    </>
  );
}

type Period = "round" | "all";
/** «Jornada» or «Total», kept in the URL: switching to the slip and back keeps it. */
function usePeriod() {
  const [params, setParams] = useSearchParams();
  const period: Period = params.get("period") === "all" ? "all" : "round";
  const setPeriod = (value: Period) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === "all") next.set("period", "all");
        else next.delete("period");
        return next;
      },
      { replace: true },
    );
  return [period, setPeriod] as const;
}

function GroupStandings({
  groups,
  matches,
  user,
  chips,
  viewTabs,
}: {
  groups: Group[];
  matches: Match[];
  user: User;
  chips?: ReactNode;
  viewTabs?: ReactNode;
}) {
  const { groupId, selectGroup, preferences } = useGroupSelection(
    user.uid,
    groups,
  );
  const competition = preferences.competition;
  const [combined, setCombined] = useState(false);
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = usePeriod();
  const scope = period === "all" && combined ? "global" : competition;
  /*
   * The round lives in the URL (?round=), shared with your slip: switching
   * between them, «Volver», an aviso or a link land on the same round.
   */
  const round = params.get("round") || "";
  const setRound = (id: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (id) next.set("round", id);
        else next.delete("round");
        return next;
      },
      { replace: true },
    );
  // A round of another competition (an aviso, a link): open that competition.
  const lastRound = useRef("");
  useEffect(() => {
    if (!round || lastRound.current === round) return;
    lastRound.current = round;
    const code = round.split("-")[0];
    if (isCompetition(code) && code !== preferences.competition) {
      preferenceStore.update(user.uid, { competition: code, liga: "" });
      setCombined(false);
    }
  }, [round]);
  const [sharing, setSharing] = useState(false);
  const selectedGroup = groups.find((g) => g.id === groupId);
  const { data, error, retry } = useGroupRankings(user.uid, selectedGroup);
  const rounds = useMemo(
    () => rankingRounds(data?.seasons || [], matches, scope),
    [data, matches, scope],
  );
  const current = useMemo(
    () =>
      currentRankingRound(
        matches,
        rounds.map((r) => r.id),
      ),
    [matches, rounds],
  );
  const selectedRound = rounds.some((r) => r.id === round) ? round : current;
  const roundChoices = useMemo((): RoundOption[] => {
    const ids = new Set(rounds.map((r) => r.id));
    const known = new Map(
      roundOptions(matches.filter((m) => ids.has(m.roundId))).map((r) => [
        r.id,
        r,
      ]),
    );
    return rounds.map((r) => {
      const [, , stage = "", matchday = "0"] = r.id.split("-");
      // The same name as in your slip («Jornada 10»): one round selector for both views.
      return (
        known.get(r.id) || {
          id: r.id,
          short: roundShortLabel({ stage, matchday: Number(matchday) || 0 }),
          start: r.kickoff,
          end: r.kickoff,
          state: "finished" as const,
          matches: 0,
          label: r.label,
        }
      );
    });
  }, [rounds, matches]);
  const roundUnavailable = period === "round" && !selectedRound;
  const rows = useMemo(
    () =>
      buildRanking(
        data?.participants || [],
        roundUnavailable ? [] : data?.seasons || [],
        scope,
        period === "round" ? selectedRound : "",
      ),
    [data, roundUnavailable, scope, period, selectedRound],
  );
  // In the season total: points of the latest scored round and places moved with it.
  const latest = useMemo(
    () =>
      period === "all" && data
        ? latestScoredRound(
            data.participants,
            data.seasons,
            scope,
            rounds.map((r) => r.id),
          )
        : null,
    [period, data, scope, rounds],
  );
  const movement = useMemo(
    () => (latest ? rankingMovement(rows, latest.rows) : null),
    [rows, latest],
  );
  const latestPoints = new Map(latest?.rows.map((r) => [r.id, r.points]));
  const latestLabel = latest
    ? roundChoices.find((r) => r.id === latest.id)?.short
    : "";
  const showHits = !isClassicRanking(
    data?.seasons || [],
    scope,
    period === "round" ? selectedRound : "",
  );
  const potCents = groupPotCents(selectedGroup);
  const potRound = period === "round" && potCents > 0 ? selectedRound : "";
  const attendance = useRoundAttendance(groupId, potRound, Boolean(potRound));
  const pot = useMemo(() => {
    if (!potRound || !data) return null;
    const fixtures = matches.filter((m) => m.roundId === potRound);
    return roundPot({
      contributionCents: potCents,
      rows,
      participantIds: attendance.ids,
      started: fixtures.some((m) => hasMatchStarted(m, Date.now())),
      complete: isRoundComplete(fixtures),
    });
  }, [potRound, data, matches, potCents, rows, attendance.ids]);
  const hasPoints = rows.some((r) => r.points > 0);
  // Shared with the round: what the pot is worth, who collects it, who pays.
  const sharedPot = pot && attendance.ready && !attendance.error ? pot : null;
  // A finished round tells its story: winner, your round, the highlights.
  const roundFixtures = useMemo(
    () => matches.filter((m) => m.roundId === selectedRound),
    [matches, selectedRound],
  );
  const recap = useMemo(
    () =>
      period === "round" &&
      data &&
      selectedRound &&
      scope !== "global" &&
      isRoundComplete(roundFixtures)
        ? roundRecap({
            participants: data.participants,
            seasons: data.seasons,
            scope,
            roundIds: rounds.map((r) => r.id),
            roundId: selectedRound,
            userId: user.uid,
            fixtures: roundFixtures,
          })
        : null,
    [period, data, selectedRound, scope, roundFixtures, rounds, user.uid],
  );
  const recapMode =
    data?.seasons.find((s) => selectedRound.startsWith(`${s.id}-`))?.mode || "classic";
  const shareGroup = selectedGroup?.name || "";
  const leaderPoints = rows[0]?.points || 0;
  const scopeName =
    scope === "global" ? "Todas las competiciones" : competitionName(scope);
  const title =
    period === "all"
      ? `${scopeName} · Temporada completa`
      : rounds.find((r) => r.id === selectedRound)?.label || "Por jornada";

  return (
    <>
      <StandingsTitle
        viewTabs={viewTabs}
        eyebrow={`Clasificación · ${scope === "global" ? "Todas" : competitionName(scope, true)}`}
        action={
          <ShareTrigger
            label="Compartir"
            disabled={!data || !rows.length}
            onClick={() => setSharing(true)}
          />
        }
      />
      {sharing && data && (
        <Suspense fallback={null}>
          <ShareDialog
            title={`Clasificación · ${shareGroup}`}
            filename={shareFileName("clasificacion", shareGroup, title)}
            text={standingsText({
              groupName: shareGroup,
              title,
              rows,
              showHits,
              pot: sharedPot,
            })}
            render={() =>
              import("../lib/shareImage").then((m) =>
                m.standingsImage({
                  groupName: shareGroup,
                  title,
                  rows,
                  showHits,
                  pot: sharedPot,
                }),
              )
            }
            onClose={() => setSharing(false)}
          />
        </Suspense>
      )}
      <PageFilters
        groups={groups}
        groupId={groupId}
        onGroup={(id) => {
          selectGroup(id);
          setRound("");
        }}
        competition={scope}
        onCompetition={(value) => {
          preferenceStore.update(user.uid, { competition: value, liga: "" });
          setCombined(false);
          setRound("");
        }}
        onAll={period === "all" ? () => setCombined(true) : undefined}
        chips={chips}
        aside={
          <Segmented<Period>
            label="Periodo de clasificación"
            value={period}
            options={[
              { value: "round", label: "Jornada" },
              { value: "all", label: "Total" },
            ]}
            onChange={setPeriod}
          />
        }
      />
      {selectedGroup && period === "round" && data && (
        <RoundSelector
          rounds={roundChoices}
          value={selectedRound}
          current={current}
          onChange={setRound}
        />
      )}
      <div
        className="standings-body"
        aria-busy={Boolean(selectedGroup && !data && !error)}
      >
        {!selectedGroup ? (
          <Empty art="podium" title="¿Qué tabla miramos?">
            Elige un grupo arriba y verás a todos sus jugadores con sus puntos.
          </Empty>
        ) : error ? (
          <div role="alert">
            <Empty
              art="whistle"
              title="El árbitro ha parado el partido"
              action={
                <button className="button secondary" onClick={retry}>
                  Reintentar
                </button>
              }
            >
              No se pudo cargar la clasificación. {error}
            </Empty>
          </div>
        ) : !data ? (
          <div className="standings-skeleton">
            <SkeletonRows rows={6} variant="line" label="Cargando clasificación" />
          </div>
        ) : (
          <div
            className="ranking-view"
            key={`${groupId}:${scope}:${period}:${selectedRound}`}
          >
            {recap ? (
              <RoundRecap
                recap={recap}
                title={rounds.find((r) => r.id === selectedRound)?.label.replace(/ · \d{4}\/\d{2}$/, "") || "Jornada"}
                shortTitle={roundChoices.find((r) => r.id === selectedRound)?.short || "Jornada"}
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
                members={selectedGroup.memberIds}
                mode={recapMode}
                fixtures={roundFixtures}
                showHits={showHits}
                userId={user.uid}
                pot={sharedPot}
              />
            ) : (
              <MyRankCard rows={rows} userId={user.uid} showHits={showHits} />
            )}
            {pot && attendance.ready && !attendance.error && (
              <PotCard
                pot={pot}
                userId={user.uid}
                manageTo={
                  selectedGroup.ownerId === user.uid
                    ? `/grupos?group=${encodeURIComponent(selectedGroup.id)}#bote`
                    : undefined
                }
              />
            )}
            {attendance.error && potRound && (
              <p className="setup-notice" role="status">
                No se pudo leer quién ha entrado en el bote: {attendance.error}
              </p>
            )}
            {!rows.length && (
              <Empty art="podium" title="Tabla en blanco">
                Esta jornada todavía no tiene participantes con boleto.
              </Empty>
            )}
            <section
              className="standings-card"
              hidden={!rows.length}
              aria-labelledby="standings-table-title"
            >
              <header className="standings-heading">
                <h2 id="standings-table-title">
                  {period === "all" ? "La temporada" : "La jornada"}
                </h2>
                <span>
                  {rows.length} {rows.length === 1 ? "jugador" : "jugadores"}
                </span>
              </header>
              <table
                className={`standings-table${showHits ? "" : " standings-points-only"}${latest ? " has-latest" : ""}`}
              >
                <caption className="sr-only">
                  {selectedGroup.name} · {title}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Pos.</th>
                    <th scope="col">Jugador</th>
                    {latest && (
                      <th scope="col" title={`Puntos en ${latestLabel}`}>
                        Últ.
                      </th>
                    )}
                    {showHits && (
                      <th scope="col" title="Aciertos">
                        Ac.
                      </th>
                    )}
                    <th scope="col">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const moved = movement?.get(r.id) || 0;
                    return (
                      <tr
                        key={r.id}
                        className={
                          r.id === user.uid ? "standings-me" : undefined
                        }
                      >
                        <td>
                          <span className="standings-position">
                            <RankBadge position={r.position} />
                            {moved !== 0 && (
                              <span
                                className={`standings-move ${moved > 0 ? "is-up" : "is-down"}`}
                                aria-label={`${moved > 0 ? "Sube" : "Baja"} ${Math.abs(moved)} ${Math.abs(moved) === 1 ? "puesto" : "puestos"}`}
                              >
                                {moved > 0 ? (
                                  <ChevronUp size={12} aria-hidden="true" />
                                ) : (
                                  <ChevronDown size={12} aria-hidden="true" />
                                )}
                                {Math.abs(moved)}
                              </span>
                            )}
                          </span>
                        </td>
                        <th scope="row">
                          <span className="standings-player">
                            <RankAvatar name={r.name} avatar={r.avatar} />
                            <span className="standings-name">
                              <span>
                                {r.position === 1 && hasPoints && (
                                  <Crown
                                    className="standings-crown"
                                    size={14}
                                    strokeWidth={2.4}
                                    aria-label="Líder"
                                  />
                                )}
                                {r.name}
                                {r.id === user.uid && <small> · Tú</small>}
                              </span>
                              <span
                                className="standings-bar"
                                aria-hidden="true"
                              >
                                <i
                                  style={{
                                    transform: `scaleX(${leaderPoints ? r.points / leaderPoints : 0})`,
                                  }}
                                />
                              </span>
                            </span>
                          </span>
                        </th>
                        {latest && (
                          <td className="standings-latest">
                            {latestPoints.get(r.id)
                              ? `+${latestPoints.get(r.id)}`
                              : "0"}
                          </td>
                        )}
                        {showHits && <td>{r.hits}</td>}
                        <td>
                          <strong>{r.points}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
            {latest && (
              <p className="standings-footnote">
                «Últ.»: lo que sumó cada uno en {latestLabel}. Las flechas
                cuentan los puestos ganados o perdidos con esa jornada.
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
