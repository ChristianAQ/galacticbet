import { randomUUID } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { COMPETITION_CODES } from "../src/lib/competitions";
import {
  CALENDAR_FORMAT,
  MAX_CALENDAR_BYTES,
  decodeCalendar,
  encodeCalendar,
} from "../src/lib/calendar";
import type { Match } from "../src/lib/domain";
import {
  applySportFixture,
  createSportApiClient,
  findSportFixture,
} from "./sportApi";
import { reserveSportApiRequests } from "./sportApiBudget";
import { recompute } from "./recompute";

const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function sportApiCandidates(matches: Match[], now: number) {
  return matches.filter(
    (m) =>
      Date.parse(m.utcDate) >= now - 8 * 3600_000 &&
      Date.parse(m.utcDate) <= now + 15 * 60_000 &&
      (["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"].includes(m.status) ||
        (m.resultProvider === "SportAPI" &&
          Date.parse(m.utcDate) >= now - 4 * 3600_000)),
  );
}

export async function syncSportApi(
  db: Firestore,
  key: string,
  options: {
    now?: number;
    runId?: string;
    request?: typeof fetch;
    log?: (message: string) => void;
    verify?: boolean;
  } = {},
) {
  const now = options.now ?? Date.now();
  const log = options.log ?? console.log;
  const seasonYear =
    new Date(now).getUTCFullYear() - (new Date(now).getUTCMonth() < 6 ? 1 : 0);
  const cache = new Map<string, Match[]>();
  const policies = new Map<string, string>();
  const pending = new Set<string>();
  // Three aggregated calendar reads. No match-collection scan and no call per user.
  const snapshots = await db.getAll(
    ...COMPETITION_CODES.map((c) => db.doc(`calendars/${c}-${seasonYear}`)),
  );
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const data = snapshot.data()!;
    cache.set(snapshot.id, decodeCalendar(data));
    if (data.deliveryPolicyFrom)
      policies.set(snapshot.id, data.deliveryPolicyFrom);
    if (data.scoringPending) pending.add(snapshot.id);
  }
  const candidates = sportApiCandidates([...cache.values()].flat(), now);
  const dates = [
    ...new Set([
      ...candidates.map((m) => day.format(new Date(m.utcDate))),
      ...(options.verify ? [day.format(new Date(now))] : []),
    ]),
  ].sort();
  let requests = 0;
  let changed = 0;
  let stopped = false;
  if (dates.length) {
    const runId =
      options.runId ??
      `sportapi-${process.env.GITHUB_RUN_ID || randomUUID()}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`;
    const reserved = await reserveSportApiRequests(
      db,
      runId,
      Math.min(3, dates.length),
      () => now,
    );
    const client = createSportApiClient(key, reserved, options.request);
    for (const date of dates.slice(0, reserved)) {
      try {
        requests++;
        const fixtures = await client.fixtures(date);
        let matched = 0;
        for (const [seasonId, matches] of cache) {
          const updates: Match[] = [];
          const next = matches.map((match) => {
            if (
              !candidates.some((m) => m.id === match.id) ||
              day.format(new Date(match.utcDate)) !== date
            )
              return match;
            const fixture = findSportFixture(match, fixtures);
            if (!fixture) return match;
            matched++;
            const updated = applySportFixture(match, fixture, now);
            if (encodeCalendar([updated]) === encodeCalendar([match]))
              return match;
            updates.push(updated);
            if (updated.status === "FINISHED") pending.add(seasonId);
            return updated;
          });
          if (!updates.length) continue;
          const payload = encodeCalendar(next);
          if (Buffer.byteLength(payload, "utf8") > MAX_CALENDAR_BYTES)
            throw new Error();
          // Commit individual security documents before publishing the new calendar.
          for (let i = 0; i < updates.length; i += 400) {
            const batch = db.batch();
            for (const match of updates.slice(i, i + 400))
              batch.set(
                db.doc(`matches/${match.id}`),
                {
                  status: match.status,
                  homeScore: match.homeScore,
                  awayScore: match.awayScore,
                  winner: match.winner ?? null,
                  scoreDuration: match.scoreDuration,
                  resultProvider: match.resultProvider,
                  sportApiId: match.sportApiId,
                  syncedAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
              );
            await batch.commit();
          }
          await db.doc(`calendars/${seasonId}`).set(
            {
              formatVersion: CALENDAR_FORMAT,
              seasonId,
              payload,
              updatedAt: FieldValue.serverTimestamp(),
              scoringPending: pending.has(seasonId),
            },
            { merge: true },
          );
          cache.set(seasonId, next);
          changed += updates.length;
        }
        log(
          `SportAPI ${date}: ${fixtures.length} encuentros de PD/CL/PL recibidos, ${matched} coincidencias verificadas.`,
        );
      } catch (error) {
        stopped = true;
        // Only our HTTP status is printed; never provider bodies, URLs with keys or SDK errors.
        const code =
          error instanceof Error
            ? /SportAPI HTTP (\d{3}):/.exec(error.message)?.[1]
            : undefined;
        if (code)
          log(
            `SportAPI HTTP ${code}: revisa la clave, el plan y la cuota del proveedor.`,
          );
        log(
          "SportAPI: sincronización interrumpida; se conservan los datos publicados. Revisa acceso y cuota en el proveedor.",
        );
        break;
      }
    }
    if (!reserved)
      log(
        "SportAPI: presupuesto agotado o ejecución ya reservada; no se consulta al proveedor.",
      );
  }
  // A durable flag retries scoring even if the previous job died after publishing results.
  if (pending.size) {
    await recompute(db, cache, policies);
    const batch = db.batch();
    for (const season of pending)
      batch.set(
        db.doc(`calendars/${season}`),
        { scoringPending: false },
        { merge: true },
      );
    await batch.commit();
  }
  log(
    `SportAPI: ${requests} peticiones, ${changed} partidos actualizados; ${pending.size} temporadas revisadas para puntuación.`,
  );
  return { requests, changed, stopped };
}
