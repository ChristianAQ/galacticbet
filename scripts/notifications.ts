import type { Firestore } from "firebase-admin/firestore";
import { competitionName } from "../src/lib/competitions";
import { roundLabelFromId } from "../src/lib/domain";
import type { Standing } from "./standings";
import {
  ensureVapidKeys,
  sendToUser,
  type PushMessage,
  type PushSend,
  type VapidKeys,
} from "./push";

const HOUR = 3_600_000;
/** Re-scored old rounds (e.g. somebody joined) never announce again. */
const RESULT_RECENT = 48 * HOUR;

const roundTitle = (competition: string, roundId: string) =>
  `${competitionName(competition, true)} · ${roundLabelFromId(roundId)}`;
const points = (n: number) => `${n} ${n === 1 ? "punto" : "puntos"}`;

// ---------- The only aviso: the round is over, this is where you finished ----------

export interface CompletedRound {
  groupId: string;
  groupName: string;
  competition: string;
  roundId: string;
  /** Kick-off of the round's last fixture. */
  lastKickoff: number;
  /** Season totals after this round, per member. */
  standings: Map<string, Standing>;
  names: Map<string, string>;
  /** Members who sealed their slip for this round: only they hear about it. */
  sealed: string[];
}

/** Position with ties sharing a place (1, 1, 3…). */
function positions(totals: [string, number][]) {
  const sorted = [...totals].sort((a, b) => b[1] - a[1]);
  const result = new Map<string, number>();
  sorted.forEach(([uid, value], index) => {
    result.set(
      uid,
      index && value === sorted[index - 1][1] ? result.get(sorted[index - 1][0])! : index + 1,
    );
  });
  return result;
}

/**
 * One aviso per player who sealed this round in this group: the place they
 * finished among those who sealed it, and their points. Nobody else is told.
 */
export function resultMessages(round: CompletedRound): Map<string, PushMessage> {
  const sealed = [...new Set(round.sealed)].filter((uid) => round.standings.has(uid));
  const roundPoints = sealed.map(
    (uid) => [uid, round.standings.get(uid)!.rounds[round.roundId]?.points ?? 0] as [string, number],
  );
  const place = positions(roundPoints);
  const of = sealed.length;
  const messages = new Map<string, PushMessage>();
  for (const [uid, mine] of roundPoints) {
    const position = place.get(uid)!;
    const tied = roundPoints.filter(([, p]) => p === mine).length > 1;
    const body =
      of === 1
        ? `Has sumado ${points(mine)} en ${round.groupName}: eras el único que selló el boleto.`
        : position === 1 && mine > 0
          ? tied
            ? `Has ganado la jornada en ${round.groupName} (empate a ${points(mine)}). 1.º de ${of}.`
            : `¡Has ganado la jornada en ${round.groupName} con ${points(mine)}! 1.º de ${of}.`
          : `Has quedado ${position}.º de ${of}${tied ? " (empate)" : ""} en ${round.groupName} con ${points(mine)}.`;
    messages.set(uid, {
      title: `${roundTitle(round.competition, round.roundId)} terminada`,
      body,
      url: `./#/quiniela?vista=clasificacion&group=${encodeURIComponent(round.groupId)}&round=${encodeURIComponent(round.roundId)}`,
      // One per group: a player in two groups gets both, not one over the other.
      tag: `result-${round.groupId}-${round.roundId}`,
    });
  }
  return messages;
}

export async function announceRoundResults(
  db: Firestore,
  keys: VapidKeys,
  completed: CompletedRound[],
  { now = Date.now(), send }: { now?: number; send?: PushSend } = {},
) {
  let announced = 0;
  for (const round of completed) {
    if (now - round.lastKickoff > RESULT_RECENT) continue;
    // Claimed before sending: a crash mid-way never repeats the whole group.
    try {
      await db
        .doc(`pushLog/result_${round.groupId}_${round.roundId}`)
        .create({ at: now });
    } catch {
      continue;
    }
    for (const [uid, message] of resultMessages(round))
      announced += (await sendToUser(db, uid, message, keys, send)) ? 1 : 0;
  }
  return { announced };
}

// ---------- Entry points: notifications never break a sync ----------

export async function notifyCompletedRounds(
  db: Firestore,
  completed: CompletedRound[],
) {
  if (!completed.length) return;
  try {
    const keys = await ensureVapidKeys(db);
    const { announced } = await announceRoundResults(db, keys, completed);
    if (announced) console.log(`Avisos: ${announced} resultados de jornada enviados.`);
  } catch (error) {
    console.warn(
      `::warning::Avisos: no se pudieron enviar los resultados (${error instanceof Error ? error.message : "error"}).`,
    );
  }
}
