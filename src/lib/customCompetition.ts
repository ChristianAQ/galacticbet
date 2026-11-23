import type { CompetitionCode } from "./competitions";
import type { Match } from "./domain";
import type { LeagueRow } from "./leagueTable";
import type { FormResult } from "./matchInsights";

/**
 * Competitions between friends: leagues and tournaments created in the app,
 * for any sport. Everything here is pure: fixtures are generated once at
 * creation, and tables, brackets and champions are always derived from the
 * stored results, so a corrected score can never count twice.
 */

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 32;
export const MAX_MATCHES = 500;
export const MAX_ICON_CHARS = 60_000;

export type Format =
  | "league"
  | "knockout"
  | "league_knockout"
  | "groups_knockout"
  | "custom";
export type ParticipantKind = "team" | "person";
export type MatchStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled";
export type Phase = "league" | "group" | "knockout" | "custom";
export type Stage =
  | "REGULAR_SEASON"
  | "GROUP_STAGE"
  | "LAST_32"
  | "LAST_16"
  | "QUARTER_FINALS"
  | "SEMI_FINALS"
  | "THIRD_PLACE"
  | "FINAL";
export type PredictionMode = "exact" | "classic" | "off";

export interface Schedule {
  /** Local date of the first round, YYYY-MM-DD. */
  start: string;
  /** Local kick-off of the first match of each day, HH:mm. */
  time: string;
  /** Days between rounds: 7 = every week on the same weekday. */
  everyDays: number;
  /** Minutes between matches of the same day; 0 = all at once. */
  slotMinutes: number;
  location: string;
  timeZone: string;
}
export interface CompetitionSetup {
  name: string;
  sport: string;
  icon: string | null;
  participantType: ParticipantKind;
  format: Format;
  /** League or group phase: one leg or home and away. */
  legs: 1 | 2;
  /** Knockout ties before the final (the final is always one match). */
  knockoutLegs: 1 | 2;
  /** league_knockout: teams that reach the bracket; groups_knockout: per group. */
  qualifiers: number;
  groups: number;
  thirdPlace: boolean;
  predictionMode: PredictionMode;
  schedule: Schedule;
}
export interface Competition extends CompetitionSetup {
  id: string;
  ownerId: string;
  adminIds: string[];
  memberIds: string[];
}
export interface Participant {
  id: string;
  name: string;
  kind: ParticipantKind;
  userId: string | null;
  icon: string | null;
  seed: number;
}
export interface Fixture {
  id: string;
  phase: Phase;
  /** Day number within its phase (Jornada N), or the knockout day. */
  round: number;
  stage: Stage;
  group: string | null;
  tie: string | null;
  leg: 1 | 2 | null;
  homeId: string | null;
  awayId: string | null;
  /** «league:1», «group:A:2», «winner:S1», «loser:S2» until it is decided. */
  homeSlot: string | null;
  awaySlot: string | null;
  startAt: number;
  location: string;
}
export interface CustomMatch extends Fixture {
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  /** Confirmed result: only the owner may change it. */
  locked: boolean;
}

export const FORMATS: Record<Format, { label: string; description: string }> = {
  league: {
    label: "Liga",
    description: "Todos contra todos. Gana quien más puntos sume.",
  },
  knockout: {
    label: "Eliminatoria",
    description: "Cruces directos hasta la final.",
  },
  league_knockout: {
    label: "Liga + eliminatoria",
    description: "Primero liga; los mejores pasan a los cruces finales.",
  },
  groups_knockout: {
    label: "Grupos + eliminatoria",
    description: "Grupos de todos contra todos y cruces con los clasificados.",
  },
  custom: {
    label: "Personalizado",
    description: "Tú creas las jornadas y los partidos a mano.",
  },
};
export const STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: "Programado",
  live: "En juego",
  finished: "Finalizado",
  postponed: "Aplazado",
  cancelled: "Cancelado",
};

const POWERS = [2, 4, 8, 16, 32];
const LETTERS = "ABCDEFGH";

// ---------- Which formats fit how many participants ----------

/** Bracket sizes after a league phase: fewer than the participants. */
export function leagueQualifierOptions(n: number) {
  return [2, 4, 8, 16].filter((q) => q < n);
}

