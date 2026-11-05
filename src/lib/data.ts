import { isCompetition } from "./competitions";
import { sealRound } from "./roundSubmission";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  type Match,
  type Mode,
  type Outcome,
  type Prediction,
  type PredictionValue,
} from "./domain";
import { auth, db } from "./firebase";
import { privateCache } from "./memoryCache";
import type { SeasonRanking } from "./rankings";
import { createPrivateGroup, prepareGroupCompetitions } from "./groupSetup";
import { decodeCalendar } from "./calendar";
import { createCalendarLoader } from "./calendarCache";
export { gameSeasonId } from "./groupSetup";
export interface Group {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
}
function database() {
  if (!db) throw new Error("Firebase no está configurado.");
  return db;
}
export const loadMatches = createCalendarLoader(
  import.meta.env.VITE_FIREBASE_PROJECT_ID || "unconfigured",
  () => window.localStorage,
  async () => {
    const snap = await getDocs(collection(database(), "calendars"));
    // Keep existing installations usable until their first upgraded backend sync.
    // Once snapshots exist, this legacy collection scan is never needed again.
    if (snap.empty) {
      const legacy = await getDocs(collection(database(), "matches"));
      return legacy.docs.map((d) => ({ ...d.data(), id: d.id }) as Match);
    }
    return snap.docs
      .filter((d) => isCompetition(d.id.split("-")[0]))
      .flatMap((d) => decodeCalendar(d.data()));
  },
);
export async function loadGroups(uid: string) {
  const snap = await getDocs(
    query(
      collection(database(), "groups"),
      where("memberIds", "array-contains", uid),
    ),
  );
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Group);
}
export async function createGroup(uid: string, name: string, mode: Mode) {
  const id = await createPrivateGroup(database(), uid, name, mode);
  privateCache.clear();
  return id;
}
export async function ensureGroupCompetitions(uid: string, groupId: string) {
  if (await prepareGroupCompetitions(database(), uid, groupId))
    privateCache.clear();
}
export function loadGameSeasons(groupId: string) {
  return privateCache.read(
    cacheKey("seasons", groupId),
    () => fetchGameSeasons(groupId),
    60000,
  );
}
async function fetchGameSeasons(groupId: string) {
  const list = await getDocs(
    collection(database(), "groups", groupId, "gameSeasons"),
  );
  return list.docs
    .filter((d) => isCompetition(d.data().competition))
    .map((d) => ({
      id: d.id,
      competition: d.data().competition as string,
      mode: d.data().mode as Mode,
    }));
}
export async function joinGroup(uid: string, code: string) {
  const store = database();
  const cleaned = code.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleaned))
    throw new Error("Introduce un código de invitación válido.");
  const ref = doc(store, "groups", cleaned);
  await runTransaction(store, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists())
      throw new Error("No encontramos ese grupo. Revisa el código.");
    const group = snap.data() as Group;
    if (group.memberIds.includes(uid)) return;
    if (group.memberIds.length >= 30)
      throw new Error("Este grupo ha alcanzado el límite de 30 participantes.");
    transaction.update(ref, { memberIds: [...group.memberIds, uid] });
    transaction.set(doc(ref, "members", uid), {
      userId: uid,
      joinedAt: serverTimestamp(),
    });
  });
  privateCache.clear();
  return cleaned;
}
export async function leaveGroup(uid: string, group: Group) {
  const store = database();
  const ref = doc(store, "groups", group.id);
  await runTransaction(store, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error("Este grupo ya no existe.");
    const data = snap.data() as Group;
    transaction.update(ref, {
      memberIds: data.memberIds.filter((id) => id !== uid),
    });
    transaction.delete(doc(ref, "members", uid));
  });
  privateCache.clear();
}
export async function savePrediction(
  uid: string,
  groupId: string,
  season: string,
  match: Match,
  value: Outcome | Prediction,
) {
  await setDoc(
    doc(
      database(),
      "groups",
      groupId,
      "gameSeasons",
      season,
      "predictions",
      `${uid}_${match.id}`,
    ),
    {
      userId: uid,
      matchId: match.id,
      roundId: match.roundId,
      value,
      updatedAt: serverTimestamp(),
    },
  );
}

export function submitRound(
  uid: string,
  groupId: string,
  seasonId: string,
  roundId: string,
  expected: Record<string, PredictionValue>,
) {
  return sealRound(database(), uid, groupId, seasonId, roundId, expected);
}

export interface Participant {
  id: string;
  name: string;
  avatar: string | null;
}
function cacheKey(kind: string, group: Group | string) {
  return JSON.stringify([
    auth?.currentUser?.uid || "",
    kind,
    typeof group === "string" ? group : [group.id, [...group.memberIds].sort()],
  ]);
}
export function loadParticipants(group: Group): Promise<Participant[]> {
  return privateCache.read(
    cacheKey("people", group),
    () => fetchParticipants(group),
    60000,
  );
}
async function fetchParticipants(group: Group): Promise<Participant[]> {
  const store = database();
  return Promise.all(
    group.memberIds.map(async (uid) => {
      const profile = await getDoc(doc(store, "users", uid));
      return {
        id: uid,
        name: profile.data()?.name || "Jugador",
        avatar: profile.data()?.avatar || null,
      };
    }),
  );
}

export function getCachedGroupRankings(group: Group) {
  return privateCache.peek<Awaited<ReturnType<typeof fetchGroupRankings>>>(
    cacheKey("rankings", group),
  );
}
/** New backend totals: refetch standings without re-reading profiles or modes. */
export function expireGroupRankings() {
  privateCache.drop((key) => key.includes(`,"rankings",`));
}
export function loadGroupRankings(group: Group) {
  return privateCache.read(
    cacheKey("rankings", group),
    () => fetchGroupRankings(group),
    30000,
  );
}
async function fetchGroupRankings(group: Group) {
  const [participants, configs] = await Promise.all([
    loadParticipants(group),
    loadGameSeasons(group.id),
  ]);
  const seasons: SeasonRanking[] = await Promise.all(
    configs.map(async (config) => {
      const standings = await getDocs(
        collection(
          database(),
          "groups",
          group.id,
          "gameSeasons",
          config.id,
          "standings",
        ),
      );
      return {
        id: config.id,
        competition: config.competition,
        mode: config.mode,
        standings: standings.docs.map((doc) => {
          const value = doc.data();
          return {
            id: doc.id,
            points: value.points ?? 0,
            hits: value.hits ?? 0,
            rounds: value.rounds ?? {},
          };
        }),
      };
    }),
  );
  return { participants, seasons };
}

export async function renameGroup(groupId: string, name: string) {
  await updateDoc(doc(database(), "groups", groupId), { name: name.trim() });
  privateCache.clear();
}
