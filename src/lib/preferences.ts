import {
  competitionCode,
  isCompetition,
  type CompetitionCode,
} from "./competitions";
export type { CompetitionCode } from "./competitions";
export interface UserPreferences {
  groupId: string;
  competition: CompetitionCode;
  /** A friends' competition chosen in Ligas, Quiniela or Clasificación ("" = the official one). */
  liga: string;
}
interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const PREFERENCES_KEY = "galacticbet:preferences:v1";
const defaults: UserPreferences = { groupId: "", competition: "PD", liga: "" };
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && !value.includes("/");

export function createPreferenceStore(
  storage: () => PreferenceStorage | undefined,
) {
  const memory = new Map<string, UserPreferences>();
  const listeners = new Set<() => void>();
  function read(): Record<string, UserPreferences> {
    try {
      const raw = storage()?.getItem(PREFERENCES_KEY);
      if (!raw || raw.length > 4096) return {};
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return {};
      return Object.fromEntries(
        Object.entries(parsed)
          .slice(-5)
          .flatMap(([uid, value]) => {
            if (!validId(uid) || !value || typeof value !== "object") return [];
            return [
              [
                uid,
                {
                  groupId: validId(value.groupId) ? value.groupId : "",
                  competition: competitionCode(value.competition),
                  liga: validId(value.liga) ? value.liga : "",
                },
              ],
            ];
          }),
      );
    } catch {
      return {};
    }
  }
  function get(uid: string): UserPreferences {
    if (!uid) return defaults;
    const cached = memory.get(uid);
    if (cached) return cached;
    const saved = read();
    const value = Object.hasOwn(saved, uid) ? saved[uid] : defaults;
    memory.set(uid, value);
    if (memory.size > 5) memory.delete(memory.keys().next().value!);
    return value;
  }
  function update(uid: string, patch: Partial<UserPreferences>) {
    if (!uid || !validId(uid)) return;
    const before = get(uid);
    const next = {
      groupId: validId(patch.groupId) ? patch.groupId : before.groupId,
      competition: isCompetition(patch.competition)
        ? patch.competition
        : before.competition,
      liga:
        patch.liga === "" || validId(patch.liga) ? patch.liga : before.liga,
    };
    if (
      next.groupId === before.groupId &&
      next.competition === before.competition &&
      next.liga === before.liga
    )
      return;
    memory.set(uid, next);
    try {
      const saved = read();
      delete saved[uid];
      const entries = [...Object.entries(saved), [uid, next] as const].slice(
        -5,
      );
      storage()?.setItem(
        PREFERENCES_KEY,
        JSON.stringify(Object.fromEntries(entries)),
      );
    } catch {
      /* A blocked/full localStorage must never interrupt navigation. */
    }
    listeners.forEach((fn) => fn());
  }
  return {
    get,
    update,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    refresh() {
      memory.clear();
      listeners.forEach((fn) => fn());
    },
  };
}
export const preferenceStore = createPreferenceStore(() =>
  typeof window === "undefined" ? undefined : window.localStorage,
);

export function resolveSelectedGroup(
  groups: { id: string }[],
  requested: string | null,
  remembered: string,
) {
  return (
    groups.find((g) => g.id === requested)?.id ||
    groups.find((g) => g.id === remembered)?.id ||
    groups[0]?.id ||
    ""
  );
}
