import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const C = "customCompetitions/c1";
const competition = (owner = "alice") => ({
  name: "Liga de los sábados",
  sport: "Fútbol 7",
  icon: null,
  participantType: "team",
  format: "league",
  legs: 1,
  knockoutLegs: 1,
  qualifiers: 0,
  groups: 0,
  thirdPlace: false,
  predictionMode: "exact",
  schedule: {
    start: "2026-11-28",
    time: "10:00",
    everyDays: 7,
    slotMinutes: 60,
    location: "Polideportivo",
    timeZone: "Europe/Madrid",
  },
  ownerId: owner,
  adminIds: [],
  memberIds: [owner],
  formatVersion: 1,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});
const match = (uid: string, over: Record<string, unknown> = {}) => ({
  phase: "league",
  round: 1,
  stage: "REGULAR_SEASON",
  group: null,
  tie: null,
  leg: null,
  homeId: "p1",
  awayId: "p2",
  homeSlot: null,
  awaySlot: null,
  startAt: Timestamp.fromMillis(Date.parse("2026-11-28T09:00:00Z")),
  location: "Polideportivo",
  status: "scheduled",
  homeScore: null,
  awayScore: null,
  homePenalties: null,
  awayPenalties: null,
  locked: false,
  updatedAt: serverTimestamp(),
  updatedBy: uid,
  ...over,
});
const participant = { name: "Rayo", kind: "team", userId: null, icon: null, seed: 0 };

