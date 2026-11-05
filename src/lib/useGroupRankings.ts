import { useEffect, useState } from "react";
import {
  expireGroupRankings,
  getCachedGroupRankings,
  loadGroupRankings,
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
  const cached = key && group ? getCachedGroupRankings(group) : undefined;
  useEffect(() => {
    if (!key || !group) return;
    let active = true;
    setResult({ key, data: getCachedGroupRankings(group) });
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
    window.addEventListener("focus", refresh);
    window.addEventListener(STANDINGS_UPDATED, scored);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(STANDINGS_UPDATED, scored);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [key]);
  return {
    data: key
      ? result.key === key
        ? result.data || cached
        : cached
      : undefined,
    error: key && result.key === key ? result.error : undefined,
    retry: () => {
      privateCache.clear();
      setAttempt((n) => n + 1);
    },
  };
}
