/**
 * Small private snapshots kept on this device (session, groups, seasons,
 * standings) so a launch paints what you saw last time while Firebase catches
 * up. Each entry is size-capped, namespaced per account by the caller and
 * wiped on sign-out. Public data (calendar, news, match details) has its own
 * caches.
 */
type StorageAccess = () => Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

export const SNAPSHOT_PREFIX = "galacticbet:private:v1:";
const MAX_CHARS = 250_000;

export function createSnapshotStore(storage: StorageAccess) {
  function read<T>(
    key: string,
    maxAge: number,
    valid: (value: unknown) => value is T,
  ): { value: T; savedAt: number } | undefined {
    try {
      const raw = storage().getItem(SNAPSHOT_PREFIX + key);
      if (!raw || raw.length > MAX_CHARS) return undefined;
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== "object") return undefined;
      const { savedAt, value } = data as { savedAt?: unknown; value?: unknown };
      if (
        typeof savedAt !== "number" ||
        !Number.isFinite(savedAt) ||
        savedAt > Date.now() ||
        Date.now() - savedAt >= maxAge ||
        !valid(value)
      )
        return undefined;
      return { value, savedAt };
    } catch {
      /* Private mode, full or corrupt storage: behave as if nothing was saved. */
      return undefined;
    }
  }
  function write(key: string, value: unknown) {
    try {
      const raw = JSON.stringify({ savedAt: Date.now(), value });
      if (raw.length > MAX_CHARS) storage().removeItem(SNAPSHOT_PREFIX + key);
      else storage().setItem(SNAPSHOT_PREFIX + key, raw);
    } catch {
      /* The network copy is still on screen; the next launch just waits for it. */
    }
  }
  function remove(key: string) {
    try {
      storage().removeItem(SNAPSHOT_PREFIX + key);
    } catch {
      /* Nothing to forget. */
    }
  }
  /** Sign-out: forget every private snapshot of every account. */
  function clear() {
    try {
      const store = storage();
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key?.startsWith(SNAPSHOT_PREFIX)) keys.push(key);
      }
      for (const key of keys) store.removeItem(key);
    } catch {
      /* Storage unavailable: there is nothing stored either. */
    }
  }
  return { read, write, remove, clear };
}

export const snapshots = createSnapshotStore(() => window.localStorage);