/** Group plans with 3 to 8 per group and a bracket of 2, 4, 8 or 16. */
export function groupPlans(n: number) {
  const plans: { groups: number; qualifiers: number }[] = [];
  for (const groups of [2, 4, 8]) {
    const smallest = Math.floor(n / groups);
    if (smallest < 3 || Math.ceil(n / groups) > 8) continue;
    for (const qualifiers of [1, 2])
      if (qualifiers < smallest && POWERS.includes(groups * qualifiers) && groups * qualifiers <= 16)
        plans.push({ groups, qualifiers });
  }
  return plans;
}

/** Why a format is not possible with n participants (null: it is). */
export function formatAvailability(n: number): Record<Format, string | null> {
  const few = n < MIN_PARTICIPANTS ? "Añade al menos 2 participantes." : null;
  return {
    league: few,
    custom: few,
    knockout: POWERS.includes(n)
      ? null
      : "Necesita 2, 4, 8, 16 o 32 participantes.",
    league_knockout: leagueQualifierOptions(n).length
      ? null
      : "Necesita al menos 3 participantes.",
    groups_knockout: groupPlans(n).length
      ? null
      : "Necesita al menos 6 participantes.",
  };
}

/** A sensible start: a league for few, a league with a final phase for more. */
export function recommendedFormat(n: number): Pick<
  CompetitionSetup,
  "format" | "qualifiers" | "groups"
> {
  if (n >= 16) {
    const plan =
      groupPlans(n).find((p) => p.groups === 4 && p.qualifiers === 2) || groupPlans(n)[0];
    if (plan) return { format: "groups_knockout", ...plan };
  }
  if (n >= 6) return { format: "league_knockout", qualifiers: n >= 12 ? 8 : 4, groups: 0 };
  return { format: "league", qualifiers: 0, groups: 0 };
}

// ---------- Fixtures ----------

const BYE = "\u0000bye";

/**
 * All-against-all rounds (circle method). Odd counts rest one per round. With
 * two legs the second half repeats the first with home and away swapped.
 */
