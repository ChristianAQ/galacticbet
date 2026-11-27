import {
  parseProbability,
  probabilityFromOdds,
} from "../src/lib/matchProbability";
import {
  COMPETITIONS,
  COMPETITION_CODES,
  type CompetitionCode,
} from "../src/lib/competitions";
import type { Match } from "../src/lib/domain";
import {
  validMatchInsight,
  type Matchup,
  type MatchGoal,
  type MatchIncident,
  type MatchInsight,
  type MatchLineup,
  type MatchPlayer,
  type MatchStatistic,
  type PlayerStat,
  type PlayerStats,
} from "../src/lib/matchInsightsData";

export const ESPN_LEAGUES = Object.fromEntries(
  COMPETITION_CODES.map((code) => [code, COMPETITIONS[code].espn]),
) as Record<CompetitionCode, string>;
const API_ROOT = "https://site.api.espn.com/apis/site/v2/sports/soccer";
type Row = Record<string, unknown>;
const row = (value: unknown): Row =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.map(row) : [];
function text(value: unknown, max = 160): string | undefined {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= max
    ? value.trim()
    : undefined;
}
function identifier(value: unknown): string | undefined {
  const result =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : text(value, 30);
  return result && /^\d+$/.test(result) ? result : undefined;
}
// Letters that lose no accent but must still compare («Bodø» = «Bodo»).
const LETTERS: Record<string, string> = { ø: "o", Ø: "o", æ: "ae", Æ: "ae", ß: "ss", ł: "l", Ł: "l", đ: "d", Đ: "d", ı: "i" };
const cleanName = (value: string) =>
  value
    .replace(/[øØæÆßłŁđĐı]/g, (c) => LETTERS[c])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
// Deliberately explicit aliases: never fuzzy-match short names, cities or abbreviations.
const aliases = [
  ["FC Barcelona", "Barcelona", "Barça"],
  ["Real Madrid CF", "Real Madrid"],
  [
    "Club Atlético de Madrid",
    "Atlético de Madrid",
    "Atlético Madrid",
    "Atletico Madrid",
    "Atleti",
  ],
  ["Athletic Club", "Athletic Club Bilbao", "Athletic Bilbao"],
  ["Real Betis Balompié", "Real Betis"],
  ["Real Sociedad de Fútbol", "Real Sociedad"],
  ["RC Celta de Vigo", "RC Celta", "Celta Vigo", "Celta de Vigo"],
  ["RCD Espanyol de Barcelona", "RCD Espanyol", "Espanyol"],
  ["RCD Mallorca", "Mallorca"],
  ["CA Osasuna", "Osasuna"],
  ["Deportivo Alavés", "Alavés"],
  ["Getafe CF", "Getafe"],
  ["Girona FC", "Girona"],
  ["Sevilla FC", "Sevilla"],
  ["Valencia CF", "Valencia"],
  ["Villarreal CF", "Villarreal"],
  ["Rayo Vallecano de Madrid", "Rayo Vallecano"],
  ["Levante UD", "Levante"],
  ["Elche CF", "Elche"],
  ["Real Oviedo", "Oviedo"],
  ["UD Las Palmas", "Las Palmas"],
  ["CD Leganés", "Leganés"],
  ["Real Valladolid CF", "Real Valladolid", "Valladolid"],
  ["Manchester City FC", "Manchester City"],
  ["Manchester United FC", "Manchester United"],
  ["Liverpool FC", "Liverpool"],
  ["Arsenal FC", "Arsenal"],
  ["Chelsea FC", "Chelsea"],
  ["Aston Villa FC", "Aston Villa"],
  ["Newcastle United FC", "Newcastle United"],
  ["Tottenham Hotspur FC", "Tottenham Hotspur"],
  ["West Ham United FC", "West Ham", "West Ham United"],
  ["Nottingham Forest FC", "Nottingham Forest"],
  [
    "Brighton & Hove Albion FC",
    "Brighton & Hove Albion",
    "Brighton and Hove Albion",
    "Brighton",
  ],
  ["Wolverhampton Wanderers FC", "Wolverhampton Wanderers", "Wolves"],
  ["Fulham FC", "Fulham"],
  ["Crystal Palace FC", "Crystal Palace"],
  ["AFC Bournemouth", "Bournemouth"],
  ["Brentford FC", "Brentford"],
  ["Everton FC", "Everton"],
  ["Leeds United FC", "Leeds United", "Leeds"],
  ["Sunderland AFC", "Sunderland"],
  ["Burnley FC", "Burnley"],
  [
    "FC Bayern München",
    "Bayern München",
    "Bayern Munich",
    "FC Bayern",
    "Bayern",
  ],
  ["Borussia Dortmund", "Borussia Dortmund 09"],
  ["Bayer 04 Leverkusen", "Bayer Leverkusen"],
  [
    "Paris Saint-Germain FC",
    "Paris Saint-Germain",
    "Paris Saint Germain",
    "PSG",
  ],
  ["FC Internazionale Milano", "Internazionale", "Inter Milan", "Inter"],
  ["AC Milan", "Milan"],
  ["Juventus FC", "Juventus"],
  ["SSC Napoli", "Napoli"],
  ["Atalanta BC", "Atalanta"],
  ["SL Benfica", "Benfica"],
  ["FC Porto", "Porto"],
  ["Sporting Clube de Portugal", "Sporting CP"],
  ["PSV Eindhoven", "PSV"],
  ["AFC Ajax", "Ajax"],
  ["Feyenoord Rotterdam", "Feyenoord"],
  ["Celtic FC", "Celtic"],
];
const teamAliases = new Map(
  aliases.flatMap((group) =>
    group.map((name) => [cleanName(name), cleanName(group[0])] as const),
  ),
);
export function canonicalTeamName(value: string) {
  const name = cleanName(value);
  return teamAliases.get(name) || name;
}

