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
import type { Match } from "./domain";
import {
  generateFixtures,
  isCode,
  MAX_ICON_CHARS,
  randomCode,
  resolveCompetition,
  toAppMatch,
  type Competition,
  type CompetitionSetup,
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
  const refs = [
    ...matchIds.map((id) => doc(competitionRef(cid), "matches", id)),
    ...participantIds.map((id) => doc(competitionRef(cid), "participants", id)),
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
  forgetPicks(cid);
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
const PICKS_KEY = (cid: string) => `galacticbet:competition-picks:v1:${cid}`;

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

type PickCache = Record<string, { t: number; p: Record<string, string> }>;
function readPickCache(cid: string): PickCache {
  try {
    const raw = JSON.parse(localStorage.getItem(PICKS_KEY(cid)) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
function forgetPicks(cid: string) {
  try {
    localStorage.removeItem(PICKS_KEY(cid));
  } catch {
    /* Only a cache. */
  }
}

/**
 * Everyone's picks for matches that have started. Once a match kicks off its
 * picks can't change (the rules refuse late ones), so each match is fetched
 * once and kept on this device; a rescheduled match is fetched again.
 */
export async function loadStartedPicks(
  cid: string,
  matches: Pick<CustomMatch, "id" | "startAt">[],
  { prune = true } = {},
): Promise<Record<string, Record<string, string>>> {
  const cache = readPickCache(cid);
  const out: Record<string, Record<string, string>> = {};
  const missing: Pick<CustomMatch, "id" | "startAt">[] = [];
  for (const m of matches) {
    const hit = cache[m.id];
    if (hit && hit.t === m.startAt) out[m.id] = hit.p;
    else missing.push(m);
  }
  const fetched = await Promise.all(
    missing.map(async (m) => {
      try {
        const snap = await getDocs(collection(competitionRef(cid), "matches", m.id, "picks"));
        // A cached-only answer (offline) may be incomplete: show it but don't keep it.
        const picks: Record<string, string> = {};
        for (const d of snap.docs) if (typeof d.data().value === "string") picks[d.id] = d.data().value;
        return { m, picks, complete: !snap.metadata.fromCache };
      } catch {
        // Not started yet by the server's clock, or offline: try again later.
        return null;
      }
    }),
  );
  // With the full list of started matches, entries of deleted matches go away.
  const keep = new Set(matches.map((m) => m.id));
  const next: PickCache = prune ? Object.fromEntries(Object.entries(cache).filter(([id]) => keep.has(id))) : cache;
  for (const f of fetched) {
    if (!f) continue;
    out[f.m.id] = f.picks;
    if (f.complete) next[f.m.id] = { t: f.m.startAt, p: f.picks };
  }
  try {
    localStorage.setItem(PICKS_KEY(cid), JSON.stringify(next));
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
