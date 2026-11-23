import {
  MAX_EVENTS,
  MAX_LINEUP,
  MAX_SQUAD,
  POSITIONS,
  type CompetitionView,
  type CustomMatch,
  type EventKind,
  type LineupPlayer,
  type MatchEvent,
  type MatchLineups,
  type PlayerPosition,
  type SquadPlayer,
} from "./customCompetition";
import type { StatRow } from "./leagueStats";
import type { MatchGoal, MatchIncident, MatchLineup } from "./matchInsightsData";

/**
 * The match report of a friends' competition: squads, lineups and events
 * (goals, cards, changes) entered by its organisers, in the same shapes the
 * official match page draws (timeline, pitch, scorers and rankings).
 */

export type Side = "home" | "away";
export const EVENT_LABELS: Record<EventKind, string> = {
  goal: "Gol",
  penalty: "Gol de penalti",
  "own-goal": "Gol en propia puerta",
  "yellow-card": "Tarjeta amarilla",
  "second-yellow": "Segunda amarilla",
  "red-card": "Tarjeta roja",
  substitution: "Cambio",
};
const KINDS = Object.keys(EVENT_LABELS) as EventKind[];
export const MAX_MINUTE = 150;
export const MAX_EXTRA = 30;

export const newReportId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
export const isGoal = (e: Pick<MatchEvent, "kind">) =>
  e.kind === "goal" || e.kind === "penalty" || e.kind === "own-goal";
export const other = (side: Side): Side => (side === "home" ? "away" : "home");

// ---------- Reading what is stored (never trust its shape) ----------

const id = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);
const text = (v: unknown) => (typeof v === "string" && v.trim() && v.length <= 40 ? v.trim() : null);
const int = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
const position = (v: unknown) => (POSITIONS.includes(v as PlayerPosition) ? (v as PlayerPosition) : null);
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function decodePlayer(value: unknown): SquadPlayer | null {
  const p = record(value);
  const pid = id(p.id);
  const name = text(p.name);
  return pid && name ? { id: pid, name, number: int(p.number, 0, 99), position: position(p.position) } : null;
}
export function decodeSquad(value: unknown): SquadPlayer[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, MAX_SQUAD).flatMap((v) => {
    const p = decodePlayer(v);
    if (!p || seen.has(p.id)) return [];
    seen.add(p.id);
    return [p];
  });
}
export function decodeEvents(value: unknown): MatchEvent[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_EVENTS).flatMap((v): MatchEvent[] => {
    const e = record(v);
    const eid = id(e.id);
    const kind = KINDS.includes(e.kind as EventKind) ? (e.kind as EventKind) : null;
    const minute = int(e.minute, 0, MAX_MINUTE);
    if (!eid || !kind || (e.side !== "home" && e.side !== "away") || minute === null) return [];
    // A goal may have no scorer yet; everything else names a player.
    const player = text(e.player) ?? (isGoal({ kind }) ? "" : null);
    if (player === null) return [];
    return [
      {
        id: eid,
        kind,
        side: e.side,
        minute,
        extra: int(e.extra, 1, MAX_EXTRA),
        player,
        playerId: id(e.playerId),
        other: text(e.other),
        otherId: id(e.otherId),
      },
    ];
  });
}
export function decodeLineups(value: unknown): MatchLineups | null {
  const l = record(value);
  const side = (v: unknown): LineupPlayer[] =>
    Array.isArray(v)
      ? v.slice(0, MAX_LINEUP).flatMap((raw) => {
          const p = decodePlayer(raw);
          return p ? [{ ...p, starter: record(raw).starter === true }] : [];
        })
      : [];
  const home = side(l.home);
  const away = side(l.away);
  return home.length || away.length ? { home, away } : null;
}

// ---------- What the page draws ----------

export const minuteLabel = (e: Pick<MatchEvent, "minute" | "extra">) =>
  e.extra ? `${e.minute}+${e.extra}'` : `${e.minute}'`;

/** Goals and incidents in the timeline's shape, each with its event id. */
export function reportTimeline(events: MatchEvent[]) {
  const goals: (MatchGoal & { id: string })[] = [];
  const incidents: (MatchIncident & { id: string })[] = [];
  for (const e of events) {
    if (isGoal(e))
      goals.push({
        id: e.id,
        minute: minuteLabel(e),
        scorer: e.player || "Sin asignar",
        side: e.side,
        kind: e.kind as MatchGoal["kind"],
        ...(e.other ? { assist: e.other } : {}),
      });
    else
      incidents.push({
        id: e.id,
        minute: minuteLabel(e),
        side: e.side,
        kind: e.kind as MatchIncident["kind"],
        player: e.player,
        ...(e.kind === "substitution" && e.other ? { playerOut: e.other } : {}),
      });
  }
  return { goals, incidents };
}

/** Lineups in the pitch's shape (only the sides that have one). */
export function reportLineups(lineups: MatchLineups | null | undefined): MatchLineup[] {
  if (!lineups) return [];
  return (["home", "away"] as const)
    .map((side) => ({
      side,
      players: lineups[side].map((p) => ({
        name: p.name,
        ...(p.number !== null ? { number: String(p.number) } : {}),
        ...(p.position ? { position: p.position } : {}),
        starter: p.starter,
      })),
    }))
    .filter((l) => l.players.length > 0);
}

// ---------- Keeping the score in step ----------

const goalsOf = (events: MatchEvent[], side: Side) => events.filter((e) => isGoal(e) && e.side === side).length;

