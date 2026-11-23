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

/**
 * Everyone's picks for matches that have started (each match is fetched once
 * and kept on the device: after kick-off they can't change). Null while loading.
 */
export function useStartedPicks(
  cid: string,
  started: Pick<CustomMatch, "id" | "startAt">[],
  uid: string,
): Record<string, PickMap> | null {
  const key = started.map((m) => `${m.id}@${m.startAt}`).join();
  const [state, setState] = useState<{ owner: string; picks: Record<string, PickMap> } | null>(null);
  const owner = `${cid}:${uid}`;
  useEffect(() => {
    if (!uid || !cid) return setState({ owner, picks: {} });
    let live = true;
    void loadStartedPicks(cid, started).then((picks) => live && setState({ owner, picks }));
    return () => {
      live = false;
    };
    // The list changes identity on every tick; its key only when a match starts or moves.
  }, [cid, uid, key]);
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
