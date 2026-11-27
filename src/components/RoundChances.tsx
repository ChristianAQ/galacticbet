import { ChevronDown, Sparkles } from "lucide-react";
import { useContext, useEffect, useId, useMemo, useState } from "react";
import { predictionSummary, type Match, type Mode, type Outcome } from "../lib/domain";
import type { MachineRound } from "../lib/machinePicks";
import { haptic } from "../lib/motion";
import { impliedProbabilities, type OddsBoard } from "../lib/odds";
import { roundBoard, type RoundPlayer } from "../lib/roundBoard";
import { loadOdds } from "../lib/useMatchOdds";
import { LiveContext, useMinuteClock } from "../lib/useLiveBoard";
import {
  duelResults,
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

/** Folded or not, the panel stays as you left it while you move around the app. */
let remembered = false;

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
 *
 * In a group, folded by default: only the chart of who is likelier to win;
 * unfolding slides the rest in. Alone against the AI, everything is in
 * sight: the points and, match by match, what you need to beat it.
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
  const bodyId = useId();
  const [expanded, setExpanded] = useState(remembered);
  const toggle = () => {
    haptic();
    remembered = !expanded;
    setExpanded(!expanded);
  };
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
  const undecided = fixtures.some((f) => !f.decided);
  const me = players.find((p) => p.id === userId);
  const group = players.length >= 2;
  const result = useMemo(
    () => (undecided && group ? simulateRound({ fixtures, players, mode, focus: me?.id }) : null),
    // The fixtures by value: a new array with the same figures is the same round.
    [fixturesKey, players, mode, me, group],
  );
  // You against the AI: the same simulation with the two of you.
  const duel = useMemo(
    () => (undecided && me && rival ? simulateRound({ fixtures, players: [me, rival], mode, focus: me.id }) : null),
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
  // Only the matches where you and the AI picked differently can change who wins.
  const split = !group && duel && me && rival ? duelResults(duel, me.picks, rival.picks) : null;
  // The same picks in everything left: nothing can change, the chart says it all.
  const identical = Boolean(split && split.differ.length === 0);
  const status = live
    ? "En directo"
    : !undecided
      ? "Jornada decidida"
      : group
        ? "Probabilidad de ganarla"
        : identical
          ? "Misma quiniela que la IA"
          : "Probabilidad de ganarle";

  /* ---------- Folded: the chart of who is likelier to win ---------- */
  const chart = group ? (
    <ol className="chances-list">
      {[...players]
        .sort((a, b) => result!.win[b.id] - result!.win[a.id] || a.id.localeCompare(b.id))
        .map((p) => (
          <li key={p.id} className={p.id === userId ? "is-me" : undefined}>
            <span className="chances-name">
              {p.name}
              {p.id === userId && <small> · Tú</small>}
            </span>
            <span className="chances-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${result!.win[p.id]})` }} />
            </span>
            <b className="chances-value">{pct(result!.win[p.id])}</b>
          </li>
        ))}
    </ol>
  ) : odd ? (
    <div className="duel-chart">
      <p className="duel-labels" aria-hidden="true">
        <span className="is-me">
          Tú <b>{pct(odd.you)}</b>
        </span>
        {odd.tie >= 0.01 && <span className="is-tie">Empate {pct(odd.tie)}</span>}
        <span className="is-ai">
          <b>{pct(odd.ai)}</b> IA
        </span>
      </p>
      <div
        className="duel-bar"
        role="img"
        aria-label={`Ganas tú: ${pct(odd.you)}; empate: ${pct(odd.tie)}; gana la IA: ${pct(odd.ai)}`}
      >
        {odd.you >= 0.005 && <i className="is-me" style={{ flexGrow: odd.you }} />}
        {odd.tie >= 0.005 && <i className="is-tie" style={{ flexGrow: odd.tie }} />}
        {odd.ai >= 0.005 && <i className="is-ai" style={{ flexGrow: odd.ai }} />}
      </div>
    </div>
  ) : (
    <p className="duel-verdict">
      {versus!.me.points > versus!.ai.points
        ? `Le has ganado a la IA: ${versus!.me.points} a ${versus!.ai.points}.`
        : versus!.me.points < versus!.ai.points
          ? `Esta jornada se la lleva la IA: ${versus!.ai.points} a ${versus!.me.points}.`
          : `Empate con la IA: ${versus!.me.points} a ${versus!.ai.points}.`}
    </p>
  );

  /* ---------- Unfolded: the points, what you need, how it is worked out ---------- */
  const score = !group && odd && versus && (
    <div className="chances-block">
      <h4>Puntos de la jornada</h4>
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
    </div>
  );
  const need = group && needs.length > 0 && (
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
  );
  const duelNeed = split && !identical && me && rival && versus && (
    <div className="duel-need">
      <h4>Qué necesitas para ganarle</h4>
      <>
          <p className="duel-need-lead">
            Solo deciden los partidos en los que no coincidís. Con cada resultado, tu probabilidad de acabar por delante:
          </p>
          <ul>
            {split.differ.slice(0, 4).map(({ matchId, byResult }) => {
              const m = byId.get(matchId)!;
              const signs = (["1", "X", "2"] as Outcome[]).filter((s) => byResult[s]);
              const best = signs.reduce((a, b) => (byResult[b]!.ahead > byResult[a]!.ahead ? b : a), signs[0]);
              const yours = me.picks[matchId];
              const its = rival.picks[matchId];
              return (
                <li key={matchId}>
                  <div className="duel-need-head">
                    <span className="chances-match">
                      {m.home} – {m.away}
                    </span>
                    <span className="duel-need-picks">
                      Tú <b>{yours ? predictionSummary(yours) : "—"}</b> · <AiMark /> <b>{its ? predictionSummary(its) : "—"}</b>
                    </span>
                  </div>
                  {signs.map((s) => {
                    const v = byResult[s]!;
                    return (
                      <div
                        key={s}
                        className={`duel-if${s === best ? " is-best" : ""}`}
                        role="img"
                        aria-label={`Si ${signName(s, m).toLowerCase()}: por delante ${pct(v.ahead)}, empate ${pct(v.level)}, por detrás ${pct(v.behind)}${s === best ? ". Es lo que te conviene" : ""}`}
                      >
                        <span className="duel-if-name">{signName(s, m)}</span>
                        <span className="duel-if-bar" aria-hidden="true">
                          {v.ahead >= 0.005 && <i className="is-me" style={{ flexGrow: v.ahead }} />}
                          {v.level >= 0.005 && <i className="is-tie" style={{ flexGrow: v.level }} />}
                          {v.behind >= 0.005 && <i className="is-ai" style={{ flexGrow: v.behind }} />}
                        </span>
                        <b className="duel-if-value">{pct(v.ahead)}</b>
                      </div>
                    );
                  })}
                </li>
              );
            })}
          </ul>
          {split.differ.length > 4 && (
            <p className="duel-need-more">
              Y {split.differ.length - 4} {split.differ.length - 4 === 1 ? "partido más" : "partidos más"} en los que no
              coincidís.
            </p>
          )}
          <p className="duel-need-key" aria-hidden="true">
            <span><i className="is-me" /> Tú por delante</span>
            <span><i className="is-tie" /> Empate</span>
            <span><i className="is-ai" /> La IA por delante</span>
          </p>
      </>
      {split.same.length > 0 && (
        <p className="duel-need-same">
          {split.same.length === 1 ? "En " : `En ${split.same.length} partidos (`}
          {split.same
            .map((id) => {
              const m = byId.get(id)!;
              return `${m.home}–${m.away}`;
            })
            .join(", ")}
          {split.same.length === 1 ? "" : ")"} habéis puesto lo mismo: no cuentan para el duelo.
        </p>
      )}
    </div>
  );
  const versusLine = group && odd && versus && (
    <p className="chances-duel">
      <AiMark /> Contra la IA: vas {versus.me.points + versus.me.livePoints} a {versus.ai.points + versus.ai.livePoints}{" "}
      y le ganas en el {pct(odd.you)} de las simulaciones
      {odd.tie >= 0.05 ? ` (empate, ${pct(odd.tie)})` : ""}.
    </p>
  );
  const note = undecided && (
    <p className="chances-note">
      Simulamos la jornada {(focusResult?.runs ?? 0).toLocaleString("es")} veces con las probabilidades sin margen de
      las casas{live ? ", el marcador y el minuto de cada partido" : ""}.{" "}
      {group ? "Empatar en cabeza cuenta como ganarla." : "La IA hizo su quiniela antes del cierre, sin ver las cuotas."}
      {typical > 0 &&
        ` ${typical === 1 ? "Un partido sin cuotas usa" : `${typical} partidos sin cuotas usan`} una probabilidad típica.`}
    </p>
  );
  // Alone against the AI with the same picks in everything left: only the chart.
  const hasDetails = !identical && Boolean(score || need || duelNeed || versusLine || note);
  const foldable = hasDetails;

  return (
    <section className={`panel round-chances${expanded ? " is-open" : ""}`} aria-labelledby={titleId}>
      <h3 className="chances-heading">
        {foldable ? (
          <button
            type="button"
            className="chances-toggle"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={toggle}
          >
            <span id={titleId} className="chances-title">
              {group ? "¿Quién se lleva la jornada?" : "Tú contra la IA"}
            </span>
            <small>
              {live && <i className="live-dot" aria-hidden="true" />}
              {status}
            </small>
            <ChevronDown className="chances-chevron" size={18} aria-hidden="true" />
          </button>
        ) : (
          <span className="chances-toggle">
            <span id={titleId} className="chances-title">
              {group ? "¿Quién se lleva la jornada?" : "Tú contra la IA"}
            </span>
            <small>
              {live && <i className="live-dot" aria-hidden="true" />}
              {status}
            </small>
          </span>
        )}
      </h3>
      {/* The chart opens the rest too: the panel's biggest target. */}
      <div className="chances-summary" onClick={foldable ? toggle : undefined}>
        {chart}
      </div>
      {foldable && (
        <div id={bodyId} className="chances-body" inert={!expanded}>
          <div className="chances-body-inner">
            {score}
            {need}
            {duelNeed}
            {versusLine}
            {note}
          </div>
        </div>
      )}
    </section>
  );
}

/** You against the AI: ahead, level or behind at the end of the round. */
function duelOdds(duel: Simulation, me: string) {
  const level = duel.shared[me];
  return { you: duel.win[me] - level, tie: level, ai: 1 - duel.win[me] };
}
