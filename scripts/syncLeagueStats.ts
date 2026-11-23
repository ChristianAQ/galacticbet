import type { Firestore } from "firebase-admin/firestore";
import { COMPETITION_CODES, type CompetitionCode } from "../src/lib/competitions";
import type { Match } from "../src/lib/domain";
import {
  MAX_SCORERS,
  sortScorers,
  validLeagueStats,
  type LeagueStats,
  type Scorer,
} from "../src/lib/leagueStats";
import { hasPublishedResult } from "../src/lib/domain";

/** Six hours between editions; one competition per run keeps the request budget. */
export const STATS_MAX_AGE = 6 * 3600000;

const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1000;
const optional = (v: unknown) => (count(v) ? v : null);

/**
 * Football-Data's top scorers (`/competitions/{code}/scorers`), checked
 * against the season we show: the same provider as the official results.
 */
export function normalizeScorers(value: unknown, competition: CompetitionCode, seasonId: string): Scorer[] {
  const body = value as {
    competition?: { code?: unknown };
    season?: { startDate?: unknown };
    scorers?: unknown;
  } | null;
  const year = seasonId.split("-")[1];
  if (
    !body ||
    (body.competition?.code !== undefined && body.competition.code !== competition) ||
    typeof body.season?.startDate !== "string" ||
    body.season.startDate.slice(0, 4) !== year ||
    !Array.isArray(body.scorers) ||
    body.scorers.length > 100
  )
    throw new Error("Temporada o formato de goleadores no verificable.");
  const seen = new Set<string>();
  const rows: Scorer[] = [];
  for (const raw of body.scorers) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as {
      player?: {
        id?: unknown;
        name?: unknown;
        dateOfBirth?: unknown;
        nationality?: unknown;
        section?: unknown;
        position?: unknown;
        shirtNumber?: unknown;
      };
      team?: { name?: unknown; shortName?: unknown; crest?: unknown };
      goals?: unknown;
      assists?: unknown;
      penalties?: unknown;
      playedMatches?: unknown;
    };
    const id = r.player?.id;
    if (
      !Number.isSafeInteger(id) ||
      (id as number) <= 0 ||
      !text(r.player?.name, 120) ||
      !text(r.team?.name, 160) ||
      !count(r.goals)
    )
      continue;
    const key = `p${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const crest = r.team?.crest;
    rows.push({
      key,
      name: r.player!.name!.trim(),
      team: (text(r.team?.shortName, 160) ? r.team!.shortName : r.team!.name)!.trim(),
      ...(typeof crest === "string" && crest.length <= 1000 && /^https:\/\//.test(crest) ? { crest } : {}),
      goals: r.goals,
      assists: optional(r.assists),
      penalties: optional(r.penalties),
      played: optional(r.playedMatches),
      playerId: id as number,
      // The specific position when published, else the line (Offence…).
      position: text(r.player?.position, 60) ? r.player!.position : text(r.player?.section, 60) ? r.player!.section : null,
      nationality: text(r.player?.nationality, 60) ? r.player!.nationality : null,
      birthDate:
        typeof r.player?.dateOfBirth === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.player.dateOfBirth)
          ? r.player.dateOfBirth.slice(0, 10)
          : null,
      shirtNumber: count(r.player?.shirtNumber) && (r.player!.shirtNumber as number) <= 99 ? (r.player!.shirtNumber as number) : null,
    });
  }
  return sortScorers(rows).slice(0, MAX_SCORERS);
}

export function buildLeagueStats(
  competition: CompetitionCode,
  seasonId: string,
  scorers: Scorer[],
  now: number,
): LeagueStats {
  return {
    version: 2,
    provider: "Football-Data",
    competition,
    seasonId,
    fetchedAt: new Date(now).toISOString(),
    scorers,
  };
}

/**
 * Refreshes the top scorers of the competition whose edition is oldest (one
 * request per run, at most every six hours each). Any failure keeps the
 * previous edition: the official results never wait for this.
 */
export async function syncLeagueStats(
  db: Firestore,
  api: <T>(path: string) => Promise<T>,
  matches: Match[],
  options: { now?: number; log?: (message: string) => void } = {},
) {
  const now = options.now ?? Date.now();
  const log = options.log ?? console.log;
  const year = new Date(now).getUTCFullYear() - (new Date(now).getUTCMonth() < 6 ? 1 : 0);
  let due: { competition: CompetitionCode; seasonId: string; age: number } | null = null;
  for (const competition of COMPETITION_CODES) {
    const seasonId = `${competition}-${year}`;
    // Before the first result there is nobody to rank.
    if (!matches.some((m) => m.competition === competition && m.seasonId === seasonId && hasPublishedResult(m)))
      continue;
    const old = (await db.doc(`leagueStats/${seasonId}`).get()).data();
    // Editions from before the players' details are renewed straight away.
    const fetched =
      validLeagueStats(old) && old.seasonId === seasonId && old.scorers.every((s) => s.playerId !== undefined)
        ? Date.parse(old.fetchedAt)
        : NaN;
    const age = Number.isFinite(fetched) && fetched <= now ? now - fetched : Infinity;
    if (age < STATS_MAX_AGE) continue;
    if (!due || age > due.age) due = { competition, seasonId, age };
  }
  if (!due) return;
  const { competition, seasonId } = due;
  try {
    const body = await api<unknown>(`/competitions/${competition}/scorers?season=${year}&limit=${MAX_SCORERS}`);
    const data = buildLeagueStats(competition, seasonId, normalizeScorers(body, competition, seasonId), now);
    if (!validLeagueStats(data)) throw new Error("invalid");
    await db.doc(`leagueStats/${seasonId}`).set(data);
    log(`Goleadores ${seasonId}: ${data.scorers.length} jugadores (Football-Data).`);
  } catch {
    log(`Goleadores ${seasonId}: no disponibles ahora; se conserva la edición anterior.`);
  }
}
