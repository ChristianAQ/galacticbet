import type { SnapshotMetadata } from "firebase/firestore";

/**
 * Offline, a one-shot Firestore read does not fail: it answers from the
 * in-memory cache, which is empty. Treat that as "no connection" so callers
 * keep what they already show (and never store an empty list as the truth).
 */
export function fromServer<T extends { metadata: SnapshotMetadata }>(snapshot: T): T {
  if (snapshot.metadata.fromCache)
    throw Object.assign(new Error("Sin conexión con Firestore."), {
      code: "offline",
    });
  return snapshot;
}
