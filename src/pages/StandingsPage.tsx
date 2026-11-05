import { competitionName } from "../lib/competitions";
import type { User } from "firebase/auth";
import { ChevronDown, ChevronUp } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Empty, PageTitle, PrivateGate } from "../components/ui";
import { type Group } from "../lib/data";
import { useGroupRankings } from "../lib/useGroupRankings";
import { type Match } from "../lib/domain";
import PageFilters, { Segmented } from "../components/PageFilters";
import RoundSelector from "../components/RoundSelector";
import ShareTrigger from "../components/ShareTrigger";
import { shareFileName, standingsText } from "../lib/shareSummary";
import {
  MyRankCard,
  Podium,
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

const ShareDialog = lazy(() => import("../components/ShareDialog"));

/** The group ranking only: competition tables live in each match page. */
export default function StandingsPage({
  groups,
  matches,
  user,
  onLogin,
}: {
  groups: Group[];
  matches: Match[];
  loading: boolean;
  user: User | null;
  onLogin: () => void;
}) {
  return (
    <>
      <PageTitle eyebrow="CADA ACIERTO SUMA" title="Clasificación" />
      {!user ? (
        <PrivateGate onLogin={onLogin} />
      ) : !groups.length ? (
        <Empty title="Tu grupo, en la tabla">
          <Link to="/grupos">
            Crea un grupo o únete con un código de invitación.
          </Link>
        </Empty>
      ) : (
        <GroupStandings groups={groups} matches={matches} user={user} />
      )}
    </>
  );
}

type Period = "round" | "all";

function GroupStandings({
  groups,
  matches,
  user,
}: {
  groups: Group[];
  matches: Match[];
  user: User;
}) {
  const { groupId, selectGroup, preferences } = useGroupSelection(
    user.uid,
    groups,
  );
  const competition = preferences.competition;
  const [combined, setCombined] = useState(false);
  const [params] = useSearchParams();
  const [period, setPeriod] = useState<Period>(
    params.get("period") === "all" ? "all" : "round",
  );
  const scope = period === "all" && combined ? "global" : competition;
  const [round, setRound] = useState("");
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
      return {
        ...(known.get(r.id) || {
          id: r.id,
          short: roundShortLabel({ stage, matchday: Number(matchday) || 0 }),
          start: r.kickoff,
          end: r.kickoff,
          state: "finished" as const,
          matches: 0,
        }),
        label: r.label,
      };
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
  const hasPoints = rows.some((r) => r.points > 0);
  const leaderPoints = rows[0]?.points || 0;
  const scopeName =
    scope === "global" ? "Todas las competiciones" : competitionName(scope);
  const title =
    period === "all"
      ? `${scopeName} · Temporada completa`
      : rounds.find((r) => r.id === selectedRound)?.label || "Por jornada";

  return (
    <>
      <PageFilters
        groups={groups}
        groupId={groupId}
        onGroup={(id) => {
          selectGroup(id);
          setRound("");
        }}
        competition={scope}
        onCompetition={(value) => {
          preferenceStore.update(user.uid, { competition: value });
          setCombined(false);
          setRound("");
        }}
        onAll={period === "all" ? () => setCombined(true) : undefined}
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
        className="panel standings-panel"
        aria-busy={Boolean(selectedGroup && !data && !error)}
      >
        {!selectedGroup ? (
          <Empty title="Tu grupo, en la tabla">
            Selecciona un grupo para ver a todos sus participantes y sus puntos.
          </Empty>
        ) : error ? (
          <div role="alert" className="empty">
            <h3>No se pudo cargar la clasificación</h3>
            <p>{error}</p>
            <button className="button secondary" onClick={retry}>
              Reintentar
            </button>
          </div>
        ) : !data ? (
          <div
            className="standings-skeleton"
            role="status"
            aria-label="Cargando clasificación"
          >
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div
            className="ranking-view"
            key={`${groupId}:${scope}:${period}:${selectedRound}`}
          >
            <div className="standings-heading">
              <div>
                <h2>{selectedGroup.name}</h2>
                <p>
                  {title} · {rows.length}{" "}
                  {rows.length === 1 ? "participante" : "participantes"}
                </p>
              </div>
              <ShareTrigger
                label="Compartir"
                disabled={!rows.length}
                onClick={() => setSharing(true)}
              />
            </div>
            {sharing && (
              <Suspense fallback={null}>
                <ShareDialog
                  title={`Clasificación · ${selectedGroup.name}`}
                  filename={shareFileName(
                    "clasificacion",
                    selectedGroup.name,
                    title,
                  )}
                  text={standingsText({
                    groupName: selectedGroup.name,
                    title,
                    rows,
                    showHits,
                  })}
                  render={() =>
                    import("../lib/shareImage").then((m) =>
                      m.standingsImage({
                        groupName: selectedGroup.name,
                        title,
                        rows,
                        showHits,
                      }),
                    )
                  }
                  onClose={() => setSharing(false)}
                />
              </Suspense>
            )}
            {roundUnavailable ? (
              <p className="standings-note" role="status">
                Aún no hay jornadas disponibles para esta competición. Estos son
                los participantes, con 0 puntos para esta vista.
              </p>
            ) : (
              !hasPoints && (
                <p className="standings-note" role="status">
                  Todos en la línea de salida. Los puntos aparecerán cuando se
                  puntúen los primeros resultados.
                </p>
              )
            )}
            {hasPoints && rows.length >= 2 && (
              <Podium rows={rows} userId={user.uid} />
            )}
            <MyRankCard rows={rows} userId={user.uid} showHits={showHits} />
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
                      Acie.
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
                      className={r.id === user.uid ? "standings-me" : undefined}
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
                              {r.name}
                              {r.id === user.uid && <small> Tú</small>}
                            </span>
                            <span className="standings-bar" aria-hidden="true">
                              <i
                                style={{
                                  width: `${leaderPoints ? (r.points / leaderPoints) * 100 : 0}%`,
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
            {latest && (
              <p className="standings-footnote">
                «Últ.»: puntos de {latestLabel}. Las flechas indican los puestos
                ganados o perdidos con esa jornada.
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
