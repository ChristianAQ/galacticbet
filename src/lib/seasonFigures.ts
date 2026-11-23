import { hasPublishedResult, type Match } from "./domain";
import { teamKey } from "./leagueTable";
import type { StatRow } from "./leagueStats";

/**
 * The «Datos» tab from the official results only: what the season has been
 * (matches, goals, how often 1, X or 2) and the teams that stand out. No
 * estimates and no third-party feeds, so every number can be checked.
 */
export interface SeasonFigures {
  /** Matches with an official result. */
  played: number;
  /** Every fixture of the season that will be played (not cancelled). */
  total: number;
  goals: number;
  home: number;
  draws: number;
  away: number;
  bothScored: number;
  overTwoAndHalf: number;
}

export function seasonFigures(matches: Match[]): SeasonFigures {
  const results = matches.filter(hasPublishedResult);
  const figures: SeasonFigures = {
    played: results.length,
    total: matches.filter((m) => m.status !== "CANCELLED").length,
    goals: 0,
    home: 0,
    draws: 0,
    away: 0,
    bothScored: 0,
    overTwoAndHalf: 0,
  };
  for (const m of results) {
    const h = m.homeScore!;
    const a = m.awayScore!;
    figures.goals += h + a;
    if (h > a) figures.home++;
    else if (h < a) figures.away++;
    else figures.draws++;
    if (h > 0 && a > 0) figures.bothScored++;
    if (h + a > 2) figures.overTwoAndHalf++;
  }
  return figures;
}

interface Split {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}
export interface TeamLine {
  key: string;
  name: string;
  crest?: string;
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
  home: Split;
  away: Split;
}
const split = (): Split => ({ played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 });

export function teamLines(matches: Match[]): TeamLine[] {
  const lines = new Map<string, TeamLine>();
  for (const m of matches.filter(hasPublishedResult)) {
    for (const side of ["home", "away"] as const) {
      const key = teamKey(m, side);
      const line = lines.get(key) || {
        key,
        name: m[side],
        played: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        cleanSheets: 0,
        home: split(),
        away: split(),
      };
      line.crest ||= side === "home" ? m.homeCrest : m.awayCrest;
      const scored = side === "home" ? m.homeScore! : m.awayScore!;
      const conceded = side === "home" ? m.awayScore! : m.homeScore!;
      line.played++;
      line.goalsFor += scored;
      line.goalsAgainst += conceded;
      if (conceded === 0) line.cleanSheets++;
      const venue = line[side];
      venue.played++;
      venue.goalsFor += scored;
      venue.goalsAgainst += conceded;
      venue[scored > conceded ? "wins" : scored < conceded ? "losses" : "draws"]++;
      lines.set(key, line);
    }
  }
  return [...lines.values()];
}

const decimal = new Intl.NumberFormat("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const perMatch = (value: number, played: number) => decimal.format(played ? value / played : 0);
const matchesLabel = (n: number) => `${n} ${n === 1 ? "partido" : "partidos"}`;
const record = (s: Split) => `${s.wins}V ${s.draws}E ${s.losses}D`;
const points = (s: Split) => s.wins * 3 + s.draws;
const byName = (a: TeamLine, b: TeamLine) => a.name.localeCompare(b.name, "es") || a.key.localeCompare(b.key);
const row = (t: TeamLine, value: number, team: string): StatRow => ({
  key: t.key,
  name: t.name,
  team,
  ...(t.crest ? { crest: t.crest } : {}),
  value,
});

/** The five boards of «Equipos», top five each. */
export function teamBoards(lines: TeamLine[], size = 5) {
  const most = Math.max(0, ...lines.map((t) => t.played));
  // Fewest conceded per match, among teams with at least half the matches of
  // the busiest one: a team out early (or with games in hand) can't lead it.
  const regular = lines.filter((t) => t.played > 0 && t.played * 2 >= most);
  return {
    attack: [...lines]
      .sort((a, b) => b.goalsFor - a.goalsFor || a.played - b.played || byName(a, b))
      .slice(0, size)
      .map((t) => row(t, t.goalsFor, `${matchesLabel(t.played)} · ${perMatch(t.goalsFor, t.played)} por partido`)),
    defence: [...regular]
      .sort(
        (a, b) =>
          a.goalsAgainst / a.played - b.goalsAgainst / b.played || a.goalsAgainst - b.goalsAgainst || byName(a, b),
      )
      .slice(0, size)
      .map((t) => row(t, t.goalsAgainst, `${matchesLabel(t.played)} · ${perMatch(t.goalsAgainst, t.played)} por partido`)),
    cleanSheets: [...lines]
      .filter((t) => t.cleanSheets > 0)
      .sort((a, b) => b.cleanSheets - a.cleanSheets || a.played - b.played || byName(a, b))
      .slice(0, size)
      .map((t) => row(t, t.cleanSheets, `de ${matchesLabel(t.played)}`)),
    home: [...lines]
      .filter((t) => t.home.played > 0)
      .sort(
        (a, b) =>
          points(b.home) - points(a.home) ||
          b.home.goalsFor - b.home.goalsAgainst - (a.home.goalsFor - a.home.goalsAgainst) ||
          a.home.played - b.home.played ||
          byName(a, b),
      )
      .slice(0, size)
      .map((t) => row(t, points(t.home), `${matchesLabel(t.home.played)} · ${record(t.home)}`)),
    away: [...lines]
      .filter((t) => t.away.played > 0)
      .sort(
        (a, b) =>
          points(b.away) - points(a.away) ||
          b.away.goalsFor - b.away.goalsAgainst - (a.away.goalsFor - a.away.goalsAgainst) ||
          a.away.played - b.away.played ||
          byName(a, b),
      )
      .slice(0, size)
      .map((t) => row(t, points(t.away), `${matchesLabel(t.away.played)} · ${record(t.away)}`)),
  };
}
