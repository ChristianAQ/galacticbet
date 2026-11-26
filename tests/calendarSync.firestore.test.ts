import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import {
  CollectionReference,
  Query,
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { scoringCalendar, syncCalendars } from "../scripts/calendarSync";
import { recompute } from "../scripts/recompute";
import { normalize, type ApiMatch } from "../scripts/normalize";
import { decodeCalendar } from "../src/lib/calendar";
import {
  decodeDelivery,
  encodeDelivery,
  requiresDelivery,
} from "../src/lib/roundDelivery";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const raw = (id: number): ApiMatch => ({
  id,
  utcDate: "2026-10-24T19:00:00Z",
  status: "TIMED",
  matchday: Math.floor(id / 10) + 1,
  stage: "REGULAR_SEASON",
  season: { id: 1, startDate: "2026-08-01", endDate: "2027-06-01" },
  homeTeam: { id: 1, name: "Local" },
  awayTeam: { id: 2, name: "Visitante" },
  score: { duration: "REGULAR", fullTime: { home: null, away: null } },
});
const finished = (home: number, away: number): ApiMatch => ({
  ...raw(1),
  status: "FINISHED",
  score: { duration: "REGULAR", fullTime: { home, away } },
});

describe.skipIf(!enabled)(
  "Sincronización: lecturas, recuperación y puntuación en Firestore",
  () => {
    let app: App;
    let db: Firestore;
    beforeAll(() => {
      // Explicit isolated emulator project; never resolve production credentials.
      app = initializeApp(
        { projectId: "demo-galacticbet-calendar-tests" },
        "calendar-tests",
      );
      db = getFirestore(app);
    });
    beforeEach(async () => {
      const response = await fetch(
        `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-galacticbet-calendar-tests/databases/(default)/documents`,
        { method: "DELETE" },
      );
      if (!response.ok)
        throw new Error("No se pudo limpiar el emulador aislado.");
    });
    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
      if (app) await deleteApp(app);
    });

    it("sincroniza 380 partidos leyendo un único documento y publica todas las jornadas", async () => {
      const reads = vi.spyOn(db, "getAll");
      const collectionReads = vi.spyOn(db, "collection");
      const fixtures = Array.from({ length: 380 }, (_, i) => raw(i));
      const cache = await syncCalendars(db, "PD", fixtures);
      expect(reads).toHaveBeenCalledTimes(1);
      expect(collectionReads).not.toHaveBeenCalled();
      expect(cache.get("PD-2026")).toHaveLength(380);
      const calendar = await db.doc("calendars/PD-2026").get();
      expect(decodeCalendar(calendar.data()!)).toHaveLength(380);
      expect(
        (await db.doc("matches/379").get())
          .data()
          ?.kickoffAt.toDate()
          .toISOString(),
      ).toBe(new Date(raw(379).utcDate).toISOString());
      expect(
        (await db.doc("rounds/PD-2026-REGULAR_SEASON-38").get()).exists,
      ).toBe(true);
    });
    it("publica descanso y ganador oficial, sin alterar el resultado a 90 minutos ni repetir escrituras", async () => {
      const source: ApiMatch = {
        ...finished(1, 1),
        score: {
          duration: "PENALTY_SHOOTOUT",
          winner: "AWAY_TEAM",
          halfTime: { home: 0, away: 1 },
          regularTime: { home: 1, away: 1 },
          fullTime: { home: 4, away: 5 },
        },
      };
      await syncCalendars(db, "CL", [source]);
      const persisted = (await db.doc("matches/1").get()).data()!;
      const published = decodeCalendar(
        (await db.doc("calendars/CL-2026").get()).data()!,
      )[0];
      for (const match of [persisted, published])
        expect(match).toMatchObject({
          homeScore: 1,
          awayScore: 1,
          winner: "2",
          halfTimeHomeScore: 0,
          halfTimeAwayScore: 1,
        });
      const batches = vi.spyOn(db, "batch");
      await syncCalendars(db, "CL", [source]);
      expect(batches).not.toHaveBeenCalled();
    });
    it("reescribe una vez las jornadas abiertas publicadas con la regla anterior; las cerradas no se tocan", async () => {
      const at = (id: number, utcDate: string, matchday: number): ApiMatch => ({ ...raw(id), utcDate, matchday });
      const now = Date.parse("2026-11-26T12:00:00Z");
      // J23: one match brought forward to December, the bulk in February. J13: already played.
      const j23 = [at(231, "2026-12-02T20:00:00Z", 23), ...[232, 233, 234, 235].map((id) => at(id, "2027-02-07T15:00:00Z", 23))];
      const j13 = [at(131, "2026-11-20T20:00:00Z", 13), at(132, "2026-11-21T20:00:00Z", 13), at(133, "2026-11-22T20:00:00Z", 13)];
      await syncCalendars(db, "PD", [...j23, ...j13], new Map(), now);
      const open = db.doc(`rounds/${normalize(j23[0], "PD").roundId}`);
      const closed = db.doc(`rounds/${normalize(j13[0], "PD").roundId}`);
      expect((await open.get()).data()!.submissionDeadline.toMillis()).toBe(Date.parse("2027-02-07T15:00:00Z"));
      // As version 2 published them: J23 closing on 2 December.
      await open.set({ submissionDeadline: Timestamp.fromMillis(Date.parse("2026-12-02T20:00:00Z")) }, { merge: true });
      await closed.set({ legacy: true }, { merge: true });
      await db.doc("calendars/PD-2026").set({ deliverySchemaVersion: 2 }, { merge: true });
      const closedBefore = await closed.get();
      await syncCalendars(db, "PD", [...j23, ...j13], new Map(), now);
      expect((await open.get()).data()!.submissionDeadline.toMillis()).toBe(Date.parse("2027-02-07T15:00:00Z"));
      expect((await closed.get()).updateTime).toEqual(closedBefore.updateTime);
      expect((await db.doc("calendars/PD-2026").get()).data()!.deliverySchemaVersion).toBe(3);
    });
    it("una reejecución idéntica no reescribe partidos ni calendario aunque cambie el orden de la API", async () => {
      await syncCalendars(db, "PD", [raw(1), raw(2)]);
      const fixture = await db.doc("matches/1").get();
      const calendar = await db.doc("calendars/PD-2026").get();
      const batches = vi.spyOn(db, "batch");
      await syncCalendars(db, "PD", [raw(2), raw(1)]);
      expect(batches).not.toHaveBeenCalled();
      expect((await db.doc("matches/1").get()).updateTime).toEqual(
        fixture.updateTime,
      );
      expect((await db.doc("calendars/PD-2026").get()).updateTime).toEqual(
        calendar.updateTime,
      );
    });
    it("solo escribe el partido modificado y omite lecturas de clasificación y pronósticos si nada cambia", async () => {
      let cache = await syncCalendars(db, "PD", [raw(1), raw(2)]);
      await db.doc("groups/g").set({ memberIds: ["alice"] });
      await db
        .doc("groups/g/gameSeasons/PD-2026")
        .set({ competition: "PD", seasonId: "PD-2026", mode: "classic" });
      await db.doc("groups/g/gameSeasons/PD-2026/predictions/alice_1").set({
        userId: "alice",
        matchId: "1",
        roundId: normalize(raw(1), "PD").roundId,
        value: "1",
      });
      await recompute(db, cache);
      const untouched = await db.doc("matches/2").get();
      cache = await syncCalendars(db, "PD", [finished(2, 1), raw(2)]);
      await recompute(db, cache);
      expect((await db.doc("matches/2").get()).updateTime).toEqual(
        untouched.updateTime,
      );
      const standing = db.doc("groups/g/gameSeasons/PD-2026/standings/alice");
      expect((await standing.get()).data()?.points).toBe(1);
      const queries = vi.spyOn(Query.prototype, "get");
      const docs = vi.spyOn(db, "getAll");
      await recompute(db, cache);
      expect(
        queries.mock.contexts.map((q) =>
          q instanceof CollectionReference ? q.path : "filtered query",
        ),
      ).toEqual(["groups", "groups/g/gameSeasons"]);
      expect(docs).not.toHaveBeenCalled();
    });
    it("recalcula correcciones y altas/bajas sin duplicar puntos ni consultar el calendario individual", async () => {
      let cache = await syncCalendars(db, "PD", [finished(2, 1)]);
      const season = db.doc("groups/g/gameSeasons/PD-2026");
      await db.doc("groups/g").set({ memberIds: ["alice"] });
      await season.set({
        competition: "PD",
        seasonId: "PD-2026",
        mode: "classic",
      });
      for (const [uid, value] of [
        ["alice", "1"],
        ["bob", "2"],
      ])
        await season
          .collection("predictions")
          .doc(`${uid}_1`)
          .set({
            userId: uid,
            matchId: "1",
            roundId: normalize(raw(1), "PD").roundId,
            value,
          });
      await recompute(db, cache);
      expect(
        (await season.collection("standings").doc("alice").get()).data()
          ?.points,
      ).toBe(1);
      await db.doc("groups/g").update({ memberIds: ["alice", "bob"] });
      await recompute(db, cache);
      expect(
        (await season.collection("standings").doc("bob").get()).data()?.points,
      ).toBe(0);
      cache = await syncCalendars(db, "PD", [finished(0, 1)]);
      await recompute(db, cache);
      expect(
        (await season.collection("standings").doc("alice").get()).data()
          ?.points,
      ).toBe(0);
      expect(
        (await season.collection("standings").doc("bob").get()).data()?.points,
      ).toBe(1);
      await db.doc("groups/g").update({ memberIds: ["bob"] });
      await recompute(db, cache);
      expect(
        (await season.collection("standings").doc("alice").get()).exists,
      ).toBe(false);
      expect(
        (await season.collection("standings").doc("bob").get()).data()?.points,
      ).toBe(1);
    });
    it("migra una temporada histórica una sola vez y luego usa su documento agregado", async () => {
      const archived = { ...normalize(raw(1), "PD"), seasonId: "PD-2025" };
      await db.doc("matches/1").set(archived);
      const collections = vi.spyOn(db, "collection");
      expect(await scoringCalendar(db, "PD-2025", new Map())).toHaveLength(1);
      expect(collections).toHaveBeenCalledWith("matches");
      collections.mockClear();
      expect(await scoringCalendar(db, "PD-2025", new Map())).toHaveLength(1);
      expect(collections).not.toHaveBeenCalled();
    });
    it("tras un fallo parcial conserva el calendario publicado y reintenta los cambios de forma segura", async () => {
      await syncCalendars(db, "PD", [raw(1)]);
      const before = (await db.doc("calendars/PD-2026").get()).data()!;
      const batch = db.batch();
      const commit = batch.commit.bind(batch);
      vi.spyOn(batch, "commit").mockImplementationOnce(async () => {
        await commit();
        throw new Error("interrupted");
      });
      vi.spyOn(db, "batch").mockReturnValueOnce(batch);
      await expect(syncCalendars(db, "PD", [finished(1, 0)])).rejects.toThrow(
        "interrupted",
      );
      expect((await db.doc("calendars/PD-2026").get()).data()?.payload).toBe(
        before.payload,
      );
      await syncCalendars(db, "PD", [finished(1, 0)]);
      expect(
        decodeCalendar((await db.doc("calendars/PD-2026").get()).data()!)[0]
          .homeScore,
      ).toBe(1);
    });
    it("rechaza un calendario que excede el límite antes de escribir partidos", async () => {
      const large = { ...raw(1), homeTeam: { name: "x".repeat(800_000) } };
      const batch = vi.spyOn(db, "batch");
      await expect(syncCalendars(db, "PD", [large])).rejects.toThrow(
        "demasiado grande",
      );
      expect(batch).not.toHaveBeenCalled();
    });
    it("puntúa solo las entregas completas nuevas y usa la copia inmutable, no el borrador", async () => {
      const policies = new Map<string, string>();
      // Keep this round after activation on any runner date, rather than letting
      // a fixed kickoff turn the new-delivery case into a historical round.
      const scheduled = {
        ...raw(1),
        utcDate: new Date(Date.now() + 86_400_000).toISOString(),
      };
      await syncCalendars(db, "PD", [scheduled], policies);
      const activatedAt = policies.get("PD-2026");
      const rid = normalize(scheduled, "PD").roundId;
      expect(requiresDelivery([normalize(scheduled, "PD")], activatedAt)).toBe(
        true,
      );
      expect(
        (await db.doc(`rounds/${rid}`).get()).data()?.requiresSubmission,
      ).toBe(true);
      const season = db.doc("groups/g/gameSeasons/PD-2026");
      await db.doc("groups/g").set({ memberIds: ["alice", "bob"] });
      await season.set({
        competition: "PD",
        seasonId: "PD-2026",
        mode: "classic",
      });
      for (const uid of ["alice", "bob"])
        await season
          .collection("predictions")
          .doc(`${uid}_1`)
          .set({ userId: uid, matchId: "1", roundId: rid, value: "2" });
      await season
        .collection("roundEntries")
        .doc(rid)
        .collection("players")
        .doc("alice")
        .set({
          userId: "alice",
          roundId: rid,
          formatVersion: 2,
          submittedAt: Timestamp.now(),
          ...encodeDelivery("classic", ["1"], { "1": "1" }),
        });
      const completed = { ...finished(2, 1), utcDate: scheduled.utcDate };
      const cache = await syncCalendars(db, "PD", [completed], policies);
      expect(policies.get("PD-2026")).toBe(activatedAt);
      expect(requiresDelivery(cache.get("PD-2026")!, activatedAt)).toBe(true);
      await recompute(db, cache, policies);
      expect(
        (await season.collection("standings").doc("alice").get()).data()
          ?.points,
      ).toBe(1);
      expect(
        (await season.collection("standings").doc("bob").get()).data()?.points,
      ).toBe(0);
    });
    it("convierte cierres antiguos completos una sola vez y no publica los incompletos", async () => {
      const cache = await syncCalendars(db, "PD", [raw(1), raw(2)]);
      const rid = normalize(raw(1), "PD").roundId;
      const season = db.doc("groups/g/gameSeasons/PD-2026");
      await db.doc("groups/g").set({ memberIds: ["alice", "bob"] });
      await season.set({
        competition: "PD",
        seasonId: "PD-2026",
        mode: "classic",
      });
      for (const uid of ["alice", "bob"])
        await season
          .collection("submissions")
          .doc(uid)
          .collection("rounds")
          .doc(rid)
          .set({ userId: uid, roundId: rid, submittedAt: Timestamp.now() });
      for (const [uid, ids] of [
        ["alice", ["1", "2"]],
        ["bob", ["1"]],
      ] as const)
        for (const matchId of ids)
          await season
            .collection("predictions")
            .doc(`${uid}_${matchId}`)
            .set({ userId: uid, matchId, roundId: rid, value: "X" });
      await recompute(db, cache);
      const entries = season
        .collection("roundEntries")
        .doc(rid)
        .collection("players");
      expect(
        decodeDelivery((await entries.doc("alice").get()).data()!),
      ).toEqual({ "1": "X", "2": "X" });
      expect((await entries.doc("bob").get()).exists).toBe(false);
      expect(
        Object.keys(
          (await season.collection("roundAttendance").doc(rid).get()).data()!
            .members,
        ),
      ).toEqual(["alice"]);
      const queries = vi.spyOn(Query.prototype, "get");
      await recompute(db, cache);
      expect(queries).toHaveBeenCalledTimes(2);
    });
    it("conserva la puntuación de jornadas que ya habían empezado al activar las nuevas entregas", async () => {
      const policies = new Map<string, string>();
      const cache = await syncCalendars(
        db,
        "PD",
        [
          {
            ...finished(2, 1),
            utcDate: new Date(Date.now() - 86_400_000).toISOString(),
          },
        ],
        policies,
      );
      expect(
        requiresDelivery(cache.get("PD-2026")!, policies.get("PD-2026")),
      ).toBe(false);
      const season = db.doc("groups/g/gameSeasons/PD-2026");
      await db.doc("groups/g").set({ memberIds: ["alice"] });
      await season.set({
        competition: "PD",
        seasonId: "PD-2026",
        mode: "classic",
      });
      await season
        .collection("predictions")
        .doc("alice_1")
        .set({
          userId: "alice",
          matchId: "1",
          roundId: normalize(raw(1), "PD").roundId,
          value: "1",
        });
      await recompute(db, cache, policies);
      expect(
        (await season.collection("standings").doc("alice").get()).data()
          ?.points,
      ).toBe(1);
    });
  },
);
