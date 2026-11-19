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
import { validPotCents } from "./pot";
import {
  createPrivateGroup,
  gameSeasonId,
  prepareGroupCompetitions,
} from "./groupSetup";
import { COMPETITION_CODES } from "./competitions";
import { snapshots } from "./localSnapshot";
import { readSession } from "./session";
import { fromServer } from "./firestoreOnline";
import { decodeCalendar } from "./calendar";
import { createCalendarLoader } from "./calendarCache";
export { gameSeasonId } from "./groupSetup";
export interface Group {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  /** Informational contribution per player and round, in cents. 0 = no pot. */
  potCents?: number;
}
function database() {
  if (!db) throw new Error("Firebase no está configurado.");
  return db;
}
/** Confirmed account, or the remembered one while Firebase confirms it. */
const currentUid = () => auth?.currentUser?.uid || readSession()?.uid || "";

/** Fired with the group id when its competitions changed after being shown. */
export const SEASONS_CHANGED = "galacticbet:seasons-changed";
/** How long device snapshots are trusted enough to paint (then: wait). */
const SNAPSHOT_MAX_AGE = 7 * 24 * 3_600_000;
/** Snapshots older than this are shown and then quietly refreshed. */
const REVALIDATE_AFTER = 10 * 60_000;
const isText = (value: unknown, max = 200) =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const isList = <T>(value: unknown, item: (entry: unknown) => boolean, max = 60): value is T[] =>
  Array.isArray(value) && value.length <= max && value.every(item);
const isGroup = (value: unknown) =>
  Boolean(value) &&
  isText((value as Group).id, 128) &&
  typeof (value as Group).name === "string" &&
  isText((value as Group).ownerId, 128) &&
  isList((value as Group).memberIds, (id) => isText(id, 128), 60);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const loadMatches = createCalendarLoader(
  import.meta.env.VITE_FIREBASE_PROJECT_ID || "unconfigured",
  () => window.localStorage,
  async () => {
    const snap = fromServer(await getDocs(collection(database(), "calendars")));
    // Keep existing installations usable until their first upgraded backend sync.
    // Once snapshots exist, this legacy collection scan is never needed again.
    if (snap.empty) {
      const legacy = fromServer(await getDocs(collection(database(), "matches")));
      return legacy.docs.map((d) => ({ ...d.data(), id: d.id }) as Match);
    }
    return snap.docs
      .filter((d) => isCompetition(d.id.split("-")[0]))
      .flatMap((d) => decodeCalendar(d.data()));
  },
);
export async function loadGroups(uid: string) {
  const snap = fromServer(
    await getDocs(
      query(
        collection(database(), "groups"),
        where("memberIds", "array-contains", uid),
      ),
    ),
  );
  const groups = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Group);
  snapshots.write(`${uid}:groups`, groups);
  return groups;
}
/** Your groups as of the last launch on this device, for the first paint. */
export function storedGroups(uid: string) {
  return snapshots.read(`${uid}:groups`, SNAPSHOT_MAX_AGE, (value): value is Group[] =>
    isList(value, isGroup, 50),
  )?.value;
}
export async function createGroup(
  uid: string,
  name: string,
  mode: Mode,
  potCents = 0,
) {
  const id = await createPrivateGroup(database(), uid, name, mode, potCents);
  privateCache.clear();
  return id;
}
/**
 * Owners add the current season of each competition when it starts. Nothing to
 * do (and no transaction) while the known seasons already include all of them.
 */
export async function ensureGroupCompetitions(uid: string, groupId: string) {
  const known = await loadGameSeasons(groupId).catch(() => []);
  const expected = [...COMPETITION_CODES].map(gameSeasonId);
  if (expected.every((id) => known.some((season) => season.id === id))) return;
  if (await prepareGroupCompetitions(database(), uid, groupId))
    privateCache.clear();
  await refreshGameSeasons(groupId, known);
}
type GameSeason = Awaited<ReturnType<typeof fetchGameSeasons>>[number];
const isSeason = (value: unknown) =>
  Boolean(value) &&
  isText((value as GameSeason).id, 128) &&
  isText((value as GameSeason).competition, 16) &&
  isText((value as GameSeason).mode, 16);
