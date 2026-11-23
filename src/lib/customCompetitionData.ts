import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { db } from "./firebase";
import type { Match, PredictionValue } from "./domain";
import { encodeDelivery, validDeliveredPicks } from "./roundDelivery";
import { readEntry, roundChanges, roundPlans, type RoundDocs } from "./customRounds";
import {
  generateFixtures,
  isCode,
  MAX_ICON_CHARS,
  randomCode,
  resolveCompetition,
  toAppMatch,
  type Competition,
  type CompetitionSetup,
  type CompetitionView,
  type CustomMatch,
  type Fixture,
  type MatchEvent,
  type MatchLineups,
  type MatchStatus,
  type Participant,
  type ParticipantKind,
} from "./customCompetition";
import { decodeEvents, decodeLineups, decodeSquad } from "./matchReport";

/**
 * Firestore access for competitions between friends. The rules decide who may
 * write; these helpers only shape documents the rules accept.
 */
export const COMPETITIONS_COLLECTION = "customCompetitions";
export const CODES_COLLECTION = "competitionCodes";
const RECENT_KEY = "galacticbet:competitions:recent";
const BATCH = 400;

function store(): Firestore {
  if (!db) throw new Error("Firebase no está configurado.");
  return db;
}
const competitionRef = (cid: string) => doc(store(), COMPETITIONS_COLLECTION, cid);

// ---------- Reading ----------

const list = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const num = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : null);

export function decodeCompetition(id: string, d: DocumentData): Competition | null {
  if (typeof d.name !== "string" || typeof d.ownerId !== "string" || !d.schedule) return null;
  return {
    id,
    name: d.name,
    sport: typeof d.sport === "string" ? d.sport : "",
    icon: typeof d.icon === "string" ? d.icon : null,
    participantType: d.participantType === "person" ? "person" : "team",
    format: d.format,
    legs: d.legs === 2 ? 2 : 1,
    knockoutLegs: d.knockoutLegs === 2 ? 2 : 1,
    qualifiers: num(d.qualifiers) ?? 0,
    groups: num(d.groups) ?? 0,
    thirdPlace: d.thirdPlace === true,
    predictionMode: ["exact", "classic", "off"].includes(d.predictionMode) ? d.predictionMode : "off",
    schedule: d.schedule,
    ownerId: d.ownerId,
    adminIds: list(d.adminIds),
    memberIds: list(d.memberIds),
    code: typeof d.code === "string" && isCode(d.code) ? d.code : null,
  };
}
function decodeParticipant(id: string, d: DocumentData): Participant {
  return {
    id,
    name: typeof d.name === "string" ? d.name : "Participante",
    kind: d.kind === "person" ? "person" : "team",
    userId: typeof d.userId === "string" ? d.userId : null,
    icon: typeof d.icon === "string" ? d.icon : null,
    seed: num(d.seed) ?? 0,
    players: decodeSquad(d.players),
  };
}
function decodeMatch(id: string, d: DocumentData): CustomMatch {
  return {
    id,
    phase: d.phase,
    round: num(d.round) ?? 1,
    stage: d.stage,
    group: typeof d.group === "string" ? d.group : null,
    tie: typeof d.tie === "string" ? d.tie : null,
    leg: d.leg === 1 || d.leg === 2 ? d.leg : null,
    homeId: typeof d.homeId === "string" ? d.homeId : null,
    awayId: typeof d.awayId === "string" ? d.awayId : null,
    homeSlot: typeof d.homeSlot === "string" ? d.homeSlot : null,
    awaySlot: typeof d.awaySlot === "string" ? d.awaySlot : null,
    startAt: d.startAt instanceof Timestamp ? d.startAt.toMillis() : Date.now(),
    location: typeof d.location === "string" ? d.location : "",
    status: d.status as MatchStatus,
    homeScore: num(d.homeScore),
    awayScore: num(d.awayScore),
    homePenalties: num(d.homePenalties),
    awayPenalties: num(d.awayPenalties),
    locked: d.locked === true,
    events: decodeEvents(d.events),
    lineups: decodeLineups(d.lineups),
  };
}

export interface CompetitionData {
  competition: Competition | null;
  participants: Participant[];
  matches: CustomMatch[];
  loading: boolean;
  /** The code leads nowhere (deleted or mistyped). */
  missing: boolean;
  error: string;
}

