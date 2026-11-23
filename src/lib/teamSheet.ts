import { hasPublishedResult, type Match } from "./domain";
import { leagueTable, LEAGUE_STAGES, teamKey, type LeagueRow } from "./leagueTable";
import type { Scorer } from "./leagueStats";
import type { FormResult } from "./matchInsights";

/**
 * A team's sheet from the league table: where it stands, how far from what
 * matters, how it comes, at home and away, its next match and its scorers.
 * Everything from official results (and the provider's top scorers).
 */
export interface SheetGame {
  id: string;
  opponent: string;
  crest?: string;
  home: boolean;
  utcDate: string;
  /** Own goals first: «2-1» is a win. */
  score?: string;
  result?: FormResult;
}
export interface SheetSplit {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}
export interface Streak {
  kind: "wins" | "unbeaten" | "losses" | "winless";
  count: number;
}
export interface TeamSheet {
  row: LeagueRow;
  position: number;
  size: number;
  /** Points to the leader (0: leads); for the leader, its margin over the second. */
  leaderGap: number;
  lead: number | null;
  /** Every played match, oldest first. */
  games: SheetGame[];
  last: SheetGame[];
  next: SheetGame | null;
  home: SheetSplit;
  away: SheetSplit;
  cleanSheets: number;
  streak: Streak | null;
  scorers: Scorer[];
}

const split = (): SheetSplit => ({ played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 });

/** The most telling current run: wins, unbeaten, losses or without a win. */
export function currentStreak(results: FormResult[]): Streak | null {
  // Newest last.
  const run = (test: (r: FormResult) => boolean) => {
    let n = 0;
    for (let i = results.length - 1; i >= 0 && test(results[i]); i--) n++;
    return n;
  };
  const wins = run((r) => r === "win");
  const unbeaten = run((r) => r !== "loss");
  const losses = run((r) => r === "loss");
  const winless = run((r) => r !== "win");
  if (wins >= 2) return { kind: "wins", count: wins };
  if (unbeaten >= 3) return { kind: "unbeaten", count: unbeaten };
  if (losses >= 2) return { kind: "losses", count: losses };
  if (winless >= 3) return { kind: "winless", count: winless };
  return null;
}

export function teamSheet(
  table: LeagueRow[],
  index: number,
  /** Matches of the competition and season (all stages). */
  matches: Match[],
  scorers: Scorer[] = [],
  now = Date.now(),
): TeamSheet {
  const row = table[index];
  const sideOf = (m: Match) =>
    teamKey(m, "home") === row.key ? "home" : teamKey(m, "away") === row.key ? "away" : null;
  const own = matches
    .map((m) => ({ m, side: sideOf(m) }))
    .filter((x): x is { m: Match; side: "home" | "away" } => x.side !== null)
    .sort((a, b) => a.m.utcDate.localeCompare(b.m.utcDate));
  const played = own.filter(({ m }) => hasPublishedResult(m));
  const venues = { home: split(), away: split() };
  let cleanSheets = 0;
  const results: FormResult[] = [];
  const games: SheetGame[] = [];
  for (const { m, side } of played) {
    const scored = side === "home" ? m.homeScore! : m.awayScore!;
    const conceded = side === "home" ? m.awayScore! : m.homeScore!;
    const result: FormResult = scored > conceded ? "win" : scored < conceded ? "loss" : "draw";
    const v = venues[side];
    v.played++;
    v.goalsFor += scored;
    v.goalsAgainst += conceded;
    v[result === "win" ? "wins" : result === "draw" ? "draws" : "losses"]++;
    v.points += result === "win" ? 3 : result === "draw" ? 1 : 0;
    if (conceded === 0) cleanSheets++;
    results.push(result);
    const other = side === "home" ? "away" : "home";
    games.push({
      id: m.id,
      opponent: m[other],
      crest: other === "home" ? m.homeCrest : m.awayCrest,
      home: side === "home",
      utcDate: m.utcDate,
      score: `${scored}-${conceded}`,
      result,
    });
  }
  const upcoming = own.find(
    ({ m }) => !hasPublishedResult(m) && !["POSTPONED", "CANCELLED"].includes(m.status) && Date.parse(m.utcDate) >= now - 3 * 3600000,
  );
  const leader = table[0];
  return {
    row,
    position: index + 1,
    size: table.length,
    leaderGap: leader.points - row.points,
    lead: index === 0 && table[1] ? row.points - table[1].points : null,
    games,
    last: games.slice(-5),
    next: upcoming
      ? {
          id: upcoming.m.id,
          opponent: upcoming.m[upcoming.side === "home" ? "away" : "home"],
          crest: upcoming.side === "home" ? upcoming.m.awayCrest : upcoming.m.homeCrest,
          home: upcoming.side === "home",
          utcDate: upcoming.m.utcDate,
        }
      : null,
    home: venues.home,
    away: venues.away,
    cleanSheets,
    streak: currentStreak(results),
    // The club's top scorers: same crest (same provider) or the same name.
    scorers: scorers
      .filter((s) => (s.crest && row.crest ? s.crest === row.crest : s.team.toLocaleLowerCase("es") === row.name.toLocaleLowerCase("es")))
      .slice(0, 3),
  };
}

