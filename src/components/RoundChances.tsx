import { useContext, useEffect, useId, useMemo, useState } from "react";
import type { Match, Mode, Outcome } from "../lib/domain";
import type { MachineRound } from "../lib/machinePicks";
import { impliedProbabilities, type OddsBoard } from "../lib/odds";
import type { RoundPlayer } from "../lib/roundBoard";
import { loadOdds } from "../lib/useMatchOdds";
import { LiveContext, useMinuteClock } from "../lib/useLiveBoard";
import { keyResults, simFixture, simulateRound, TYPICAL_CHANCES, type Chances } from "../lib/winChances";
import "../styles/chances.css";

const pct = (p: number) =>
  p <= 0 ? "0 %" : p >= 1 ? "100 %" : p < 0.005 ? "<1 %" : p > 0.995 ? ">99 %" : `${Math.round(p * 100)} %`;

/** «Gana el Betis», «Empate», «Gana el Sevilla» for a sign of a match. */
function signName(sign: Outcome, m: Match) {
  return sign === "1" ? `Gana ${m.home}` : sign === "2" ? `Gana ${m.away}` : "Empate";
}

/**
 * «¿Quién se lleva la jornada?»: each player's chance of winning the round
 * (alone or sharing it), from the round simulated many times with the
 * market's chances and, while a match is in play, its score and minute.
 * For you, «Qué necesitas»: the results that move your chance most, and
 * your likeliest way to win.
 */
export default function RoundChances({
  matches,
  players,
  mode,
  userId,
  machineRound,
}: {
  matches: Match[];
  players: RoundPlayer[];
  mode: Mode;
  userId: string;
  /** Market chances frozen before the round closed, when the backend has them. */
  machineRound?: MachineRound;
}) {
  const titleId = useId();
  const live = matches.some((m) => ["IN_PLAY", "PAUSED"].includes(m.status));
  const now = useMinuteClock(live);
  const board = useContext(LiveContext).board;
  // Without frozen chances, today's market (the same document as the match pages).
  const needsOdds = matches.some((m) => !machineRound?.matches[m.id]?.p);
  const [odds, setOdds] = useState<OddsBoard | null>(null);
  useEffect(() => {
    if (!needsOdds) return;
    let active = true;
    loadOdds().then(
      (b) => active && setOdds(b),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [needsOdds]);
  const chanceOf = (m: Match): { chances: Chances; typical: boolean } => {
    const frozen = machineRound?.matches[m.id]?.p;
    if (frozen) return { chances: frozen, typical: false };
    const implied = odds?.matches[m.id] ? impliedProbabilities(odds.matches[m.id].bookmakers) : null;
    return implied
      ? { chances: { home: implied.home / 100, draw: implied.draw / 100, away: implied.away / 100 }, typical: false }
      : { chances: TYPICAL_CHANCES, typical: true };
  };
  // Whole minutes only: the figures move with the game, not with every render.
  const minute = Math.floor(now / 60_000);
  const inputs = matches.map((m) => ({ m, ...chanceOf(m), live: board?.matches.find((l) => l.id === m.id) }));
  const fixtures = inputs.flatMap(({ m, chances, live: l }) => simFixture(m, chances, l, minute * 60_000) ?? []);
  const typical = inputs.filter((i) => i.typical && !fixtures.find((f) => f.id === i.m.id)?.decided).length;
  const fixturesKey = JSON.stringify(fixtures);
  const focus = players.some((p) => p.id === userId) ? userId : undefined;
  const result = useMemo(
    () => (fixtures.some((f) => !f.decided) ? simulateRound({ fixtures, players, mode, focus }) : null),
    // The fixtures by value: a new array with the same figures is the same round.
    [fixturesKey, players, mode, focus],
  );
  if (!result || players.length < 2) return null;
  const rows = [...players].sort((a, b) => result.win[b.id] - result.win[a.id] || a.id.localeCompare(b.id));
  const needs = focus ? keyResults(result) : [];
  const byId = new Map(matches.map((m) => [m.id, m]));
  const mine = focus ? result.win[focus] : 0;
  const path = result.path && mine > 0.005 && mine < 0.995 ? Object.entries(result.path.signs) : [];
  return (
    <section className="panel round-chances" aria-labelledby={titleId}>
      <header className="round-board-heading">
        <h3 id={titleId}>¿Quién se lleva la jornada?</h3>
        <small>
          {live ? (
            <>
              <i className="live-dot" aria-hidden="true" /> Con el marcador en directo
            </>
          ) : (
            "Probabilidad de ganarla"
          )}
        </small>
      </header>
      <ol className="chances-list">
        {rows.map((p) => (
          <li key={p.id} className={p.id === userId ? "is-me" : undefined}>
            <span className="chances-name">
              {p.name}
              {p.id === userId && <small> · Tú</small>}
            </span>
            <span className="chances-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${result.win[p.id]})` }} />
            </span>
            <b className="chances-value">{pct(result.win[p.id])}</b>
          </li>
        ))}
      </ol>
      {needs.length > 0 && (
        <div className="chances-need">
          <h4>Qué necesitas</h4>
          <ul>
            {needs.map(({ matchId, byResult }) => {
              const m = byId.get(matchId)!;
              return (
                <li key={matchId}>
                  <span className="chances-match">
                    {m.home} – {m.away}
                  </span>
                  <span className="chances-ifs">
                    {(["1", "X", "2"] as Outcome[])
                      .filter((s) => byResult[s] !== undefined)
                      .map((s) => (
                        <span key={s} className="chances-if">
                          {signName(s, m)} <b>{pct(byResult[s]!)}</b>
                        </span>
                      ))}
                  </span>
                </li>
              );
            })}
          </ul>
          {path.length > 0 && (
            <p className="chances-path">
              Tu camino más probable:{" "}
              {path
                .slice(0, 4)
                .map(([id, s]) => {
                  const m = byId.get(id)!;
                  return s === "X" ? `empate en el ${m.home}–${m.away}` : `gana ${s === "1" ? m.home : m.away}`;
                })
                .join(" · ")}
              {path.length > 4 ? ` y ${path.length - 4} más` : ""}.
            </p>
          )}
        </div>
      )}
      <p className="chances-note">
        Simulamos la jornada {result.runs.toLocaleString("es")} veces con las probabilidades sin margen de las casas
        {live ? ", el marcador y el minuto de cada partido" : ""}. Empatar en cabeza cuenta como ganarla.
        {typical > 0 &&
          ` ${typical === 1 ? "Un partido sin cuotas usa" : `${typical} partidos sin cuotas usan`} una probabilidad típica.`}
      </p>
    </section>
  );
}
