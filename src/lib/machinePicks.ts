import { decodeRun, type AnalysisRun } from "./bettingAnalysis";
import { isCompetition } from "./competitions";
import { hasPublishedResult, outcome, score, type Match, type Mode, type PredictionValue } from "./domain";
import type { RankingTotal } from "./rankings";
import type { RoundPlayer } from "./roundBoard";
import { favouriteSign, goalRates, likeliestScore, type Chances } from "./winChances";

/**
 * Two rivals in every group: «IA» (the AI's own slip, from the season's data
 * and the news, without prices) and «Favorito» (always the market's
 * favourite). Both slips are frozen by the backend before the round closes,
 * as everyone's, in one public document per season (`machinePicks/PD-2026`),
 * with the market's chances at that moment. They never enter the group's
 * official standings: they are a yardstick.
 */
export const MACHINE_FORMAT = 1;
export const machinePicksPath = (seasonId: string) => `machinePicks/${seasonId}`;
export const SEASON_ID = /^(PD|CL|PL)-\d{4}$/;

export interface MachineScore {
  home: number;
  away: number;
}
export interface MachineMatch {
  /** The market's 1X2 chances without margin when the slips were frozen. */
  p?: Chances;
  favorite?: MachineScore;
  ai?: MachineScore;
}
export interface MachineRound {
  frozenAt: string;
  deadline: string;
  matches: Record<string, MachineMatch>;
  /** How the AI ran for its slip. */
  ai?: AnalysisRun;
}
export interface MachinePicks {
  formatVersion: typeof MACHINE_FORMAT;
  seasonId: string;
  rounds: Record<string, MachineRound>;
}

export const GHOSTS = [
  { id: "ghost:ai", key: "ai", name: "IA" },
  { id: "ghost:favorite", key: "favorite", name: "Favorito" },
] as const;
export type GhostKey = (typeof GHOSTS)[number]["key"];

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
const goals = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 20;
const chance = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;

function decodeScore(raw: unknown): MachineScore | undefined {
  return isRow(raw) && goals(raw.home) && goals(raw.away) ? { home: raw.home, away: raw.away } : undefined;
}
function decodeChances(raw: unknown): Chances | undefined {
  if (!isRow(raw) || !chance(raw.home) || !chance(raw.draw) || !chance(raw.away)) return undefined;
  return Math.abs(raw.home + raw.draw + raw.away - 1) <= 0.01 ? { home: raw.home, draw: raw.draw, away: raw.away } : undefined;
}

export function decodeMachinePicks(raw: unknown, seasonId: string): MachinePicks | null {
  if (!isRow(raw) || raw.formatVersion !== MACHINE_FORMAT || raw.seasonId !== seasonId || !isRow(raw.rounds)) return null;
  const rounds: Record<string, MachineRound> = {};
  for (const [roundId, r] of Object.entries(raw.rounds).slice(0, 120)) {
    if (!roundId.startsWith(`${seasonId}-`) || !ID.test(roundId) || !isRow(r) || !date(r.frozenAt) || !date(r.deadline))
      continue;
    if (!isRow(r.matches)) continue;
    const matches: Record<string, MachineMatch> = {};
    for (const [matchId, m] of Object.entries(r.matches).slice(0, 40)) {
      if (!ID.test(matchId) || !isRow(m)) continue;
      const p = decodeChances(m.p);
      const favorite = decodeScore(m.favorite);
      const ai = decodeScore(m.ai);
      if (p || favorite || ai) matches[matchId] = { ...(p ? { p } : {}), ...(favorite ? { favorite } : {}), ...(ai ? { ai } : {}) };
    }
    const run = decodeRun(r.ai);
    rounds[roundId] = { frozenAt: r.frozenAt, deadline: r.deadline, matches, ...(run ? { ai: run } : {}) };
  }
  return { formatVersion: MACHINE_FORMAT, seasonId, rounds };
}

/** The favourite's slip for a match: its sign, and the likeliest score with that sign. */
export function favoriteScore(p: Chances): MachineScore {
  return likeliestScore(goalRates(p), favouriteSign(p));
}

