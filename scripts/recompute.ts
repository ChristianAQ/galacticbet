import { isCompetition } from "../src/lib/competitions";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { isRoundComplete, type Match, type Mode } from "../src/lib/domain";
import type { CompletedRound } from "./notifications";
import { scoringCalendar } from "./calendarSync";
import { migrateSubmissions } from "./migrateSubmissions";
import { decodeDelivery, requiresDelivery } from "../src/lib/roundDelivery";
import {
  resultFingerprint,
  scoreRound,
  sumRounds,
  type Standing,
  type StoredPrediction,
} from "./standings";
/**
 * Returns the rounds this run scored as complete (every fixture played), so
 * the players can be told their points.
 */
export async function recompute(
  db: Firestore,
  cache: Map<string, Match[]>,
  policies = new Map<string, string>(),
): Promise<CompletedRound[]> {
  const completed: CompletedRound[] = [];
  // Current calendars come directly from the API; archived snapshots cost one read per season.
  const profiles = new Map<string, string>();
  const groups = await db.collection("groups").get();
  for (const group of groups.docs) {
    const seasons = await group.ref.collection("gameSeasons").get();
    for (const season of seasons.docs) {
      const config = season.data();
      if (!isCompetition(config.competition)) continue;
      const mode = config.mode as Mode;
      if (!["classic", "exact"].includes(mode))
        throw new Error("Modalidad no válida en backend.");
      const members = group.data().memberIds as string[];
      const fixtures = await scoringCalendar(
        db,
        config.seasonId,
        cache,
        policies,
      );
      const migrated: string[] =
        config.submissionMigrationVersion === 2
          ? config.submissionMigratedMembers || []
          : [];
      const pendingMigration = members.filter((uid) => !migrated.includes(uid));
      if (pendingMigration.length) {
        await migrateSubmissions(season.ref, pendingMigration, fixtures, mode);
        await season.ref.update({
          submissionMigrationVersion: 2,
          submissionMigratedMembers: [...new Set([...migrated, ...members])],
        });
      }
      const byRound = new Map<string, Match[]>();
      for (const match of fixtures) {
        const list = byRound.get(match.roundId) || [];
        list.push(match);
        byRound.set(match.roundId, list);
      }
      const membershipChanged =
        !Array.isArray(config.scoringMembers) ||
        [...config.scoringMembers].sort().join(",") !==
          [...members].sort().join(",");
      const state: Record<string, string> = { ...config.scoringState };
      // An empty/moved/corrected round must clear its previous contribution as well.
      const roundIds = new Set([...byRound.keys(), ...Object.keys(state)]);
      const changedRounds = [...roundIds].filter(
        (rid) =>
          state[rid] !== resultFingerprint(byRound.get(rid) || []) ||
          config.scoringVersion !== 1 ||
          membershipChanged,
      );
      // Nothing to score: do not read standings, profiles or forecasts at all.
      if (!changedRounds.length && !membershipChanged) continue;
      const previous = await season.ref.collection("standings").get();
      const totals = new Map<string, Standing>();
      const finishedRounds: { rid: string; lastKickoff: number }[] = [];
      for (const uid of members) {
        const row = previous.docs.find((d) => d.id === uid);
        totals.set(uid, sumRounds(row?.data().rounds || {}));
      }
      for (const rid of changedRounds) {
        const games = byRound.get(rid) || [];
        const fingerprint = resultFingerprint(games);
        const finished = games.filter(
          (m) =>
            m.status === "FINISHED" &&
            m.homeScore !== null &&
            m.awayScore !== null,
        );
        let predictions: StoredPrediction[] = [];
        if (finished.length) {
          if (requiresDelivery(games, policies.get(config.seasonId))) {
            const entries = await season.ref
              .collection("roundEntries")
              .doc(rid)
              .collection("players")
              .get();
            predictions = entries.docs.flatMap((entry) =>
              Object.entries(decodeDelivery(entry.data())).map(
                ([matchId, value]) =>
                  ({ userId: entry.id, matchId, value }) as StoredPrediction,
              ),
            );
          } else {
            // Existing, already-started rounds retain their previous scoring contract.
            const legacy = await season.ref
              .collection("predictions")
              .where("roundId", "==", rid)
              .get();
            predictions = legacy.docs.map(
              (doc) => doc.data() as StoredPrediction,
            );
          }
        }
        const roundTotals = scoreRound(mode, games, predictions, members);
        for (const [uid, total] of totals) {
          total.rounds[rid] = roundTotals.get(uid) || { points: 0, hits: 0 };
        }
        state[rid] = fingerprint;
        if (isRoundComplete(games) && finished.length)
          finishedRounds.push({
            rid,
            lastKickoff: Math.max(...games.map((m) => Date.parse(m.utcDate) || 0)),
          });
      }
      const batch = db.batch();
      for (const row of previous.docs)
        if (!totals.has(row.id)) batch.delete(row.ref);
      for (const [uid, total] of totals) {
        if (!profiles.has(uid)) {
          const profile = await db.doc(`users/${uid}`).get();
          profiles.set(uid, profile.data()?.name || "Jugador");
        }
        batch.set(season.ref.collection("standings").doc(uid), {
          ...sumRounds(total.rounds),
          name: profiles.get(uid),
          competition: config.competition,
          computedAt: FieldValue.serverTimestamp(),
        });
      }
      batch.update(season.ref, {
        scoringState: state,
        scoringVersion: 1,
        scoringMembers: [...members].sort(),
      });
      // The round state and replacement totals commit atomically; never increment points.
      await batch.commit();
      console.log(`Clasificación actualizada: ${group.id}/${season.id}`);
      const standings = new Map(
        [...totals].map(([uid, total]) => [uid, sumRounds(total.rounds)]),
      );
      for (const { rid, lastKickoff } of finishedRounds)
        completed.push({
          groupId: group.id,
          groupName: group.data().name || "tu grupo",
          competition: config.competition,
          roundId: rid,
          lastKickoff,
          standings,
          names: new Map(members.map((uid) => [uid, profiles.get(uid) || "Jugador"])),
        });
    }
  }
  return completed;
}
