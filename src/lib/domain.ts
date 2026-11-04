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
export function hasPublishedResult(match: Match) {
  return (
    match.status === "FINISHED" &&
    [match.homeScore, match.awayScore].every(
      (value) =>
        typeof value === "number" && Number.isInteger(value) && value >= 0,
    )
  );
}

// Cancelled/awarded fixtures need no played result. Postponed fixtures remain pending.
export function isRoundComplete(matches: Match[]) {
  return (
    matches.length > 0 &&
    matches.every(
      (match) =>
        ["CANCELLED", "AWARDED"].includes(match.status) ||
        hasPublishedResult(match),
    )
  );
}

export function preferredRound(matches: Match[], now = Date.now()) {
  const valid = matches.filter((m) => Number.isFinite(Date.parse(m.utcDate)));
  // An incomplete archived season must not become the current round of a new season.
  const latestSeasons = new Map<string, string>();
  for (const match of valid) {
    const latest = latestSeasons.get(match.competition);
    if (
      !latest ||
      match.seasonId.localeCompare(latest, "es", { numeric: true }) > 0
    )
      latestSeasons.set(match.competition, match.seasonId);
  }
  const byRound = new Map<string, Match[]>();
  for (const match of valid) {
    if (match.seasonId !== latestSeasons.get(match.competition)) continue;
    const list = byRound.get(match.roundId);
    if (list) list.push(match);
    else byRound.set(match.roundId, [match]);
  }
  const rounds = [...byRound]
    .map(([id, list]) => ({
      id,
      list,
      start: Math.min(...list.map((m) => Date.parse(m.utcDate))),
      started: list.some((m) => hasMatchStarted(m, now)),
    }))
    .sort(
      (a, b) =>
        a.start - b.start || a.id.localeCompare(b.id, "es", { numeric: true }),
    );
  // Wait for the whole started round, including missing final scores and the gap
  // between Champions match days. A passing kick-off time never closes a round.
  const current = rounds.find((r) => r.started && !isRoundComplete(r.list));
  if (current) return current.id;
  const upcoming = rounds.find(
    (r) =>
      !r.started && r.list.some((m) => canPredict(m.utcDate, now, m.status)),
  );
  return (
    upcoming?.id ||
    rounds.filter((r) => r.started).at(-1)?.id ||
    rounds.at(-1)?.id ||
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
