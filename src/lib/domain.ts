import type { CompetitionCode } from "./competitions";
export type Mode = "classic" | "exact";
export type Outcome = "1" | "X" | "2";
export interface Prediction {
  home: number;
  away: number;
}
export type PredictionValue = Outcome | Prediction;

export function samePrediction(a: PredictionValue, b: PredictionValue) {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.home === b.home && a.away === b.away;
}

export function predictionSummary(value: PredictionValue) {
  return typeof value === "string" ? value : `${value.home} – ${value.away}`;
}
export interface Match {
  id: string;
  competition: CompetitionCode;
  seasonId: string;
  roundId: string;
  matchday: number;
  stage: string;
  utcDate: string;
  status: string;
  home: string;
  away: string;
  homeTeamId?: number | null;
  awayTeamId?: number | null;
  scoreDuration?: string;
  halfTimeHomeScore?: number | null;
  halfTimeAwayScore?: number | null;
  winner?: Outcome | null;
  resultProvider?: "SportAPI";
  sportApiId?: string;
  homeCrest?: string;
  awayCrest?: string;
  homeScore: number | null;
  awayScore: number | null;
}
export const outcome = (home: number, away: number): Outcome =>
  home > away ? "1" : home < away ? "2" : "X";
export function score(
  mode: Mode,
  prediction: Prediction | Outcome,
  result: Prediction,
): number {
  if (typeof prediction === "string")
    return mode === "classic" &&
      prediction === outcome(result.home, result.away)
      ? 1
      : 0;
  if (mode !== "exact") return 0;
  return prediction.home === result.home && prediction.away === result.away
    ? 3
    : outcome(prediction.home, prediction.away) ===
        outcome(result.home, result.away)
      ? 1
      : 0;
}
export function canPredict(
  kickoff: string,
  serverNow: number,
  status = "TIMED",
) {
  return (
    ["TIMED", "SCHEDULED"].includes(status) && serverNow < Date.parse(kickoff)
  );
}
export function validPrediction(value: Prediction) {
  return (
    Number.isInteger(value.home) &&
    Number.isInteger(value.away) &&
    value.home >= 0 &&
    value.away >= 0 &&
    value.home <= 99 &&
    value.away <= 99
  );
}

export const matchStatusLabel: Record<string, string> = {
  SCHEDULED: "Programado",
  TIMED: "Próximamente",
  IN_PLAY: "En juego",
  PAUSED: "Descanso",
  FINISHED: "Finalizado",
  POSTPONED: "Aplazado",
  SUSPENDED: "Suspendido",
  CANCELLED: "Cancelado",
  AWARDED: "Adjudicado",
};

const stages: Record<string, string> = {
  REGULAR_SEASON: "Jornada",
  LEAGUE_STAGE: "Fase liga",
  GROUP_STAGE: "Fase de grupos",
  PLAYOFFS: "Playoffs",
  LAST_128: "Primera ronda",
  LAST_64: "Treintaidosavos",
  PRELIMINARY_ROUND: "Ronda previa",
  FIRST_ROUND: "Primera ronda",
  SECOND_ROUND: "Segunda ronda",
  LAST_32: "Dieciseisavos",
  LAST_16: "Octavos de final",
  QUARTER_FINALS: "Cuartos de final",
  SEMI_FINALS: "Semifinales",
  FINAL: "Final",
  QUALIFICATION: "Clasificación",
};
export function roundLabel(match: Pick<Match, "stage" | "matchday">) {
  const stage = stages[match.stage] || match.stage.replaceAll("_", " ");
  return match.stage === "REGULAR_SEASON"
    ? `Jornada ${match.matchday}`
    : `${stage}${match.matchday ? ` · Jornada ${match.matchday}` : ""}`;
}
export function roundLabelFromId(id: string) {
  const parts = id.split("-");
  return roundLabel({ stage: parts[2] || "", matchday: Number(parts[3]) || 0 });
}
export function preferredRound(matches: Match[]) {
  return (
    matches.find((m) => canPredict(m.utcDate, Date.now(), m.status))?.roundId ||
    matches.at(-1)?.roundId ||
    ""
  );
}

export function hasMatchStarted(
  match: Pick<Match, "utcDate" | "status">,
  now: number,
) {
  return (
    !["POSTPONED", "CANCELLED"].includes(match.status) &&
    now >= Date.parse(match.utcDate)
  );
}
