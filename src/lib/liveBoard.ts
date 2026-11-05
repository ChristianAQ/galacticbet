import {
  hasPublishedResult,
  outcome,
  type Match,
  type Outcome,
} from "./domain";
import type { MatchInsight } from "./matchInsightsData";
import { chronologicalGoals } from "./matchPresentation";

export const LIVE_FORMAT = 1;
/** Clients listen a little before kick-off and stop once results are published. */
export const LIVE_WATCH_BEFORE = 20 * 60_000;
export const LIVE_WINDOW_AFTER = 4 * 3_600_000;
/** Regular time plus half-time, stoppages and a delayed provider status. */
export const HOT_MATCH_MS = 170 * 60_000;
const MAX_EVENTS = 40;
const MAX_MATCHES = 80;

export type LiveEventKind =
  | "goal"
  | "penalty"
  | "own-goal"
  | "yellow-card"
  | "second-yellow"
  | "red-card";
export interface LiveEvent {
  minute: string;
  side: "home" | "away";
  kind: LiveEventKind;
  player: string;
}
// Mirrors the published calendar state; the minute is only a display anchor.
export interface LiveMatch {
  id: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  winner?: Outcome | null;
  provider?: "SportAPI";
  minute?: string;
  minuteAt?: number;
  events: LiveEvent[];
}
export interface LiveBoard {
  formatVersion: typeof LIVE_FORMAT;
  updatedAt: number;
  scoredAt?: number;
  matches: LiveMatch[];
}

const closed = ["POSTPONED", "CANCELLED", "SUSPENDED", "AWARDED"];
const kinds: LiveEventKind[] = [
  "goal",
  "penalty",
  "own-goal",
  "yellow-card",
  "second-yellow",
  "red-card",
];

/** Started, not yet published and recent enough to deserve minute-by-minute checks. */
export function isHotMatch(match: Match, now: number) {
  const kickoff = Date.parse(match.utcDate);
  return (
    Number.isFinite(kickoff) &&
    kickoff <= now &&
    now - kickoff <= HOT_MATCH_MS &&
    !closed.includes(match.status) &&
    !hasPublishedResult(match)
  );
}

export function inLiveWindow(match: Match, now: number) {
  const kickoff = Date.parse(match.utcDate);
  return (
    Number.isFinite(kickoff) &&
    now >= kickoff - LIVE_WATCH_BEFORE &&
    now <= kickoff + LIVE_WINDOW_AFTER &&
    !["POSTPONED", "CANCELLED"].includes(match.status)
  );
}

/** Whether the browser should keep a real-time listener on the live board. */
export function needsLiveWatch(matches: Match[], now: number) {
  return matches.some(
    (match) =>
      inLiveWindow(match, now) &&
      !closed.includes(match.status) &&
      !hasPublishedResult(match),
  );
}

export function normalizeLiveMinute(value: string) {
  const minute = value.trim().replace(/[’′']+$/, "");
  if (minute === "HT") return minute;
  return /^\d{1,3}(?:\+\d{1,2})?$/.test(minute) ? minute : undefined;
}

export function liveEvents(insight: MatchInsight | null): LiveEvent[] {
  if (!insight) return [];
  const events: LiveEvent[] = [
    ...insight.goals.map((goal) => ({
      minute: goal.minute,
      side: goal.side,
      kind: goal.kind,
      player: goal.scorer,
    })),
    ...(insight.incidents || [])
      .filter((incident) => incident.kind !== "substitution")
      .map((incident) => ({
        minute: incident.minute,
        side: incident.side,
        kind: incident.kind as LiveEventKind,
        player: incident.player,
      })),
  ];
  return chronologicalGoals(events).slice(0, MAX_EVENTS);
}

const text = (value: unknown, max = 160): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const score = (value: unknown) =>
  value === null || (Number.isInteger(value) && Number(value) >= 0);

function decodeEvent(value: unknown): LiveEvent | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  return text(e.minute, 12) &&
    (e.side === "home" || e.side === "away") &&
    kinds.includes(e.kind as LiveEventKind) &&
    text(e.player)
    ? {
        minute: e.minute,
        side: e.side,
        kind: e.kind as LiveEventKind,
        player: e.player,
      }
    : null;
}

function decodeMatch(value: unknown): LiveMatch | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  if (
    !text(m.id, 100) ||
    !text(m.status, 30) ||
    !score(m.homeScore) ||
    !score(m.awayScore) ||
    !(
      m.winner === undefined ||
      m.winner === null ||
      ["1", "X", "2"].includes(m.winner as string)
    ) ||
    !(m.provider === undefined || m.provider === "SportAPI") ||
    !Array.isArray(m.events)
  )
    return null;
  const minute =
    typeof m.minute === "string" ? normalizeLiveMinute(m.minute) : undefined;
  return {
    id: m.id,
    status: m.status,
    homeScore: m.homeScore as number | null,
    awayScore: m.awayScore as number | null,
    ...(m.winner !== undefined ? { winner: m.winner as Outcome | null } : {}),
    ...(m.provider ? { provider: "SportAPI" as const } : {}),
    ...(minute && Number.isSafeInteger(m.minuteAt)
      ? { minute, minuteAt: m.minuteAt as number }
      : {}),
    events: m.events
      .slice(0, MAX_EVENTS)
      .map(decodeEvent)
      .filter((e): e is LiveEvent => e !== null),
  };
}