export interface EspnEvent {
  id: string;
  competition: Match["competition"];
  kickoff: string;
  home: string;
  away: string;
  homeId: string;
  awayId: string;
}
function eventFromCompetition(
  value: unknown,
  competition: Match["competition"],
  fallbackId?: unknown,
): EspnEvent | null {
  const event = row(value);
  const id = identifier(event.id) || identifier(fallbackId);
  if (
    identifier(event.id) &&
    identifier(fallbackId) &&
    identifier(event.id) !== identifier(fallbackId)
  )
    return null;
  const kickoff = text(event.date);
  const competitors = rows(event.competitors);
  const home = competitors.filter((c) => c.homeAway === "home");
  const away = competitors.filter((c) => c.homeAway === "away");
  if (
    !id ||
    !kickoff ||
    !Number.isFinite(Date.parse(kickoff)) ||
    home.length !== 1 ||
    away.length !== 1 ||
    competitors.length !== 2
  )
    return null;
  const homeTeam = row(home[0].team),
    awayTeam = row(away[0].team);
  const homeName = text(homeTeam.displayName) || text(homeTeam.name);
  const awayName = text(awayTeam.displayName) || text(awayTeam.name);
  const homeId = identifier(homeTeam.id),
    awayId = identifier(awayTeam.id);
  if (!homeName || !awayName || !homeId || !awayId || homeId === awayId)
    return null;
  return {
    id,
    competition,
    kickoff,
    home: homeName,
    away: awayName,
    homeId,
    awayId,
  };
}
export function parseEspnScoreboard(
  value: unknown,
  competition: Match["competition"],
): EspnEvent[] {
  const data = row(value);
  const leagues = rows(data.leagues)
    .map((league) => text(league.slug) || text(league.abbreviation))
    .filter((slug): slug is string => Boolean(slug));
  if (
    leagues.length &&
    !leagues.some((slug) => slug.toLowerCase() === ESPN_LEAGUES[competition])
  )
    throw new Error("ESPN: competición de calendario incorrecta.");
  if (!Array.isArray(data.events))
    throw new Error("ESPN: calendario con formato no reconocido.");
  return rows(data.events).flatMap((event) => {
    const competitions = rows(event.competitions);
    if (competitions.length !== 1) return [];
    const parsed = eventFromCompetition(competitions[0], competition, event.id);
    return parsed ? [parsed] : [];
  });
}
/** Club-type words and years that the two providers add or leave out («Viking FK», «Como 1907»). */
const GENERIC = new Set(["fc", "cf", "fk", "sk", "afc", "sc", "ac", "as", "bc", "bk", "sv", "if", "club", "calcio"]);
/** Reserve, youth and women's sides: never the same club as the first team. */
const SIDE_MARKERS = new Set(["b", "c", "ii", "iii", "u17", "u19", "u20", "u21", "u23", "w", "women", "femenino", "fem", "youth", "reserves"]);
const sideOf = (name: string) => name.split(" ").filter((t) => SIDE_MARKERS.has(t)).sort().join(" ");
/** Numbers in a name («Como 1907», «Schalke 04»): left out only when one of the two names has none. */
const numbersOf = (name: string) => canonicalTeamName(name).split(" ").filter((t) => /^\d+$/.test(t)).sort().join(" ");
const numbersAgree = (a: string, b: string) => {
  const x = numbersOf(a),
    y = numbersOf(b);
  return !x || !y || x === y;
};
/** Same kind of side and no clashing numbers: what a different spelling may never hide. */
const compatible = (a: string, b: string) =>
  sideOf(coreTeamName(a)) === sideOf(coreTeamName(b)) && numbersAgree(a, b);
