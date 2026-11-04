import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCalendars } from "../scripts/calendarSync";
import { syncSportApi } from "../scripts/syncSportApi";
import { decodeCalendar } from "../src/lib/calendar";
import type { ApiMatch } from "../scripts/normalize";
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
describe.skipIf(!enabled)(
  "SportAPI: publicación, recuperación y puntuación real en Firestore",
  () => {
    const projectId = "demo-galacticbet-sportapi";
    const app = enabled ? initializeApp({ projectId }, "sportapi-tests") : null;
    const db = app ? getFirestore(app) : null!;
    const now = Date.parse("2026-11-04T22:00:00Z");
    const raw: ApiMatch = {
      id: 123,
      utcDate: "2026-11-04T20:00:00Z",
      status: "TIMED",
      stage: "REGULAR_SEASON",
      matchday: 12,
      season: { id: 1, startDate: "2026-08-01", endDate: "2027-06-01" },
      homeTeam: { name: "FC Barcelona" },
      awayTeam: { name: "Real Madrid CF" },
      score: { duration: "REGULAR", fullTime: { home: null, away: null } },
    };
    const body = {
      success: true,
      date: "2026-11-04",
      data: [
        {
          id: 555,
          league_id: 1,
          home_team: "Barcelona",
          away_team: "Real Madrid",
          kickoff_utc: raw.utcDate,
          updated_at: "2026-11-04T21:59:00Z",
          home_score: 2,
          away_score: 1,
          status: "FT",
        },
      ],
    };
    const request = () =>
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response(JSON.stringify(body)));
    beforeEach(async () => {
      const response = await fetch(
        `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("No se pudo limpiar el emulador.");
      await syncCalendars(db, "PD", [raw]);
      await db.doc("groups/g").set({ memberIds: ["me"] });
      await db.doc("users/me").set({ name: "Ana" });
      for (const mode of ["classic", "exact"]) {
        const ref = db.doc(`groups/g/gameSeasons/${mode}`);
        await ref.set({
          competition: "PD",
          seasonId: "PD-2026",
          mode,
          submissionMigrationVersion: 2,
          submissionMigratedMembers: ["me"],
        });
        await ref
          .collection("predictions")
          .doc("me_123")
          .set({
            userId: "me",
            matchId: "123",
            roundId: "PD-2026-REGULAR_SEASON-12",
            value: mode === "classic" ? "1" : { home: 2, away: 1 },
          });
      }
      // This round predates the submission policy and uses its existing scoring contract.
      await db
        .doc("calendars/PD-2026")
        .set({ deliveryPolicyFrom: "2026-11-05T00:00:00Z" }, { merge: true });
    });
    afterAll(async () => {
      if (app) await deleteApp(app);
    });
    it("puntúa ambos modos, publica una vez y el proveedor oficial retrasado no reabre el partido", async () => {
      const fetcher = request();
      expect(
        await syncSportApi(db, "TEST_ONLY", {
          now,
          request: fetcher,
          runId: "first",
        }),
      ).toMatchObject({ changed: 1, requests: 1, stopped: false });
      expect((await db.doc("matches/123").get()).data()).toMatchObject({
        status: "FINISHED",
        homeScore: 2,
        resultProvider: "SportAPI",
      });
      for (const [mode, points] of [
        ["classic", 1],
        ["exact", 3],
      ] as const)
        expect(
          (
            await db.doc(`groups/g/gameSeasons/${mode}/standings/me`).get()
          ).data()?.points,
        ).toBe(points);
      const beforeMatch = (await db.doc("matches/123").get()).data()!;
      const standing = db.doc("groups/g/gameSeasons/classic/standings/me");
      const beforeStanding = (await standing.get()).data()!;
      expect(
        (
          await syncSportApi(db, "TEST_ONLY", {
            now,
            request: request(),
            runId: "second",
          })
        ).changed,
      ).toBe(0);
      // The quota transaction writes its ledger; public fixtures and totals stay untouched.
      expect(
        (await db.doc("matches/123").get())
          .data()!
          .syncedAt.isEqual(beforeMatch.syncedAt),
      ).toBe(true);
      expect(
        (await standing.get())
          .data()!
          .computedAt.isEqual(beforeStanding.computedAt),
      ).toBe(true);
      await syncCalendars(db, "PD", [raw]);
      expect(
        decodeCalendar((await db.doc("calendars/PD-2026").get()).data()!)[0],
      ).toMatchObject({
        status: "FINISHED",
        homeScore: 2,
        resultProvider: "SportAPI",
      });
      await syncCalendars(db, "PD", [
        {
          ...raw,
          status: "FINISHED",
          score: { duration: "REGULAR", fullTime: { home: 1, away: 1 } },
        },
      ]);
      expect(
        decodeCalendar((await db.doc("calendars/PD-2026").get()).data()!)[0],
      ).toMatchObject({ status: "FINISHED", homeScore: 1 });
      expect(
        (await db.doc("providerBudgets/sportapi").get()).data()?.monthUsed,
      ).toBe(2);
    });
    it("reintenta el cálculo tras un fallo posterior a publicar, aunque el resultado no cambie", async () => {
      const collection = vi
        .spyOn(db, "collection")
        .mockImplementationOnce(() => {
          throw new Error("Fallo simulado al puntuar");
        });
      await expect(
        syncSportApi(db, "TEST_ONLY", {
          now,
          request: request(),
          runId: "crash",
        }),
      ).rejects.toThrow();
      collection.mockRestore();
      expect(
        (await db.doc("calendars/PD-2026").get()).data()?.scoringPending,
      ).toBe(true);
      await syncSportApi(db, "TEST_ONLY", {
        now,
        request: request(),
        runId: "recover",
      });
      expect(
        (await db.doc("groups/g/gameSeasons/classic/standings/me").get()).data()
          ?.points,
      ).toBe(1);
      expect(
        (await db.doc("calendars/PD-2026").get()).data()?.scoringPending,
      ).toBe(false);
    });
    it("una clave rechazada consume un intento, conserva datos y comunica el fallo sin publicar secretos", async () => {
      const log = vi.fn();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("SECRET_BODY", { status: 401 }));
      const result = await syncSportApi(db, "SECRET_KEY", {
        now,
        request: fetcher,
        runId: "unauthorized",
        log,
      });
      expect(result).toMatchObject({ changed: 0, stopped: true, requests: 1 });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect((await db.doc("matches/123").get()).data()?.status).toBe("TIMED");
      expect(JSON.stringify(log.mock.calls)).toContain("401");
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET/);
    });
    it("no llama sin encuentros cercanos; una comprobación manual sí valida el acceso con una sola fecha", async () => {
      await db.doc("calendars/PD-2026").delete();
      const fetcher = request();
      expect(
        (
          await syncSportApi(db, "TEST_ONLY", {
            now,
            request: fetcher,
            runId: "idle",
          })
        ).requests,
      ).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
      expect(
        (
          await syncSportApi(db, "TEST_ONLY", {
            now,
            request: fetcher,
            runId: "verify",
            verify: true,
          })
        ).requests,
      ).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  },
);