/**
 * The match after its report changes. A new goal raises its side's score
 * unless the score already counted it (scorers added to a result entered by
 * hand); removing one lowers it only when the score was exactly the goals on
 * record. Reporting anything on a match that hadn't started puts it in play.
 */
export function applyEvents(
  match: Pick<CustomMatch, "status" | "homeScore" | "awayScore" | "events">,
  events: MatchEvent[],
): Pick<CustomMatch, "status" | "homeScore" | "awayScore"> & { events: MatchEvent[] } {
  const before = match.events || [];
  const started = match.status === "live" || match.status === "finished";
  if (!started && !events.length)
    return { events, status: match.status, homeScore: match.homeScore, awayScore: match.awayScore };
  const score = (side: Side, current: number | null) => {
    const was = goalsOf(before, side);
    const now = goalsOf(events, side);
    const base = current ?? 0;
    if (now > was) return Math.max(base, now);
    if (now < was) return base === was ? now : base;
    return base;
  };
  return {
    events,
    status: started ? match.status : "live",
    homeScore: score("home", match.homeScore),
    awayScore: score("away", match.awayScore),
  };
}

/** A sensible minute for a new event: the clock while in play, else the last one. */
export function suggestedMinute(
  match: Pick<CustomMatch, "status" | "startAt" | "events">,
  now = Date.now(),
): number | null {
  if (match.status === "live" && now > match.startAt)
    return Math.min(MAX_MINUTE, Math.max(1, Math.floor((now - match.startAt) / 60_000) + 1));
  const last = (match.events || []).reduce<number | null>((m, e) => Math.max(m ?? 0, e.minute), null);
  return last;
}

// ---------- Squads ----------

const POSITION_WORDS: [RegExp, PlayerPosition][] = [
  [/^(por|portero|portera|gk|arquero)$/i, "POR"],
  [/^(def|defensa|defensor|lateral|central)$/i, "DEF"],
  [/^(med|medio|centrocampista|mediocentro|mc|mid)$/i, "MED"],
  [/^(del|delantero|delantera|extremo|punta|fw)$/i, "DEL"],
];

/**
 * A pasted list, one player per line: «10 Pedro Pérez DEL», «1. Juan (POR)»,
 * «Ana - 7». Number and position are optional and may go before or after.
 */
export function parseSquadList(input: string): Omit<SquadPlayer, "id">[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.replace(/[()·,;|]/g, " ").trim())
    .filter(Boolean)
    .flatMap((line) => {
      let words = line.split(/\s+/);
      let number: number | null = null;
      let pos: PlayerPosition | null = null;
      const takeNumber = (w: string | undefined) => {
        const m = w && /^#?(\d{1,2})[.º-]?$/.exec(w);
        return m ? Number(m[1]) : null;
      };
      const takePosition = (w: string | undefined) =>
        w ? POSITION_WORDS.find(([pattern]) => pattern.test(w))?.[1] ?? null : null;
      for (let pass = 0; pass < 2; pass++) {
        if (number === null && (number = takeNumber(words[0])) !== null) words = words.slice(1);
        if (number === null && (number = takeNumber(words.at(-1))) !== null) words = words.slice(0, -1);
        if (pos === null && (pos = takePosition(words.at(-1))) !== null) words = words.slice(0, -1);
        if (pos === null && (pos = takePosition(words[0])) !== null) words = words.slice(1);
      }
      const name = words.join(" ").replace(/^[-–]\s*|\s*[-–]$/g, "").trim().slice(0, 40);
      return name ? [{ name, number, position: pos }] : [];
    });
}

export const sortSquad = <T extends Pick<SquadPlayer, "number" | "name" | "position">>(players: T[]) =>
  [...players].sort(
    (a, b) =>
      POSITIONS.indexOf(a.position ?? ("ZZZ" as PlayerPosition)) -
        POSITIONS.indexOf(b.position ?? ("ZZZ" as PlayerPosition)) ||
      (a.number ?? 100) - (b.number ?? 100) ||
      a.name.localeCompare(b.name, "es"),
  );

// ---------- Competition rankings ----------

export interface ReportRankings {
  scorers: StatRow[];
  assists: StatRow[];
  yellow: StatRow[];
  red: StatRow[];
}

/** Scorers, assists and cards over every match report of the competition. */
export function reportRankings(view: Pick<CompetitionView, "matches">): ReportRankings {
  const boards = { scorers: new Map(), assists: new Map(), yellow: new Map(), red: new Map() } as Record<
    keyof ReportRankings,
    Map<string, StatRow>
  >;
  const add = (board: keyof ReportRankings, team: { id: string | null; name: string; icon: string | null }, pid: string | null, name: string) => {
    if (!name) return;
    const key = `${team.id || team.name}:${pid || name.toLocaleLowerCase("es")}`;
    const row = boards[board].get(key) || {
      key,
      name,
      team: team.name,
      ...(team.icon ? { crest: team.icon } : {}),
      value: 0,
    };
    row.value += 1;
    boards[board].set(key, row);
  };
  for (const m of view.matches) {
    for (const e of m.events || []) {
      const team = e.side === "home" ? m.home : m.away;
      if (e.kind === "goal" || e.kind === "penalty") {
        add("scorers", team, e.playerId, e.player);
        if (e.other) add("assists", team, e.otherId, e.other);
      } else if (e.kind === "yellow-card") add("yellow", team, e.playerId, e.player);
      else if (e.kind === "red-card" || e.kind === "second-yellow") add("red", team, e.playerId, e.player);
    }
  }
  const rows = (board: keyof ReportRankings) => [...boards[board].values()];
  return { scorers: rows("scorers"), assists: rows("assists"), yellow: rows("yellow"), red: rows("red") };
}
