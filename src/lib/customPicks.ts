import { outcome, score, type Prediction, type PredictionValue } from "./domain";
import type { RankingRow } from "./rankings";
import type { Competition, CustomMatch, ResolvedMatch } from "./customCompetition";

/**
 * Predictions in a friends' competition. A pick is stored as text: "1", "X",
 * "2" (1X2) or "2-1" (exact score). Points are derived from the results every
 * time, never stored, so editing a result can't count anything twice.
 */
export type PickMap = Record<string, string>; // uid -> stored pick

export function encodePick(value: PredictionValue): string {
  return typeof value === "string" ? value : `${value.home}-${value.away}`;
}
export function decodePick(raw: unknown): PredictionValue | null {
  if (raw === "1" || raw === "X" || raw === "2") return raw;
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw);
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
}
export function pickLabel(raw: string) {
  const value = decodePick(raw);
  if (!value) return "—";
  return typeof value === "string" ? value : `${value.home} – ${value.away}`;
}

/** Only a finished match with a score scores; cancelled or pending ones don't. */
export function matchResult(m: Pick<CustomMatch, "status" | "homeScore" | "awayScore">): Prediction | null {
  if (m.status !== "finished" || m.homeScore === null || m.awayScore === null) return null;
  return { home: m.homeScore, away: m.awayScore };
}

/**
 * Each pick scores by its own kind, so changing the competition's mode midway
 * keeps earlier points: exact score 3 (or 1 for the right outcome), 1X2 1.
 */
export function pickPoints(raw: string, m: Pick<CustomMatch, "status" | "homeScore" | "awayScore">): number | null {
  const result = matchResult(m);
  const value = decodePick(raw);
  if (!result || !value) return null;
  return score(typeof value === "string" ? "classic" : "exact", value, result);
}
export function pickHit(raw: string, m: Pick<CustomMatch, "status" | "homeScore" | "awayScore">) {
  const result = matchResult(m);
  const value = decodePick(raw);
  if (!result || !value) return null;
  if (typeof value === "string") return value === outcome(result.home, result.away) ? "outcome" : "miss";
  return value.home === result.home && value.away === result.away
    ? "exact"
    : outcome(value.home, value.away) === outcome(result.home, result.away)
      ? "outcome"
      : "miss";
}

/** Open for picks: scheduled, not started, both sides known and predictions on. */
export function canPick(competition: Pick<Competition, "predictionMode">, m: ResolvedMatch, now: number) {
  return (
    competition.predictionMode !== "off" &&
    m.status === "scheduled" &&
    m.startAt > now &&
    Boolean(m.home.id && m.away.id && !m.home.pending && !m.away.pending)
  );
}

export interface PickPerson {
  id: string;
  name: string;
  avatar: string | null;
}
export interface PickRankingRow extends RankingRow {
  exact: number;
  played: number;
}

/**
 * The prediction table: every follower (and anyone who predicted before
 * leaving), ordered by points, then exact scores, then hits, then name.
 */
export function pickRanking(
  matches: Pick<CustomMatch, "id" | "status" | "homeScore" | "awayScore">[],
  picks: Record<string, PickMap>,
  people: PickPerson[],
): PickRankingRow[] {
  const rows = new Map<string, PickRankingRow>(
    people.map((p) => [p.id, { ...p, points: 0, hits: 0, exact: 0, played: 0, position: 0 }]),
  );
  for (const m of matches) {
    const byUser = picks[m.id];
    if (!byUser || !matchResult(m)) continue;
    for (const [uid, raw] of Object.entries(byUser)) {
      const points = pickPoints(raw, m);
      if (points === null) continue;
      let row = rows.get(uid);
      if (!row) {
        row = { id: uid, name: "Jugador", avatar: null, points: 0, hits: 0, exact: 0, played: 0, position: 0 };
        rows.set(uid, row);
      }
      row.played += 1;
      row.points += points;
      if (points > 0) row.hits += 1;
      if (pickHit(raw, m) === "exact") row.exact += 1;
    }
  }
  const sorted = [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.exact - a.exact ||
      b.hits - a.hits ||
      a.name.localeCompare(b.name, "es") ||
      a.id.localeCompare(b.id),
  );
  let position = 1;
  return sorted.map((row, index) => {
    const prev = sorted[index - 1];
    if (index && (row.points !== prev.points || row.exact !== prev.exact || row.hits !== prev.hits))
      position = index + 1;
    return { ...row, position };
  });
}
