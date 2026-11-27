import { useEffect, useRef, useState } from "react";
import { loadClosedEntries, loadMyPicks } from "./customCompetitionData";
import type { PredictionValue } from "./domain";

/** A clock that ticks every half minute: enough to close picks at kick-off. */
export function useClock(step = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), step);
    return () => window.clearInterval(id);
  }, [step]);
  return now;
}

/** Rounds the server doesn't consider closed yet are read again this often. */
const RETRY_MS = 20_000;
const MAX_RETRIES = 15;

/**
 * Everyone's sealed slips, by round, for the rounds that have closed (each
 * round is fetched once and kept on the device: its slips can't change any
 * more). Null while loading.
 */
export function useClosedEntries(
  cid: string,
  closed: { id: string; deadline: number }[],
  uid: string,
  enabled = true,
): Record<string, Record<string, Record<string, PredictionValue>>> | null {
  const key = closed.map((r) => `${r.id}@${r.deadline}`).join();
  const [state, setState] = useState<{
    owner: string;
    entries: Record<string, Record<string, Record<string, PredictionValue>>>;
  } | null>(null);
  const owner = `${cid}:${uid}`;
  // Retries are counted afresh for each competition and each newly closed round.
  const scope = `${owner}|${key}`;
  const [retries, setRetries] = useState({ scope: "", n: 0 });
  const attempt = retries.scope === scope ? retries.n : 0;
  useEffect(() => {
    if (!uid || !cid) return setState({ owner, entries: {} });
    if (!enabled) return;
    let live = true;
    let retry = 0;
    void loadClosedEntries(cid, closed).then((entries) => {
      if (!live) return;
      setState({ owner, entries });
      // Closed by this device's clock but not yet by the server's (or offline).
      if (attempt < MAX_RETRIES && closed.some((r) => !entries[r.id]))
        retry = window.setTimeout(
          () => setRetries((r) => ({ scope, n: (r.scope === scope ? r.n : 0) + 1 })),
          RETRY_MS,
        );
    });
    return () => {
      live = false;
      window.clearTimeout(retry);
    };
    // The list changes identity on every tick; its key only when a round closes or moves.
  }, [cid, uid, key, enabled, attempt]);
  // While a newly closed round loads, the previous slips of the same competition stay.
  return state && state.owner === owner ? state.entries : null;
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
