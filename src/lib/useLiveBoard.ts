import { doc, onSnapshot } from "firebase/firestore";
import { createContext, useContext, useEffect, useState } from "react";
import { db } from "./firebase";
import {
  decodeLiveBoard,
  needsLiveWatch,
  type LiveBoard,
  type LiveMatch,
} from "./liveBoard";
import type { Match } from "./domain";

export const STANDINGS_UPDATED = "galacticbet:standings-updated";

/**
 * One document listener, only while fixtures are around kick-off or in play and the
 * page is visible. Each backend update costs one read per open app.
 */
export function useLiveBoard(matches: Match[], enabled: boolean) {
  const [board, setBoard] = useState<LiveBoard | null>(null);
  const [now, setNow] = useState(Date.now());
  const [visible, setVisible] = useState(
    () => document.visibilityState === "visible",
  );
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const visibility = () => {
      setVisible(document.visibilityState === "visible");
      tick();
    };
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const watch = enabled && visible && needsLiveWatch(matches, now);
  useEffect(() => {
    if (!watch || !db) return;
    return onSnapshot(
      doc(db, "live", "football"),
      (snapshot) => setBoard(decodeLiveBoard(snapshot.data())),
      // Display-only data: the cached calendar keeps working without it.
      () => {},
    );
  }, [watch]);
  useEffect(() => {
    if (!enabled) setBoard(null);
  }, [enabled]);
  // Backend scoring finished: let open rankings fetch fresh totals once.
  const scoredAt = board?.scoredAt;
  const [seenScore, setSeenScore] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (scoredAt === undefined) return;
    if (seenScore !== undefined && scoredAt > seenScore)
      window.dispatchEvent(new Event(STANDINGS_UPDATED));
    setSeenScore(scoredAt);
  }, [scoredAt]);
  return { board, watching: watch };
}

export const LiveContext = createContext<{
  board: LiveBoard | null;
  watching: boolean;
}>({ board: null, watching: false });

export function useLiveMatch(id: string): LiveMatch | undefined {
  return useContext(LiveContext).board?.matches.find((m) => m.id === id);
}

/** Re-render once per minute while a fixture is in play, for the extrapolated minute. */
export function useMinuteClock(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