export function roundRobin(ids: string[], legs: 1 | 2): [string, string][][] {
  if (ids.length < 2) return [];
  let wheel = ids.length % 2 ? [...ids, BYE] : [...ids];
  const size = wheel.length;
  const rounds: [string, string][][] = [];
  for (let r = 0; r < size - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < size / 2; i++) {
      const a = wheel[i];
      const b = wheel[size - 1 - i];
      if (a === BYE || b === BYE) continue;
      // Alternate who hosts so nobody plays every match at home.
      const swap = i === 0 ? r % 2 === 1 : (r + i) % 2 === 1;
      pairs.push(swap ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    wheel = [wheel[0], wheel[size - 1], ...wheel.slice(1, size - 1)];
  }
  return legs === 2 ? [...rounds, ...rounds.map((r) => r.map(([h, a]) => [a, h] as [string, string]))] : rounds;
}

/** Bracket positions so that seeds 1 and 2 can only meet in the final. */
export function seedOrder(size: number): number[] {
  if (size <= 1) return [1];
  return seedOrder(size / 2).flatMap((seed) => [seed, size + 1 - seed]);
}

const STAGE_BY_TIES: Record<number, Stage> = {
  16: "LAST_32",
  8: "LAST_16",
  4: "QUARTER_FINALS",
  2: "SEMI_FINALS",
  1: "FINAL",
};
const TIE_PREFIX: Partial<Record<Stage, string>> = {
  LAST_32: "D",
  LAST_16: "O",
  QUARTER_FINALS: "Q",
  SEMI_FINALS: "S",
};
const tieId = (stage: Stage, index: number) =>
  stage === "FINAL" ? "F" : stage === "THIRD_PLACE" ? "TP" : `${TIE_PREFIX[stage]}${index + 1}`;

type Side = { id: string } | { slot: string };
interface Planned {
  key: string;
  phase: Phase;
  round: number;
  stage: Stage;
  group: string | null;
  tie: string | null;
  leg: 1 | 2 | null;
  home: Side;
  away: Side;
}

/** Snake draft by seed so every group gets a similar mix. */
export function splitGroups(ids: string[], groups: number) {
  const result: string[][] = Array.from({ length: groups }, () => []);
  ids.forEach((id, i) => {
    const lap = Math.floor(i / groups);
    const slot = i % groups;
    result[lap % 2 ? groups - 1 - slot : slot].push(id);
  });
  return result;
}

function firstRoundPairs(setup: CompetitionSetup, ids: string[]): [Side, Side][] {
  if (setup.format === "groups_knockout") {
    const letters = LETTERS.slice(0, setup.groups).split("");
    if (setup.qualifiers === 1) {
      const pairs: [Side, Side][] = [];
      for (let i = 0; i < letters.length; i += 2)
        pairs.push([{ slot: `group:${letters[i]}:1` }, { slot: `group:${letters[i + 1]}:1` }]);
      return pairs;
    }
    // A1–B2 and B1–A2 land in opposite halves: group winners meet late.
    const top: [Side, Side][] = [];
    const bottom: [Side, Side][] = [];
    for (let i = 0; i < letters.length; i += 2) {
      const [x, y] = [letters[i], letters[i + 1]];
      top.push([{ slot: `group:${x}:1` }, { slot: `group:${y}:2` }]);
      bottom.push([{ slot: `group:${y}:1` }, { slot: `group:${x}:2` }]);
    }
    return [...top, ...bottom];
  }
  const entrants: Side[] =
    setup.format === "league_knockout"
      ? Array.from({ length: setup.qualifiers }, (_, i) => ({ slot: `league:${i + 1}` }))
      : ids.map((id) => ({ id }));
  const order = seedOrder(entrants.length);
  const pairs: [Side, Side][] = [];
  for (let i = 0; i < order.length; i += 2)
    pairs.push([entrants[order[i] - 1], entrants[order[i + 1] - 1]]);
  return pairs;
}

/** Days of the knockout phase, from the first round to the final. */
function knockoutDays(setup: CompetitionSetup, ids: string[]): Planned[][] {
  const days: Planned[][] = [];
  let pairs = firstRoundPairs(setup, ids);
  let round = 0;
  while (pairs.length >= 1) {
    const stage = STAGE_BY_TIES[pairs.length];
    const legs = stage !== "FINAL" && setup.knockoutLegs === 2 ? 2 : 1;
    const ties = pairs.map((_, i) => tieId(stage, i));
    for (let leg = 1; leg <= legs; leg++) {
      round++;
      const day: Planned[] = [];
      if (stage === "FINAL" && setup.thirdPlace && days.length)
        day.push({
          key: "TP-1",
          phase: "knockout",
          round,
          stage: "THIRD_PLACE",
          group: null,
          tie: "TP",
          leg: null,
          home: { slot: "loser:S1" },
          away: { slot: "loser:S2" },
        });
      pairs.forEach(([high, low], i) =>
        day.push({
          key: `${ties[i]}-${leg}`,
          phase: "knockout",
          round,
          stage,
          group: null,
          tie: ties[i],
          leg: legs === 2 ? (leg as 1 | 2) : null,
          // Two legs: the better seed hosts the return; one leg: hosts it.
          home: legs === 2 && leg === 1 ? low : high,
          away: legs === 2 && leg === 1 ? high : low,
        }),
      );
      days.push(day);
    }
    const next: [Side, Side][] = [];
    for (let i = 0; i + 1 < ties.length; i += 2)
      next.push([{ slot: `winner:${ties[i]}` }, { slot: `winner:${ties[i + 1]}` }]);
    pairs = next;
  }
  return days;
}

/** «2026-11-28» + 7 → «2026-12-05», on the calendar (no time zone involved). */
export function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Offset of a time zone at an instant, in ms (positive east of UTC). */
function zoneOffset(ms: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return local - ms;
}

/**
 * Instant of a local wall-clock time in a time zone: Saturday 10:00 stays
 * 10:00 across daylight-saving changes.
 */
export function zonedInstant(date: string, minutes: number, timeZone: string) {
  const extraDays = Math.floor(minutes / 1440);
  const [y, m, d] = addDays(date, extraDays).split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes % 1440);
  let instant = wall - zoneOffset(wall, timeZone);
  instant = wall - zoneOffset(instant, timeZone);
  return instant;
}