/** The competition, its participants and its matches, kept live. */
export function useCompetition(cid: string): CompetitionData {
  const [state, setState] = useState<CompetitionData>({
    competition: null,
    participants: [],
    matches: [],
    loading: true,
    missing: false,
    error: "",
  });
  useEffect(() => {
    if (!cid || !db) {
      setState((s) => ({ ...s, loading: false, missing: !cid }));
      return;
    }
    setState({ competition: null, participants: [], matches: [], loading: true, missing: false, error: "" });
    const ref = competitionRef(cid);
    // Loaded once the competition and its matches have both arrived: a match
    // page must not say «not found» while the fixtures are still on the way.
    const seen = { competition: false, matches: false };
    const fail = (e: unknown) =>
      setState((s) => ({
        ...s,
        loading: false,
        error:
          (e as { code?: string })?.code === "permission-denied"
            ? "No tienes acceso a esta competición."
            : "No se pudo cargar la competición. Comprueba la conexión.",
      }));
    const stops = [
      onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            if (!snap.metadata.fromCache)
              setState((s) => ({ ...s, competition: null, loading: false, missing: true }));
            return;
          }
          const competition = decodeCompetition(snap.id, snap.data());
          seen.competition = true;
          setState((s) => ({ ...s, competition, loading: !seen.matches && Boolean(competition), missing: !competition }));
          if (competition) rememberCompetition(competition);
        },
        fail,
      ),
      onSnapshot(
        collection(ref, "participants"),
        (snap) =>
          setState((s) => ({
            ...s,
            participants: snap.docs
              .map((d) => decodeParticipant(d.id, d.data()))
              .sort((a, b) => a.seed - b.seed || a.name.localeCompare(b.name, "es")),
          })),
        fail,
      ),
      onSnapshot(
        collection(ref, "matches"),
        (snap) => {
          seen.matches = true;
          setState((s) => ({
            ...s,
            matches: snap.docs.map((d) => decodeMatch(d.id, d.data())).sort((a, b) => a.startAt - b.startAt),
            loading: s.loading && !seen.competition,
          }));
        },
        fail,
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [cid]);
  return state;
}

export interface Person {
  id: string;
  name: string;
  avatar: string | null;
}
/** Names and avatars of signed players (followers, administrators, predictors). */
export function usePeople(ids: string[]): Record<string, Person> {
  const [people, setPeople] = useState<Record<string, Person>>({});
  const key = [...new Set(ids)].sort().join();
  useEffect(() => {
    if (!db || !key) return;
    let active = true;
    Promise.all(
      key
        .split(",")
        .slice(0, 120)
        .map(async (uid): Promise<Person> => {
          try {
            const d = (await getDoc(doc(store(), "users", uid))).data();
            return {
              id: uid,
              name: typeof d?.name === "string" && d.name.trim() ? d.name.trim() : "Jugador",
              avatar: typeof d?.avatar === "string" ? d.avatar : null,
            };
          } catch {
            return { id: uid, name: "Jugador", avatar: null };
          }
        }),
    ).then((list) => active && setPeople(Object.fromEntries(list.map((p) => [p.id, p]))));
    return () => {
      active = false;
    };
  }, [key]);
  return people;
}

export interface CompetitionChip {
  id: string;
  name: string;
  icon: string | null;
}
function readRecent(): CompetitionChip[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.filter((c) => c && typeof c.id === "string" && typeof c.name === "string").slice(0, 12)
      : [];
  } catch {
    return [];
  }
}
/** Opened on this device: even without an account it stays one tap away. */
export function rememberCompetition(c: Pick<Competition, "id" | "name" | "icon">) {
  try {
    const next = [{ id: c.id, name: c.name, icon: c.icon }, ...readRecent().filter((r) => r.id !== c.id)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* Only a shortcut. */
  }
}
export function forgetCompetition(cid: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(readRecent().filter((r) => r.id !== cid)));
  } catch {
    /* Only a shortcut. */
  }
}

