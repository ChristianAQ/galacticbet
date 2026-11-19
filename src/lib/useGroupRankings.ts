import { useEffect, useMemo, useState } from "react";
import {
  expireGroupRankings,
  getCachedGroupRankings,
  getStoredGroupRankings,
  loadGroupRankings,
  SEASONS_CHANGED,
  type Group,
} from "./data";
import { readableError } from "../components/ui";
import { privateCache } from "./memoryCache";
import { STANDINGS_UPDATED } from "./useLiveBoard";

/** Shared between Home and Standings; the data service deduplicates requests. */
export function useGroupRankings(userId: string, group?: Group) {
  const [attempt, setAttempt] = useState(0);
  const key =
    userId && group ? JSON.stringify([userId, group.id, group.memberIds]) : "";
  const [result, setResult] = useState<{
    key: string;
    data?: Awaited<ReturnType<typeof loadGroupRankings>>;
    error?: string;
  }>({ key: "" });
  // Last totals seen on this device: painted at once, replaced when fresh ones land.
  const stored = useMemo(
    () => (key && group ? getStoredGroupRankings(group) : undefined),
    [key],
  );
  const cached =
    key && group ? (getCachedGroupRankings(group) ?? stored) : undefined;
  useEffect(() => {
    if (!key || !group) return;
    let active = true;
    // Re-run when an <Activity> page is shown again: keep the totals on screen.
    setResult((previous) =>
      previous.key === key && previous.data
        ? previous
        : { key, data: getCachedGroupRankings(group) ?? stored },
    );
    void loadGroupRankings(group).then(
      (data) => {
        if (active) setResult({ key, data });
      },
      (error: unknown) => {
        if (active) setResult({ key, error: readableError(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [key, attempt]);
  useEffect(() => {
    const refresh = () => {
      if (
        key &&
        group &&
        document.visibilityState === "visible" &&
        !getCachedGroupRankings(group)
      )
        setAttempt((n) => n + 1);
    };
    // A live result was scored: expire totals; hidden pages refetch on return.
    const scored = () => {
      expireGroupRankings();
      refresh();
    };
    // New competitions in this group: totals per season changed shape.
    const seasons = (event: Event) => {
      if ((event as CustomEvent<string>).detail === group?.id) refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener(STANDINGS_UPDATED, scored);
    window.addEventListener(SEASONS_CHANGED, seasons);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(STANDINGS_UPDATED, scored);
      window.removeEventListener(SEASONS_CHANGED, seasons);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [key]);
  const data = key
    ? result.key === key
      ? result.data || cached
      : cached
    : undefined;
  return {
    data,
    // Stored totals stay on screen when a refresh fails (offline, flaky
    // signal); the error only replaces an empty table.
    error: key && result.key === key && !data ? result.error : undefined,
    retry: () => {
      privateCache.clear();
      setAttempt((n) => n + 1);
    },
  };
}
