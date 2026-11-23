import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";

export interface FollowedCompetition {
  id: string;
  name: string;
  icon: string | null;
  predictionMode: "exact" | "classic";
}

/**
 * Friends' competitions you follow that have predictions: one more chip in
 * Quiniela and Clasificación, next to LaLiga, Champions and Premier. Kept
 * apart from the competition module so those pages stay light.
 */
export function useFollowedCompetitions(uid: string): FollowedCompetition[] {
  const [list, setList] = useState<FollowedCompetition[]>([]);
  useEffect(() => {
    if (!uid || !db) {
      setList([]);
      return;
    }
    return onSnapshot(
      query(collection(db, "customCompetitions"), where("memberIds", "array-contains", uid)),
      (snap) =>
        setList(
          snap.docs
            .map((d) => {
              const data = d.data();
              return {
                id: d.id,
                name: typeof data.name === "string" ? data.name : "",
                icon: typeof data.icon === "string" ? data.icon : null,
                predictionMode: data.predictionMode,
              };
            })
            .filter(
              (c): c is FollowedCompetition =>
                Boolean(c.name) && (c.predictionMode === "exact" || c.predictionMode === "classic"),
            )
            .sort((a, b) => a.name.localeCompare(b.name, "es")),
        ),
      () => setList([]),
    );
  }, [uid]);
  return list;
}
