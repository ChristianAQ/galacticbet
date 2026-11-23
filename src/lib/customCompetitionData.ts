import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
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
import { useEffect, useState } from "react";
import { db } from "./firebase";
import {
  generateFixtures,
  MAX_ICON_CHARS,
  type Competition,
  type CompetitionSetup,
  type CustomMatch,
  type Fixture,
  type MatchStatus,
  type Participant,
  type ParticipantKind,
} from "./customCompetition";

/**
 * Firestore access for competitions between friends. The rules decide who may
 * write; these helpers only shape documents the rules accept.
 */
export const COMPETITIONS_COLLECTION = "customCompetitions";
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
          setState((s) => ({ ...s, competition, loading: false, missing: !competition }));
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
        (snap) =>
          setState((s) => ({
            ...s,
            matches: snap.docs.map((d) => decodeMatch(d.id, d.data())).sort((a, b) => a.startAt - b.startAt),
          })),
        fail,
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [cid]);
  return state;
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
  await setDoc(ref, {
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

/** Admins: a whole match document (date, place, state, result, lock). */
export async function saveMatch(cid: string, match: CustomMatch, uid: string) {
  const { id, startAt, ...rest } = match;
  await setDoc(doc(competitionRef(cid), "matches", id), {
    ...rest,
    startAt: Timestamp.fromMillis(startAt),
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
  const { id, ...rest } = p;
  await setDoc(doc(competitionRef(cid), "participants", id), { ...rest, name: rest.name.trim() });
}
export async function deleteParticipant(cid: string, pid: string) {
  await deleteDoc(doc(competitionRef(cid), "participants", pid));
}

/** Owner: matches and participants first, then the competition itself. */
export async function deleteCompetition(cid: string, participantIds: string[], matchIds: string[]) {
  const refs = [
    ...matchIds.map((id) => doc(competitionRef(cid), "matches", id)),
    ...participantIds.map((id) => doc(competitionRef(cid), "participants", id)),
  ];
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = writeBatch(store());
    for (const ref of refs.slice(i, i + BATCH)) batch.delete(ref);
    await batch.commit();
  }
  await deleteDoc(competitionRef(cid));
  forgetCompetition(cid);
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
  const { getDocs } = await import("firebase/firestore");
  const snap = await getDocs(collection(competitionRef(cid), "participants"));
  return snap.docs.map((d) => decodeParticipant(d.id, d.data())).sort((a, b) => a.seed - b.seed);
}
