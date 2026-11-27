import { COMPETITION_CODES } from "./competitions";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import type { Mode } from "./domain";
import { validPotCents } from "./pot";

export function gameSeasonId(competition: string) {
  const now = new Date();
  const year = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
  return `${competition}-${year}`;
}

export async function createPrivateGroup(
  store: Firestore,
  uid: string,
  name: string,
  mode: Mode,
  potCents = 0,
) {
  if (!validPotCents(potCents))
    throw new Error("La aportación debe estar entre 0 y 1.000 €.");
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 60)
    throw new Error("El nombre del grupo debe tener entre 3 y 60 caracteres.");
  const group = doc(collection(store, "groups"));
  const batch = writeBatch(store);
  batch.set(group, {
    name: trimmed,
    ownerId: uid,
    memberIds: [uid],
    createdAt: serverTimestamp(),
    ...(potCents ? { potCents } : {}),
  });
  batch.set(doc(group, "members", uid), {
    userId: uid,
    joinedAt: serverTimestamp(),
  });
  for (const competition of [...COMPETITION_CODES]) {
    const seasonId = gameSeasonId(competition);
    batch.set(doc(group, "gameSeasons", seasonId), {
      competition,
      seasonId,
      mode,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return group.id;
}

/** The same competition one season earlier: «PD-2026» → «PD-2025». */
const previousSeasonId = (id: string) =>
  id.replace(/\d{4}$/, (year) => String(Number(year) - 1));

// Add only missing current seasons. Existing rules and predictions remain immutable.
export async function prepareGroupCompetitions(
  store: Firestore,
  uid: string,
  groupId: string,
) {
  const group = doc(store, "groups", groupId);
  const refs = [...COMPETITION_CODES].map((c) =>
    doc(group, "gameSeasons", gameSeasonId(c)),
  );
  return runTransaction(store, async (tx) => {
    const snapshot = await tx.get(group);
    if (!snapshot.exists() || snapshot.data().ownerId !== uid)
      throw new Error(
        "Solo el administrador puede preparar las competiciones del grupo.",
      );
    const seasons = await Promise.all(refs.map((ref) => tx.get(ref)));
    // A new season keeps the mode the group played the previous one with.
    const earlier = seasons.some((s) => s.exists())
      ? []
      : await Promise.all(
          refs.map((ref) =>
            tx.get(doc(group, "gameSeasons", previousSeasonId(ref.id))),
          ),
        );
    const existing = [...seasons, ...earlier].find((s) => s.exists());
    const mode = existing?.data()?.mode === "exact" ? "exact" : "classic";
    seasons.forEach((season, i) => {
      if (!season.exists())
        tx.set(refs[i], {
          competition: COMPETITION_CODES[i],
          seasonId: refs[i].id,
          mode,
          createdAt: serverTimestamp(),
        });
    });
    return seasons.some((season) => !season.exists());
  });
}
