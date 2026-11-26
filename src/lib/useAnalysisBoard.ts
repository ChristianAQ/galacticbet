import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { decodeAnalysisBoard, type AnalysisBoard } from "./bettingAnalysis";
import { REFRESH_EVENT } from "./chrome";
import { db } from "./firebase";
import { fromServer } from "./firestoreOnline";

const TTL = 5 * 60_000;
let cached: { at: number; board: AnalysisBoard | null } | undefined;
let pending: Promise<AnalysisBoard | null> | undefined;

/** One public document with the latest analyses; read at most every five minutes. */
function loadBoard(force = false) {
  if (!force && cached && Date.now() - cached.at < TTL) return Promise.resolve(cached.board);
  if (!pending)
    pending = (
      db
        ? getDoc(doc(db, "analysis", "football"))
            .then(fromServer)
            .then((s) => decodeAnalysisBoard(s.data()))
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

export function useAnalysisBoard(enabled: boolean) {
  const [state, setState] = useState<{ board: AnalysisBoard | null; loading: boolean; error: boolean }>(() => ({
    board: cached?.board ?? null,
    loading: enabled && !cached,
    error: false,
  }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const read = (force: boolean) =>
      loadBoard(force).then(
        (board) => {
          if (active) setState({ board, loading: false, error: false });
        },
        () => {
          // A board already on screen stays; only an empty screen shows the error.
          if (active) setState((s) => ({ ...s, loading: false, error: !s.board }));
        },
      );
    void read(attempt > 0);
    const again = () => void read(true);
    window.addEventListener(REFRESH_EVENT, again);
    return () => {
      active = false;
      window.removeEventListener(REFRESH_EVENT, again);
    };
  }, [enabled, attempt]);
  return { ...state, retry: () => setAttempt((a) => a + 1) };
}
