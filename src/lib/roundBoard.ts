import {
  hasPublishedResult,
  score,
  type Match,
  type Mode,
  type PredictionValue,
} from "./domain";

export type PickState = "hit" | "miss" | "live-hit" | "live-miss" | null;
export interface RoundPlayer {
  id: string;
  name: string;
  picks: Record<string, PredictionValue | undefined>;
}
export interface RoundBoardRow {
  id: string;
  name: string;
  position: number;
  points: number;
  hits: number;
  /** Points if in-play fixtures ended with the current score. */
  livePoints: number;
}

const playing = (m: Match) =>
  ["IN_PLAY", "PAUSED"].includes(m.status) &&
  m.homeScore !== null &&
  m.awayScore !== null;

/** Points of one pick: final with a published 90-minute result, provisional in play. */
export function pickPoints(
  mode: Mode,
  value: PredictionValue | undefined,
  m: Match,
) {
  if (!value || m.homeScore === null || m.awayScore === null) return null;
  if (!hasPublishedResult(m) && !playing(m)) return null;
  return score(mode, value, { home: m.homeScore, away: m.awayScore });
}

export function pickState(
  mode: Mode,
  value: PredictionValue | undefined,
  m: Match,
): PickState {
  const points = pickPoints(mode, value, m);
  if (points === null) return null;
  const live = !hasPublishedResult(m);
  return points > 0 ? (live ? "live-hit" : "hit") : live ? "live-miss" : "miss";
}

/**
 * Display-only round summary of complete, shared deliveries. Official totals remain
 * those computed by the backend in Clasificación.
 */
export function roundBoard(
  matches: Match[],
  mode: Mode,
  players: RoundPlayer[],
): RoundBoardRow[] {
  const rows = players.map((player) => {
    let points = 0,
      hits = 0,
      livePoints = 0;
    for (const m of matches) {
      const value = pickPoints(mode, player.picks[m.id], m);
      if (value === null) continue;
      if (hasPublishedResult(m)) {
        points += value;
        if (value > 0) hits++;
      } else livePoints += value;
    }
    return { id: player.id, name: player.name, points, hits, livePoints };
  });
  const total = (r: (typeof rows)[number]) => r.points + r.livePoints;
  rows.sort(
    (a, b) =>
      total(b) - total(a) ||
      b.points - a.points ||
      a.name.localeCompare(b.name, "es") ||
      a.id.localeCompare(b.id),
  );
  let position = 1;
  return rows.map((row, i) => {
    if (i && total(row) !== total(rows[i - 1])) position = i + 1;
    return { ...row, position };
  });
}

export function roundHasStarted(matches: Match[]) {
  return matches.some((m) => hasPublishedResult(m) || playing(m));
}