/** The name without those words, after the explicit aliases. */
export function coreTeamName(value: string) {
  return canonicalTeamName(value)
    .split(" ")
    .filter((t) => t && !GENERIC.has(t) && !/^\d+$/.test(t))
    .join(" ");
}
/**
 * The same club, said differently: every word of the shorter name starts a
 * word of the other («man city» / «manchester city», «dortmund» / «borussia
 * dortmund», «sl bratislava» / «slovan bratislava»), with a real word in common.
 */
export function sameTeam(a: string, b: string) {
  const x = coreTeamName(a),
    y = coreTeamName(b);
  if (!x || !y || !compatible(a, b)) return false;
  if (x === y) return true;
  // Either provider may write the short form: with as many words, both ways.
  const [p, q] = [x.split(" "), y.split(" ")];
  return (p.length <= q.length && covers(p, q)) || (q.length <= p.length && covers(q, p));
}
/** Every real word of the short name starts a word of the long one, and one of them is the same word. */
function covers(short: string[], long: string[]) {
  const words = short.filter((w) => w.length > 2);
  return (
    words.length > 0 &&
    words.some((w) => long.includes(w)) &&
    words.every((w) => long.some((l) => l.startsWith(w)))
  );
}
const sameKickoff = (event: EspnEvent, match: Match) =>
  event.competition === match.competition &&
  Math.abs(Date.parse(event.kickoff) - Date.parse(match.utcDate)) <= 15 * 60_000;
/**
 * Among fixtures already at the right time and competition, the one of this
 * match: both clubs agree («Man City» / «Manchester City»); failing that, one
 * club exactly the same in its place (a club plays one match at a time) and
 * the other compatible. Two possible fixtures: none.
 */
export function pairByTeams<T extends { home: string; away: string }>(
  match: Pick<Match, "home" | "away">,
  fixtures: T[],
  { oneClub = true }: { oneClub?: boolean } = {},
): T | null {
  const full = fixtures.filter((f) => sameTeam(f.home, match.home) && sameTeam(f.away, match.away));
  if (full.length || !oneClub) return full.length === 1 ? full[0] : null;
  const exact = (a: string, b: string) => coreTeamName(a) === coreTeamName(b) && numbersAgree(a, b);
  const partial = fixtures.filter(
    (f) =>
      // The other club may be written differently, but never be another side of a club («Barcelona B»).
      compatible(f.home, match.home) &&
      compatible(f.away, match.away) &&
      (exact(f.home, match.home) || exact(f.away, match.away)),
  );
  return partial.length === 1 ? partial[0] : null;
}
/** Both clubs, each in its place. */
export function eventFitsMatch(event: EspnEvent, match: Match) {
  return sameKickoff(event, match) && sameTeam(event.home, match.home) && sameTeam(event.away, match.away);
}
/** The ESPN event of a match (see `pairByTeams`). */
export function findEspnEvent(
  match: Match,
  events: EspnEvent[],
): EspnEvent | null {
  return pairByTeams(match, events.filter((event) => sameKickoff(event, match)));
}
function sideFor(team: unknown, event: EspnEvent): "home" | "away" | undefined {
  const id = identifier(row(team).id);
  return id === event.homeId
    ? "home"
    : id === event.awayId
      ? "away"
      : undefined;
}
function playerName(value: unknown) {
  const player = row(value),
    athlete = row(player.athlete);
  return (
    text(athlete.displayName) ||
    text(athlete.fullName) ||
    text(player.displayName) ||
    text(player.fullName)
  );
}
// Roster stat names → ours. "appearances" says whether the player took part.
const playerStatNames: Record<string, PlayerStat> = {
  totalShots: "shots",
  shotsOnTarget: "shotsOnTarget",
  totalGoals: "goals",
  goalAssists: "assists",
  foulsCommitted: "foulsCommitted",
  foulsSuffered: "foulsSuffered",
  yellowCards: "yellowCards",
  redCards: "redCards",
  saves: "saves",
};
function count(stat: Row): number | undefined {
  const value =
    typeof stat.value === "number"
      ? stat.value
      : Number(text(stat.displayValue, 4));
  return Number.isInteger(value) && value >= 0 && value <= 99
    ? value
    : undefined;
}
/** A player's numbers, only once ESPN counts an appearance (never for an unused sub). */
function playerStats(entry: Row): PlayerStats | undefined {
  const stats: PlayerStats = {};
  let appearances = 0;
  for (const stat of rows(entry.stats)) {
    const name = String(stat.name || ""),
      value = count(stat);
    if (value === undefined) continue;
    if (name === "appearances") appearances = value;
    else if (playerStatNames[name]) stats[playerStatNames[name]] = value;
  }
  return appearances > 0 && Object.keys(stats).length ? stats : undefined;
}
function normalizeLineups(data: Row, event: EspnEvent): MatchLineup[] {
  // Soccer summary.rosters[].roster contains athlete, jersey, position and starter.
  // Only explicit starter flags are accepted; an available squad is not a confirmed XI.
  const result: MatchLineup[] = [];
  for (const roster of rows(data.rosters)) {
    const side = sideFor(roster.team, event);
    if (!side || result.some((lineup) => lineup.side === side)) continue;
    const players: MatchPlayer[] = [];
    const names = new Set<string>();
    for (const entry of rows(roster.roster).slice(0, 50)) {
      const name = playerName(entry);
      if (!name || typeof entry.starter !== "boolean" || names.has(name))
        continue;
      const number =
        text(entry.jersey, 8) ||
        (Number.isInteger(entry.jersey) && Number(entry.jersey) >= 0
          ? String(entry.jersey)
          : undefined);
      const position =
        text(row(entry.position).abbreviation, 30) ||
        text(row(entry.position).displayName, 50);
      // plays[] are the player's own events; substitutions carry the minute.
      const changes = rows(entry.plays)
        .filter((play) => play.substitution === true)
        .map((play) => text(row(play.clock).displayValue, 30));
      const subIn = entry.subbedIn === true ? changes[0] : undefined;
      const subOut =
        entry.subbedOut === true
          ? changes[entry.subbedIn === true ? 1 : 0]
          : undefined;
      const stats = playerStats(entry);
      players.push({
        name,
        starter: entry.starter,
        ...(number ? { number } : {}),
        ...(position ? { position } : {}),
        ...(subIn ? { subIn } : {}),
        ...(subOut ? { subOut } : {}),
        ...(stats ? { stats } : {}),
      });
      names.add(name);
    }
    if (!players.length || players.length > 30) continue;
    const formation =
      text(roster.formation, 30) || text(row(roster.formation).displayName, 30);
    result.push({ side, players, ...(formation ? { formation } : {}) });
  }
  return result;
}
/**
 * The side an own goal counts for when ESPN does not say it: the other one
 * than the line-up with that player (substitutes included). Unknown when the
 * name is in neither line-up, or in both.
 */
