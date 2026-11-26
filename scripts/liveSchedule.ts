import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { isCompetition } from "../src/lib/competitions";
import type { Match } from "../src/lib/domain";
import { LIVE_WATCH_BEFORE, isHotMatch } from "../src/lib/liveBoard";
import { REMIND_LAST_CALL, REMIND_WINDOW } from "./notifications";

/**
 * When the live job has work, so it can wait for it instead of trusting
 * GitHub's schedule (hours late, or skipped, on busy days): every match from
 * 20 minutes before kick-off, and the reminder of each round still open.
 */
const MINUTE = 60_000;
/** The reminder goes out two hours before a round closes (it may until ten minutes before). */
export const REMIND_BEFORE = 2 * 60 * MINUTE;
/** The longest wait inside one job (GitHub stops a job at six hours). */
export const MAX_WAIT = 5 * 60 * MINUTE + 15 * MINUTE;
/** Keep a job waiting only when there is work this close. */
export const CHAIN_HORIZON = 18 * 60 * MINUTE;
const UPCOMING = ["TIMED", "SCHEDULED"];

export type LiveWake = { at: number; kind: "live" } | { at: number; kind: "remind"; deadline: number };

/** The next moment with work: a match to follow (now, if one is in play) or a reminder to send. */
export function nextLiveWake(matches: Match[], deadlines: number[], now: number): LiveWake | undefined {
  let best: LiveWake | undefined;
  for (const m of matches) {
    if (isHotMatch(m, now)) return { at: now, kind: "live" };
    const kickoff = Date.parse(m.utcDate);
    if (!Number.isFinite(kickoff) || kickoff <= now || !UPCOMING.includes(m.status)) continue;
    const at = Math.max(now, kickoff - LIVE_WATCH_BEFORE);
    if (!best || at < best.at) best = { at, kind: "live" };
  }
  for (const deadline of deadlines) {
    if (deadline - REMIND_LAST_CALL <= now) continue;
    const at = Math.max(now, deadline - Math.min(REMIND_BEFORE, REMIND_WINDOW));
    // At the same moment, following the match comes first (it reminds too).
    if (!best || at < best.at) best = { at, kind: "remind", deadline };
  }
  return best;
}

/** The deadlines of the open rounds that still need a reminder (a small range query). */
export async function roundDeadlines(db: Firestore, now: number) {
  const snap = await db
    .collection("rounds")
    .where("submissionDeadline", ">", Timestamp.fromMillis(now + REMIND_LAST_CALL))
    .orderBy("submissionDeadline")
    .limit(10)
    .get();
  return snap.docs
    .filter((d) => d.data().requiresSubmission === true && isCompetition(d.data().competition))
    .map((d) => (d.data().submissionDeadline as Timestamp).toMillis());
}