export const streakLabel = (s: Streak) =>
  s.kind === "wins"
    ? `${s.count} victorias seguidas`
    : s.kind === "unbeaten"
      ? `${s.count} partidos sin perder`
      : s.kind === "losses"
        ? `${s.count} derrotas seguidas`
        : `${s.count} partidos sin ganar`;

const pts = (n: number) => `${n} ${n === 1 ? "punto" : "puntos"}`;
/**
 * Where the team stands against what matters in its competition: the
 * leader, the Champions places and relegation in a league, the last-16 and
 * play-off places in the Champions. Only with the whole table, as its zones.
 */
export function standingNotes(table: LeagueRow[], index: number, code?: string): string[] {
  const own = table[index].points;
  const at = (position: number) => table[position - 1]?.points ?? 0;
  const position = index + 1;
  const notes: string[] = [];
  if (index === 0) {
    const margin = table[1] ? own - table[1].points : 0;
    notes.push(margin ? `Líder con ${pts(margin)} de ventaja` : "Líder, empatado a puntos con el segundo");
  } else notes.push(`A ${pts(at(1) - own)} del líder`);
  if ((code === "PD" || code === "PL") && table.length === 20) {
    if (position > 4) notes.push(`A ${pts(at(4) - own)} de la Champions`);
    else if (index > 0) notes.push(`${pts(own - at(5))} sobre el 5.º`);
    if (position >= 18) notes.push(`A ${pts(at(17) - own)} de la salvación`);
    else if (position >= 11) notes.push(`${pts(own - at(18))} sobre el descenso`);
  }
  if (code === "CL" && table.length === 36) {
    if (position <= 8) {
      if (index > 0) notes.push(`${pts(own - at(9))} sobre el 9.º: octavos directos`);
    } else if (position <= 24) notes.push(`A ${pts(at(8) - own)} de los octavos directos`);
    else notes.push(`A ${pts(at(24) - own)} del playoff`);
  }
  return notes;
}

/**
 * The team's place after each matchday of the league stage (for the line
 * chart): the table of every result up to that matchday.
 */
export function positionHistory(matches: Match[], key: string) {
  const league = matches.filter((m) => LEAGUE_STAGES.includes(m.stage) && m.matchday && hasPublishedResult(m));
  const days = [...new Set(league.map((m) => m.matchday!))].sort((a, b) => a - b);
  return days.flatMap((day) => {
    const table = leagueTable(league.filter((m) => m.matchday! <= day));
    const at = table.findIndex((r) => r.key === key);
    return at < 0 ? [] : [{ day, position: at + 1, points: table[at].points, size: table.length }];
  });
}
