import { decodeRun, sourceHosts, type AnalysisRun } from "./bettingAnalysis";
import { isCompetition, type CompetitionCode } from "./competitions";
import type { Match } from "./domain";

/**
 * «La IA te cuenta», on Inicio: the AI picks the key matches of the next
 * days and says why they matter. The matches are ours (the calendar): the
 * AI only chooses them and writes the words. One public document, written
 * by the backend.
 */
export const BRIEFING_DOC = "briefing/football";
export const BRIEFING_FORMAT = 1;
export const MAX_KEY_MATCHES = 4;
/** Older than this, it would talk about days already gone: not shown. */
export const BRIEFING_MAX_AGE = 36 * 3_600_000;
/** A key match leaves the front page this long after kick-off. */
export const KEY_MATCH_SHOWN_AFTER_KICKOFF = 2 * 3_600_000;

/** The app's limits for the AI's words. */
export const BRIEFING_LIMITS = {
  headline: 140,
  summary: 700,
  angle: 48,
  preview: 320,
  watch: 200,
} as const;

export interface KeyMatch {
  matchId: string;
  competition: CompetitionCode;
  home: string;
  away: string;
  homeCrest?: string;
  awayCrest?: string;
  utcDate: string;
  /** What is at stake, in a few words: «Duelo por el liderato». */
  angle: string;
  preview: string;
  /** What to watch, in one sentence. */
  watch: string;
}
export interface Briefing {
  formatVersion: typeof BRIEFING_FORMAT;
  generatedAt: string;
  headline: string;
  summary: string;
  keyMatches: KeyMatch[];
  /** Sites the AI read, host names only. */
  sources?: string[];
  /** How the AI ran: model, web searches, seconds. */
  ai?: AnalysisRun;
}

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const date = (v: unknown): v is string => text(v, 40) && Number.isFinite(Date.parse(v));
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const CREST = (v: unknown) => v === undefined || (text(v, 500) && /^https:\/\//.test(v));
const unique = <T>(list: T[], key: (item: T) => string) => [...new Map(list.map((item) => [key(item), item])).values()];

function decodeKeyMatch(raw: unknown): KeyMatch | null {
  if (!isRow(raw)) return null;
  const { matchId, competition, home, away, homeCrest, awayCrest, utcDate, angle, preview, watch } = raw;
  if (typeof matchId !== "string" || !ID.test(matchId) || !isCompetition(competition)) return null;
  if (!text(home, 100) || !text(away, 100) || !date(utcDate) || !CREST(homeCrest) || !CREST(awayCrest)) return null;
  const { angle: a, preview: p, watch: w } = BRIEFING_LIMITS;
  if (!text(angle, a) || !text(preview, p) || !text(watch, w)) return null;
  return {
    matchId,
    competition,
    home,
    away,
    ...(homeCrest ? { homeCrest: homeCrest as string } : {}),
    ...(awayCrest ? { awayCrest: awayCrest as string } : {}),
    utcDate,
    angle,
    preview,
    watch,
  };
}

/** The public document, checked: anything malformed is left out (or null). */
export function decodeBriefing(raw: unknown): Briefing | null {
  if (!isRow(raw) || raw.formatVersion !== BRIEFING_FORMAT) return null;
  const { generatedAt, headline, summary } = raw;
  if (!date(generatedAt) || !text(headline, BRIEFING_LIMITS.headline) || !text(summary, BRIEFING_LIMITS.summary))
    return null;
  // Each match once: it is the list's key.
  const keyMatches = unique(
    (Array.isArray(raw.keyMatches) ? raw.keyMatches : []).slice(0, MAX_KEY_MATCHES).flatMap((m) => decodeKeyMatch(m) ?? []),
    (m) => m.matchId,
  );
  if (!keyMatches.length) return null;
  const sources = sourceHosts(raw.sources);
  const ai = decodeRun(raw.ai);
  return {
    formatVersion: BRIEFING_FORMAT,
    generatedAt,
    headline,
    summary,
    keyMatches,
    ...(sources.length ? { sources } : {}),
    ...(ai ? { ai } : {}),
  };
}

export interface ShownKeyMatch extends KeyMatch {
  /** The calendar's current state, when the app has the match. */
  status?: string;
  homeScore?: number | null;
  awayScore?: number | null;
}

/**
 * What the front page shows now: nothing when it is too old; key matches
 * with the calendar's latest time and state, until a while after kick-off
 * (never postponed or cancelled ones). Nothing once they are all past.
 */
export function shownBriefing(briefing: Briefing | null, matches: Match[], now: number) {
  if (!briefing) return null;
  const age = now - Date.parse(briefing.generatedAt);
  if (age > BRIEFING_MAX_AGE || age < -3_600_000) return null;
  const byId = new Map(matches.map((m) => [m.id, m]));
  const keyMatches = briefing.keyMatches.flatMap((k): ShownKeyMatch[] => {
    const current = byId.get(k.matchId);
    const utcDate = current?.utcDate ?? k.utcDate;
    if (current && ["POSTPONED", "CANCELLED", "SUSPENDED", "AWARDED"].includes(current.status)) return [];
    if (now - Date.parse(utcDate) > KEY_MATCH_SHOWN_AFTER_KICKOFF) return [];
    return [
      current
        ? { ...k, utcDate, status: current.status, homeScore: current.homeScore, awayScore: current.awayScore }
        : k,
    ];
  });
  return keyMatches.length ? { ...briefing, keyMatches } : null;
}