/** Competitions you follow (and those opened on this device), for the Ligas chips. */
export function useMyCompetitions(uid: string) {
  const [followed, setFollowed] = useState<CompetitionChip[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!uid || !db) {
      setFollowed([]);
      return;
    }
    return onSnapshot(
      query(collection(store(), COMPETITIONS_COLLECTION), where("memberIds", "array-contains", uid)),
      (snap) =>
        setFollowed(
          snap.docs
            .map((d) => decodeCompetition(d.id, d.data()))
            .filter((c): c is Competition => Boolean(c))
            .map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
        ),
      () => setFollowed([]),
    );
  }, [uid]);
  const recent = readRecent();
  const ids = new Set(followed.map((c) => c.id));
  return {
    competitions: [...followed, ...recent.filter((r) => !ids.has(r.id))],
    refresh: () => setVersion(version + 1),
  };
}

// ---------- Writing ----------

export interface NewParticipant {
  name: string;
  kind: ParticipantKind;
  userId: string | null;
  icon: string | null;
}

function fixtureData(f: Fixture, uid: string) {
  const { id: _id, startAt, ...rest } = f;
  return {
    ...rest,
    startAt: Timestamp.fromMillis(startAt),
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    homePenalties: null,
    awayPenalties: null,
    locked: false,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };
}
async function commitInBatches(writes: [DocumentReference, Record<string, unknown>][]) {
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = writeBatch(store());
    for (const [ref, data] of writes.slice(i, i + BATCH)) batch.set(ref, data);
    await batch.commit();
  }
}

/**
 * Creates the competition with its participants and every generated match.
 * The competition goes first so the rules can see you own it.
 */
export async function createCompetition(
  uid: string,
  setup: CompetitionSetup,
  entries: NewParticipant[],
): Promise<string> {
  const ref = doc(collection(store(), COMPETITIONS_COLLECTION));
  const participants: Participant[] = entries.map((e, seed) => ({
    id: doc(collection(ref, "participants")).id,
    name: e.name.trim(),
    kind: e.kind,
    userId: e.userId,
    icon: e.icon,
    seed,
  }));
  const fixtures = generateFixtures(setup, participants);
  const data = {
    name: setup.name.trim(),
    sport: setup.sport.trim(),
    icon: setup.icon,
    participantType: setup.participantType,
    format: setup.format,
    legs: setup.legs,
    knockoutLegs: setup.knockoutLegs,
    qualifiers: setup.qualifiers,
    groups: setup.groups,
    thirdPlace: setup.thirdPlace,
    predictionMode: setup.predictionMode,
    schedule: { ...setup.schedule, location: setup.schedule.location.trim() },
    ownerId: uid,
    adminIds: [],
    memberIds: [uid],
    formatVersion: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await withFreshCode((code) => {
    const batch = writeBatch(store());
    batch.set(ref, { ...data, code });
    batch.set(doc(store(), CODES_COLLECTION, code), { competitionId: ref.id, createdAt: serverTimestamp() });
    return batch.commit();
  });
  await commitInBatches([
    ...participants.map(({ id, ...p }): [DocumentReference, Record<string, unknown>] => [
      doc(ref, "participants", id),
      p,
    ]),
    ...fixtures.map((f): [DocumentReference, Record<string, unknown>] => [
      doc(ref, "matches", f.id),
      fixtureData(f, uid),
    ]),
  ]);
  rememberCompetition({ id: ref.id, name: setup.name.trim(), icon: setup.icon });
  return ref.id;
}

/**
 * Codes are random, so a clash with an existing one is rare: the rules refuse
 * to overwrite a code and we simply try another.
 */
async function withFreshCode(write: (code: string) => Promise<void>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write(randomCode());
    } catch (e) {
      if ((e as { code?: string })?.code !== "permission-denied" || attempt >= 4) throw e;
    }
  }
}

/** Owner: competitions created before short codes get theirs the first time. */
export async function ensureCompetitionCode(cid: string) {
  await withFreshCode((code) => {
    const batch = writeBatch(store());
    batch.update(competitionRef(cid), { code });
    batch.set(doc(store(), CODES_COLLECTION, code), { competitionId: cid, createdAt: serverTimestamp() });
    return batch.commit();
  });
}

/** The competition a short code points to, or null if there is none. */
export async function resolveCompetitionCode(code: string): Promise<string | null> {
  const snap = await getDoc(doc(store(), CODES_COLLECTION, code));
  const id = snap.data()?.competitionId;
  return typeof id === "string" ? id : null;
}

/** The invitation link: opens the competition directly, no lookup needed. */
export const competitionLink = (cid: string) => `${location.origin}${location.pathname}#/ligas?liga=${cid}`;

