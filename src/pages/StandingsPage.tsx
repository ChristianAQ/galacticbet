import {
  COMPETITION_CODES,
  competitionName,
  type CompetitionCode,
} from "../lib/competitions";
import type { User } from "firebase/auth";
import { ArrowRight } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Crest, Empty, PageTitle, PrivateGate } from "../components/ui";
import { type Group } from "../lib/data";
import { useGroupRankings } from "../lib/useGroupRankings";
import { type Match } from "../lib/domain";
import CompetitionTabs from "../components/CompetitionTabs";
import RoundSelector from "../components/RoundSelector";
import ShareTrigger from "../components/ShareTrigger";
import { shareFileName, standingsText } from "../lib/shareSummary";
import {
  MyRankCard,
  Podium,
  RankAvatar,
  RankBadge,
} from "../components/RankingWidgets";
import { formNames } from "../components/TeamForm";
import { currentLeagueTable, LEAGUE_STAGES } from "../lib/leagueTable";
import { preferenceStore } from "../lib/preferences";
import { useGroupSelection, usePreferences } from "../lib/useGroupSelection";
import {
  buildRanking,
  isClassicRanking,
  rankingRounds,
  currentRankingRound,
} from "../lib/rankings";
import {
  roundOptions,
  roundShortLabel,
  type RoundOption,
} from "../lib/roundOptions";

const ShareDialog = lazy(() => import("../components/ShareDialog"));

type View = "grupo" | "liga";
interface Zone {
  kind: "top" | "mid" | "down";
  label: string;
  test: (position: number, size: number) => boolean;
}
// Only shown when every team is in the table, so partial early tables are not labelled.
const leagueZones: Partial<
  Record<CompetitionCode, { size: number; zones: Zone[] }>
> = {
  PD: {
    size: 20,
    zones: [
      { kind: "top", label: "Champions League", test: (p) => p <= 4 },
      { kind: "down", label: "Descenso", test: (p, n) => p > n - 3 },
    ],
  },
  PL: {
    size: 20,
    zones: [
      { kind: "top", label: "Champions League", test: (p) => p <= 4 },
      { kind: "down", label: "Descenso", test: (p, n) => p > n - 3 },
    ],
  },
  CL: {
    size: 36,
    zones: [
      { kind: "top", label: "Octavos de final", test: (p) => p <= 8 },
      { kind: "mid", label: "Playoffs", test: (p) => p > 8 && p <= 24 },
    ],
  },
};

