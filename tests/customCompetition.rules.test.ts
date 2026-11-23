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
});
