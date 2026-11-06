import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { createMemoryCache } from "./memoryCache";
import { validLeagueStats, type LeagueStats } from "./leagueStats";
const cache = createMemoryCache(6);
export function useLeagueStats(seasonId: string, demo: boolean) {
  const [state, setState] = useState<{
    id: string;
    data?: LeagueStats | null;
    error?: boolean;
  }>({ id: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (demo || !/^(PD|CL|PL)-\d{4}$/.test(seasonId)) return;
    setState({ id: seasonId });
    void cache
      .read(
        seasonId,
        async () => {
          if (!db) throw new Error("Firebase no configurado");
          const data = (await getDoc(doc(db, "leagueStats", seasonId))).data();
          if (data === undefined) return null;
          if (
            !validLeagueStats(data) ||
            data.seasonId !== seasonId ||
            data.competition !== seasonId.split("-")[0]
          )
            throw new Error("Estadísticas incompatibles");
          return data;
        },
        15 * 60000,
      )
      .then(
        (data) => {
          if (active) setState({ id: seasonId, data });
        },
        () => {
          if (active) setState({ id: seasonId, error: true });
        },
      );
    return () => {
      active = false;
    };
  }, [seasonId, demo, attempt]);
  const enabled = !demo && /^(PD|CL|PL)-\d{4}$/.test(seasonId);
  return {
    data: enabled && state.id === seasonId ? state.data : null,
    error: enabled && state.id === seasonId && Boolean(state.error),
    loading:
      enabled &&
      (state.id !== seasonId || (state.data === undefined && !state.error)),
    retry: () => {
      cache.clear();
      setAttempt((a) => a + 1);
    },
  };
}
