import type { Match } from "./domain";
import { insightFitsMatch, type MatchInsight } from "./matchInsightsData";
import { hasCurrentProbability } from "./matchProbability";
export type DetailTab =
  "probability" | "goals" | "lineups" | "statistics" | "matchups";
export function availableMatchTabs(
  match: Match,
  insight: MatchInsight | null,
  now = Date.now(),
): DetailTab[] {
  if (!insight || !insightFitsMatch(insight, match)) return [];
  const available: DetailTab[] = [];
  if (hasCurrentProbability(match, insight.probability, now))
    available.push("probability");
  if (
    insight.matchups?.length &&
    ["TIMED", "SCHEDULED"].includes(match.status) &&
    Date.parse(match.utcDate) > now
  )
    available.push("matchups");
  if (insight.goals.length || insight.incidents?.length)
    available.push("goals");
  if (insight.lineups.some((l) => l.players.length > 0))
    available.push("lineups");
  if (insight.statistics.length) available.push("statistics");
  return available;
}

export type MatchPageTab =
  "preview" | "odds" | "events" | "lineups" | "statistics" | "table";
export const matchPageTabLabels: Record<MatchPageTab, string> = {
  preview: "Previa",
  odds: "Cuotas",
  events: "Eventos",
  lineups: "Alineaciones",
  statistics: "Estadísticas",
  table: "Clasificación",
};

/**
 * Full-page match menu. Upcoming fixtures open on the preview and odds; started
 * ones on events. Lineups and statistics only appear with real data.
 */
export function matchPageTabs(
  match: Match,
  insight: MatchInsight | null,
  hasTable: boolean,
  now = Date.now(),
): MatchPageTab[] {
  const fits = Boolean(insight && insightFitsMatch(insight, match));
  const upcoming =
    ["TIMED", "SCHEDULED"].includes(match.status) &&
    Date.parse(match.utcDate) > now;
  const tabs: MatchPageTab[] = upcoming ? ["preview", "odds"] : ["events"];
  if (fits && insight!.lineups.some((l) => l.players.length > 0))
    tabs.push("lineups");
  if (!upcoming && fits && insight!.statistics.length) tabs.push("statistics");
  if (hasTable) tabs.push("table");
  return tabs;
}