/** Public, display-only data. Invalid entries are ignored rather than trusted. */
export function decodeLiveBoard(value: unknown): LiveBoard | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    data.formatVersion !== LIVE_FORMAT ||
    !Number.isSafeInteger(data.updatedAt) ||
    !Array.isArray(data.matches)
  )
    return null;
  return {
    formatVersion: LIVE_FORMAT,
    updatedAt: data.updatedAt as number,
    ...(Number.isSafeInteger(data.scoredAt)
      ? { scoredAt: data.scoredAt as number }
      : {}),
    matches: data.matches
      .slice(0, MAX_MATCHES)
      .map(decodeMatch)
      .filter((m): m is LiveMatch => m !== null),
  };
}

/**
 * Brings the faster live state into the cached calendar. It never replaces an official
 * Football-Data result, never reopens a finished fixture and never touches kick-offs.
 */
export function applyLiveBoard(matches: Match[], board: LiveBoard | null) {
  if (!board?.matches.length) return matches;
  const live = new Map(board.matches.map((m) => [m.id, m]));
  let changed = false;
  const next = matches.map((match) => {
    const l = live.get(match.id);
    if (
      !l ||
      !["IN_PLAY", "PAUSED", "FINISHED"].includes(l.status) ||
      closed.includes(match.status) ||
      (hasPublishedResult(match) && match.resultProvider !== "SportAPI") ||
      (match.status === "FINISHED" && l.status !== "FINISHED") ||
      (l.status === match.status &&
        l.homeScore === match.homeScore &&
        l.awayScore === match.awayScore)
    )
      return match;
    changed = true;
    const final =
      l.status === "FINISHED" && l.homeScore !== null && l.awayScore !== null;
    return {
      ...match,
      status: l.status,
      homeScore: l.homeScore,
      awayScore: l.awayScore,
      winner:
        l.winner !== undefined
          ? l.winner
          : final
            ? outcome(l.homeScore!, l.awayScore!)
            : null,
      ...(l.provider ? { resultProvider: l.provider } : {}),
    };
  });
  return changed ? next : matches;
}

/** Extrapolates the provider minute between board updates, capped per half. */
export function liveMinuteLabel(live: LiveMatch | undefined, now: number) {
  if (!live) return "";
  if (live.status === "PAUSED" || live.minute === "HT") return "Descanso";
  if (live.status !== "IN_PLAY") return "";
  const parts = /^(\d{1,3})(?:\+(\d{1,2}))?$/.exec(live.minute || "");
  if (!parts || live.minuteAt === undefined) return "En juego";
  const elapsed = Math.max(0, Math.floor((now - live.minuteAt) / 60_000));
  const base = Number(parts[1]);
  if (parts[2] !== undefined)
    return `${base}+${Math.min(Number(parts[2]) + elapsed, 15)}'`;
  const cap = base <= 45 ? 45 : base <= 90 ? 90 : 120;
  const value = base + elapsed;
  return value > cap ? `${cap}+'` : `${value}'`;
}
