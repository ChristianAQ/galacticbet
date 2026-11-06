import { isCompetition, type CompetitionCode } from "./competitions";

export const PLAYER_METRICS = [
  { id: "goals", label: "Máximos goleadores", unit: "goles" },
  { id: "assists", label: "Más asistencias", unit: "asistencias" },
  { id: "minutes", label: "Más minutos disputados", unit: "min" },
  { id: "yellowCards", label: "Tarjetas amarillas", unit: "amarillas" },
  { id: "redCards", label: "Tarjetas rojas", unit: "rojas" },
  {
    id: "cleanSheets",
    label: "Porteros · porterías a cero",
    unit: "porterías a cero",
  },
  {
    id: "goalContributions",
    label: "Participación en goles",
    unit: "goles + asistencias",
  },
] as const;
export type PlayerMetric = (typeof PLAYER_METRICS)[number]["id"];
export interface StatRow {
  key: string;
  name: string;
  team: string;
  crest?: string;
  value: number;
}
export interface LeagueStats {
  version: 1;
  provider: "SportAPI";
  competition: CompetitionCode;
  seasonId: string;
  fetchedAt: string;
  rankings: Partial<Record<PlayerMetric, StatRow[]>>;
}
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 180;
export function validLeagueStats(value: unknown): value is LeagueStats {
  if (!value || typeof value !== "object") return false;
  const v = value as LeagueStats;
  return (
    v.version === 1 &&
    v.provider === "SportAPI" &&
    isCompetition(v.competition) &&
    new RegExp(`^${v.competition}-\\d{4}$`).test(v.seasonId) &&
    typeof v.fetchedAt === "string" &&
    Number.isFinite(Date.parse(v.fetchedAt)) &&
    Boolean(v.rankings) &&
    typeof v.rankings === "object" &&
    !Array.isArray(v.rankings) &&
    Object.entries(v.rankings).every(
      ([key, rows]) =>
        PLAYER_METRICS.some((m) => m.id === key) &&
        Array.isArray(rows) &&
        rows.length <= 5 &&
        new Set(rows.map((r) => r?.key)).size === rows.length &&
        rows.every(
          (r) =>
            r &&
            text(r.key) &&
            text(r.name) &&
            text(r.team) &&
            Number.isSafeInteger(r.value) &&
            r.value >= 0 &&
            r.value <= 100000 &&
            (r.crest === undefined ||
              (typeof r.crest === "string" &&
                r.crest.length <= 1000 &&
                /^https:\/\//.test(r.crest))),
        ),
    )
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