export async function followCompetition(uid: string, cid: string) {
  await updateDoc(competitionRef(cid), { memberIds: arrayUnion(uid) });
}
export async function unfollowCompetition(uid: string, cid: string) {
  await updateDoc(competitionRef(cid), {
    memberIds: arrayRemove(uid),
    adminIds: arrayRemove(uid),
  });
}

/** Owner only: name, sport, icon, prediction mode and administrators. */
export async function updateCompetition(
  cid: string,
  patch: Partial<Pick<Competition, "name" | "sport" | "icon" | "adminIds" | "predictionMode">>,
) {
  await updateDoc(competitionRef(cid), { ...patch, updatedAt: serverTimestamp() });
}

/** Admins: a whole match document (date, place, state, result, lock, report). */
export async function saveMatch(cid: string, match: CustomMatch, uid: string) {
  const { id, startAt, events, lineups, ...rest } = match;
  await setDoc(doc(competitionRef(cid), "matches", id), {
    ...rest,
    // An empty report is simply absent.
    ...(events?.length ? { events } : {}),
    ...(lineups ? { lineups } : {}),
    startAt: Timestamp.fromMillis(startAt),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}
/**
 * Waits a moment for the server. Without signal (a touchline) the write stays
 * queued and shows at once on this device, so the sheet can move on; a late
 * refusal undoes it on screen by itself.
 */
export async function settled(write: Promise<void>, wait = 2500) {
  write.catch(() => undefined);
  await Promise.race([write, new Promise((resolve) => window.setTimeout(resolve, wait))]);
}

/**
 * Admins: the report of a match (events and the score/state they imply, or
 * the lineups). Only these fields change, so a result edited meanwhile stays.
 */
export async function saveMatchReport(
  cid: string,
  mid: string,
  patch: Partial<Pick<CustomMatch, "status" | "homeScore" | "awayScore">> & {
    events?: MatchEvent[];
    lineups?: MatchLineups | null;
  },
  uid: string,
) {
  const { lineups, ...rest } = patch;
  await updateDoc(doc(competitionRef(cid), "matches", mid), {
    ...rest,
    ...(lineups !== undefined ? { lineups: lineups ?? deleteField() } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}
export async function addFixtures(cid: string, fixtures: Fixture[], uid: string) {
  await commitInBatches(
    fixtures.map((f): [DocumentReference, Record<string, unknown>] => [
      doc(competitionRef(cid), "matches", f.id),
      fixtureData(f, uid),
    ]),
  );
}
export async function deleteMatch(cid: string, mid: string) {
  await deleteDoc(doc(competitionRef(cid), "matches", mid));
}
export const newMatchId = (cid: string) => doc(collection(competitionRef(cid), "matches")).id;
export const newParticipantId = (cid: string) => doc(collection(competitionRef(cid), "participants")).id;

export async function saveParticipant(cid: string, p: Participant) {
  const { id, players, ...rest } = p;
  await setDoc(doc(competitionRef(cid), "participants", id), {
    ...rest,
    ...(players?.length ? { players } : {}),
    name: rest.name.trim(),
  });
}
export async function deleteParticipant(cid: string, pid: string) {
  await deleteDoc(doc(competitionRef(cid), "participants", pid));
}

/** Owner: matches and participants first, then the code and the competition. */
export async function deleteCompetition(
  cid: string,
  participantIds: string[],
  matchIds: string[],
  code: string | null | undefined,
) {
  const rounds = await getDocs(collection(competitionRef(cid), "rounds")).catch(() => null);
  const refs = [
    ...matchIds.map((id) => doc(competitionRef(cid), "matches", id)),
    ...participantIds.map((id) => doc(competitionRef(cid), "participants", id)),
    ...(rounds?.docs.map((d) => d.ref) || []),
  ];
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = writeBatch(store());
    for (const ref of refs.slice(i, i + BATCH)) batch.delete(ref);
    await batch.commit();
  }
  const last = writeBatch(store());
  last.delete(competitionRef(cid));
  if (code) last.delete(doc(store(), CODES_COLLECTION, code));
  await last.commit();
  forgetCompetition(cid);
  forgetEntries(cid);
}

/**
 * A picked photo as a small square image (data URL) stored inside the
 * competition: no file storage needed, and it loads with the rest.
 */
export async function shrinkImage(file: File, size = 160, max = MAX_ICON_CHARS): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Elige una imagen.");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar la imagen.");
  // Cover crop from the centre, like an app icon.
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();
  for (const [type, quality] of [
    ["image/webp", 0.85],
    ["image/jpeg", 0.85],
    ["image/jpeg", 0.6],
  ] as const) {
    const url = canvas.toDataURL(type, quality);
    if (url.startsWith(`data:${type}`) && url.length <= max) return url;
  }
  throw new Error("La imagen es demasiado pesada. Prueba con otra.");
}

/** Participants of another competition, to reuse them in a new one. */
export async function loadCompetitionParticipants(cid: string): Promise<Participant[]> {
  const snap = await getDocs(collection(competitionRef(cid), "participants"));
  return snap.docs.map((d) => decodeParticipant(d.id, d.data())).sort((a, b) => a.seed - b.seed);
}

// ---------- Predictions ----------

const pickRef = (cid: string, mid: string, uid: string) => doc(competitionRef(cid), "matches", mid, "picks", uid);

/** Yours, before kick-off: the rules check the time, the mode and that you follow it. */
export async function savePick(cid: string, mid: string, uid: string, value: string) {
  await setDoc(pickRef(cid, mid, uid), { value, updatedAt: serverTimestamp() });
}
export async function deletePick(cid: string, mid: string, uid: string) {
  await deleteDoc(pickRef(cid, mid, uid));
}
/** Your picks for matches that haven't started (nobody else can read them yet). */
export async function loadMyPicks(cid: string, mids: string[], uid: string): Promise<Record<string, string>> {
  const pairs = await Promise.all(
    mids.map(async (mid) => {
      const snap = await getDoc(pickRef(cid, mid, uid));
      const value = snap.data()?.value;
      return typeof value === "string" ? ([mid, value] as const) : null;
    }),
  );
  return Object.fromEntries(pairs.filter((p): p is readonly [string, string] => p !== null));
}

// ---------- Rounds and sealed slips (the quiniela, as in LaLiga) ----------

const roundRef = (cid: string, rk: string) => doc(competitionRef(cid), "rounds", rk);
const entryRef = (cid: string, rk: string, uid: string) => doc(roundRef(cid, rk), "entries", uid);
const attendanceRef = (cid: string, rk: string) => doc(competitionRef(cid), "roundAttendance", rk);
const ENTRIES_KEY = (cid: string) => `galacticbet:competition-entries:v1:${cid}`;

/** Each round's deadline (first kick-off) and the matches its slip asks for. */
export function useCompetitionRounds(cid: string): RoundDocs | null {
  const [rounds, setRounds] = useState<{ cid: string; docs: RoundDocs } | null>(null);
  useEffect(() => {
    if (!cid || !db) return;
    return onSnapshot(
      collection(competitionRef(cid), "rounds"),
      (snap) => {
        const docs: RoundDocs = {};
        for (const d of snap.docs) {
          const data = d.data();
          if (data.deadline instanceof Timestamp && Array.isArray(data.matchIds))
            docs[d.id] = {
              deadline: data.deadline.toMillis(),
              matchIds: data.matchIds.filter((id: unknown): id is string => typeof id === "string"),
            };
        }
        // A cached first answer may miss rounds: wait for the server's.
        if (!snap.metadata.fromCache || snap.docs.length) setRounds({ cid, docs });
      },
      () => setRounds({ cid, docs: {} }),
    );
  }, [cid]);
  return rounds && rounds.cid === cid ? rounds.docs : null;
}

/**
 * The organisers' app keeps the rounds in step with the calendar and the
 * results (a new match, a moved date, a knockout side now known), like the
 * backend does for LaLiga. Closed rounds are never touched.
 */
export function useRoundsSync(
  competition: Pick<Competition, "id" | "ownerId" | "adminIds" | "predictionMode"> | null,
  view: Pick<CompetitionView, "matches"> | null,
  rounds: RoundDocs | null,
  uid: string,
) {
  const tried = useRef("");
  const runs = Boolean(competition && uid && (competition.ownerId === uid || competition.adminIds.includes(uid)));
  useEffect(() => {
    if (!competition || !view || !rounds || !runs || competition.predictionMode === "off") return;
    const { write, remove } = roundChanges(roundPlans(view), rounds, Date.now());
    if (!write.length && !remove.length) return;
    const signature = JSON.stringify([competition.id, write, remove]);
    // One attempt per change: a refused write doesn't loop.
    if (tried.current === signature) return;
    tried.current = signature;
    const batch = writeBatch(store());
    for (const plan of write)
      batch.set(roundRef(competition.id, plan.id), {
        deadline: Timestamp.fromMillis(plan.deadline),
        matchIds: plan.matchIds,
        updatedAt: serverTimestamp(),
      });
    for (const id of remove) batch.delete(roundRef(competition.id, id));
    batch.commit().catch(() => undefined);
  }, [competition, view, rounds, runs]);
}

/** Your sealed slip for a round (null if you haven't sealed it). */
export function useMyEntry(cid: string, rk: string, uid: string) {
  const [state, setState] = useState<{ key: string; picks: Record<string, PredictionValue> | null } | null>(null);
  const key = `${cid}:${rk}:${uid}`;
  useEffect(() => {
    if (!cid || !rk || !uid || !db) return setState({ key, picks: null });
    return onSnapshot(
      entryRef(cid, rk, uid),
      (snap) => {
        if (snap.metadata.fromCache && !snap.exists()) return;
        setState({ key, picks: snap.exists() ? readEntry(snap.data()) : null });
      },
      () => setState({ key, picks: null }),
    );
  }, [cid, rk, uid, key]);
  return state && state.key === key ? { loading: false, picks: state.picks } : { loading: true, picks: null };
}

/**
 * Everyone's sealed slips for a round: readable once you have sealed yours or
 * once the round has closed. Null while loading (or not yet readable).
 */
export function useRoundEntries(cid: string, rk: string, enabled: boolean) {
  const [state, setState] = useState<{ key: string; entries: Record<string, Record<string, PredictionValue>> } | null>(
    null,
  );
  const key = `${cid}:${rk}`;
  useEffect(() => {
    if (!enabled || !cid || !rk || !db) return;
    return onSnapshot(
      collection(roundRef(cid, rk), "entries"),
      (snap) => {
        const entries: Record<string, Record<string, PredictionValue>> = {};
        for (const d of snap.docs) {
          const picks = readEntry(d.data());
          if (picks) entries[d.id] = picks;
        }
        setState({ key, entries });
      },
      () => setState({ key, entries: {} }),
    );
  }, [cid, rk, key, enabled]);
  return enabled && state && state.key === key ? state.entries : null;
}

/** Who has sealed the round (never what): for «faltan por sellar». */
export function useRoundAttendance(cid: string, rk: string) {
  const [state, setState] = useState<{ key: string; ids: string[] } | null>(null);
  const key = `${cid}:${rk}`;
  useEffect(() => {
    if (!cid || !rk || !db) return;
    return onSnapshot(
      attendanceRef(cid, rk),
      (snap) => setState({ key, ids: Object.keys(snap.data()?.members || {}) }),
      () => setState({ key, ids: [] }),
    );
  }, [cid, rk, key]);
  return state && state.key === key ? { ready: true, ids: state.ids } : { ready: false, ids: [] as string[] };
}

/**
 * Seals the round: a complete, unchangeable slip with a pick for every match
 * the round asks for, before its deadline. The rules check all of it again.
 */
export async function sealCustomRound(
  cid: string,
  rk: string,
  uid: string,
  mode: "classic" | "exact",
  picks: Record<string, PredictionValue>,
) {
  const s = store();
  await runTransaction(s, async (t) => {
    const [mine, round] = await Promise.all([t.get(entryRef(cid, rk, uid)), t.get(roundRef(cid, rk))]);
    if (mine.exists()) throw new Error("Este boleto ya está sellado.");
    const data = round.data();
    if (!data || !(data.deadline instanceof Timestamp) || data.deadline.toMillis() <= Date.now())
      throw new Error("El plazo de esta jornada ya se cerró.");
    const matchIds = (data.matchIds || []) as string[];
    const expected = Object.fromEntries(matchIds.map((id) => [id, picks[id]]));
    if (!validDeliveredPicks(mode, matchIds, expected))
      throw new Error("Completa todos los partidos de esta jornada antes de sellar.");
    t.set(entryRef(cid, rk, uid), {
      userId: uid,
      submittedAt: serverTimestamp(),
      ...encodeDelivery(mode, matchIds, expected),
    });
    t.set(attendanceRef(cid, rk), { members: { [uid]: serverTimestamp() } }, { merge: true });
  });
}

type EntryCache = Record<string, { t: number; e: Record<string, string> }>;
function readEntryCache(cid: string): EntryCache {
  try {
    const raw = JSON.parse(localStorage.getItem(ENTRIES_KEY(cid)) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
function forgetEntries(cid: string) {
  try {
    localStorage.removeItem(ENTRIES_KEY(cid));
    localStorage.removeItem(`galacticbet:competition-picks:v1:${cid}`);
  } catch {
    /* Only a cache. */
  }
}

/**
 * Every sealed slip of the rounds that have closed, for the tables. A closed
 * round's slips can't change (no slip is accepted after the deadline), so each
 * round is fetched once and kept on this device.
 */
export async function loadClosedEntries(
  cid: string,
  rounds: { id: string; deadline: number }[],
): Promise<Record<string, Record<string, Record<string, PredictionValue>>>> {
  const cache = readEntryCache(cid);
  const out: Record<string, Record<string, Record<string, PredictionValue>>> = {};
  const decode = (raw: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(raw).flatMap(([uid, json]) => {
        try {
          const picks = readEntry(JSON.parse(json));
          return picks ? [[uid, picks]] : [];
        } catch {
          return [];
        }
      }),
    );
  const missing = rounds.filter((r) => {
    const hit = cache[r.id];
    if (hit && hit.t === r.deadline) {
      out[r.id] = decode(hit.e);
      return false;
    }
    return true;
  });
  const fetched = await Promise.all(
    missing.map(async (r) => {
      try {
        const snap = await getDocs(collection(roundRef(cid, r.id), "entries"));
        const raw: Record<string, string> = {};
        for (const d of snap.docs) {
          const { matchIds, selections, mode } = d.data();
          raw[d.id] = JSON.stringify({ matchIds, selections, mode });
        }
        return { r, raw, complete: !snap.metadata.fromCache };
      } catch {
        // Not closed yet by the server's clock, or offline: next time.
        return null;
      }
    }),
  );
  const keep = new Set(rounds.map((r) => r.id));
  const next: EntryCache = Object.fromEntries(Object.entries(cache).filter(([id]) => keep.has(id)));
  for (const f of fetched) {
    if (!f) continue;
    out[f.r.id] = decode(f.raw);
    if (f.complete) next[f.r.id] = { t: f.r.deadline, e: f.raw };
  }
  try {
    localStorage.setItem(ENTRIES_KEY(cid), JSON.stringify(next));
  } catch {
    /* Only a cache. */
  }
  return out;
}

// ---------- Porra rápida ----------

export interface CompetitionFixtures {
  id: string;
  name: string;
  matches: Match[];
}
/** Matches of friends' competitions carry this prefix in the porra: never confused with a league fixture. */
export const customFixtureId = (cid: string, mid: string) => `c:${cid}:${mid}`;

/**
 * Upcoming matches (both sides known) of the competitions you follow, as
 * ordinary fixtures for the porra rápida. One read per competition.
 */
export async function loadFollowedFixtures(uid: string, now = Date.now()): Promise<CompetitionFixtures[]> {
  if (!db || !uid) return [];
  const snap = await getDocs(
    query(collection(store(), COMPETITIONS_COLLECTION), where("memberIds", "array-contains", uid)),
  );
  const competitions = snap.docs
    .map((d) => decodeCompetition(d.id, d.data()))
    .filter((c): c is Competition => Boolean(c))
    .slice(0, 12);
  const out = await Promise.all(
    competitions.map(async (c): Promise<CompetitionFixtures> => {
      const ref = competitionRef(c.id);
      const [people, games] = await Promise.all([
        getDocs(collection(ref, "participants")),
        getDocs(collection(ref, "matches")),
      ]);
      const view = resolveCompetition(
        c,
        people.docs.map((d) => decodeParticipant(d.id, d.data())),
        games.docs.map((d) => decodeMatch(d.id, d.data())),
      );
      const matches = view.matches
        .filter(
          (m) =>
            m.status === "scheduled" &&
            m.startAt > now &&
            m.home.id &&
            m.away.id &&
            !m.home.pending &&
            !m.away.pending,
        )
        .sort((a, b) => a.startAt - b.startAt)
        .slice(0, 30)
        .map((m) => ({ ...toAppMatch(c.id, m), id: customFixtureId(c.id, m.id) }));
      return { id: c.id, name: c.name, matches };
    }),
  );
  return out.filter((c) => c.matches.length);
}