function ownGoalSide(scorer: string, lineups: MatchLineup[]): "home" | "away" | undefined {
  const name = cleanName(scorer);
  const sides = lineups
    .filter((lineup) => lineup.players.some((p) => cleanName(p.name) === name))
    .map((lineup) => lineup.side);
  return sides.length === 1 ? (sides[0] === "home" ? "away" : "home") : undefined;
}
function normalizeGoals(
  data: Row,
  event: EspnEvent,
  competition: Row,
  lineups: MatchLineup[],
): MatchGoal[] {
  // keyEvents/scoringPlays expose type, clock, team and participants. Competition
  // details is a fallback for snapshots that expose scoring plays in the header.
  const sources = [data.keyEvents, data.scoringPlays, competition.details];
  const entries = sources.flatMap((source, sourceIndex) =>
    rows(source).map((entry) => ({ entry, sourceIndex })),
  );
  const result: MatchGoal[] = [];
  const seen = new Map<
    string,
    { index: number; id?: string; sources: Set<number> }[]
  >();
  for (const { entry, sourceIndex } of entries) {
    const type = row(entry.type);
    const kind = cleanName(
      [type.text, type.type, type.name]
        .filter((v) => typeof v === "string")
        .join(" "),
    );
    if (
      /shoot ?out|penalty missed|missed penalty|disallow|overturn|cancel/.test(
        kind,
      ) ||
      Number(row(entry.period).number) >= 5 ||
      entry.shootout === true ||
      entry.penaltyShootout === true ||
      entry.scoringPlay === false
    )
      continue;
    const own = /own goal/.test(kind) || entry.ownGoal === true;
    const penalty =
      /penalty|penalt[yi] kick/.test(kind) || entry.penaltyKick === true;
    // Reject generic incidents and attempts. A bare penalty is not proof it scored.
    if (!/goal/.test(kind) && entry.scoringPlay !== true) continue;
    const minute =
      text(row(entry.clock).displayValue, 30) || text(entry.displayClock, 30);
    const participants = rows(entry.participants);
    const explicitScorer = participants.find((p) =>
      /scorer|scoring|goal scorer/.test(
        String(p.type || p.role || "").toLowerCase(),
      ),
    );
    const scorer =
      playerName(entry.scorer) ||
      playerName(explicitScorer || participants[0]) ||
      playerName(rows(entry.athletes)[0]);
    // Public payloads do not consistently distinguish the own-goal player's team
    // from the beneficiary: an explicit scoringTeam, else the player's line-up
    // (the goal counts for the other side). Never `team`, which may be either.
    const side = own
      ? sideFor(entry.scoringTeam, event) ?? (scorer ? ownGoalSide(scorer, lineups) : undefined)
      : sideFor(entry.team, event);
    const assistant = participants.find((p) =>
      /assist/.test(String(p.type || p.role || "").toLowerCase()),
    );
    const assist = playerName(entry.assist) || playerName(assistant);
    if (!side || !minute || !scorer) continue;
    const goal: MatchGoal = {
      side,
      minute,
      scorer,
      kind: own ? "own-goal" : penalty ? "penalty" : "goal",
      ...(assist ? { assist } : {}),
    };
    const clock = minute.replace(/[\s'’′]/g, "");
    const parts = /^(\d+)(?:\+(\d+))?$/.exec(clock);
    const normalizedMinute = parts
      ? `${Number(parts[1])}${parts[2] ? `+${Number(parts[2])}` : ""}`
      : clock.toLowerCase();
    const key = JSON.stringify([
      side,
      normalizedMinute,
      cleanName(scorer),
      goal.kind,
    ]);
    const id = identifier(entry.id);
    const candidates = seen.get(key) || [];
    // Provider IDs help align repeated events, but never override the actual goal
    // identity: header/details can reuse identifiers. Distinct IDs in one source
    // remain distinct even if the same scorer scored twice in the same minute.
    const duplicate =
      candidates.find((candidate) => id && candidate.id === id) ||
      candidates.find((candidate) => !candidate.sources.has(sourceIndex)) ||
      candidates.find((candidate) => !id && !candidate.id);
    if (duplicate) {
      const previous = result[duplicate.index];
      if (!previous.assist && assist)
        result[duplicate.index] = { ...previous, assist };
      duplicate.sources.add(sourceIndex);
    } else {
      candidates.push({
        index: result.length,
        id,
        sources: new Set([sourceIndex]),
      });
      result.push(goal);
      seen.set(key, candidates);
    }
  }
  return result.slice(0, 40);
}
function normalizeIncidents(
  data: Row,
  event: EspnEvent,
  competition: Row,
): MatchIncident[] {
  const result = new Map<string, MatchIncident>();
  for (const entry of [
    ...rows(data.keyEvents),
    ...rows(competition.details),
  ].slice(0, 300)) {
    const type = row(entry.type);
    const label = cleanName(
      [type.text, type.type, type.name]
        .filter((v) => typeof v === "string")
        .join(" "),
    );
    if (/cancel|overturn|rescind/.test(label)) continue;
    const side = sideFor(entry.team, event);
    const minute =
      text(row(entry.clock).displayValue, 30) || text(entry.displayClock, 30);
    if (!side || !minute) continue;
    const kind = /second yellow|yellow red|yellow card 2nd|2nd yellow/.test(
      label,
    )
      ? "second-yellow"
      : /red card/.test(label)
        ? "red-card"
        : /yellow card/.test(label)
          ? "yellow-card"
          : /substitution/.test(label)
            ? "substitution"
            : undefined;
    if (!kind) continue;
    const participants = rows(entry.participants);
    const role = (p: Row) =>
      cleanName(
        [p.type, p.role, row(p.type).text, row(p.type).name]
          .filter((v) => typeof v === "string")
          .join(" "),
      );
    const incoming = participants.find((p) =>
      /^(substitution )?(on|in|entering)$/.test(role(p)),
    );
    const outgoing = participants.find((p) =>
      /^(substitution )?(off|out|leaving)$/.test(role(p)),
    );
    const player =
      kind === "substitution"
        ? playerName(incoming)
        : playerName(entry.athlete) ||
          (participants.length === 1 ? playerName(participants[0]) : undefined);
    const playerOut =
      kind === "substitution" ? playerName(outgoing) : undefined;
    if (!player || (kind === "substitution" && !playerOut)) continue;
    const incident: MatchIncident = {
      side,
      minute,
      kind,
      player,
      ...(playerOut ? { playerOut } : {}),
    };
    const key = [
      side,
      minute.replace(/[\s'’′]/g, ""),
      kind,
      player,
      playerOut,
    ].join(":");
    result.set(key, incident);
  }
  return [...result.values()].slice(0, 100);
}
const statisticNames: Record<string, string> = {
  possessionpct: "Posesión",
  possession: "Posesión",
  ballpossession: "Posesión",
  totalshots: "Remates",
  shots: "Remates",
  shotstotal: "Remates",
  shotsontarget: "Remates a puerta",
  shotsongoal: "Remates a puerta",
  foulscommitted: "Faltas",
  fouls: "Faltas",
  cornerkicks: "Córners",
  corners: "Córners",
  woncorners: "Córners",
  offsides: "Fueras de juego",
  saves: "Paradas",
  yellowcards: "Tarjetas amarillas",
  redcards: "Tarjetas rojas",
  totalpasses: "Pases",
  accuratepasses: "Pases completados",
  expectedgoals: "Goles esperados (xG)",
  shotsblocked: "Remates bloqueados",
  blockedshots: "Remates bloqueados",
  shotswide: "Remates fuera",
  shotsofftarget: "Remates fuera",
  tackles: "Entradas",
  totaltackles: "Entradas",
  interceptions: "Intercepciones",
  passpct: "Precisión de pase",
  passcompletionpct: "Precisión de pase",
  crosses: "Centros",
  totalcrosses: "Centros",
  longballs: "Balones largos",
  totallongballs: "Balones largos",
  clearances: "Despejes",
  totalclearance: "Despejes",
};
// Display order; it also caps the list (the document allows 20).
const statisticOrder = [
  "Posesión",
  "Goles esperados (xG)",
  "Remates",
  "Remates a puerta",
  "Remates fuera",
  "Remates bloqueados",
  "Córners",
  "Pases",
  "Pases completados",
  "Precisión de pase",
  "Centros",
  "Balones largos",
  "Entradas",
  "Intercepciones",
  "Despejes",
  "Paradas",
  "Faltas",
  "Fueras de juego",
  "Tarjetas amarillas",
  "Tarjetas rojas",
];
/** Some feeds give a ratio (0.9) where the label is a percentage. */
function percent(value: string) {
  if (value.endsWith("%")) return value;
  const n = Number(value.replace(",", "."));
  return `${n <= 1 ? Math.round(n * 100) : value}%`;
}
function statValue(value: unknown): string | undefined {
  const formatted =
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? String(value)
      : text(value, 30);
  return formatted && /^\d+(?:[.,]\d+)?%?$/.test(formatted)
    ? formatted
    : undefined;
}
function normalizeStatistics(data: Row, event: EspnEvent): MatchStatistic[] {
  // Soccer uses boxscore.players[].statistics for team totals; teams is accepted
  // only when it carries the same named-statistic structure (never player rows).
  const boxscore = row(data.boxscore);
  const bySide: Record<"home" | "away", Map<string, string>> = {
    home: new Map(),
    away: new Map(),
  };
  for (const entry of [...rows(boxscore.players), ...rows(boxscore.teams)]) {
    const side = sideFor(entry.team, event);
    if (!side) continue;
    for (const stat of rows(entry.statistics)) {
      const key = String(stat.name || "")
        .toLowerCase()
        .replace(/[^a-z]/g, "");
      const label = statisticNames[key];
      const value = statValue(stat.displayValue ?? stat.value);
      if (label && value !== undefined)
        bySide[side].set(
          label,
          ["Posesión", "Precisión de pase"].includes(label)
            ? percent(value)
            : value,
        );
    }
  }
  // ESPN rounds its pass ratio to one decimal (0.9); the counts give the real figure.
  for (const stats of Object.values(bySide)) {
    const total = Number(stats.get("Pases")),
      accurate = Number(stats.get("Pases completados"));
    if (total > 0 && accurate <= total)
      stats.set(
        "Precisión de pase",
        `${Math.round((accurate / total) * 100)}%`,
      );
  }
  return [...bySide.home]
    .flatMap(([label, home]) => {
      const away = bySide.away.get(label);
      return away === undefined ? [] : [{ label, home, away }];
    })
    .sort(
      (a, b) =>
        statisticOrder.indexOf(a.label) - statisticOrder.indexOf(b.label),
    )
    .slice(0, 20);
}
/** Only the provider's head-to-head block is accepted, never each team's recent form. */
export function normalizeMatchups(
  value: unknown,
  expected: Pick<EspnEvent, "id" | "homeId" | "awayId">,
  cutoff: number,
): Matchup[] {
  function candidates(input: unknown, depth = 0): Row[] {
    if (depth > 2) return [];
    return rows(input).flatMap((item) =>
      Array.isArray(item.events) ? candidates(item.events, depth + 1) : [item],
    );
  }
  function score(value: unknown): number | null {
    const raw =
      typeof value === "object" && value !== null
        ? (row(value).value ?? row(value).displayValue)
        : value;
    if (
      typeof raw !== "number" &&
      (typeof raw !== "string" || !/^\d{1,2}$/.test(raw))
    )
      return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
  }
  const parsed = candidates(value)
    .slice(0, 40)
    .flatMap((item) => {
      const comps = rows(item.competitions);
      if (comps.length > 1) return [];
      const game = comps[0] || item;
      const id = identifier(item.id ?? game.id);
      const date = text(game.date) || text(item.date);
      if (
        !id ||
        id === expected.id ||
        !date ||
        !Number.isFinite(Date.parse(date)) ||
        Date.parse(date) >= cutoff
      )
        return [];
      const state = row(row(game.status ?? item.status).type);
      if (state.completed === false || (state.state && state.state !== "post"))
        return [];
      const competitors = rows(game.competitors);
      if (
        competitors.length &&
        (competitors.length !== 2 ||
          competitors.filter((c) => c.homeAway === "home").length !== 1 ||
          competitors.filter((c) => c.homeAway === "away").length !== 1)
      )
        return [];
      const home = competitors.find((c) => c.homeAway === "home");
      const away = competitors.find((c) => c.homeAway === "away");
      const ht = row(home?.team ?? game.homeTeam),
        at = row(away?.team ?? game.awayTeam);
      const hid = identifier(ht.id ?? game.homeTeamId),
        aid = identifier(at.id ?? game.awayTeamId);
      if (!(
        (hid === expected.homeId && aid === expected.awayId) ||
        (hid === expected.awayId && aid === expected.homeId)
      ))
        return [];
      const homeName = text(ht.displayName) || text(ht.name);
      const awayName = text(at.displayName) || text(at.name);
      const homeScore = score(home?.score ?? game.homeTeamScore ?? ht.score);
      const awayScore = score(away?.score ?? game.awayTeamScore ?? at.score);
      if (!homeName || !awayName || homeScore === null || awayScore === null)
        return [];
      const league = row(item.league ?? game.league);
      const competition = text(league.displayName) || text(league.name);
      return [
        {
          id,
          date: new Date(date).toISOString(),
          home: homeName,
          away: awayName,
          homeScore,
          awayScore,
          ...(competition ? { competition } : {}),
        },
      ];
    });
  return [...new Map(parsed.map((m) => [m.id, m])).values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
}

export function normalizeEspnSummary(
  value: unknown,
  match: Match,
  expected: EspnEvent,
  fetchedAt = new Date().toISOString(),
): MatchInsight | null {
  const data = row(value),
    header = row(data.header);
  const competitions = rows(header.competitions);
  if (competitions.length !== 1) return null;
  const competition = competitions[0];
  const event = eventFromCompetition(competition, match.competition, header.id);
  // Validate the summary identity again; do not trust a previously matched listing.
  if (
    !event ||
    event.id !== expected.id ||
    event.homeId !== expected.homeId ||
    event.awayId !== expected.awayId ||
    // Same rules as finding it: both clubs, or one identical and the only possible match.
    findEspnEvent(match, [event]) !== event
  )
    return null;
  const league = row(header.league);
  const leagueCode = text(league.slug) || text(league.abbreviation);
  if (
    leagueCode &&
    leagueCode.toLowerCase() !== ESPN_LEAGUES[match.competition]
  )
    return null;
  const gameInfo = row(data.gameInfo);
  const venue =
    text(row(gameInfo.venue).fullName) || text(row(competition.venue).fullName);
  const officials = rows(gameInfo.officials);
  const refereeRow = officials.find((official) =>
    /^(referee|ref)$/i.test(
      String(official.type || row(official.position).name || ""),
    ),
  );
  const referee = refereeRow
    ? text(refereeRow.displayName) || text(refereeRow.fullName)
    : undefined;
  const attendanceValue = gameInfo.attendance ?? competition.attendance;
  const attendance =
    Number.isInteger(attendanceValue) && Number(attendanceValue) >= 0
      ? Number(attendanceValue)
      : undefined;
  const probability =
    ["SCHEDULED", "TIMED"].includes(match.status) &&
    Date.parse(fetchedAt) < Date.parse(match.utcDate)
      ? parseProbability(
          data.predictor,
          event.homeId,
          event.awayId,
          fetchedAt,
        ) || probabilityFromOdds(data.pickcenter, fetchedAt)
      : undefined;
  const lineups = normalizeLineups(data, event);
  const insight: MatchInsight = {
    version: 1,
    matchId: match.id,
    competition: match.competition,
    kickoff: match.utcDate,
    provider: "ESPN",
    eventId: event.id,
    fetchedAt,
    ...(probability ? { probability } : {}),
    ...(venue ? { venue } : {}),
    ...(referee ? { referee } : {}),
    ...(attendance !== undefined ? { attendance } : {}),
    matchups: normalizeMatchups(
      data.headToHeadGames,
      event,
      Math.min(Date.parse(match.utcDate), Date.parse(fetchedAt)),
    ),
    incidents: normalizeIncidents(data, event, competition),
    lineups,
    goals: normalizeGoals(data, event, competition, lineups),
    statistics: normalizeStatistics(data, event),
  };
  return validMatchInsight(insight) ? insight : null;
}

export class EspnRequestError extends Error {
  constructor(
    public readonly status?: number,
    budgetExhausted = false,
  ) {
    super(
      budgetExhausted
        ? "ESPN: límite interno de 50 peticiones alcanzado; se conserva la información anterior."
        : status
          ? `ESPN HTTP ${status}; se conserva la información anterior.`
          : "ESPN no respondió; se conserva la información anterior.",
    );
  }
}
export interface EspnClient {
  schedule?: (
    competition: Match["competition"],
    teamId: string,
    season: number,
  ) => Promise<unknown>;
  odds?: (
    competition: Match["competition"],
    eventId: string,
  ) => Promise<unknown>;
  scoreboard: (
    competition: Match["competition"],
    from: string,
    to: string,
  ) => Promise<EspnEvent[]>;
  summary: (
    competition: Match["competition"],
    eventId: string,
  ) => Promise<unknown>;
}
export function createEspnClient(request: typeof fetch = fetch): EspnClient {
  let requests = 0;
  async function read(url: string) {
    if (++requests > 50) throw new EspnRequestError(undefined, true);
    try {
      const response = await request(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new EspnRequestError(response.status);
      const body = await response.text();
      if (body.length > 3_000_000) throw new EspnRequestError();
      return JSON.parse(body) as unknown;
    } catch (error) {
      if (error instanceof EspnRequestError) throw error;
      throw new EspnRequestError();
    }
  }
  return {
    async schedule(competition, teamId, season) {
      if (
        !ESPN_LEAGUES[competition] ||
        !/^\d{1,30}$/.test(teamId) ||
        !Number.isInteger(season) ||
        season < 2000 ||
        season > 2100
      )
        throw new Error("ESPN: calendario de equipo inválido.");
      return read(
        `${API_ROOT}/${ESPN_LEAGUES[competition]}/teams/${teamId}/schedule?season=${season}`,
      );
    },
    async scoreboard(competition, from, to) {
      if (!/^\d{8}$/.test(from) || !/^\d{8}$/.test(to))
        throw new Error("ESPN: intervalo de fechas inválido.");
      const url = `${API_ROOT}/${ESPN_LEAGUES[competition]}/scoreboard`;
      try {
        return parseEspnScoreboard(
          await read(
            `${url}?dates=${from === to ? from : `${from}-${to}`}&limit=100`,
          ),
          competition,
        );
      } catch (error) {
        // Community documentation reports date-range regressions. Do not retry 403/429.
        if (
          !(error instanceof EspnRequestError) ||
          error.status !== 400 ||
          from === to
        )
          throw error;
        const day = (v: string) =>
          Date.parse(
            `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}T00:00:00Z`,
          );
        const start = day(from),
          end = day(to);
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          end < start ||
          end - start > 4 * 86400000
        )
          throw error;
        const events = new Map<string, EspnEvent>();
        for (let date = start; date <= end; date += 86400000) {
          const key = new Date(date)
            .toISOString()
            .slice(0, 10)
            .replaceAll("-", "");
          for (const event of parseEspnScoreboard(
            await read(`${url}?dates=${key}&limit=100`),
            competition,
          ))
            events.set(event.id, event);
        }
        return [...events.values()];
      }
    },
    async odds(competition, eventId) {
      if (!/^\d{1,30}$/.test(eventId) || !ESPN_LEAGUES[competition])
        throw new Error("ESPN: identificador inválido.");
      // Fixed host/path; never follow provider-supplied $ref URLs.
      return read(
        `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${ESPN_LEAGUES[competition]}/events/${eventId}/competitions/${eventId}/odds?limit=10`,
      );
    },
    async summary(competition, eventId) {
      if (!/^\d{1,30}$/.test(eventId))
        throw new Error("ESPN: identificador inválido.");
      return read(
        `${API_ROOT}/${ESPN_LEAGUES[competition]}/summary?event=${eventId}`,
      );
    },
  };
}