/** The local date and time of an instant in a time zone, for the edit fields. */
export function localParts(ms: number, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(ms)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export const timeToMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

/** Days of every generated phase, in playing order. */
function plannedDays(setup: CompetitionSetup, ids: string[]): Planned[][] {
  const days: Planned[][] = [];
  if (setup.format === "league" || setup.format === "league_knockout")
    roundRobin(ids, setup.legs).forEach((pairs, r) =>
      days.push(
        pairs.map(([home, away], i) => ({
          key: `L${r + 1}-${i + 1}`,
          phase: "league",
          round: r + 1,
          stage: "REGULAR_SEASON",
          group: null,
          tie: null,
          leg: null,
          home: { id: home },
          away: { id: away },
        })),
      ),
    );
  if (setup.format === "groups_knockout") {
    const groups = splitGroups(ids, setup.groups).map((members) =>
      roundRobin(members, setup.legs),
    );
    const longest = Math.max(...groups.map((g) => g.length));
    for (let r = 0; r < longest; r++)
      days.push(
        groups.flatMap((rounds, g) =>
          (rounds[r] || []).map(([home, away], i) => ({
            key: `G${LETTERS[g]}${r + 1}-${i + 1}`,
            phase: "group" as const,
            round: r + 1,
            stage: "GROUP_STAGE" as const,
            group: LETTERS[g],
            tie: null,
            leg: null,
            home: { id: home },
            away: { id: away },
          })),
        ),
      );
  }
  if (["knockout", "league_knockout", "groups_knockout"].includes(setup.format))
    days.push(...knockoutDays(setup, ids));
  return days;
}

/** How many matches and playing days the setup produces. */
export function fixturePlan(setup: CompetitionSetup, count: number) {
  const days = plannedDays(
    setup,
    Array.from({ length: count }, (_, i) => `p${i}`),
  );
  return {
    days: days.length,
    matches: days.reduce((sum, day) => sum + day.length, 0),
    lastDate: days.length
      ? addDays(setup.schedule.start, (days.length - 1) * setup.schedule.everyDays)
      : setup.schedule.start,
  };
}

/**
 * Every match of the competition, dated: one playing day per round, every
 * `everyDays` days, matches of a day spaced by `slotMinutes`.
 */
export function generateFixtures(setup: CompetitionSetup, participants: Participant[]): Fixture[] {
  const ids = [...participants].sort((a, b) => a.seed - b.seed).map((p) => p.id);
  const start = timeToMinutes(setup.schedule.time);
  return plannedDays(setup, ids).flatMap((day, d) => {
    const date = addDays(setup.schedule.start, d * setup.schedule.everyDays);
    return day.map(
      (m, i): Fixture => ({
        id: m.key,
        phase: m.phase,
        round: m.round,
        stage: m.stage,
        group: m.group,
        tie: m.tie,
        leg: m.leg,
        homeId: "id" in m.home ? m.home.id : null,
        awayId: "id" in m.away ? m.away.id : null,
        homeSlot: "slot" in m.home ? m.home.slot : null,
        awaySlot: "slot" in m.away ? m.away.slot : null,
        startAt: zonedInstant(date, start + i * setup.schedule.slotMinutes, setup.schedule.timeZone),
        location: setup.schedule.location,
      }),
    );
  });
}

/**
 * The same match on a recurring date: every `everyDays` days, `count` times.
 * Rounds continue after the latest existing one.
 */
export function recurringFixtures({
  homeId,
  awayId,
  start,
  time,
  everyDays,
  count,
  location,
  timeZone,
  firstRound,
  id,
}: {
  homeId: string;
  awayId: string;
  start: string;
  time: string;
  everyDays: number;
  count: number;
  location: string;
  timeZone: string;
  firstRound: number;
  id: (index: number) => string;
}): Fixture[] {
  return Array.from({ length: count }, (_, i) => ({
    id: id(i),
    phase: "custom",
    round: firstRound + i,
    stage: "REGULAR_SEASON",
    group: null,
    tie: null,
    leg: null,
    homeId,
    awayId,
    homeSlot: null,
    awaySlot: null,
    startAt: zonedInstant(addDays(start, i * everyDays), timeToMinutes(time), timeZone),
    location,
  }));
}

// ---------- Validation (the same limits as the Firestore rules) ----------

export function validateSetup(setup: CompetitionSetup, names: string[]): string | null {
  const name = setup.name.trim();
  if (name.length < 3 || name.length > 60) return "El nombre debe tener entre 3 y 60 caracteres.";
  if (setup.sport.trim().length > 40) return "El deporte admite hasta 40 caracteres.";
  const clean = names.map((n) => n.trim());
  if (clean.length < MIN_PARTICIPANTS) return "Añade al menos 2 participantes.";
  if (clean.length > MAX_PARTICIPANTS) return `Como máximo ${MAX_PARTICIPANTS} participantes.`;
  if (clean.some((n) => !n || n.length > 40))
    return "Cada participante necesita un nombre de hasta 40 caracteres.";
  const seen = new Set(clean.map((n) => n.toLocaleLowerCase("es")));
  if (seen.size !== clean.length) return "Hay participantes con el mismo nombre.";
  const reason = formatAvailability(clean.length)[setup.format];
  if (reason) return reason;
  if (setup.format === "league_knockout" && !leagueQualifierOptions(clean.length).includes(setup.qualifiers))
    return "Elige cuántos pasan a la fase final.";
  if (
    setup.format === "groups_knockout" &&
    !groupPlans(clean.length).some((p) => p.groups === setup.groups && p.qualifiers === setup.qualifiers)
  )
    return "Elige cuántos grupos y clasificados.";
  const { start, time, everyDays, slotMinutes, location } = setup.schedule;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start)))
    return "Elige la fecha de la primera jornada.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return "Elige la hora de los partidos.";
  if (!Number.isInteger(everyDays) || everyDays < 1 || everyDays > 28)
    return "Las jornadas se repiten cada 1 a 28 días.";
  if (!Number.isInteger(slotMinutes) || slotMinutes < 0 || slotMinutes > 240)
    return "Entre partidos caben de 0 a 240 minutos.";
  if (location.trim().length > 120) return "El lugar admite hasta 120 caracteres.";
  const plan = fixturePlan(setup, clean.length);
  if (plan.matches > MAX_MATCHES)
    return `Serían ${plan.matches} partidos; el máximo es ${MAX_MATCHES}. Prueba a solo ida o con grupos.`;
  return null;
}

