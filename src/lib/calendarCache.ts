import { isCompetition } from "./competitions";
import { calendarMatch, validCalendarMatch } from "./calendar";
import type { Match } from "./domain";

export const CALENDAR_TTL = 5 * 60_000;
const MAX_CACHE_CHARS = 1_500_000;
type StorageAccess = () => Pick<Storage, "getItem" | "setItem">;

// Only public fixtures persist. Private forecasts and closure documents never enter here.
export function createCalendarLoader(
  project: string,
  storage: StorageAccess,
  fetchMatches: () => Promise<Match[]>,
) {
  const key = `galacticbet:calendar:v1:${project}`;
  let cached: { savedAt: number; matches: Match[] } | undefined;
  let pending: Promise<Match[]> | undefined;
  let restored = false;
  function restore() {
    if (restored) return;
    restored = true;
    try {
      const raw = storage().getItem(key);
      if (!raw || raw.length > MAX_CACHE_CHARS) return;
      const data = JSON.parse(raw);
      if (
        Number.isFinite(data.savedAt) &&
        data.savedAt <= Date.now() &&
        Date.now() - data.savedAt < CALENDAR_TTL &&
        Array.isArray(data.matches) &&
        data.matches.length > 0 &&
        data.matches.every(validCalendarMatch)
      )
        cached = {
          savedAt: data.savedAt,
          matches: data.matches
            .filter((m: Match) => isCompetition(m.competition))
            .map(calendarMatch),
        };
    } catch {
      /* Safari private mode / full storage: use memory instead. */
    }
  }
  /** `maxAge` lets pull-to-refresh ask for fresher data than the usual TTL. */
  return function load({ maxAge = CALENDAR_TTL }: { maxAge?: number } = {}) {
    restore();
    if (
      cached &&
      Date.now() >= cached.savedAt &&
      Date.now() - cached.savedAt < Math.min(maxAge, CALENDAR_TTL)
    )
      return Promise.resolve(cached.matches);
    if (pending) return pending;
    pending = Promise.resolve()
      .then(fetchMatches)
      .then((matches) => {
        const clean = matches
          .filter((m) => isCompetition(m.competition))
          .map(calendarMatch)
          .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
        if (!clean.length)
          throw new Error(
            "Aún no hay calendarios. Ejecuta «Synchronize football and standings» en GitHub Actions.",
          );
        cached = { savedAt: Date.now(), matches: clean };
        try {
          const raw = JSON.stringify(cached);
          if (raw.length <= MAX_CACHE_CHARS) storage().setItem(key, raw);
        } catch {
          /* Memory cache remains usable without persistent storage. */
        }
        return clean;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