export default function StandingsPage({
  groups,
  matches,
  loading,
  user,
  onLogin,
}: {
  groups: Group[];
  matches: Match[];
  loading: boolean;
  user: User | null;
  onLogin: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("vista");
  const view: View =
    requested === "liga" || requested === "grupo"
      ? requested
      : user
        ? "grupo"
        : "liga";
  const setView = (next: View) =>
    setParams(
      (previous) => {
        const value = new URLSearchParams(previous);
        value.set("vista", next);
        return value;
      },
      { replace: true },
    );
  return (
    <>
      <PageTitle
        eyebrow={
          view === "liga" ? "TABLA DE LA COMPETICIÓN" : "CADA ACIERTO SUMA"
        }
        title="Clasificación"
      />
      <div
        className="view-tabs"
        data-view={view}
        role="group"
        aria-label="Tipo de clasificación"
      >
        <button
          type="button"
          aria-pressed={view === "grupo"}
          onClick={() => setView("grupo")}
        >
          Mi grupo
        </button>
        <button
          type="button"
          aria-pressed={view === "liga"}
          onClick={() => setView("liga")}
        >
          Liga
        </button>
      </div>
      {view === "liga" ? (
        <LeagueStandings
          matches={matches}
          loading={loading}
          userId={user?.uid || ""}
        />
      ) : !user ? (
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

function LeagueStandings({
  matches,
  loading,
  userId,
}: {
  matches: Match[];
  loading: boolean;
  userId: string;
}) {
  const preferences = usePreferences(userId);
  const [chosen, setChosen] = useState<CompetitionCode | null>(null);
  const available = useMemo(
    () =>
      COMPETITION_CODES.filter((code) =>
        matches.some(
          (m) => m.competition === code && LEAGUE_STAGES.includes(m.stage),
        ),
      ),
    [matches],
  );
  const wanted = chosen ?? preferences.competition;
  const code = available.find((c) => c === wanted) ?? available[0] ?? wanted;
  const rows = useMemo(
    () => currentLeagueTable(matches, code),
    [matches, code],
  );
  const config = leagueZones[code];
  const zones = config && rows.length === config.size ? config.zones : [];
  return (
    <>
      <CompetitionTabs
        value={code}
        available={available}
        onChange={(next) => {
          setChosen(next);
          preferenceStore.update(userId, { competition: next });
        }}
      />
      <div className="panel standings-panel" aria-busy={loading}>
        {loading ? (
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
        ) : !rows.length ? (
          <Empty title="Clasificación no disponible">
            Aparecerá cuando se disputen los primeros partidos de la fase de
            liga.
          </Empty>
        ) : (
          <div className="ranking-view" key={code}>
            <div className="standings-heading">
              <div>
                <h2>{competitionName(code)}</h2>
                <p>{rows.length} equipos · Resultados sincronizados</p>
              </div>
              <Link
                className="standings-heading-link"
                to={`/partidos?competition=${code}`}
              >
                Ver partidos <ArrowRight size={14} />
              </Link>
            </div>
            <table className="league-table">
              <caption className="sr-only">
                Clasificación de {competitionName(code)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Equipo</th>
                  <th scope="col" title="Partidos jugados">
                    PJ
                  </th>
                  <th scope="col" className="hide-sm" title="Ganados">
                    G
                  </th>
                  <th scope="col" className="hide-sm" title="Empatados">
                    E
                  </th>
                  <th scope="col" className="hide-sm" title="Perdidos">
                    P
                  </th>
                  <th scope="col" className="hide-sm" title="Goles">
                    Goles
                  </th>
                  <th scope="col" title="Diferencia de goles">
                    DG
                  </th>
                  <th scope="col">Pts</th>
                  <th scope="col" className="hide-md">
                    Forma
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const position = i + 1;
                  const zone = zones.find((z) => z.test(position, rows.length));
                  const diff = r.goalsFor - r.goalsAgainst;
                  return (
                    <tr
                      key={r.key}
                      className={zone ? `zone-${zone.kind}` : undefined}
                    >
                      <td>
                        <span className="league-pos">{position}</span>
                      </td>
                      <th scope="row">
                        <span className="league-team">
                          <Crest src={r.crest} />
                          <span>{r.name}</span>
                        </span>
                      </th>
                      <td>{r.played}</td>
                      <td className="hide-sm">{r.wins}</td>
                      <td className="hide-sm">{r.draws}</td>
                      <td className="hide-sm">{r.losses}</td>
                      <td className="hide-sm">
                        {r.goalsFor}:{r.goalsAgainst}
                      </td>
                      <td>{diff > 0 ? `+${diff}` : diff}</td>
                      <td>
                        <strong>{r.points}</strong>
                      </td>
                      <td className="hide-md">
                        <span
                          className="team-form"
                          aria-label={r.form
                            .map((f) => formNames[f])
                            .join(", ")}
                        >
                          {r.form.map((f, j) => (
                            <span
                              key={j}
                              className={`form-dot form-${f}`}
                              title={formNames[f]}
                            />
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {zones.length > 0 && (
              <ul className="league-legend">
                {zones.map((z) => (
                  <li key={z.kind} className={`zone-${z.kind}`}>
                    <i aria-hidden="true" />
                    {z.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}

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
  const [period, setPeriod] = useState<"all" | "round">(
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
  const showHits = !isClassicRanking(
    data?.seasons || [],
    scope,
    period === "round" ? selectedRound : "",
  );
  const hasPoints = rows.some((r) => r.points > 0);
  const leaderPoints = rows[0]?.points || 0;
  const title =
    period === "all"
      ? "Todas las jornadas"
      : rounds.find((r) => r.id === selectedRound)?.label || "Por jornada";
  const shareTitle =
    period === "all"
      ? `${scope === "global" ? "Global del grupo" : competitionName(scope)} · Todas las jornadas`
      : title;

  return (
    <>
      <div className="standings-toolbar">
        {groups.length > 1 && (
          <label className="standings-group-select">
            <span className="sr-only">Grupo</span>
            <select
              value={groupId}
              onChange={(e) => {
                selectGroup(e.target.value);
                setRound("");
              }}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div
          className="standings-period"
          data-period={period}
          role="group"
          aria-label="Periodo de clasificación"
        >
          <button
            type="button"
            aria-pressed={period === "round"}
            onClick={() => setPeriod("round")}
          >
            Por jornada
          </button>
          <button
            type="button"
            aria-pressed={period === "all"}
            onClick={() => setPeriod("all")}
          >
            Total
          </button>
        </div>
      </div>
      <CompetitionTabs
        value={scope}
        onChange={(value) => {
          preferenceStore.update(user.uid, { competition: value });
          setCombined(false);
          setRound("");
        }}
        onAll={period === "all" ? () => setCombined(true) : undefined}
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
                <p>{title}</p>
              </div>
              <span className="group-view-actions">
                <span>
                  {rows.length}{" "}
                  {rows.length === 1 ? "participante" : "participantes"}
                </span>
                <ShareTrigger
                  label="Compartir"
                  disabled={!rows.length}
                  onClick={() => setSharing(true)}
                />
              </span>
            </div>
            {sharing && (
              <Suspense fallback={null}>
                <ShareDialog
                  title={`Clasificación · ${selectedGroup.name}`}
                  filename={shareFileName(
                    "clasificacion",
                    selectedGroup.name,
                    shareTitle,
                  )}
                  text={standingsText({
                    groupName: selectedGroup.name,
                    title: shareTitle,
                    rows,
                    showHits,
                  })}
                  render={() =>
                    import("../lib/shareImage").then((m) =>
                      m.standingsImage({
                        groupName: selectedGroup.name,
                        title: shareTitle,
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
                  sincronicen y puntúen los resultados.
                </p>
              )
            )}
            {hasPoints && rows.length >= 2 && (
              <Podium rows={rows} userId={user.uid} />
            )}
            <MyRankCard rows={rows} userId={user.uid} showHits={showHits} />
            <table
              className={`standings-table${showHits ? "" : " standings-points-only"}`}
            >
              <caption className="sr-only">
                {selectedGroup.name} · {title} ·{" "}
                {scope === "global"
                  ? "Global del grupo"
                  : competitionName(scope)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Pos.</th>
                  <th scope="col">Jugador</th>
                  {showHits && <th scope="col">Aciertos</th>}
                  <th scope="col">Puntos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={r.id === user.uid ? "standings-me" : undefined}
                  >
                    <td>
                      <RankBadge position={r.position} />
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
                    {showHits && <td>{r.hits}</td>}
                    <td>
                      <strong>{r.points}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