const seasonsKey = (groupId: string) => `${currentUid()}:seasons:${groupId}`;
/** Seasons are fixed for a whole year: the stored list paints, then revalidates. */
export function loadGameSeasons(groupId: string) {
  return privateCache.read(
    cacheKey("seasons", groupId),
    async () => {
      const stored = snapshots.read(
        seasonsKey(groupId),
        SNAPSHOT_MAX_AGE,
        (value): value is GameSeason[] => isList(value, isSeason, 30),
      );
      if (!stored) return refreshGameSeasons(groupId);
      if (Date.now() - stored.savedAt > REVALIDATE_AFTER)
        void refreshGameSeasons(groupId, stored.value).catch(() => {});
      return stored.value;
    },
    60000,
  );
}
async function refreshGameSeasons(groupId: string, shown?: GameSeason[]) {
  const key = seasonsKey(groupId);
  const fresh = await fetchGameSeasons(groupId);
  snapshots.write(key, fresh);
  if (shown && !sameJson(shown, fresh)) {
    privateCache.drop((entry) => entry === cacheKey("seasons", groupId));
    expireGroupRankings();
    window.dispatchEvent(new CustomEvent(SEASONS_CHANGED, { detail: groupId }));
  }
  return fresh;
}
async function fetchGameSeasons(groupId: string) {
  const list = fromServer(
    await getDocs(collection(database(), "groups", groupId, "gameSeasons")),
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
    currentUid(),
    kind,
    typeof group === "string" ? group : [group.id, [...group.memberIds].sort()],
  ]);
}
const isParticipant = (value: unknown) =>
  Boolean(value) &&
  isText((value as Participant).id, 128) &&
  typeof (value as Participant).name === "string" &&
  ((value as Participant).avatar === null ||
    typeof (value as Participant).avatar === "string");
const membersOf = (group: Group) => [...group.memberIds].sort().join();
/** One profile read per member: names change rarely, so the stored list paints. */
export function loadParticipants(group: Group): Promise<Participant[]> {
  return privateCache.read(
    cacheKey("people", group),
    async () => {
      const key = `${currentUid()}:people:${group.id}`;
      const stored = snapshots.read(
        key,
        SNAPSHOT_MAX_AGE,
        (value): value is { members: string; people: Participant[] } =>
          Boolean(value) &&
          (value as { members: unknown }).members === membersOf(group) &&
          isList((value as { people: unknown }).people, isParticipant, 60),
      );
      const refresh = async () => {
        const people = await fetchParticipants(group);
        snapshots.write(key, { members: membersOf(group), people });
        return people;
      };
      if (!stored) return refresh();
      if (Date.now() - stored.savedAt > REVALIDATE_AFTER)
        void refresh().catch(() => {});
      return stored.value.people;
    },
    60000,
  );
}
async function fetchParticipants(group: Group): Promise<Participant[]> {
  const store = database();
  return Promise.all(
    group.memberIds.map(async (uid) => {
      const profile = fromServer(await getDoc(doc(store, "users", uid)));
      return {
        id: uid,
        name: profile.data()?.name || "Jugador",
        avatar: profile.data()?.avatar || null,
      };
    }),
  );
}

type GroupRankings = Awaited<ReturnType<typeof fetchGroupRankings>>;
export function getCachedGroupRankings(group: Group) {
  return privateCache.peek<GroupRankings>(cacheKey("rankings", group));
}
const rankingsKey = (group: Group) => `${currentUid()}:rankings:${group.id}`;
/**
 * Standings as of the last time they were on screen on this device. Painted at
 * once while the fresh totals load; never trusted for anything but display.
 */
export function getStoredGroupRankings(group: Group) {
  return snapshots.read(
    rankingsKey(group),
    SNAPSHOT_MAX_AGE,
    (value): value is { members: string; data: GroupRankings } => {
      const entry = value as { members?: unknown; data?: GroupRankings };
      return (
        Boolean(entry) &&
        entry.members === membersOf(group) &&
        Boolean(entry.data) &&
        isList(entry.data!.participants, isParticipant, 60) &&
        isList(
          entry.data!.seasons,
          (season) =>
            isSeason(season) &&
            isList((season as SeasonRanking).standings, (row) =>
              Boolean(row) &&
              isText((row as { id: unknown }).id, 128) &&
              typeof (row as { points: unknown }).points === "number",
            ),
          30,
        )
      );
    },
  )?.value.data;
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
  // Profiles and standings in parallel: the standings only wait for the seasons.
  const [participants, seasons] = await Promise.all([
    loadParticipants(group),
    loadGameSeasons(group.id).then((configs) => fetchStandings(group, configs)),
  ]);
  const data = { participants, seasons };
  snapshots.write(rankingsKey(group), { members: membersOf(group), data });
  return data;
}
function fetchStandings(group: Group, configs: GameSeason[]) {
  return Promise.all(
    configs.map(async (config): Promise<SeasonRanking> => {
      const standings = fromServer(
        await getDocs(
          collection(
            database(),
            "groups",
            group.id,
            "gameSeasons",
            config.id,
            "standings",
          ),
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
}

export async function renameGroup(groupId: string, name: string) {
  await updateDoc(doc(database(), "groups", groupId), { name: name.trim() });
  privateCache.clear();
}

/** Owner only. The pot is informational: no money moves through the app. */
export async function setGroupPot(groupId: string, potCents: number) {
  if (!validPotCents(potCents))
    throw new Error("La aportación debe estar entre 0 y 1.000 €.");
  await updateDoc(doc(database(), "groups", groupId), { potCents });
  privateCache.clear();
}
