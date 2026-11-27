import { hasPublishedResult, outcome, score, type Match, type Mode, type Outcome, type PredictionValue } from "./domain";
import type { MachinePicks } from "./machinePicks";
import { favouriteSign } from "./winChances";

/**
 * «Tu perfil de pronosticador»: what your own delivered slips say about you,
 * on matches with an official result. Everything comes from your slips, the
 * results and the market's chances frozen with the machines' slips.
 */
export interface SignRecord {
  picked: number;
  hits: number;
}
export interface TeamRecord {
  team: string;
  matches: number;
  points: number;
  /** Points left on the table: the most each match could give, minus yours. */
  lost: number;
}
export interface PredictorProfile {
  matches: number;
  points: number;
  maxPoints: number;
  /** Sign right (1X2), in any mode. */
  hits: number;
  /** Exact scores (exact mode only). */
  exact: number;
  bySign: Record<Outcome, SignRecord>;
  /** Picks against the market's favourite, and how many came in. */
  upsets: SignRecord;
  /** On matches with the market's chances: your signs and the favourite's. */
  market: { matches: number; you: number; favorite: number };
  best: TeamRecord | null;
  costliest: TeamRecord | null;
}

/** A team needs this many of your matches to be called your best or costliest. */
export const TEAM_MIN_MATCHES = 3;

export function predictorProfile({
  slips,
  matches,
  modes,
  machines,
}: {
  /** Your delivered picks, by round. */
  slips: Record<string, Record<string, PredictionValue>>;
  matches: Match[];
  /** Each season's mode (`PD-2026` → «exact»). */
  modes: Record<string, Mode>;
  machines: Map<string, MachinePicks>;
}): PredictorProfile | null {
  const profile: PredictorProfile = {
    matches: 0,
    points: 0,
    maxPoints: 0,
    hits: 0,
    exact: 0,
    bySign: { "1": { picked: 0, hits: 0 }, X: { picked: 0, hits: 0 }, "2": { picked: 0, hits: 0 } },
    upsets: { picked: 0, hits: 0 },
    market: { matches: 0, you: 0, favorite: 0 },
    best: null,
    costliest: null,
  };
  const teams = new Map<string, TeamRecord>();
  const byId = new Map(matches.map((m) => [m.id, m]));
  for (const [roundId, picks] of Object.entries(slips)) {
    for (const [matchId, pick] of Object.entries(picks)) {
      const m = byId.get(matchId);
      if (!m || m.roundId !== roundId || !hasPublishedResult(m)) continue;
      const mode = modes[m.seasonId] ?? (typeof pick === "string" ? "classic" : "exact");
      const result = { home: m.homeScore!, away: m.awayScore! };
      const sign = typeof pick === "string" ? pick : outcome(pick.home, pick.away);
      const real = outcome(result.home, result.away);
      const points = score(mode, pick, result);
      const most = mode === "exact" ? 3 : 1;
      profile.matches++;
      profile.points += points;
      profile.maxPoints += most;
      profile.bySign[sign].picked++;
      if (sign === real) {
        profile.hits++;
        profile.bySign[sign].hits++;
      }
      if (typeof pick !== "string" && pick.home === result.home && pick.away === result.away) profile.exact++;
      const p = machines.get(m.seasonId)?.rounds[roundId]?.matches[matchId]?.p;
      if (p) {
        const favourite = favouriteSign(p);
        profile.market.matches++;
        if (sign === real) profile.market.you++;
        if (favourite === real) profile.market.favorite++;
        if (sign !== favourite) {
          profile.upsets.picked++;
          if (sign === real) profile.upsets.hits++;
        }
      }
      for (const team of [m.home, m.away]) {
        const t = teams.get(team) ?? { team, matches: 0, points: 0, lost: 0 };
        t.matches++;
        t.points += points;
        t.lost += most - points;
        teams.set(team, t);
      }
    }
  }
  if (!profile.matches) return null;
  const regular = [...teams.values()].filter((t) => t.matches >= TEAM_MIN_MATCHES);
  profile.best =
    [...regular].sort((a, b) => b.points / b.matches - a.points / a.matches || b.matches - a.matches)[0] ?? null;
  profile.costliest = [...regular].sort((a, b) => b.lost - a.lost || b.matches - a.matches)[0] ?? null;
  if (profile.costliest && profile.costliest.team === profile.best?.team) profile.costliest = null;
  return profile;
}
