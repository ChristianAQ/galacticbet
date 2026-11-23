import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { competitionName, isCompetition } from "../src/lib/competitions";
import { roundLabelFromId } from "../src/lib/domain";
import type { Standing } from "./standings";
import {
  ensureVapidKeys,
  sendToUser,
  type PushMessage,
  type PushSend,
  type VapidKeys,
} from "./push";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Remind players who have not sealed during the last three hours. */
export const REMIND_WINDOW = 3 * HOUR;
/** Too close to the deadline to still be useful. */
const REMIND_LAST_CALL = 10 * MINUTE;
/** Re-scored old rounds (e.g. somebody joined) never announce again. */
const RESULT_RECENT = 48 * HOUR;

const clock = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  hour: "2-digit",
  minute: "2-digit",
});
const roundTitle = (competition: string, roundId: string) =>
  `${competitionName(competition, true)} · ${roundLabelFromId(roundId)}`;
const points = (n: number) => `${n} ${n === 1 ? "punto" : "puntos"}`;

// ---------- Reminder: the round closes soon and you have not sealed ----------

export interface OpenRound {
  id: string;
  competition: string;
  deadline: number;
}
export interface PendingGroup {
  id: string;
  name: string;
  /** Members who have not sealed this round in this group. */
  pending: string[];
}
export interface Reminder {
  uid: string;
  round: OpenRound;
  groups: { id: string; name: string }[];
}

/** One reminder per player and round, naming every group still waiting. */
export function collectReminders(
  rounds: { round: OpenRound; groups: PendingGroup[] }[],
): Reminder[] {
  const reminders: Reminder[] = [];
  for (const { round, groups } of rounds) {
    const byUser = new Map<string, { id: string; name: string }[]>();
    for (const group of groups)
      for (const uid of group.pending)
        byUser.set(uid, [
          ...(byUser.get(uid) || []),
          { id: group.id, name: group.name },
        ]);
    for (const [uid, list] of byUser) reminders.push({ uid, round, groups: list });
  }
  return reminders;
}

export function reminderMessage({ round, groups }: Reminder): PushMessage {
  const where =
    groups.length === 1 ? ` en ${groups[0].name}` : ` en ${groups.length} grupos`;
  return {
    title: roundTitle(round.competition, round.id),
    body: `Cierra a las ${clock.format(round.deadline)} y aún no has sellado tu quiniela${where}.`,
    url: `./#/quiniela?group=${encodeURIComponent(groups[0].id)}&round=${encodeURIComponent(round.id)}`,
    tag: `remind-${round.id}`,
  };
}

/** Every ten minutes (live job) and after each full sync. */
export async function remindPendingRounds(
  db: Firestore,
  keys: VapidKeys,
  { now = Date.now(), send }: { now?: number; send?: PushSend } = {},
) {
  // One range query; nearly always empty, so this costs a single read.
  const due = await db
    .collection("rounds")
    .where("submissionDeadline", ">", Timestamp.fromMillis(now + REMIND_LAST_CALL))
    .where("submissionDeadline", "<=", Timestamp.fromMillis(now + REMIND_WINDOW))
    .get();
  const open = due.docs.filter(
    (d) => d.data().requiresSubmission === true && isCompetition(d.data().competition),
  );
  if (!open.length) return { reminded: 0 };
  const groups = await db.collection("groups").get();
  const rounds: { round: OpenRound; groups: PendingGroup[] }[] = [];
  for (const doc of open) {
    const data = doc.data();
    const round: OpenRound = {
      id: doc.id,
      competition: data.competition,
      deadline: data.submissionDeadline.toMillis(),
    };
    const waiting: PendingGroup[] = [];
    for (const group of groups.docs) {
      const season = group.ref.collection("gameSeasons").doc(data.seasonId);
      if (!(await season.get()).exists) continue;
      const attendance = await season
        .collection("roundAttendance")
        .doc(doc.id)
        .get();
      const sealed = new Set(Object.keys(attendance.data()?.members ?? {}));
      const members: string[] = group.data().memberIds || [];
      const pending = members.filter((uid) => !sealed.has(uid));
      if (pending.length)
        waiting.push({ id: group.id, name: group.data().name || "tu grupo", pending });
    }
    rounds.push({ round, groups: waiting });
  }
  let reminded = 0;
  for (const reminder of collectReminders(rounds)) {
    const log = db.doc(`pushLog/remind_${reminder.round.id}_${reminder.uid}`);
    if ((await log.get()).exists) continue;
    const delivered = await sendToUser(
      db,
      reminder.uid,
      reminderMessage(reminder),
      keys,
      send,
    );
    // Only marked once it reached a device: turning avisos on later still works.
    if (delivered) {
      await log.set({ at: now });
      reminded++;
    }
  }
  return { reminded };
}

// ---------- Result: the round is over, here are your points ----------

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

export function resultMessages(round: CompletedRound): Map<string, PushMessage> {
  const roundPoints = [...round.standings].map(
    ([uid, s]) => [uid, s.rounds[round.roundId]?.points ?? 0] as [string, number],
  );
  const season = positions(
    [...round.standings].map(([uid, s]) => [uid, s.points] as [string, number]),
  );
  const best = Math.max(0, ...roundPoints.map(([, p]) => p));
  const winners = roundPoints.filter(([, p]) => best > 0 && p === best).map(([uid]) => uid);
  const nameOf = (uid: string) => round.names.get(uid) || "Jugador";
  const messages = new Map<string, PushMessage>();
  for (const [uid, mine] of roundPoints) {
    const place = `Vas ${season.get(uid)}.º en la general.`;
    let body: string;
    if (!best) body = `Nadie ha puntuado en ${round.groupName}. ${place}`;
    else if (winners.includes(uid))
      body =
        winners.length === 1
          ? `¡Has ganado la jornada en ${round.groupName} con ${points(mine)}! ${place}`
          : `Has ganado la jornada en ${round.groupName} (empate a ${points(mine)}). ${place}`;
    else {
      const winner =
        winners.length === 1
          ? `Ganó ${nameOf(winners[0])} con ${best}`
          : `${winners.length} jugadores empataron a ${best}`;
      body = `Has sumado ${points(mine)} en ${round.groupName}. ${winner}. ${place}`;
    }
    messages.set(uid, {
      title: `${roundTitle(round.competition, round.roundId)} cerrada`,
      body,
      url: `./#/quiniela?vista=clasificacion&group=${encodeURIComponent(round.groupId)}&round=${encodeURIComponent(round.roundId)}`,
      tag: `result-${round.roundId}`,
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

export async function notifyPendingRounds(db: Firestore) {
  try {
    const keys = await ensureVapidKeys(db);
    const { reminded } = await remindPendingRounds(db, keys);
    if (reminded) console.log(`Avisos: ${reminded} recordatorios de cierre enviados.`);
  } catch (error) {
    console.warn(
      `::warning::Avisos: no se pudieron enviar los recordatorios (${error instanceof Error ? error.message : "error"}).`,
    );
  }
}

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