/** A frozen score as a pick of the group's kind: the sign in 1X2, the score in exact. */
export function asPick(value: MachineScore, mode: Mode): PredictionValue {
  return mode === "classic" ? outcome(value.home, value.away) : { home: value.home, away: value.away };
}

/** «IA» and «Favorito» as players of a round board (only those with a slip). */
export function ghostPlayers(round: MachineRound | undefined, mode: Mode): RoundPlayer[] {
  if (!round) return [];
  return GHOSTS.flatMap((g) => {
    const picks = Object.fromEntries(
      Object.entries(round.matches).flatMap(([id, m]) => (m[g.key] ? [[id, asPick(m[g.key]!, mode)]] : [])),
    );
    return Object.keys(picks).length ? [{ id: g.id, name: g.name, picks }] : [];
  });
}

/** A ghost's points and hits in a finished round, scored as the group scores it. */
export function ghostRound(round: MachineRound, key: GhostKey, fixtures: Match[], mode: Mode): RankingTotal | null {
  let points = 0,
    hits = 0,
    picked = 0;
  for (const m of fixtures) {
    const value = round.matches[m.id]?.[key];
    if (!value || !hasPublishedResult(m)) continue;
    picked++;
    const p = score(mode, asPick(value, mode), { home: m.homeScore!, away: m.awayScore! });
    points += p;
    if (p > 0) hits++;
  }
  return picked ? { points, hits } : null;
}

export interface MachineDuel {
  /** Finished rounds with both slips frozen and yours delivered. */
  rounds: number;
  you: number;
  ai: number;
  favorite: number;
  beatAi: number;
  beatFavorite: number;
  /** Group members ahead of the AI on those rounds (and how many players). */
  aheadOfAi: number;
  players: number;
}

/**
 * «Contra la máquina»: your season against both slips, round by round, on
 * the finished rounds the machines played (and you too).
 */
export function machineDuel({
  machines,
  seasons,
  matches,
  userId,
  scope,
}: {
  machines: Map<string, MachinePicks>;
  seasons: { id: string; competition: string; mode?: Mode; standings: { id: string; rounds: Record<string, RankingTotal> }[] }[];
  matches: Match[];
  userId: string;
  /** A competition, or «global». */
  scope: string;
}): MachineDuel | null {
  const duel: MachineDuel = { rounds: 0, you: 0, ai: 0, favorite: 0, beatAi: 0, beatFavorite: 0, aheadOfAi: 0, players: 0 };
  const totals = new Map<string, number>();
  let aiTotal = 0;
  for (const season of seasons) {
    if (!isCompetition(season.competition) || (scope !== "global" && scope !== season.competition)) continue;
    const machine = machines.get(season.id);
    if (!machine) continue;
    const mode = season.mode ?? "classic";
    for (const [roundId, round] of Object.entries(machine.rounds)) {
      const fixtures = matches.filter((m) => m.roundId === roundId);
      if (!fixtures.length || !fixtures.every((m) => hasPublishedResult(m) || ["POSTPONED", "CANCELLED"].includes(m.status)))
        continue;
      const ai = ghostRound(round, "ai", fixtures, mode);
      const favorite = ghostRound(round, "favorite", fixtures, mode);
      if (!ai || !favorite) continue;
      aiTotal += ai.points;
      for (const s of season.standings)
        if (s.rounds[roundId]) totals.set(s.id, (totals.get(s.id) ?? 0) + s.rounds[roundId].points);
      const mine = season.standings.find((s) => s.id === userId)?.rounds[roundId];
      if (!mine) continue;
      duel.rounds++;
      duel.you += mine.points;
      duel.ai += ai.points;
      duel.favorite += favorite.points;
      if (mine.points > ai.points) duel.beatAi++;
      if (mine.points > favorite.points) duel.beatFavorite++;
    }
  }
  duel.players = totals.size;
  duel.aheadOfAi = [...totals.values()].filter((t) => t > aiTotal).length;
  return duel.rounds ? duel : null;
}
