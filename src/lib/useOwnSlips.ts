import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import type { PredictionValue } from "./domain";
import { db } from "./firebase";
import { snapshots } from "./localSnapshot";
import { decodeDelivery } from "./roundDelivery";

type Slips = Record<string, Record<string, PredictionValue>>;
/** Delivered slips never change: kept on this device for a season (wiped at sign-out like every private snapshot). */
const MAX_AGE = 300 * 24 * 3_600_000;
const NONE: Slips = {};

const isSlips = (value: unknown): value is Slips =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value as object).every((picks) => Boolean(picks) && typeof picks === "object" && !Array.isArray(picks));

/**
 * Your delivered slips of these rounds (`PD-2026-…`) in a group, for your
 * forecaster's profile: one read per round the first time, none after.
 */
export function useOwnSlips(uid: string, groupId: string, roundIds: string[], enabled: boolean) {
  const key = [...roundIds].sort().join(",");
  const [state, setState] = useState<{ key: string; slips: Slips; ready: boolean }>({ key: "", slips: NONE, ready: false });
  useEffect(() => {
    if (!enabled || !uid || !groupId || !db) return;
    let active = true;
    const store = `${uid}:slips:${groupId}`;
    const saved = snapshots.read(store, MAX_AGE, isSlips)?.value ?? {};
    const wanted = key ? key.split(",") : [];
    const missing = wanted.filter((rid) => !saved[rid]);
    const done = (slips: Slips) => active && setState({ key, slips, ready: true });
    if (!missing.length) {
      done(saved);
      return;
    }
    void Promise.all(
      missing.map(async (rid) => {
        const seasonId = rid.split("-").slice(0, 2).join("-");
        try {
          const snap = await getDoc(doc(db!, "groups", groupId, "gameSeasons", seasonId, "roundEntries", rid, "players", uid));
          return snap.exists() ? ([rid, decodeDelivery(snap.data())] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((read) => {
      const slips = { ...saved, ...Object.fromEntries(read.flatMap((r) => (r ? [r] : []))) };
      snapshots.write(store, slips);
      done(slips);
    });
    return () => {
      active = false;
    };
  }, [uid, groupId, key, enabled]);
  return state.key === key ? state : { slips: NONE, ready: false };
}
