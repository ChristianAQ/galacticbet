import { decodeRun, sourceHosts, type AnalysisRun } from "./bettingAnalysis";
import { isCompetition, type CompetitionCode } from "./competitions";
import type { Match } from "./domain";
import { NEWS_MAX_AGE, newsImageUrl, newsUrl, type NewsImage } from "./footballNews";

/**
 * «La IA te cuenta», on Inicio: the AI picks the key matches of the next
 * days and the stories most worth reading, and says why. Matches and
 * stories are ours (the calendar and ESPN's headlines): the AI only chooses
 * them and writes the words. One public document, written by the backend.
 */
export const BRIEFING_DOC = "briefing/football";
export const BRIEFING_FORMAT = 1;
export const MAX_KEY_MATCHES = 4;
export const MAX_STORIES = 5;
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
  why: 220,
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
export interface BriefingStory {
  title: string;
  url: string;
  publishedAt: string;
  competition: CompetitionCode;
  image?: NewsImage;
  /** Why it is worth reading (the AI's words). */
  why: string;
}
export interface Briefing {
  formatVersion: typeof BRIEFING_FORMAT;
  generatedAt: string;
  headline: string;
  summary: string;
  keyMatches: KeyMatch[];
  stories: BriefingStory[];
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

function decodeStory(raw: unknown): BriefingStory | null {
  if (!isRow(raw)) return null;
  const { title, url, publishedAt, competition, image, why } = raw;
  const link = newsUrl(url);
  if (!text(title, 240) || !link || link !== url || !date(publishedAt) || !isCompetition(competition)) return null;
  if (!text(why, BRIEFING_LIMITS.why)) return null;
  const photo =
    isRow(image) && newsImageUrl(image.url) === image.url && (image.alt === undefined || text(image.alt, 300))
      ? { url: image.url as string, ...(image.alt ? { alt: image.alt as string } : {}) }
      : undefined;
  return { title, url: link, publishedAt, competition, ...(photo ? { image: photo } : {}), why };
}

/** The public document, checked: anything malformed is left out (or null). */
export function decodeBriefing(raw: unknown): Briefing | null {
  if (!isRow(raw) || raw.formatVersion !== BRIEFING_FORMAT) return null;
  const { generatedAt, headline, summary } = raw;
  if (!date(generatedAt) || !text(headline, BRIEFING_LIMITS.headline) || !text(summary, BRIEFING_LIMITS.summary))
    return null;
  // Each match and story once: they are the lists' keys.
  const keyMatches = unique(
    (Array.isArray(raw.keyMatches) ? raw.keyMatches : []).slice(0, MAX_KEY_MATCHES).flatMap((m) => decodeKeyMatch(m) ?? []),
    (m) => m.matchId,
  );
  const stories = unique(
    (Array.isArray(raw.stories) ? raw.stories : []).slice(0, MAX_STORIES).flatMap((s) => decodeStory(s) ?? []),
    (s) => s.url,
  );
  if (!keyMatches.length && !stories.length) return null;
  const sources = sourceHosts(raw.sources);
  const ai = decodeRun(raw.ai);
  return {
    formatVersion: BRIEFING_FORMAT,
    generatedAt,
    headline,
    summary,
    keyMatches,
    stories,
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
 * (never postponed or cancelled ones); stories still current.
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
  const stories = briefing.stories.filter((s) => {
    const at = Date.parse(s.publishedAt);
    return at <= now + 3_600_000 && now - at <= NEWS_MAX_AGE;
  });
  return keyMatches.length || stories.length ? { ...briefing, keyMatches, stories } : null;
}