// ---------- Results: tables, ties, bracket ----------

const played = (m: CustomMatch) =>
  m.status === "finished" && Number.isInteger(m.homeScore) && Number.isInteger(m.awayScore);
const settled = (m: CustomMatch) => m.status === "cancelled" || played(m);

/** Standard table: 3 points a win, 1 a draw; points, goal difference, goals. */
export function standings(
  ids: string[],
  matches: { homeId: string | null; awayId: string | null; match: CustomMatch }[],
  byId: Map<string, Participant>,
): LeagueRow[] {
  const rows = new Map<string, LeagueRow>(
    ids.map((id) => [
      id,
      {
        key: id,
        name: byId.get(id)?.name || "Participante",
        crest: byId.get(id)?.icon || undefined,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
        form: [],
      },
    ]),
  );
  for (const { homeId, awayId, match } of [...matches].sort((a, b) => a.match.startAt - b.match.startAt)) {
    if (!played(match) || !homeId || !awayId) continue;
    for (const [id, scored, conceded] of [
      [homeId, match.homeScore!, match.awayScore!],
      [awayId, match.awayScore!, match.homeScore!],
    ] as const) {
      const row = rows.get(id);
      if (!row) continue;
      const result: FormResult = scored > conceded ? "win" : scored < conceded ? "loss" : "draw";
      row.played++;
      row[result === "win" ? "wins" : result === "draw" ? "draws" : "losses"]++;
      row.points += result === "win" ? 3 : result === "draw" ? 1 : 0;
      row.goalsFor += scored;
      row.goalsAgainst += conceded;
      row.form = [...row.form, result].slice(-5);
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

export interface ResolvedSide {
  id: string | null;
  name: string;
  icon: string | null;
  /** Not known yet: «1.º de la liga», «Ganador semifinal 1». */
  pending: boolean;
}
export interface ResolvedMatch extends CustomMatch {
  home: ResolvedSide;
  away: ResolvedSide;
}
export interface TieResult {
  winner: string | null;
  loser: string | null;
  /** Goals over both legs, from the first leg's home side point of view. */
  aggregate: [number, number] | null;
}
export interface CompetitionView {
  matches: ResolvedMatch[];
  tables: { id: string; title: string; rows: LeagueRow[]; complete: boolean }[];
  ties: Record<string, TieResult>;
  champion: ResolvedSide | null;
}

const TIE_NAMES: Record<string, string> = {
  D: "dieciseisavos",
  O: "octavos",
  Q: "cuartos",
  S: "semifinal",
};
export function tieName(tie: string) {
  if (tie === "F") return "la final";
  if (tie === "TP") return "el tercer puesto";
  return `${TIE_NAMES[tie[0]] || "eliminatoria"} ${tie.slice(1)}`;
}
export function slotLabel(slot: string) {
  const [kind, a, b] = slot.split(":");
  if (kind === "league") return `${a}.º de la liga`;
  if (kind === "group") return `${b}.º del grupo ${a}`;
  if (kind === "winner") return `Ganador de ${tieName(a)}`;
  if (kind === "loser") return `Perdedor de ${tieName(a)}`;
  return "Por determinar";
}

const STAGE_ORDER: Stage[] = [
  "LAST_32",
  "LAST_16",
  "QUARTER_FINALS",
  "SEMI_FINALS",
  "THIRD_PLACE",
  "FINAL",
];

/** Who goes through: score, then the aggregate over two legs, then penalties. */
export function decideTie(legs: ResolvedMatch[]): TieResult {
  const none: TieResult = { winner: null, loser: null, aggregate: null };
  if (!legs.length || legs.some((m) => !played(m))) return none;
  const ordered = [...legs].sort((a, b) => (a.leg || 1) - (b.leg || 1));
  const a = ordered[0].home.id;
  const b = ordered[0].away.id;
  if (!a || !b || ordered.some((m) => ![a, b].includes(m.home.id!) || ![a, b].includes(m.away.id!)))
    return none;
  let goalsA = 0;
  let goalsB = 0;
  for (const m of ordered) {
    goalsA += m.home.id === a ? m.homeScore! : m.awayScore!;
    goalsB += m.home.id === b ? m.homeScore! : m.awayScore!;
  }
  const last = ordered[ordered.length - 1];
  let winner: string | null = goalsA > goalsB ? a : goalsB > goalsA ? b : null;
  if (!winner && last.homePenalties !== null && last.awayPenalties !== null && last.homePenalties !== last.awayPenalties)
    winner = last.homePenalties > last.awayPenalties ? last.home.id : last.away.id;
  return {
    winner,
    loser: winner ? (winner === a ? b : a) : null,
    aggregate: [goalsA, goalsB],
  };
}

/** Tables, sides of every match (placeholders resolved when decided), ties and champion. */
export function resolveCompetition(
  setup: Pick<CompetitionSetup, "format">,
  participants: Participant[],
  matches: CustomMatch[],
): CompetitionView {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const side = (id: string | null, slot: string | null): ResolvedSide => {
    if (id) {
      const p = byId.get(id);
      return { id, name: p?.name || "Participante eliminado", icon: p?.icon || null, pending: false };
    }
    return { id: null, name: slot ? slotLabel(slot) : "Por determinar", icon: null, pending: true };
  };
  const plain = (m: CustomMatch): ResolvedMatch => ({
    ...m,
    home: side(m.homeId, m.homeSlot),
    away: side(m.awayId, m.awaySlot),
  });

  const tables: CompetitionView["tables"] = [];
  const positions = new Map<string, string[] | null>();
  // Custom tournaments rank their own matches the same way.
  const league = matches.filter((m) => m.phase === (setup.format === "custom" ? "custom" : "league"));
  if (league.length || ["league", "league_knockout", "custom"].includes(setup.format)) {
    const rows = standings(
      participants.map((p) => p.id),
      league.map((m) => ({ homeId: m.homeId, awayId: m.awayId, match: m })),
      byId,
    );
    const complete = league.length > 0 && league.every(settled);
    tables.push({ id: "league", title: "Clasificación", rows, complete });
    positions.set("league", complete ? rows.map((r) => r.key) : null);
  }
  const groupLetters = [...new Set(matches.filter((m) => m.phase === "group").map((m) => m.group!))].sort();
  for (const letter of groupLetters) {
    const own = matches.filter((m) => m.phase === "group" && m.group === letter);
    const ids = [...new Set(own.flatMap((m) => [m.homeId, m.awayId]).filter(Boolean) as string[])];
    const rows = standings(ids, own.map((m) => ({ homeId: m.homeId, awayId: m.awayId, match: m })), byId);
    const complete = own.every(settled);
    tables.push({ id: `group:${letter}`, title: `Grupo ${letter}`, rows, complete });
    positions.set(`group:${letter}`, complete ? rows.map((r) => r.key) : null);
  }

  const ties: Record<string, TieResult> = {};
  const fromSlot = (slot: string | null): string | null => {
    if (!slot) return null;
    const [kind, a, b] = slot.split(":");
    if (kind === "league") return positions.get("league")?.[Number(a) - 1] ?? null;
    if (kind === "group") return positions.get(`group:${a}`)?.[Number(b) - 1] ?? null;
    if (kind === "winner") return ties[a]?.winner ?? null;
    if (kind === "loser") return ties[a]?.loser ?? null;
    return null;
  };
  const resolved = new Map<string, ResolvedMatch>();
  for (const m of matches) if (m.phase !== "knockout") resolved.set(m.id, plain(m));
  const knockout = matches
    .filter((m) => m.phase === "knockout")
    .sort(
      (a, b) =>
        STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) ||
        (a.tie || "").localeCompare(b.tie || "", "es", { numeric: true }) ||
        (a.leg || 1) - (b.leg || 1),
    );
  for (const stage of STAGE_ORDER) {
    const own = knockout.filter((m) => m.stage === stage);
    for (const m of own) {
      const homeId = m.homeId || fromSlot(m.homeSlot);
      const awayId = m.awayId || fromSlot(m.awaySlot);
      resolved.set(m.id, {
        ...m,
        home: homeId ? side(homeId, null) : side(null, m.homeSlot),
        away: awayId ? side(awayId, null) : side(null, m.awaySlot),
      });
    }
    for (const tie of new Set(own.map((m) => m.tie).filter(Boolean) as string[]))
      ties[tie] = decideTie(own.filter((m) => m.tie === tie).map((m) => resolved.get(m.id)!));
  }

  let champion: ResolvedSide | null = null;
  if (ties.F?.winner) champion = side(ties.F.winner, null);
  else if (setup.format === "league") {
    const table = tables.find((t) => t.id === "league");
    if (table?.complete && table.rows[0]) champion = side(table.rows[0].key, null);
  }
  return {
    matches: matches.map((m) => resolved.get(m.id)!).sort((a, b) => a.startAt - b.startAt),
    tables,
    ties,
    champion,
  };
}

// ---------- The app's match shape, so the existing rows and pages show them ----------

const STATUS_TO_MATCH: Record<MatchStatus, string> = {
  scheduled: "TIMED",
  live: "IN_PLAY",
  finished: "FINISHED",
  postponed: "POSTPONED",
  cancelled: "CANCELLED",
};

/** Rounds of the selector: «J3» for league/group days, the stage for knockout. */
export function roundKey(m: Pick<CustomMatch, "phase" | "stage" | "round">) {
  return m.phase === "knockout" ? m.stage : `${m.phase === "group" ? "G" : "J"}${m.round}`;
}

/**
 * A resolved match in the shape the app's rows, round selector and tables
 * expect. `competition` is never shown for these; it only satisfies the type.
 */
export function toAppMatch(competitionId: string, m: ResolvedMatch): Match {
  const penalties =
    m.homePenalties !== null && m.awayPenalties !== null && m.homePenalties !== m.awayPenalties;
  return {
    id: m.id,
    competition: "PD" as CompetitionCode,
    seasonId: competitionId,
    roundId: `${competitionId}:${roundKey(m)}`,
    matchday: m.phase === "knockout" ? 0 : m.round,
    stage: m.stage,
    utcDate: new Date(m.startAt).toISOString(),
    status: STATUS_TO_MATCH[m.status],
    home: m.home.name,
    away: m.away.name,
    homeCrest: m.home.icon || undefined,
    awayCrest: m.away.icon || undefined,
    homeScore: m.status === "finished" || m.status === "live" ? m.homeScore : null,
    awayScore: m.status === "finished" || m.status === "live" ? m.awayScore : null,
    ...(penalties
      ? {
          scoreDuration: "PENALTY_SHOOTOUT",
          winner: m.homePenalties! > m.awayPenalties! ? ("1" as const) : ("2" as const),
        }
      : {}),
  };
}
