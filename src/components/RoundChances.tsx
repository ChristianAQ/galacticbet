import { Sparkles } from "lucide-react";
import { useContext, useEffect, useId, useMemo, useState } from "react";
import type { Match, Mode, Outcome } from "../lib/domain";
import type { MachineRound } from "../lib/machinePicks";
import { impliedProbabilities, type OddsBoard } from "../lib/odds";
import { roundBoard, type RoundPlayer } from "../lib/roundBoard";
import { loadOdds } from "../lib/useMatchOdds";
import { LiveContext, useMinuteClock } from "../lib/useLiveBoard";
import {
  keyResults,
  simFixture,
  simulateRound,
  TYPICAL_CHANCES,
  type Chances,
  type RoundChances as Simulation,
} from "../lib/winChances";
import "../styles/chances.css";

const pct = (p: number) =>
  p <= 0 ? "0 %" : p >= 1 ? "100 %" : p < 0.005 ? "<1 %" : p > 0.995 ? ">99 %" : `${Math.round(p * 100)} %`;

/** «Gana el Betis», «Empate», «Gana el Sevilla» for a sign of a match. */
function signName(sign: Outcome, m: Match) {
  return sign === "1" ? `Gana ${m.home}` : sign === "2" ? `Gana ${m.away}` : "Empate";
}

/** The AI's mark, small: it plays, but it is not one of the group. */
export function AiMark() {
  return (
    <span className="ai-mark">
      <Sparkles size={11} strokeWidth={2.6} aria-hidden="true" />
      IA
    </span>
  );
}

/**
 * «¿Quién se lleva la jornada?»: each player's chance of winning the round
 * (alone or sharing it), from the round simulated many times with the
 * market's chances and, while a match is in play, its score and minute.
 * For you, «Qué necesitas»: the results that move your chance most, and
 * your likeliest way to win.
 *
 * The AI plays too, with its own slip frozen before the round closed: in a
 * group, one line says how you stand against it; alone, the panel is your
 * duel with it, so nobody plays a round without a rival.
 */
export default function RoundChances({
  matches,
  players,
  mode,
  userId,
  machineRound,
  rival,
}: {
  matches: Match[];
  players: RoundPlayer[];
  mode: Mode;
  userId: string;
  /** Market chances frozen before the round closed, when the backend has them. */
  machineRound?: MachineRound;
  /** «IA», with its slip of the round. */
  rival?: RoundPlayer;
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
  const open = fixtures.some((f) => !f.decided);
  const me = players.find((p) => p.id === userId);
  const group = players.length >= 2;
  const result = useMemo(
    () => (open && group ? simulateRound({ fixtures, players, mode, focus: me?.id }) : null),
    // The fixtures by value: a new array with the same figures is the same round.
    [fixturesKey, players, mode, me, group],
  );
  // You against the AI: the same simulation with the two of you.
  const duel = useMemo(
    () => (open && me && rival ? simulateRound({ fixtures, players: [me, rival], mode, focus: me.id }) : null),
    [fixturesKey, me, rival, mode],
  );
  const points = useMemo(
    () => (me && rival ? new Map(roundBoard(matches, mode, [me, rival]).map((r) => [r.id, r])) : null),
    [matches, mode, me, rival],
  );
  const byId = new Map(matches.map((m) => [m.id, m]));
  const versus = me && rival && points ? { me: points.get(me.id)!, ai: points.get(rival.id)! } : null;
  // Alone with the AI: the panel is your duel. With nobody to play, nothing.
  if (!group && !versus) return null;
  if (group && !result) return null;
  const focusResult = group ? result : duel;
  const mine = me && focusResult ? focusResult.win[me.id] : 0;
  const needs = me && focusResult ? keyResults(focusResult) : [];
  const path = focusResult?.path && mine > 0.005 && mine < 0.995 ? Object.entries(focusResult.path.signs) : [];
  const odd = duel && me ? duelOdds(duel, me.id) : null;
  return (
    <section className="panel round-chances" aria-labelledby={titleId}>
      <header className="chances-heading">
        <h3 id={titleId}>{group ? "¿Quién se lleva la jornada?" : "Tú contra la IA"}</h3>
        <small>
          {live ? (
            <>
              <i className="live-dot" aria-hidden="true" /> Con el marcador en directo
            </>
          ) : !open ? (
            "Jornada decidida"
          ) : group ? (
            "Probabilidad de ganarla"
          ) : (
            "Probabilidad de ganarle"
          )}
        </small>
      </header>
      {group && result ? (
        <ol className="chances-list">
          {[...players]
            .sort((a, b) => result.win[b.id] - result.win[a.id] || a.id.localeCompare(b.id))
            .map((p) => (
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
      ) : (
        versus && (
          <div className="duel">
            <p className="duel-score">
              <span className="is-me">
                Tú <b>{versus.me.points}</b>
                {versus.me.livePoints > 0 && <small title="Si terminaran así">+{versus.me.livePoints}</small>}
              </span>
              <span>
                <AiMark /> <b>{versus.ai.points}</b>
                {versus.ai.livePoints > 0 && <small title="Si terminaran así">+{versus.ai.livePoints}</small>}
              </span>
            </p>
            {odd ? (
              <>
                <div
                  className="duel-bar"
                  role="img"
                  aria-label={`Ganas tú: ${pct(odd.you)}; empate: ${pct(odd.tie)}; gana la IA: ${pct(odd.ai)}`}
                >
                  <i className="is-me" style={{ flexGrow: odd.you }} />
                  <i className="is-tie" style={{ flexGrow: odd.tie }} />
                  <i className="is-ai" style={{ flexGrow: odd.ai }} />
                </div>
                <p className="duel-legend" aria-hidden="true">
                  <span>Ganas tú {pct(odd.you)}</span>
                  <span>Empate {pct(odd.tie)}</span>
                  <span>Gana la IA {pct(odd.ai)}</span>
                </p>
              </>
            ) : (
              <p className="duel-verdict">
                {versus.me.points > versus.ai.points
                  ? "Le has ganado a la IA esta jornada."
                  : versus.me.points < versus.ai.points
                    ? "Esta jornada se la lleva la IA."
                    : "Empate con la IA esta jornada."}
              </p>
            )}
          </div>
        )
      )}
      {needs.length > 0 && (
        <div className="chances-need">
          <h4>{group ? "Qué necesitas" : "Qué necesitas para ganarle"}</h4>
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
      {group && odd && (
        <p className="chances-duel">
          <AiMark /> Contra la IA: vas {versus!.me.points + versus!.me.livePoints} a{" "}
          {versus!.ai.points + versus!.ai.livePoints} y le ganas en el {pct(odd.you)} de las simulaciones
          {odd.tie >= 0.05 ? ` (empate, ${pct(odd.tie)})` : ""}.
        </p>
      )}
      {open && (
        <p className="chances-note">
          Simulamos la jornada {(focusResult?.runs ?? 0).toLocaleString("es")} veces con las probabilidades sin margen
          de las casas{live ? ", el marcador y el minuto de cada partido" : ""}.{" "}
          {group ? "Empatar en cabeza cuenta como ganarla." : "La IA hizo su quiniela antes del cierre, sin ver las cuotas."}
          {typical > 0 &&
            ` ${typical === 1 ? "Un partido sin cuotas usa" : `${typical} partidos sin cuotas usan`} una probabilidad típica.`}
        </p>
      )}
    </section>
  );
}

/** You against the AI: ahead, level or behind at the end of the round. */
function duelOdds(duel: Simulation, me: string) {
  const level = duel.shared[me];
  return { you: duel.win[me] - level, tie: level, ai: 1 - duel.win[me] };
}
