import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  announceRoundResults,
  remindPendingRounds,
  type CompletedRound,
} from "../scripts/notifications";
import { roundDeadlines } from "../scripts/liveSchedule";
import { ensureVapidKeys, type PushSend } from "../scripts/push";
import type { Standing } from "../scripts/standings";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const RID = "PD-2026-REGULAR_SEASON-13";
const device = (endpoint: string) => ({
  endpoint,
  p256dh: "B".repeat(87),
  auth: "c".repeat(22),
  createdAt: Timestamp.now(),
});

describe.skipIf(!enabled)("Avisos en Firestore: claves, recordatorios y resultados de jornada", () => {
  let app: App;
  let db: Firestore;
  const now = Date.parse("2026-11-21T18:00:00Z");
  beforeAll(() => {
    app = initializeApp({ projectId: "demo-galacticbet-push-tests" }, "push-tests");
    db = getFirestore(app);
  });
  afterAll(async () => {
    await deleteApp(app);
  });
  beforeEach(async () => {
    await fetch(
      `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-galacticbet-push-tests/databases/(default)/documents`,
      { method: "DELETE" },
    );
    await db.doc("groups/g1").set({ name: "Los del barrio", ownerId: "ana", memberIds: ["ana", "bruno", "carla"] });
    await db.doc("groups/g2").set({ name: "Oficina", ownerId: "dani", memberIds: ["dani", "bruno"] });
    for (const g of ["g1", "g2"])
      await db.doc(`groups/${g}/gameSeasons/PD-2026`).set({ competition: "PD", seasonId: "PD-2026", mode: "classic" });
    await db.doc(`rounds/${RID}`).set({
      seasonId: "PD-2026",
      competition: "PD",
      requiresSubmission: true,
      requiredMatchIds: ["1"],
      submissionDeadline: Timestamp.fromMillis(now + 2 * 3600_000),
    });
    // Next week's round is not due yet.
    await db.doc("rounds/PD-2026-REGULAR_SEASON-14").set({
      seasonId: "PD-2026",
      competition: "PD",
      requiresSubmission: true,
      submissionDeadline: Timestamp.fromMillis(now + 7 * 86400_000),
    });
    await db.doc(`groups/g1/gameSeasons/PD-2026/roundAttendance/${RID}`).set({ members: { ana: Timestamp.now() } });
    await db.doc(`users/bruno/push/${"a".repeat(64)}`).set(device("https://web.push.apple.com/bruno"));
    await db.doc(`users/carla/push/${"b".repeat(64)}`).set(device("https://web.push.apple.com/carla-gone"));
    await db.doc(`users/ana/push/${"c".repeat(64)}`).set(device("https://fcm.googleapis.com/fcm/send/ana"));
  });

  it("crea las claves una vez, publica solo la pública y las reutiliza", async () => {
    const first = await ensureVapidKeys(db);
    const second = await ensureVapidKeys(db);
    expect(second).toEqual(first);
    expect((await db.doc("config/push").get()).data()).toEqual({ publicKey: first.publicKey, formatVersion: 1 });
    expect((await db.doc("private/push").get()).data()?.privateKey).toBe(first.privateKey);
  });

  it("recuerda la jornada a quien no ha sellado, una sola vez, y olvida móviles dados de baja", async () => {
    const keys = await ensureVapidKeys(db);
    const send = vi.fn<PushSend>(async (subscription) => {
      if (subscription.endpoint.includes("gone"))
        throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return {};
    });
    expect(await remindPendingRounds(db, keys, { now, send })).toEqual({ reminded: 1 });
    // Ana sealed; Dani has no device; Carla's device is gone; Bruno gets one for both groups.
    expect(send).toHaveBeenCalledTimes(2);
    const [subscription, payload] = send.mock.calls.find(([s]) => s.endpoint.endsWith("bruno"))!;
    expect(subscription.keys.auth).toBe("c".repeat(22));
    expect(JSON.parse(payload)).toMatchObject({
      title: "LaLiga · Jornada 13",
      body: expect.stringContaining("en 2 grupos"),
    });
    expect((await db.collection("users/carla/push").get()).empty).toBe(true);
    expect((await db.doc(`pushLog/remind_${RID}_bruno`).get()).exists).toBe(true);
    send.mockClear();
    expect(await remindPendingRounds(db, keys, { now: now + 600_000, send })).toEqual({ reminded: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("anuncia cada jornada terminada una vez, solo a quien selló, y calla las antiguas", async () => {
    const keys = await ensureVapidKeys(db);
    const send = vi.fn<PushSend>(async () => ({}));
    const round: CompletedRound = {
      groupId: "g1",
      groupName: "Los del barrio",
      competition: "PD",
      roundId: RID,
      lastKickoff: now - 3600_000,
      standings: new Map<string, Standing>([
        ["ana", { points: 9, hits: 9, rounds: { [RID]: { points: 9, hits: 9 } } }],
        ["bruno", { points: 4, hits: 4, rounds: { [RID]: { points: 4, hits: 4 } } }],
        ["carla", { points: 0, hits: 0, rounds: {} }],
      ]),
      names: new Map([["ana", "Ana"], ["bruno", "Bruno"], ["carla", "Carla"]]),
      sealed: ["ana", "bruno"],
    };
    // Ana, Bruno and Carla each have a device, but Carla didn't seal.
    expect(await announceRoundResults(db, keys, [round], { now, send })).toEqual({ announced: 2 });
    const bodies = send.mock.calls.map(([, payload]) => JSON.parse(payload).body);
    expect(bodies.sort()).toEqual([
      "Has quedado 2.º de 2 en Los del barrio con 4 puntos.",
      "¡Has ganado la jornada en Los del barrio con 9 puntos! 1.º de 2.",
    ]);
    expect(send.mock.calls.some(([s]) => s.endpoint.includes("carla"))).toBe(false);
    send.mockClear();
    expect(await announceRoundResults(db, keys, [round], { now, send })).toEqual({ announced: 0 });
    const old = { ...round, groupId: "g2", lastKickoff: now - 5 * 86400_000 };
    expect(await announceRoundResults(db, keys, [old], { now, send })).toEqual({ announced: 0 });
    expect(send).not.toHaveBeenCalled();
  });
  it("la espera del directo conoce los cierres abiertos de las jornadas oficiales", async () => {
    await db.doc("rounds/PD-2026-REGULAR_SEASON-12").set({
      seasonId: "PD-2026",
      competition: "PD",
      requiresSubmission: true,
      submissionDeadline: Timestamp.fromMillis(now - 3600_000),
    });
    await db.doc("rounds/CL-2026-LEAGUE_STAGE-6").set({
      seasonId: "CL-2026",
      competition: "CL",
      requiresSubmission: false,
      submissionDeadline: Timestamp.fromMillis(now + 3600_000),
    });
    expect(await roundDeadlines(db, now)).toEqual([now + 2 * 3600_000, now + 7 * 86400_000]);
  });
});
