import type { Match } from "./domain";
import {
  insightFitsMatch,
  validMatchInsight,
  type MatchInsight,
} from "./matchInsightsData";

export const MATCH_INSIGHT_TTL = 15 * 60_000;
const MAX_ENTRIES = 12;
const MAX_CHARS = 180_000;
interface Entry {
  key: string;
  savedAt: number;
  insight: MatchInsight | null;
}
type StorageAccess = () => Pick<Storage, "getItem" | "setItem">;

// Public, on-demand data only. Also caches missing details to avoid repeated reads.
export function createMatchInsightLoader(
  project: string,
  storage: StorageAccess,
  fetchInsight: (id: string) => Promise<unknown>,
) {
  const storageKey = `galacticbet:match-insights:v1:${project}`;
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<MatchInsight | null>>();
  let restored = false;
  const fresh = (time: number, ttl = MATCH_INSIGHT_TTL) =>
    Number.isFinite(time) && time <= Date.now() && Date.now() - time < ttl;
  function restore() {
    if (restored) return;
    restored = true;
    try {
      const raw = storage().getItem(storageKey);
      if (!raw || raw.length > MAX_CHARS) return;
      const data: unknown = JSON.parse(raw);
      if (!Array.isArray(data) || data.length > MAX_ENTRIES) return;
      for (const value of data) {
        if (
          value &&
          typeof value.key === "string" &&
          value.key.length < 250 &&
          fresh(value.savedAt) &&
          (value.insight === null || validMatchInsight(value.insight))
        )
          entries.set(value.key, value);
      }
    } catch {
      /* Storage may be unavailable; keep the memory cache. */
    }
  }
  function save() {
    for (const [key, entry] of entries)
      if (!fresh(entry.savedAt)) entries.delete(key);
    while (entries.size > MAX_ENTRIES)
      entries.delete(entries.keys().next().value!);
    let raw = JSON.stringify([...entries.values()]);
    while (raw.length > MAX_CHARS && entries.size) {
      entries.delete(entries.keys().next().value!);
      raw = JSON.stringify([...entries.values()]);
    }
    try {
      storage().setItem(storageKey, raw);
    } catch {
      /* Memory remains usable. */
    }
  }
  return (
    match: Pick<Match, "id" | "competition" | "utcDate">,
    ttl = MATCH_INSIGHT_TTL,
  ): Promise<MatchInsight | null> => {
    if (match.id.startsWith("demo-")) return Promise.resolve(null);
    restore();
    const key = `${match.competition}:${match.id}:${match.utcDate}`;
    const cached = entries.get(key);
    if (
      cached &&
      fresh(cached.savedAt, Math.min(ttl, MATCH_INSIGHT_TTL)) &&
      (!cached.insight || insightFitsMatch(cached.insight, match))
    )
      return Promise.resolve(cached.insight);
    const request = pending.get(key);
    if (request) return request;
    const next = Promise.resolve()
      .then(() => fetchInsight(match.id))
      .then((value) => {
        if (value !== null && !validMatchInsight(value))
          throw new Error("Información del partido no compatible.");
        const insight = value && insightFitsMatch(value, match) ? value : null;
        entries.delete(key);
        entries.set(key, { key, savedAt: Date.now(), insight });
        save();
        return insight;
      })
      .finally(() => pending.delete(key));
    pending.set(key, next);
    return next;
  };
}
