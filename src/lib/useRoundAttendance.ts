import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { readableError } from "../components/ui";
import { db } from "./firebase";

/** Members who delivered a round, live. Only needed when the group has a pot. */
export function useRoundAttendance(
  groupId: string,
  roundId: string,
  enabled = true,
) {
  // Round ids start with their game season id: «PD-2026-REGULAR_SEASON-12».
  const seasonId = roundId.split("-").slice(0, 2).join("-");
  const key = enabled && groupId && roundId ? `${groupId}:${roundId}` : "";
  const [state, setState] = useState({
    key: "",
    ids: [] as string[],
    error: "",
  });
  useEffect(() => {
    if (!db || !key) return;
    return onSnapshot(
      doc(
        db,
        "groups",
        groupId,
        "gameSeasons",
        seasonId,
        "roundAttendance",
        roundId,
      ),
      (snap) =>
        setState({
          key,
          ids: Object.keys(snap.data()?.members || {}),
          error: "",
        }),
      (e) => setState({ key, ids: [], error: readableError(e) }),
    );
  }, [key]);
  return {
    ids: state.key === key ? state.ids : [],
    ready: Boolean(key) && state.key === key,
    error: state.key === key ? state.error : "",
  };
}
