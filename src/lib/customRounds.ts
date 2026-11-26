import { roundKey, type CompetitionView, type ResolvedMatch } from "./customCompetition";
import { encodePick, type PickMap } from "./customPicks";
import { roundCore, type PredictionValue } from "./domain";
import { decodeDelivery, MAX_ROUND_MATCHES } from "./roundDelivery";

/**
 * Rounds of a friends' competition's quiniela, like LaLiga's: a round closes
 * at the first kick-off of its bulk and asks for a pick on every match of it
 * that is still on (not postponed or cancelled) and whose two sides are
 * known. A match moved weeks away from the rest doesn't set the deadline.
 * Sealed slips are the only ones that count.
 */
export interface RoundPlan {
  /** Round key: «J3», «G1», «A2» or a knockout stage. */
  id: string;
  deadline: number;
  matchIds: string[];
}
export type RoundDocs = Record<string, Pick<RoundPlan, "deadline" | "matchIds">>;

const playable = (m: ResolvedMatch) =>
  m.status !== "postponed" &&
  m.status !== "cancelled" &&
  Boolean(m.home.id && m.away.id && !m.home.pending && !m.away.pending);

/** What each round should look like now, from the calendar and the results. */
export function roundPlans(view: Pick<CompetitionView, "matches">): RoundPlan[] {
  const byRound = new Map<string, ResolvedMatch[]>();
  for (const m of view.matches) {
    const key = roundKey(m);
    byRound.set(key, [...(byRound.get(key) || []), m]);
  }
  return [...byRound.entries()].flatMap(([id, matches]) => {
    const required = roundCore(
      matches.filter(playable).map((m) => ({ m, utcDate: new Date(m.startAt).toISOString() })),
    ).core.map(({ m }) => m);
    if (!required.length) return [];
    return [
      {
        id,
        deadline: Math.min(...required.map((m) => m.startAt)),
        matchIds: required
          .map((m) => m.id)
          .sort()
          .slice(0, MAX_ROUND_MATCHES),
      },
    ];
  });
}

/**
 * The round documents the organisers' app keeps in step. A round that has
 * closed never changes again (its slips refer to it), and a round whose first
 * match is already under way isn't opened late.
 */
export function roundChanges(plans: RoundPlan[], current: RoundDocs, now: number) {
  const write: RoundPlan[] = [];
  for (const plan of plans) {
    const existing = current[plan.id];
    if (existing && existing.deadline <= now) continue;
    if (!existing && plan.deadline <= now) continue;
    if (
      existing &&
      existing.deadline === plan.deadline &&
      existing.matchIds.length === plan.matchIds.length &&
      existing.matchIds.every((id, i) => id === plan.matchIds[i])
    )
      continue;
    write.push(plan);
  }
  const planned = new Set(plans.map((p) => p.id));
  const remove = Object.entries(current)
    .filter(([id, doc]) => !planned.has(id) && doc.deadline > now)
    .map(([id]) => id);
  return { write, remove };
}

/** A sealed slip, read back (null if it doesn't hold together). */
export function readEntry(data: Record<string, unknown>): Record<string, PredictionValue> | null {
  try {
    return decodeDelivery(data);
  } catch {
    return null;
  }
}

/** Sealed slips by round as picks by match, the shape the tables score. */
export function entriesAsPicks(
  entries: Record<string, Record<string, Record<string, PredictionValue>>>,
): Record<string, PickMap> {
  const out: Record<string, PickMap> = {};
  for (const byUser of Object.values(entries))
    for (const [uid, picks] of Object.entries(byUser))
      for (const [mid, value] of Object.entries(picks)) (out[mid] ||= {})[uid] = encodePick(value);
  return out;
}
