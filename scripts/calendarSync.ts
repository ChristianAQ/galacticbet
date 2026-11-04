import type { CompetitionCode } from "../src/lib/competitions";
import {
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import {
  CALENDAR_FORMAT,
  MAX_CALENDAR_BYTES,
  decodeCalendar,
  encodeCalendar,
} from "../src/lib/calendar";
import type { Match } from "../src/lib/domain";
import { normalize, type ApiMatch } from "./normalize";
import { roundRequirements, requiresDelivery } from "../src/lib/roundDelivery";
import { preserveSportResult } from "./sportApi";

function roundMetadata(fixtures: Match[], policyFrom: string) {
  const rounds = new Map<string, Match[]>();
  for (const m of fixtures)
    rounds.set(m.roundId, [...(rounds.get(m.roundId) || []), m]);
  return new Map(
    [...rounds].map(([id, matches]) => {
      const first = matches[0];
      const { matchIds, deadline } = roundRequirements(matches);
      return [
        id,
        {
          seasonId: first.seasonId,
          competition: first.competition,
          stage: first.stage,
          matchday: first.matchday,
          requiredMatchIds: matchIds,
          submissionDeadlineMillis: deadline,
          requiresSubmission: requiresDelivery(matches, policyFrom),
        },
      ];
    }),
  );
}

function snapshotData(seasonId: string, matches: Match[]) {
  const payload = encodeCalendar(matches);
  // Leave room below Firestore's 1 MiB document limit for field names and metadata.
  if (Buffer.byteLength(payload, "utf8") > MAX_CALENDAR_BYTES)
    throw new Error(
      `Calendario ${seasonId} demasiado grande; se conserva el anterior.`,
    );
  const data = {
    formatVersion: CALENDAR_FORMAT,
    seasonId,
    payload,
    updatedAt: FieldValue.serverTimestamp(),
  };
  decodeCalendar(data);
  return data;
}

export async function syncCalendars(
  db: Firestore,
  code: CompetitionCode,
  rawMatches: ApiMatch[],
  policies = new Map<string, string>(),
) {
  const seasons = new Map<string, { raw: ApiMatch; match: Match }[]>();
  for (const raw of rawMatches) {
    const match = normalize(raw, code);
    if (!Number.isFinite(Date.parse(match.utcDate)))
      throw new Error(`Fecha inválida en partido ${match.id}`);
    const list = seasons.get(match.seasonId) || [];
    list.push({ raw, match });
    seasons.set(match.seasonId, list);
  }
  const cache = new Map<string, Match[]>();
  for (const [seasonId, entries] of seasons) {
    const ref = db.doc(`calendars/${seasonId}`);
    const previous = await ref.get();
    const previousData = previous.data();
    const oldFixtures = previous.exists ? decodeCalendar(previousData!) : [];
    const oldById = new Map(oldFixtures.map((m) => [m.id, m]));
    for (const entry of entries)
      entry.match = preserveSportResult(
        entry.match,
        oldById.get(entry.match.id),
      );
    const fixtures = entries.map((entry) => entry.match);
    const data = snapshotData(seasonId, fixtures);
    const policyFrom: string =
      previousData?.deliveryPolicyFrom || new Date().toISOString();
    policies.set(seasonId, policyFrom);
    cache.set(seasonId, fixtures);
    if (
      previousData?.formatVersion === CALENDAR_FORMAT &&
      previousData.payload === data.payload &&
      previousData.deliverySchemaVersion === 2
    ) {
      console.log(
        `${seasonId}: sin cambios; 1 lectura de calendario, 0 escrituras de partidos.`,
      );
      continue;
    }
    const previousById = new Map(
      oldFixtures.map((m) => [m.id, encodeCalendar([m])]),
    );
    const changed = entries.filter(
      ({ match }) => previousById.get(match.id) !== encodeCalendar([match]),
    );
    // Publish a snapshot only after its individual fixtures and validation metadata are committed.
    // If a run stops midway, the old snapshot causes those changes to be retried next time.
    for (let i = 0; i < changed.length; i += 150) {
      const batch = db.batch();
      const metadata = new Map<string, Record<string, unknown>>();
      for (const { raw, match: m } of changed.slice(i, i + 150)) {
        batch.set(db.doc(`matches/${m.id}`), {
          ...m,
          kickoffAt: Timestamp.fromDate(new Date(m.utcDate)),
          providerSeasonId: raw.season.id,
          syncedAt: FieldValue.serverTimestamp(),
        });
        metadata.set(`seasons/${seasonId}`, {
          competition: code,
          startDate: raw.season.startDate,
          endDate: raw.season.endDate,
          providerId: raw.season.id,
        });
        if (
          m.status === "FINISHED" &&
          (m.homeScore === null || m.awayScore === null)
        )
          console.warn(
            `Partido ${m.id}: sin marcador reglamentario fiable; no se puntúa.`,
          );
      }
      for (const [path, value] of metadata)
        batch.set(db.doc(path), value, { merge: true });
      await batch.commit();
    }
    const oldRounds = roundMetadata(oldFixtures, policyFrom);
    const updates = [...roundMetadata(fixtures, policyFrom)].filter(
      ([rid, value]) =>
        previousData?.deliverySchemaVersion !== 2 ||
        JSON.stringify(oldRounds.get(rid)) !== JSON.stringify(value),
    );
    for (let i = 0; i < updates.length; i += 400) {
      const batch = db.batch();
      for (const [rid, { submissionDeadlineMillis, ...value }] of updates.slice(
        i,
        i + 400,
      ))
        batch.set(
          db.doc(`rounds/${rid}`),
          {
            ...value,
            submissionDeadline:
              submissionDeadlineMillis === null
                ? null
                : Timestamp.fromMillis(submissionDeadlineMillis),
          },
          { merge: true },
        );
      await batch.commit();
    }
    await ref.set({
      ...data,
      deliverySchemaVersion: 2,
      deliveryPolicyFrom: policyFrom,
    });
    console.log(
      `${seasonId}: ${fixtures.length} partidos disponibles, ${changed.length} modificados.`,
    );
  }
  return cache;
}

export async function scoringCalendar(
  db: Firestore,
  seasonId: string,
  cache: Map<string, Match[]>,
  policies = new Map<string, string>(),
) {
  if (cache.has(seasonId)) return cache.get(seasonId)!;
  const ref = db.doc(`calendars/${seasonId}`);
  const snapshot = await ref.get();
  let fixtures: Match[];
  if (snapshot.exists) {
    fixtures = decodeCalendar(snapshot.data()!);
    if (snapshot.data()!.deliveryPolicyFrom)
      policies.set(seasonId, snapshot.data()!.deliveryPolicyFrom);
  } else {
    // One-time backfill for archived game seasons, which the provider no longer returns.
    const legacy = await db
      .collection("matches")
      .where("seasonId", "==", seasonId)
      .get();
    fixtures = legacy.docs.map(
      (doc) => ({ ...doc.data(), id: doc.id }) as Match,
    );
    if (fixtures.length) await ref.set(snapshotData(seasonId, fixtures));
    console.log(
      `${seasonId}: migración histórica, ${fixtures.length} partidos leídos una sola vez.`,
    );
  }
  cache.set(seasonId, fixtures);
  return fixtures;
}
