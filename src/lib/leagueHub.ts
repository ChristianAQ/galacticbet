import type { Match } from "./domain";

export const LEAGUE_TABS = [
  { id: "partidos", label: "Partidos" },
  { id: "clasificacion", label: "Clasificación" },
  { id: "noticias", label: "Noticias" },
  { id: "estadisticas", label: "Estadísticas" },
] as const;
export type LeagueTab = (typeof LEAGUE_TABS)[number]["id"];
export function leagueTab(value: unknown): LeagueTab {
  return LEAGUE_TABS.find((tab) => tab.id === value)?.id || "partidos";
}
export function competitionSeasons(matches: Match[], competition: string) {
  return [
    ...new Set(
      matches
        .filter(
          (m) =>
            m.competition === competition &&
            new RegExp(`^${competition}-\\d{4}$`).test(m.seasonId),
        )
        .map((m) => m.seasonId),
    ),
  ].sort((a, b) => b.localeCompare(a, "es", { numeric: true }));
}
export function seasonLabel(id: string) {
  const year = Number(id.split("-")[1]);
  return Number.isInteger(year) && year >= 2000
    ? `${year}/${String(year + 1).slice(-2)}`
    : "Sin temporada";
}
