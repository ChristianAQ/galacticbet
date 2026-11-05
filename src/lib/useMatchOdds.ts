import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";
import { decodeOddsBoard, type MatchOdds, type OddsBoard } from "./odds";

const TTL = 10 * 60_000;
let cached: { at: number; board: OddsBoard | null } | undefined;
let pending: Promise<OddsBoard | null> | undefined;

// One public document for every fixture; shared between all open match pages.
function loadOdds() {
  if (cached && Date.now() - cached.at < TTL)
    return Promise.resolve(cached.board);
  if (!pending)
    pending = (
      db
        ? getDoc(doc(db, "odds", "football")).then((s) =>
            decodeOddsBoard(s.data()),
          )
        : Promise.resolve(null)
    )
      .then((board) => {
        cached = { at: Date.now(), board };
        return board;
      })
      .finally(() => {
        pending = undefined;
      });
  return pending;
}

export function useMatchOdds(matchId: string, enabled: boolean) {
  const [state, setState] = useState<{
    id: string;
    odds: MatchOdds | null;
    loading: boolean;
    error: boolean;
  }>({ id: matchId, odds: null, loading: enabled, error: false });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState({ id: matchId, odds: null, loading: true, error: false });
    loadOdds().then(
      (board) => {
        if (active)
          setState({
            id: matchId,
            odds: board?.matches[matchId] ?? null,
            loading: false,
            error: false,
          });
      },
      () => {
        if (active)
          setState({ id: matchId, odds: null, loading: false, error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [matchId, enabled]);
  return state.id === matchId
    ? state
    : { id: matchId, odds: null, loading: enabled, error: false };
}