describe.skipIf(!enabled)("Competiciones entre amigos: permisos en Firestore", () => {
  let env: RulesTestEnvironment;
  const as = (uid: string | null): Firestore =>
    (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "demo-galacticbet-competitions",
      firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
    });
  });
  afterAll(async () => {
    await env.cleanup();
  });
  beforeEach(async () => {
    await env.clearFirestore();
    // alice owns it, bob administers it, carol follows it, dave has only the code.
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, C), {
        ...competition(),
        adminIds: ["bob"],
        memberIds: ["alice", "bob", "carol"],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await setDoc(doc(db, `${C}/participants/p1`), participant);
      await setDoc(doc(db, `${C}/matches/m1`), { ...match("alice"), updatedAt: Timestamp.now() });
    });
  });

  it("crear: solo como propietario, con campos válidos y sin colar a nadie", async () => {
    const alice = as("alice");
    await assertSucceeds(setDoc(doc(alice, "customCompetitions/new"), competition()));
    await assertFails(setDoc(doc(as(null), "customCompetitions/x"), competition()));
    await assertFails(setDoc(doc(alice, "customCompetitions/x2"), competition("bob")));
    await assertFails(setDoc(doc(alice, "customCompetitions/x3"), { ...competition(), memberIds: ["alice", "bob"] }));
    await assertFails(setDoc(doc(alice, "customCompetitions/x4"), { ...competition(), adminIds: ["bob"] }));
    await assertFails(setDoc(doc(alice, "customCompetitions/x5"), { ...competition(), name: "AB" }));
    await assertFails(setDoc(doc(alice, "customCompetitions/x6"), { ...competition(), format: "bracket" }));
    await assertFails(setDoc(doc(alice, "customCompetitions/x7"), { ...competition(), extra: 1 }));
    await assertFails(
      setDoc(doc(alice, "customCompetitions/x8"), { ...competition(), icon: "https://evil.test/a.png" }),
    );
    await assertSucceeds(
      setDoc(doc(alice, "customCompetitions/x9"), { ...competition(), icon: "data:image/webp;base64,UklGRg==" }),
    );
  });

  it("con el código se ve todo sin cuenta, pero nadie puede listar competiciones ajenas", async () => {
    const dave = as(null);
    await assertSucceeds(getDoc(doc(dave, C)));
    await assertSucceeds(getDocs(collection(dave, `${C}/participants`)));
    await assertSucceeds(getDocs(collection(dave, `${C}/matches`)));
    await assertFails(getDocs(collection(dave, "customCompetitions")));
    await assertFails(getDocs(collection(as("dave"), "customCompetitions")));
    await assertSucceeds(
      getDocs(query(collection(as("carol"), "customCompetitions"), where("memberIds", "array-contains", "carol"))),
    );
  });

  it("visibilidad: solo las públicas se buscan; la privada solo con su código o enlace", async () => {
    const alice = as("alice");
    const dave = as("dave");
    const search = (db: Firestore, term?: string) =>
      getDocs(
        query(
          collection(db, "customCompetitions"),
          where("visibility", "==", "public"),
          ...(term ? [where("searchTerms", "array-contains", term)] : []),
        ),
      );
    // Private (or from before visibility): nobody can search it.
    await assertFails(getDocs(query(collection(dave, "customCompetitions"), where("visibility", "==", "private"))));
    await assertSucceeds(
      setDoc(doc(alice, "customCompetitions/pub"), {
        ...competition(),
        visibility: "public",
        searchTerms: ["l", "li", "lig", "liga"],
      }),
    );
    await assertSucceeds(
      setDoc(doc(alice, "customCompetitions/priv"), { ...competition(), visibility: "private", searchTerms: [] }),
    );
    await assertFails(setDoc(doc(alice, "customCompetitions/bad"), { ...competition(), visibility: "secret" }));
    await assertFails(
      setDoc(doc(alice, "customCompetitions/bad2"), {
        ...competition(),
        searchTerms: Array.from({ length: 121 }, (_, i) => `t${i}`),
      }),
    );
    // Signed in, anyone finds the public ones; without an account, nobody.
    const found = await assertSucceeds(search(dave, "liga"));
    if (found.docs.map((d) => d.id).join() !== "pub") throw new Error("Solo debía encontrar la pública");
    await assertSucceeds(search(dave));
    await assertFails(search(as(null)));
    // Still opens by link, and following it is only adding yourself.
    await assertSucceeds(getDoc(doc(dave, "customCompetitions/priv")));
    await assertSucceeds(updateDoc(doc(dave, "customCompetitions/pub"), { memberIds: arrayUnion("dave") }));
    // Only the owner changes it.
    await assertSucceeds(
      updateDoc(doc(alice, C), { visibility: "public", searchTerms: ["l"], updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(as("bob"), C), { visibility: "private", searchTerms: [], updatedAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(doc(dave, C), { visibility: "private" }));
  });

  it("seguir y dejar de seguir: cada uno solo a sí mismo", async () => {
    await assertSucceeds(updateDoc(doc(as("dave"), C), { memberIds: arrayUnion("dave") }));
    await assertFails(updateDoc(doc(as("erin"), C), { memberIds: arrayUnion("erin", "frank") }));
    await assertFails(updateDoc(doc(as("carol"), C), { memberIds: arrayRemove("bob") }));
    await assertFails(updateDoc(doc(as(null), C), { memberIds: arrayUnion("ghost") }));
    await assertSucceeds(updateDoc(doc(as("bob"), C), { memberIds: arrayRemove("bob"), adminIds: arrayRemove("bob") }));
    // The owner cannot walk out of their own competition.
    await assertFails(updateDoc(doc(as("alice"), C), { memberIds: arrayRemove("alice") }));
  });

  it("solo el propietario cambia la configuración y nombra administradores entre los seguidores", async () => {
    const at = { updatedAt: serverTimestamp() };
    await assertSucceeds(updateDoc(doc(as("alice"), C), { adminIds: ["bob", "carol"], ...at }));
    await assertFails(updateDoc(doc(as("alice"), C), { adminIds: ["dave"], ...at }));
    await assertFails(updateDoc(doc(as("bob"), C), { name: "Mía", ...at }));
    await assertFails(updateDoc(doc(as("bob"), C), { adminIds: ["bob", "carol"], ...at }));
    await assertFails(updateDoc(doc(as("alice"), C), { format: "knockout", ...at }));
    await assertSucceeds(updateDoc(doc(as("alice"), C), { name: "Liga de invierno", ...at }));
  });

  it("participantes y calendario: propietario y administradores, nadie más", async () => {
    await assertSucceeds(setDoc(doc(as("bob"), `${C}/participants/p2`), { ...participant, name: "Sol" }));
    await assertFails(setDoc(doc(as("carol"), `${C}/participants/p3`), participant));
    await assertFails(setDoc(doc(as("bob"), `${C}/participants/p4`), { ...participant, kind: "club" }));
    await assertFails(setDoc(doc(as("bob"), `${C}/participants/p5`), { ...participant, name: "" }));
    await assertSucceeds(setDoc(doc(as("bob"), `${C}/matches/m2`), match("bob")));
    await assertFails(setDoc(doc(as("carol"), `${C}/matches/m3`), match("carol")));
    await assertFails(setDoc(doc(as("bob"), `${C}/matches/m4`), match("alice")));
    await assertFails(setDoc(doc(as("bob"), `${C}/matches/m5`), match("bob", { awayId: "p1" })));
    await assertFails(setDoc(doc(as("bob"), `${C}/matches/m6`), match("bob", { homeId: null, homeSlot: "nowhere" })));
    await assertSucceeds(
      setDoc(doc(as("bob"), `${C}/matches/m7`), match("bob", { phase: "knockout", stage: "FINAL", tie: "F", homeId: null, homeSlot: "winner:S1" })),
    );
    await assertFails(setDoc(doc(as("bob"), `${C}/matches/m8`), match("bob", { locked: true })));
  });

  it("plantillas y acta del partido: solo la organización, con tamaños acotados", async () => {
    const players = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `j${i}`, name: `Jugador ${i}`, number: i, position: "MED" }));
    await assertSucceeds(setDoc(doc(as("bob"), `${C}/participants/p1`), { ...participant, players: players(18) }));
    await assertFails(setDoc(doc(as("carol"), `${C}/participants/p1`), { ...participant, players: players(18) }));
    await assertFails(setDoc(doc(as("bob"), `${C}/participants/p1`), { ...participant, players: players(61) }));
    await assertFails(setDoc(doc(as("bob"), `${C}/participants/p1`), { ...participant, players: "Pedro" }));
    const goal = { id: "e1", kind: "goal", side: "home", minute: 38, extra: null, player: "Pedro", playerId: "j1", other: null, otherId: null };
    const lineups = { home: [{ ...players(1)[0], starter: true }], away: [] };
    const live = { status: "live", homeScore: 1, awayScore: 0 };
    await assertSucceeds(setDoc(doc(as("bob"), `${C}/matches/m1`), match("bob", { ...live, events: [goal], lineups })));
    // The report alone, as the match page saves it.
    await assertSucceeds(
      updateDoc(doc(as("bob"), `${C}/matches/m1`), { events: [goal, { ...goal, id: "e2" }], homeScore: 2, updatedAt: serverTimestamp(), updatedBy: "bob" }),
    );
    await assertFails(
      updateDoc(doc(as("carol"), `${C}/matches/m1`), { events: [], updatedAt: serverTimestamp(), updatedBy: "carol" }),
    );
    await assertFails(setDoc(doc(as("bob"), `${C}/matches/m1`), match("bob", { ...live, events: Array(151).fill(goal) })));
    await assertFails(setDoc(doc(as("bob"), `${C}/matches/m1`), match("bob", { ...live, events: goal })));
    await assertFails(setDoc(doc(as("bob"), `${C}/matches/m1`), match("bob", { ...live, lineups: { home: [], bench: [] } })));
    await assertFails(setDoc(doc(as("bob"), `${C}/matches/m1`), match("bob", { ...live, lineups: { home: players(41) } })));
  });

  it("resultados coherentes con el estado del partido", async () => {
    const save = (over: Record<string, unknown>) => setDoc(doc(as("bob"), `${C}/matches/m1`), match("bob", over));
    await assertSucceeds(save({ status: "finished", homeScore: 2, awayScore: 1 }));
    await assertSucceeds(save({ status: "live", homeScore: 0, awayScore: 0 }));
    await assertFails(save({ status: "finished", homeScore: null, awayScore: null }));
    await assertFails(save({ status: "scheduled", homeScore: 1, awayScore: 0 }));
    await assertFails(save({ status: "finished", homeScore: -1, awayScore: 0 }));
    await assertFails(save({ status: "finished", homeScore: 1.5, awayScore: 0 }));
    await assertFails(save({ status: "suspended" }));
    // Penalties: knockout only, finished, with a winner.
    await assertFails(save({ status: "finished", homeScore: 1, awayScore: 1, homePenalties: 4, awayPenalties: 3 }));
    const ko = { phase: "knockout", stage: "FINAL", tie: "F", status: "finished", homeScore: 1, awayScore: 1 };
    await assertSucceeds(save({ ...ko, homePenalties: 4, awayPenalties: 3 }));
    await assertFails(save({ ...ko, homePenalties: 3, awayPenalties: 3 }));
    await assertFails(save({ ...ko, homePenalties: 3, awayPenalties: null }));
    await assertSucceeds(save({ status: "postponed", startAt: Timestamp.fromMillis(Date.parse("2026-12-05T09:00:00Z")) }));
    await assertSucceeds(save({ status: "cancelled" }));
  });

  it("un resultado confirmado solo lo cambia o lo desbloquea el propietario", async () => {
    const save = (uid: string, over: Record<string, unknown>) =>
      setDoc(doc(as(uid), `${C}/matches/m1`), match(uid, { status: "finished", homeScore: 2, awayScore: 1, ...over }));
    await assertSucceeds(save("bob", { locked: true }));
    await assertFails(save("bob", { locked: true, homeScore: 3 }));
    await assertFails(save("bob", { locked: false }));
    await assertFails(deleteDoc(doc(as("bob"), `${C}/matches/m1`)));
    await assertSucceeds(save("alice", { locked: true, homeScore: 3 }));
    await assertSucceeds(save("alice", { locked: false }));
    await assertSucceeds(save("bob", { homeScore: 4 }));
    // Admins cannot delete a played match either; the owner can.
    await assertFails(deleteDoc(doc(as("bob"), `${C}/matches/m1`)));
    await assertSucceeds(deleteDoc(doc(as("alice"), `${C}/matches/m1`)));
  });

  it("crea una competición completa en lotes grandes y la borra entera", async () => {
    const alice = as("alice");
    await assertSucceeds(setDoc(doc(alice, "customCompetitions/big"), competition()));
    const batch = writeBatch(alice);
    for (let i = 0; i < 120; i++) batch.set(doc(alice, `customCompetitions/big/matches/L${i}`), match("alice"));
    for (let i = 0; i < 20; i++) batch.set(doc(alice, `customCompetitions/big/participants/p${i}`), { ...participant, seed: i });
    await assertSucceeds(batch.commit());
    await assertFails(deleteDoc(doc(as("bob"), C)));
    const wipe = writeBatch(alice);
    for (let i = 0; i < 120; i++) wipe.delete(doc(alice, `customCompetitions/big/matches/L${i}`));
    await assertSucceeds(wipe.commit());
    await assertSucceeds(deleteDoc(doc(alice, "customCompetitions/big")));
  });

  // ---------- Short codes ----------
  const withCode = (code: string, owner = "alice") => ({ ...competition(owner), code });
  const claim = (db: Firestore, code: string, cid: string) =>
    setDoc(doc(db, `competitionCodes/${code}`), { competitionId: cid, createdAt: serverTimestamp() });

  it("código corto: se crea junto a la competición, es único y no se puede robar", async () => {
    const alice = as("alice");
    const create = (cid: string, code: string, owner = alice, ownerId = "alice") => {
      const batch = writeBatch(owner);
      batch.set(doc(owner, `customCompetitions/${cid}`), withCode(code, ownerId));
      batch.set(doc(owner, `competitionCodes/${code}`), { competitionId: cid, createdAt: serverTimestamp() });
      return batch.commit();
    };
    await assertSucceeds(create("n1", "K7M2QX"));
    // Anyone resolves a code; nobody lists them.
    await assertSucceeds(getDoc(doc(as(null), "competitionCodes/K7M2QX")));
    await assertFails(getDocs(collection(as("carol"), "competitionCodes")));
    // Taken: the rules never overwrite a code (the app retries with another).
    await assertFails(create("n2", "K7M2QX", as("bob"), "bob"));
    // Only the alphabet without 0/O/1/I/L, six characters.
    await assertFails(create("n3", "K0M2QX"));
    await assertFails(create("n4", "K7M2Q"));
    // A code must point to a competition you own that names the same code.
    await assertFails(claim(as("bob"), "BBBBBB", "n1"));
    await assertFails(claim(alice, "CCCCCC", "n1"));
    // The competition can't name a code that points elsewhere.
    await assertFails(setDoc(doc(alice, "customCompetitions/n5"), withCode("K7M2QX")));
    // And a code can't be edited.
    await assertFails(updateDoc(doc(alice, "competitionCodes/K7M2QX"), { competitionId: "c1" }));
    await assertFails(updateDoc(doc(alice, "customCompetitions/n1"), { code: "DDDDDD" }));
  });

  it("código corto para competiciones de antes: solo el propietario y una vez", async () => {
    const give = (uid: string, code: string) => {
      const db = as(uid);
      const batch = writeBatch(db);
      batch.update(doc(db, C), { code });
      batch.set(doc(db, `competitionCodes/${code}`), { competitionId: "c1", createdAt: serverTimestamp() });
      return batch.commit();
    };
    await assertFails(give("bob", "EEEEEE"));
    await assertSucceeds(give("alice", "FFFFFF"));
    await assertFails(give("alice", "GGGGGG"));
  });

  it("borrar la competición libera su código", async () => {
    const alice = as("alice");
    const batch = writeBatch(alice);
    batch.set(doc(alice, "customCompetitions/n1"), withCode("HHHHHH"));
    batch.set(doc(alice, "competitionCodes/HHHHHH"), { competitionId: "n1", createdAt: serverTimestamp() });
    await batch.commit();
    await assertFails(deleteDoc(doc(alice, "competitionCodes/HHHHHH")));
    await assertFails(deleteDoc(doc(as("bob"), "competitionCodes/HHHHHH")));
    const wipe = writeBatch(alice);
    wipe.delete(doc(alice, "customCompetitions/n1"));
    wipe.delete(doc(alice, "competitionCodes/HHHHHH"));
    await assertSucceeds(wipe.commit());
  });

  // ---------- Predictions ----------
  const future = () => Timestamp.fromMillis(Date.now() + 86_400_000);
  const past = () => Timestamp.fromMillis(Date.now() - 3_600_000);
  const fixture = async (mid: string, over: Record<string, unknown>, mode = "exact") =>
    env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await updateDoc(doc(db, C), { predictionMode: mode });
      await setDoc(doc(db, `${C}/matches/${mid}`), { ...match("alice"), updatedAt: Timestamp.now(), ...over });
    });
  const pick = (uid: string, mid: string, value: unknown, as_ = uid) =>
    setDoc(doc(as(as_), `${C}/matches/${mid}/picks/${uid}`), { value, updatedAt: serverTimestamp() });

  it("pronósticos: solo seguidores, solo los suyos y antes de que empiece", async () => {
    await fixture("open", { startAt: future() });
    await fixture("gone", { startAt: past() });
    await assertSucceeds(pick("carol", "open", "2-1"));
    await assertSucceeds(pick("carol", "open", "0-0")); // can change it until kick-off
    await assertSucceeds(pick("alice", "open", "1-1"));
    await assertFails(pick("dave", "open", "2-1")); // has the code, doesn't follow
    await assertFails(pick("carol", "open", "2-1", "bob")); // someone else's pick
    await assertFails(pick("carol", "gone", "2-1")); // too late
    await assertFails(setDoc(doc(as("carol"), `${C}/matches/open/picks/carol`), { value: "1-0", updatedAt: serverTimestamp(), points: 3 }));
    await assertFails(setDoc(doc(as("carol"), `${C}/matches/missing/picks/carol`), { value: "1-0", updatedAt: serverTimestamp() }));
  });

  it("pronósticos: el valor sigue el modo y el partido tiene que estar programado", async () => {
    await fixture("open", { startAt: future() }, "classic");
    await assertSucceeds(pick("carol", "open", "X"));
    await assertFails(pick("carol", "open", "2-1"));
    await assertFails(pick("carol", "open", "3"));
    await fixture("open", { startAt: future() }, "exact");
    await assertFails(pick("carol", "open", "X"));
    await assertFails(pick("carol", "open", "100-1"));
    await assertFails(pick("carol", "open", "a-b"));
    await fixture("open", { startAt: future() }, "off");
    await assertFails(pick("carol", "open", "1-0"));
    await fixture("open", { startAt: future(), status: "postponed" });
    await assertFails(pick("carol", "open", "1-0"));
  });

  it("los borradores no se ven nunca, ni después de empezar el partido", async () => {
    await fixture("open", { startAt: future() });
    await assertSucceeds(pick("carol", "open", "2-1"));
    await assertSucceeds(getDoc(doc(as("carol"), `${C}/matches/open/picks/carol`)));
    await assertFails(getDoc(doc(as("bob"), `${C}/matches/open/picks/carol`)));
    await assertFails(getDocs(collection(as("bob"), `${C}/matches/open/picks`)));
    await fixture("open", { startAt: past() });
    await assertFails(getDocs(collection(as("bob"), `${C}/matches/open/picks`)));
    await assertFails(getDoc(doc(as("alice"), `${C}/matches/open/picks/carol`)));
    await assertFails(pick("carol", "open", "3-0"));
    await assertFails(deleteDoc(doc(as("carol"), `${C}/matches/open/picks/carol`)));
  });

  // ---------- Rounds and sealed slips ----------
  const R = `${C}/rounds/J1`;
  const round = (deadline: Timestamp, matchIds = ["m1", "m2"]) => ({ deadline, matchIds, updatedAt: serverTimestamp() });
  const openRound = (deadline = future(), matchIds = ["m1", "m2"], mode = "exact") =>
    env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await updateDoc(doc(db, C), { predictionMode: mode });
      await setDoc(doc(db, R), { deadline, matchIds, updatedAt: Timestamp.now() });
    });
  const seal = (uid: string, over: Record<string, unknown> = {}, as_ = uid, attend = true) => {
    const db = as(as_);
    const batch = writeBatch(db);
    batch.set(doc(db, `${R}/entries/${uid}`), {
      userId: uid,
      matchIds: ["m1", "m2"],
      selections: "2:1,0:0",
      mode: "exact",
      submittedAt: serverTimestamp(),
      ...over,
    });
    if (attend) batch.set(doc(db, `${C}/roundAttendance/J1`), { members: { [uid]: serverTimestamp() } }, { merge: true });
    return batch.commit();
  };

  it("jornadas: solo la organización las abre o cambia, y todos las ven", async () => {
    await assertSucceeds(setDoc(doc(as("bob"), R), round(future())));
    await assertSucceeds(setDoc(doc(as("alice"), `${C}/rounds/QUARTER_FINALS`), round(future(), ["q1"])));
    await assertFails(setDoc(doc(as("carol"), `${C}/rounds/J2`), round(future())));
    await assertFails(setDoc(doc(as("bob"), `${C}/rounds/J3`), { ...round(future()), extra: true }));
    await assertFails(setDoc(doc(as("bob"), `${C}/rounds/J4`), round(future(), [])));
    await assertFails(setDoc(doc(as("bob"), `${C}/rounds/J 5`), round(future())));
    await assertSucceeds(getDoc(doc(as(null), R)));
    // Closed: nobody moves its deadline back into the future to seal late.
    await openRound(past());
    await assertFails(setDoc(doc(as("alice"), R), round(future())));
  });

  it("sellar: un boleto completo, antes del plazo, una sola vez y sin tocarlo después", async () => {
    await openRound();
    await assertFails(seal("dave")); // not a follower
    await assertFails(seal("carol", {}, "bob")); // someone else's slip
    await assertFails(seal("carol", { selections: "2:1" })); // incomplete
    await assertFails(seal("carol", { matchIds: ["m1"], selections: "2:1" })); // not the round's matches
    await assertFails(seal("carol", { mode: "classic", selections: "1X" })); // not the competition's mode
    await assertFails(seal("carol", {}, "carol", false)); // without saying who has sealed
    await assertSucceeds(seal("carol"));
    await assertFails(seal("carol", { selections: "3:0,0:0" })); // never again
    await assertFails(
      updateDoc(doc(as("carol"), `${R}/entries/carol`), { selections: "3:0,0:0", submittedAt: serverTimestamp() }),
    );
    await assertFails(deleteDoc(doc(as("carol"), `${R}/entries/carol`)));
    // Attendance: only yourself, and only together with your slip.
    await assertFails(
      setDoc(doc(as("bob"), `${C}/roundAttendance/J1`), { members: { bob: serverTimestamp() } }, { merge: true }),
    );
    await openRound(past());
    await assertFails(seal("bob")); // the round closed at its first kick-off
  });

  it("los boletos ajenos se ven al sellar el tuyo o al cerrarse la jornada", async () => {
    await openRound();
    await assertSucceeds(seal("carol"));
    await assertSucceeds(getDoc(doc(as("carol"), `${R}/entries/carol`)));
    await assertFails(getDoc(doc(as("bob"), `${R}/entries/carol`)));
    await assertFails(getDocs(collection(as("bob"), `${R}/entries`)));
    await assertSucceeds(seal("bob"));
    await assertSucceeds(getDocs(collection(as("bob"), `${R}/entries`)));
    await assertSucceeds(getDoc(doc(as(null), `${C}/roundAttendance/J1`)));
    await openRound(past());
    await assertSucceeds(getDocs(collection(as("alice"), `${R}/entries`)));
    await assertSucceeds(getDoc(doc(as("dave"), `${R}/entries/carol`)));
    await assertFails(getDocs(collection(as(null), `${R}/entries`)));
  });
});
