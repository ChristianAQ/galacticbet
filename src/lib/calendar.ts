import { isKnownCompetition } from "./competitions";
import type { Match } from "./domain";

export const CALENDAR_FORMAT = 1;
export const MAX_CALENDAR_BYTES = 800_000;

// Explicit fields exclude Firestore timestamps and any private/backend metadata.
export function calendarMatch(m: Match): Match {
  return {
    id: m.id,
    competition: m.competition,
    seasonId: m.seasonId,
    roundId: m.roundId,
    matchday: m.matchday,
    stage: m.stage,
    utcDate: m.utcDate,
    status: m.status,
    home: m.home || "Por determinar",
    away: m.away || "Por determinar",
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    scoreDuration: m.scoreDuration,
    halfTimeHomeScore: m.halfTimeHomeScore,
    halfTimeAwayScore: m.halfTimeAwayScore,
    winner: m.winner,
    resultProvider: m.resultProvider,
    sportApiId: m.sportApiId,
    homeCrest: m.homeCrest,
    awayCrest: m.awayCrest,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
  };
}

export function encodeCalendar(matches: Match[]) {
  return JSON.stringify(
    matches.map(calendarMatch).sort((a, b) => a.id.localeCompare(b.id)),
  );
}

export function validCalendarMatch(value: unknown): value is Match {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    isKnownCompetition(m.competition) &&
    [
      "id",
      "seasonId",
      "roundId",
      "stage",
      "utcDate",
      "status",
      "home",
      "away",
    ].every(
      (key) => typeof m[key] === "string" && (m[key] as string).length > 0,
    ) &&
    Number.isFinite(Date.parse(m.utcDate as string)) &&
    Number.isInteger(m.matchday) &&
    (m.resultProvider === undefined || m.resultProvider === "SportAPI") &&
    (m.sportApiId === undefined ||
      (typeof m.sportApiId === "string" && /^\d{1,30}$/.test(m.sportApiId))) &&
    [m.homeTeamId, m.awayTeamId].every(
      (id) => id === undefined || id === null || Number.isInteger(id),
    ) &&
    [m.homeCrest, m.awayCrest, m.scoreDuration].every(
      (text) => text === undefined || typeof text === "string",
    ) &&
    [m.halfTimeHomeScore, m.halfTimeAwayScore].every(
      (score) =>
        score === undefined ||
        score === null ||
        (Number.isInteger(score) && Number(score) >= 0),
    ) &&
    (m.winner === undefined ||
      m.winner === null ||
      m.winner === "1" ||
      m.winner === "X" ||
      m.winner === "2") &&
    [m.homeScore, m.awayScore].every(
      (score) =>
        score === null || (Number.isInteger(score) && Number(score) >= 0),
    )
  );
}

export function decodeCalendar(data: Record<string, unknown>): Match[] {
  if (
    data.formatVersion !== CALENDAR_FORMAT ||
    typeof data.payload !== "string"
  )
    throw new Error(
      "Formato de calendario no compatible. Ejecuta la sincronización de fútbol.",
    );
  const matches: unknown = JSON.parse(data.payload);
  if (
    !Array.isArray(matches) ||
    !matches.length ||
    !matches.every((m) => validCalendarMatch(m) && m.seasonId === data.seasonId)
  )
    throw new Error(
      "Calendario incompleto o inválido; se conserva la versión anterior.",
    );
  return matches.map(calendarMatch);
}
