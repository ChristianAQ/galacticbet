import {
  hasPublishedResult,
  outcome,
  score,
  type Match,
  type Mode,
  type Outcome,
  type PredictionValue,
} from "./domain";
import type { LiveMatch } from "./liveBoard";

/**
 * «¿Quién se lleva la jornada?»: the round simulated many times. Each match
 * still to be decided gets goals from a Poisson model fitted to the market's
 * 1X2 chances (without the bookmakers' margin); a match in play keeps its
 * score and only plays the minutes left. Every player's slip is scored on
 * each simulated round, as the group scores it, and the best total wins
 * (ties share it, as the pot does). Display only: nothing is stored.
 */
export interface Chances {
  home: number;
  draw: number;
  away: number;
}
export interface GoalRates {
  home: number;
  away: number;
}

/** When the market has no price for a match: a typical league fixture. */
export const TYPICAL_CHANCES: Chances = { home: 0.45, draw: 0.27, away: 0.28 };
/** Regular time plus a typical stoppage. */
export const MATCH_MINUTES = 95;
export const SIMULATIONS = 20_000;
const MAX_GOALS = 10;

function poisson(rate: number) {
  const p = [Math.exp(-rate)];
  for (let k = 1; k <= MAX_GOALS; k++) p.push((p[k - 1] * rate) / k);
  return p;
}

/** 1X2 chances of two independent Poisson scores. */
export function outcomeChances(rates: GoalRates): Chances {
  const h = poisson(rates.home);
  const a = poisson(rates.away);
  let home = 0,
    draw = 0,
    away = 0;
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = h[i] * a[j];
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
    }
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

/**
 * The goal rates whose 1X2 chances are closest to the market's: a pattern
 * search from a typical match, halving the step until it settles.
 */
export function goalRates(target: Chances): GoalRates {
  const error = (r: GoalRates) => {
    const c = outcomeChances(r);
    return (c.home - target.home) ** 2 + (c.draw - target.draw) ** 2 + (c.away - target.away) ** 2;
  };
  let best = { home: 1.4, away: 1.1 };
  let bestError = error(best);
  for (let step = 0.5; step > 0.002; ) {
    let moved = false;
    for (const [dh, da] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ]) {
      const next = { home: Math.min(6, Math.max(0.05, best.home + dh)), away: Math.min(6, Math.max(0.05, best.away + da)) };
      const e = error(next);
      if (e < bestError) {
        best = next;
        bestError = e;
        moved = true;
      }
    }
    if (!moved) step /= 2;
  }
  return best;
}

/** The most likely final score with a given sign (the market favourite's, for its slip). */
export function likeliestScore(rates: GoalRates, sign: Outcome) {
  const h = poisson(rates.home);
  const a = poisson(rates.away);
  let best = sign === "1" ? { home: 1, away: 0 } : sign === "2" ? { home: 0, away: 1 } : { home: 1, away: 1 };
  let top = -1;
  for (let i = 0; i <= 6; i++)
    for (let j = 0; j <= 6; j++)
      if (outcome(i, j) === sign && h[i] * a[j] > top) {
        top = h[i] * a[j];
        best = { home: i, away: j };
      }
  return best;
}

/** The favourite's sign: the most likely of 1, X and 2. */
export function favouriteSign(c: Chances): Outcome {
  return c.home >= c.draw && c.home >= c.away ? "1" : c.away >= c.draw ? "2" : "X";
}

/**
 * Minutes played in a match in play, from the live board (provider minute
 * plus the time since it was read), else from its kick-off.
 */
export function playedMinutes(match: Match, live: LiveMatch | undefined, now: number) {
  if (match.status === "PAUSED" || live?.status === "PAUSED" || live?.minute === "HT") return 45;
  const parts = /^(\d{1,3})(?:\+(\d{1,2}))?$/.exec(live?.minute || "");
  if (parts && live?.minuteAt !== undefined) {
    const base = Number(parts[1]) + Number(parts[2] || 0);
    const cap = Number(parts[1]) <= 45 ? 50 : MATCH_MINUTES;
    return Math.min(cap, base + Math.max(0, (now - live.minuteAt) / 60_000));
  }
  const since = (now - Date.parse(match.utcDate)) / 60_000;
  // Past the first half, the break does not count.
  return Math.max(0, Math.min(MATCH_MINUTES, since > 47 ? since - 15 : since));
}

