import { useEffect, useRef, useState } from "react";
import type { CustomMatch } from "./customCompetition";
import { loadMyPicks, loadStartedPicks } from "./customCompetitionData";
import type { PickMap } from "./customPicks";

/** A clock that ticks every half minute: enough to close picks at kick-off. */
export function useClock(step = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), step);
    return () => window.clearInterval(id);
  }, [step]);
  return now;
}

/** Reads of matches the server doesn't consider started yet are retried this often. */
const RETRY_MS = 20_000;
const MAX_RETRIES = 15;

/**
 * Everyone's picks for matches that have started (each match is fetched once
 * and kept on the device: after kick-off they can't change). Null while loading.
 *
 * `enabled`: wait until the competition has loaded (its empty list would wipe
 * the cache). `prune`: the list is every started match of the competition, so
 * cached matches that aren't in it were deleted (only the full list may prune).
 */
export function useStartedPicks(
  cid: string,
  started: Pick<CustomMatch, "id" | "startAt">[],
  uid: string,
  { enabled = true, prune = false }: { enabled?: boolean; prune?: boolean } = {},
): Record<string, PickMap> | null {
  const key = started.map((m) => `${m.id}@${m.startAt}`).join();
  const [state, setState] = useState<{ owner: string; picks: Record<string, PickMap> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const owner = `${cid}:${uid}`;
  useEffect(() => {
    if (!uid || !cid) return setState({ owner, picks: {} });
    if (!enabled) return;
    let live = true;
    let retry = 0;
    void loadStartedPicks(cid, started, { prune }).then((picks) => {
      if (!live) return;
      setState({ owner, picks });
      // Kicked off by this device's clock but not yet by the server's (or offline).
      if (attempt < MAX_RETRIES && started.some((m) => !picks[m.id]))
        retry = window.setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
    });
    return () => {
      live = false;
      window.clearTimeout(retry);
    };
    // The list changes identity on every tick; its key only when a match starts or moves.
  }, [cid, uid, key, enabled, prune, attempt]);
  // While a newly started match loads, the previous picks of the same competition stay.
  return state && state.owner === owner ? state.picks : null;
}

/** Your picks for matches still open (nobody else can read them yet). */
export function useMyPicks(cid: string, mids: string[], uid: string) {
  const key = mids.join();
  const [mine, setMine] = useState<Record<string, string> | null>(null);
  // Match ids repeat between competitions («L1-0»): another one starts empty.
  const owner = useRef("");
  useEffect(() => {
    if (owner.current !== `${cid}:${uid}`) {
      owner.current = `${cid}:${uid}`;
      setMine(null);
    }
    if (!uid || !cid) return setMine({});
    let live = true;
    loadMyPicks(cid, key ? key.split(",") : [], uid).then(
      // Keep picks saved meanwhile that this read may not include.
      (fresh) => live && setMine((prev) => ({ ...(prev || {}), ...fresh })),
      () => live && setMine((prev) => prev || {}),
    );
    return () => {
      live = false;
    };
  }, [cid, uid, key]);
  return [mine, setMine] as const;
}
