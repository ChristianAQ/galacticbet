import { useMemo, useState } from "react";
import type { Match } from "../lib/domain";
import type {
  MatchLineup,
  MatchPlayer,
  PlayerStat,
} from "../lib/matchInsightsData";
import {
  minuteMark,
  playersByShots,
  shortPlayerName,
} from "../lib/matchPresentation";
import Segmented from "./Segmented";
import "../styles/matchExtras.css";

type Side = "home" | "away";

const COLUMNS: { stat: PlayerStat; short: string; label: string }[] = [
  { stat: "shots", short: "Tir", label: "Tiros" },
  { stat: "shotsOnTarget", short: "Pta", label: "Tiros a puerta" },
  { stat: "goals", short: "G", label: "Goles" },
  { stat: "assists", short: "A", label: "Asistencias" },
  { stat: "foulsCommitted", short: "FC", label: "Faltas cometidas" },
  { stat: "foulsSuffered", short: "FR", label: "Faltas recibidas" },
];

function Cards({ player }: { player: MatchPlayer }) {
  const yellow = player.stats?.yellowCards ?? 0,
    red = player.stats?.redCards ?? 0;
  const cards = [
    ...(yellow >= 2
      ? [["second-yellow", "Doble amarilla"]]
      : yellow
        ? [["yellow-card", "Tarjeta amarilla"]]
        : []),
    ...(red && yellow < 2 ? [["red-card", "Tarjeta roja"]] : []),
  ];
  return cards.map(([kind, label]) => (
    <i
      key={kind}
      className={`incident-card ${kind}`}
      role="img"
      aria-label={label}
    />
  ));
}

/** Each player's numbers in the match, by team, most shots first. */
export default function PlayerStats({
  match,
  lineups,
}: {
  match: Match;
  lineups: MatchLineup[];
}) {
  const played = useMemo(() => {
    const of = (side: Side) =>
      playersByShots(lineups.find((l) => l.side === side)?.players || []);
    return { home: of("home"), away: of("away") };
  }, [lineups]);
  const [side, setSide] = useState<Side>(
    played.home.length ? "home" : "away",
  );
  const leaders = useMemo(
    () =>
      playersByShots([...played.home, ...played.away])
        .filter((p) => (p.stats?.shots ?? 0) > 0)
        .slice(0, 3),
    [played],
  );
  const players = played[side];
  if (!played.home.length && !played.away.length) return null;
  const top = (stat: PlayerStat) =>
    Math.max(0, ...players.map((p) => p.stats?.[stat] ?? 0));
  return (
    <section className="match-block player-stats">
      <h3 className="match-block-title">Jugadores</h3>
      {leaders.length > 0 && (
        <p className="player-stats-leaders">
          <span>Más tiros</span>
          {leaders.map((p) => (
            <span key={p.name}>
              <strong>{shortPlayerName(p.name)}</strong> {p.stats!.shots}
              <small> ({p.stats!.shotsOnTarget ?? 0} a puerta)</small>
            </span>
          ))}
        </p>
      )}
      <Segmented<Side>
        label="Equipo"
        className="player-stats-switch"
        size="sm"
        value={side}
        options={(["home", "away"] as const).map((s) => ({
          value: s,
          label: match[s],
          disabled: !played[s].length,
        }))}
        onChange={setSide}
      />
      {players.length > 0 ? (
        <table className="player-stats-table">
          <caption className="sr-only">
            Estadísticas de cada jugador de {match[side]}, ordenadas por tiros.
          </caption>
          <thead>
            <tr>
              <th scope="col">Jugador</th>
              {COLUMNS.map((c) => (
                <th key={c.stat} scope="col">
                  <abbr title={c.label}>{c.short}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => {
              const saves = p.stats?.saves;
              const details = [
                p.position !== "SUB" && p.position,
                p.subIn && `Entra ${minuteMark(p.subIn)}`,
                p.subOut && `Sale ${minuteMark(p.subOut)}`,
                saves !== undefined &&
                  `${saves} ${saves === 1 ? "parada" : "paradas"}`,
              ].filter(Boolean);
              return (
                <tr key={`${p.name}-${i}`}>
                  <th scope="row">
                    <span className="player-stats-name">
                      {p.number && <b>{p.number}</b>}
                      <span title={p.name}>{shortPlayerName(p.name)}</span>
                      <Cards player={p} />
                    </span>
                    {details.length > 0 && <small>{details.join(" · ")}</small>}
                  </th>
                  {COLUMNS.map(({ stat }) => {
                    const value = p.stats?.[stat];
                    return (
                      <td
                        key={stat}
                        className={
                          !value
                            ? "is-zero"
                            : value === top(stat)
                              ? "is-top"
                              : undefined
                        }
                      >
                        {value ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="match-extra-empty">
          Sin estadísticas por jugador de este equipo.
        </p>
      )}
      <p className="match-extra-note">
        Tir: tiros · Pta: a puerta · G: goles · A: asistencias · FC: faltas
        cometidas · FR: faltas recibidas. Solo quien ha jugado, según ESPN; en
        amarillo, la cifra más alta del equipo.
      </p>
    </section>
  );
}