export interface SimFixture {
  id: string;
  /** Goals so far (the final score when decided). */
  home: number;
  away: number;
  decided: boolean;
  /** Goals expected in what is left of the match. */
  rest: GoalRates;
}

/** A match as the simulation sees it: decided, in play (minutes left) or still to play. */
export function simFixture(match: Match, chances: Chances, live: LiveMatch | undefined, now: number): SimFixture | null {
  if (["POSTPONED", "CANCELLED", "SUSPENDED", "AWARDED"].includes(match.status)) return null;
  const scored = match.homeScore !== null && match.awayScore !== null;
  if (hasPublishedResult(match) || (match.status === "FINISHED" && scored))
    return { id: match.id, home: match.homeScore!, away: match.awayScore!, decided: true, rest: { home: 0, away: 0 } };
  const rates = goalRates(chances);
  const playing = ["IN_PLAY", "PAUSED"].includes(match.status) && scored;
  const left = playing ? Math.max(0, MATCH_MINUTES - playedMinutes(match, live, now)) / MATCH_MINUTES : 1;
  return {
    id: match.id,
    home: playing ? match.homeScore! : 0,
    away: playing ? match.awayScore! : 0,
    decided: false,
    rest: { home: rates.home * left, away: rates.away * left },
  };
}

/** A small seeded generator: the same inputs give the same figures (no flicker). */
function generator(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function goals(rate: number, random: () => number) {
  // Knuth: fine for the small rates of football.
  const limit = Math.exp(-rate);
  let k = 0;
  for (let p = random(); p > limit; p *= random()) k++;
  return k;
}

export interface SimPlayer {
  id: string;
  picks: Record<string, PredictionValue | undefined>;
}
export interface RoundChances {
  runs: number;
  /** Chance of winning the round, alone or sharing it. */
  win: Record<string, number>;
  /** Chance of sharing it (part of `win`). */
  shared: Record<string, number>;
  /** For one player (`focus`): their chance with each result of each open match. */
  ifResult: Record<string, Partial<Record<Outcome, number>>>;
  /** The same, counting only the runs `focus` wins alone (ahead of everybody). */
  ifResultAlone: Record<string, Partial<Record<Outcome, number>>>;
  /** The open matches' signs most often seen when `focus` wins, and how often. */
  path: { signs: Record<string, Outcome>; share: number } | null;
}

export function simulateRound({
  fixtures,
  players,
  mode,
  focus,
  runs = SIMULATIONS,
}: {
  fixtures: SimFixture[];
  players: SimPlayer[];
  mode: Mode;
  focus?: string;
  runs?: number;
}): RoundChances {
  const open = fixtures.filter((f) => !f.decided);
  const random = generator(
    hash(JSON.stringify([fixtures.map((f) => [f.id, f.home, f.away, f.rest.home.toFixed(3), f.rest.away.toFixed(3)]), mode])),
  );
  const win: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
  const shared: Record<string, number> = { ...win };
  const seen: Record<string, Record<Outcome, number>> = {};
  const won: Record<string, Record<Outcome, number>> = {};
  const alone: Record<string, Record<Outcome, number>> = {};
  for (const f of open) {
    seen[f.id] = { "1": 0, X: 0, "2": 0 };
    won[f.id] = { "1": 0, X: 0, "2": 0 };
    alone[f.id] = { "1": 0, X: 0, "2": 0 };
  }
  const paths = new Map<string, number>();
  let focusWins = 0;
  // Points of decided matches are the same in every run.
  const base = players.map((p) =>
    fixtures
      .filter((f) => f.decided)
      .reduce((sum, f) => sum + (p.picks[f.id] ? score(mode, p.picks[f.id]!, f) : 0), 0),
  );
  const results = open.map(() => ({ home: 0, away: 0 }));
  const signs: Outcome[] = open.map(() => "X");
  for (let run = 0; run < runs; run++) {
    open.forEach((f, i) => {
      results[i] = { home: f.home + goals(f.rest.home, random), away: f.away + goals(f.rest.away, random) };
      signs[i] = outcome(results[i].home, results[i].away);
    });
    let top = -1;
    const totals = players.map((p, k) => {
      let total = base[k];
      open.forEach((f, i) => {
        const pick = p.picks[f.id];
        if (pick) total += score(mode, pick, results[i]);
      });
      if (total > top) top = total;
      return total;
    });
    const leaders = totals.filter((t) => t === top).length;
    players.forEach((p, k) => {
      if (totals[k] !== top) return;
      win[p.id]++;
      if (leaders > 1) shared[p.id]++;
    });
    if (focus) {
      const k = players.findIndex((p) => p.id === focus);
      const focusWon = k >= 0 && totals[k] === top;
      const focusAlone = focusWon && leaders === 1;
      open.forEach((f, i) => {
        seen[f.id][signs[i]]++;
        if (focusWon) won[f.id][signs[i]]++;
        if (focusAlone) alone[f.id][signs[i]]++;
      });
      if (focusWon) {
        focusWins++;
        const key = signs.join("");
        paths.set(key, (paths.get(key) ?? 0) + 1);
      }
    }
  }
  const ifResult: RoundChances["ifResult"] = {};
  const ifResultAlone: RoundChances["ifResultAlone"] = {};
  for (const f of open) {
    const signs = (["1", "X", "2"] as Outcome[]).filter((s) => seen[f.id][s] > 0);
    ifResult[f.id] = Object.fromEntries(signs.map((s) => [s, won[f.id][s] / seen[f.id][s]]));
    ifResultAlone[f.id] = Object.fromEntries(signs.map((s) => [s, alone[f.id][s] / seen[f.id][s]]));
  }
  const [likeliest, count] = [...paths].sort((a, b) => b[1] - a[1])[0] ?? [];
  return {
    runs,
    win: Object.fromEntries(Object.entries(win).map(([id, n]) => [id, n / runs])),
    shared: Object.fromEntries(Object.entries(shared).map(([id, n]) => [id, n / runs])),
    ifResult: focus ? ifResult : {},
    ifResultAlone: focus ? ifResultAlone : {},
    path:
      focus && likeliest !== undefined && open.length
        ? {
            signs: Object.fromEntries(open.map((f, i) => [f.id, likeliest[i] as Outcome])),
            share: count! / focusWins,
          }
        : null,
  };
}

/**
 * You against one rival, match by match: where your picks differ (the only
 * matches that can change who wins, best first) and where they are the same.
 * For each result of a differing match: your chance of ending ahead, level
 * or behind.
 */
export function duelResults(
  chances: RoundChances,
  mine: Record<string, PredictionValue | undefined>,
  theirs: Record<string, PredictionValue | undefined>,
) {
  const differ: {
    matchId: string;
    swing: number;
    byResult: Partial<Record<Outcome, { ahead: number; level: number; behind: number }>>;
  }[] = [];
  const same: string[] = [];
  for (const [matchId, byResult] of Object.entries(chances.ifResult)) {
    if (samePick(mine[matchId], theirs[matchId])) {
      same.push(matchId);
      continue;
    }
    const split = Object.fromEntries(
      Object.entries(byResult).map(([sign, win]) => {
        const ahead = chances.ifResultAlone[matchId]?.[sign as Outcome] ?? 0;
        return [sign, { ahead, level: Math.max(0, win! - ahead), behind: Math.max(0, 1 - win!) }];
      }),
    ) as Partial<Record<Outcome, { ahead: number; level: number; behind: number }>>;
    const values = Object.values(split).map((v) => v!.ahead);
    differ.push({ matchId, byResult: split, swing: values.length ? Math.max(...values) - Math.min(...values) : 0 });
  }
  differ.sort((a, b) => b.swing - a.swing);
  return { differ, same };
}

/** The same pick: the same sign, or the same score. */
export function samePick(a?: PredictionValue, b?: PredictionValue) {
  if (!a || !b) return false;
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.home === b.home && a.away === b.away;
}

/**
 * «Qué necesitas»: the open matches that move `focus`'s chance most, with
 * the chance for each result. Only matches that change it by 3 points or more.
 */
export function keyResults(chances: RoundChances, limit = 3) {
  return Object.entries(chances.ifResult)
    .map(([matchId, byResult]) => {
      const values = Object.values(byResult);
      return { matchId, byResult, swing: values.length ? Math.max(...values) - Math.min(...values) : 0 };
    })
    .filter((r) => r.swing >= 0.03)
    .sort((a, b) => b.swing - a.swing)
    .slice(0, limit);
}
