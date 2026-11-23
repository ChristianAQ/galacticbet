import { isCompetition, type CompetitionCode } from "./competitions";

/** One line of a ranking board: who, a subtitle and the number. */
export interface StatRow {
  key: string;
  name: string;
  team: string;
  crest?: string;
  value: number;
}

/** A top scorer, as published by the official provider (Football-Data). */
export interface Scorer {
  key: string;
  name: string;
  /** Club as it reads in the app (short name). */
  team: string;
  crest?: string;
  goals: number;
  /** Not every season publishes them: null is «unknown», never zero. */
  assists: number | null;
  penalties: number | null;
  played: number | null;
  /** For the player's card («cromo»); older editions don't have them. */
  playerId?: number;
  position?: string | null;
  nationality?: string | null;
  birthDate?: string | null;
  shirtNumber?: number | null;
}

/**
 * `leagueStats/{seasonId}`: the season's top scorers from the same provider
 * as the official results. Version 1 (SportAPI rankings) is no longer read.
 */
export interface LeagueStats {
  version: 2;
  provider: "Football-Data";
  competition: CompetitionCode;
  seasonId: string;
  fetchedAt: string;
  scorers: Scorer[];
}
export const MAX_SCORERS = 20;

const text = (value: unknown, max = 180): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1000;
const optionalCount = (value: unknown) => value === null || count(value);
const optionalText = (value: unknown) => value === undefined || value === null || text(value, 60);
const crest = (value: unknown) =>
  value === undefined || (typeof value === "string" && value.length <= 1000 && /^https:\/\//.test(value));

export function validScorer(value: unknown): value is Scorer {
  if (!value || typeof value !== "object") return false;
  const s = value as Scorer;
  return (
    text(s.key, 40) &&
    text(s.name, 120) &&
    text(s.team, 160) &&
    crest(s.crest) &&
    count(s.goals) &&
    optionalCount(s.assists) &&
    optionalCount(s.penalties) &&
    optionalCount(s.played) &&
    (s.playerId === undefined || (Number.isSafeInteger(s.playerId) && s.playerId > 0)) &&
    optionalText(s.position) &&
    optionalText(s.nationality) &&
    (s.birthDate === undefined || s.birthDate === null || /^\d{4}-\d{2}-\d{2}$/.test(s.birthDate)) &&
    (s.shirtNumber === undefined || s.shirtNumber === null || (count(s.shirtNumber) && s.shirtNumber <= 99))
  );
}

export function validLeagueStats(value: unknown): value is LeagueStats {
  if (!value || typeof value !== "object") return false;
  const v = value as LeagueStats;
  return (
    v.version === 2 &&
    v.provider === "Football-Data" &&
    isCompetition(v.competition) &&
    new RegExp(`^${v.competition}-\\d{4}$`).test(v.seasonId) &&
    typeof v.fetchedAt === "string" &&
    Number.isFinite(Date.parse(v.fetchedAt)) &&
    Array.isArray(v.scorers) &&
    v.scorers.length <= MAX_SCORERS &&
    v.scorers.every(validScorer) &&
    new Set(v.scorers.map((s) => s.key)).size === v.scorers.length
  );
}

/** Most goals first; then assists, fewer matches and the name. */
export function sortScorers(list: Scorer[]) {
  return [...list].sort(
    (a, b) =>
      b.goals - a.goals ||
      (b.assists ?? 0) - (a.assists ?? 0) ||
      (a.played ?? Infinity) - (b.played ?? Infinity) ||
      a.name.localeCompare(b.name, "es"),
  );
}

export function topFive(rows: StatRow[], ascending = false) {
  return [...rows]
    .sort(
      (a, b) =>
        (ascending ? a.value - b.value : b.value - a.value) ||
        a.name.localeCompare(b.name, "es") ||
        a.key.localeCompare(b.key),
    )
    .slice(0, 5);
}
