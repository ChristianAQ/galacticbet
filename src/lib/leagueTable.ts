import type { Match } from "./domain";
import {
  hasRegulationResult,
  teamResult,
  type FormResult,
} from "./matchInsights";

export const LEAGUE_STAGES = ["REGULAR_SEASON", "LEAGUE_STAGE"];

export interface LeagueRow {
  key: string;
  name: string;
  crest?: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: FormResult[];
}

export function teamKey(match: Match, side: "home" | "away") {
  const id = side === "home" ? match.homeTeamId : match.awayTeamId;
  return id != null
    ? `id:${id}`
    : `name:${match[side].trim().toLocaleLowerCase("es")}`;
}

// Expects results from a single competition, season and league stage.
export function leagueTable(results: Match[]): LeagueRow[] {
  const rows = new Map<string, LeagueRow>();
  const ordered = results
    .filter(hasRegulationResult)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  for (const m of ordered) {
    for (const side of ["home", "away"] as const) {
      const key = teamKey(m, side);
      const row = rows.get(key) || {
        key,
        name: m[side],
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
        form: [],
      };
      const result = teamResult(m, side);
      row.crest ||= side === "home" ? m.homeCrest : m.awayCrest;
      row.played++;
      row[result === "win" ? "wins" : result === "draw" ? "draws" : "losses"]++;
      row.points += result === "win" ? 3 : result === "draw" ? 1 : 0;
      row.goalsFor += side === "home" ? m.homeScore! : m.awayScore!;
      row.goalsAgainst += side === "home" ? m.awayScore! : m.homeScore!;
      row.form = [...row.form, result].slice(-5);
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
      b.goalsFor - a.goalsFor ||
      a.name.localeCompare(b.name, "es"),
  );
}

/** A single selected season; scheduled league fixtures also supply the zero rows. */
export function seasonLeagueTable(
  matches: Match[],
  competition: string,
  seasonId: string,
  now = Date.now(),
) {
  const own = matches.filter(
    (m) =>
      m.competition === competition &&
      m.seasonId === seasonId &&
      LEAGUE_STAGES.includes(m.stage),
  );
  const rows = leagueTable(own.filter((m) => Date.parse(m.utcDate) <= now));
  const known = new Set(rows.map((r) => r.key));
  for (const m of own)
    for (const side of ["home", "away"] as const) {
      const key = teamKey(m, side);
      if (known.has(key) || !m[side] || m[side] === "Por determinar") continue;
      known.add(key);
      rows.push({
        key,
        name: m[side],
        crest: side === "home" ? m.homeCrest : m.awayCrest,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
        form: [],
      });
    }
  return rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
      b.goalsFor - a.goalsFor ||
      a.name.localeCompare(b.name, "es"),
  );
}

// Uses the season of the latest played fixture, or the next one before any is played.
export function currentLeagueTable(
  matches: Match[],
  competition: string,
  now = Date.now(),
) {
  const own = matches.filter(
    (m) => m.competition === competition && LEAGUE_STAGES.includes(m.stage),
  );
  const next = own
    .filter((m) => Date.parse(m.utcDate) > now)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate))[0];
  const latest = own
    .filter((m) => Date.parse(m.utcDate) <= now)
    .sort((a, b) => b.utcDate.localeCompare(a.utcDate))[0];
  const reference = latest || next;
  if (!reference) return [];
  return leagueTable(
    own.filter(
      (m) =>
        m.seasonId === reference.seasonId &&
        m.stage === reference.stage &&
        Date.parse(m.utcDate) <= now,
    ),
  );
}
