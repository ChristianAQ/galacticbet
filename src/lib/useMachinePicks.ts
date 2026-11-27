import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { REFRESH_EVENT } from "./chrome";
import { db } from "./firebase";
import { fromServer } from "./firestoreOnline";
import { SEASON_ID, decodeMachinePicks, machinePicksPath, type MachinePicks } from "./machinePicks";

const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; picks: MachinePicks | null }>();
const pending = new Map<string, Promise<MachinePicks | null>>();
const NONE = new Map<string, MachinePicks>();

/** One public document per season, changed only before rounds close: read at most every ten minutes. */
function loadSeason(seasonId: string, force = false) {
  const cached = cache.get(seasonId);
  if (!force && cached && Date.now() - cached.at < TTL) return Promise.resolve(cached.picks);
  let load = pending.get(seasonId);
  if (!load) {
    load = (
      db
        ? getDoc(doc(db, machinePicksPath(seasonId)))
            .then(fromServer)
            .then((s) => decodeMachinePicks(s.data(), seasonId))
        : Promise.resolve(null)
    )
      .then((picks) => {
        cache.set(seasonId, { at: Date.now(), picks });
        return picks;
      })
      .finally(() => pending.delete(seasonId));
    pending.set(seasonId, load);
  }
  return load;
}

/** The slips of «IA» and «Favorito» of these seasons; a season that fails to load is just missing. */
export function useMachinePicks(seasonIds: string[], enabled = true) {
  const key = [...new Set(seasonIds.filter((id) => SEASON_ID.test(id)))].sort().join(",");
  const [state, setState] = useState<{ key: string; picks: Map<string, MachinePicks> }>({ key: "", picks: NONE });
  useEffect(() => {
    if (!enabled || !key) return;
    let active = true;
    const read = (force: boolean) =>
      Promise.all(key.split(",").map((id) => loadSeason(id, force).catch(() => null))).then((list) => {
        if (!active) return;
        setState({ key, picks: new Map(list.flatMap((p) => (p ? [[p.seasonId, p]] : []))) });
      });
    void read(false);
    const again = () => void read(true);
    window.addEventListener(REFRESH_EVENT, again);
    return () => {
      active = false;
      window.removeEventListener(REFRESH_EVENT, again);
    };
  }, [key, enabled]);
  return state.key === key ? state.picks : NONE;
}
