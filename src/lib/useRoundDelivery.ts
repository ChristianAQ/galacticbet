import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";
import type { Match } from "./domain";
import { roundRequirements } from "./roundDelivery";
import { readableError } from "../components/ui";

export function useRoundDelivery({
  groupId,
  seasonId,
  roundId,
  userId,
  matches,
  demo,
  demoSealed,
}: {
  groupId: string;
  seasonId: string;
  roundId: string;
  userId: string;
  matches: Match[];
  demo: boolean;
  demoSealed: boolean;
}) {
  const key = `${userId}:${groupId}:${seasonId}:${roundId}`;
  const [meta, setMeta] = useState({
    key: "",
    ids: [] as string[],
    deadline: null as number | null,
    prepared: false,
    // A cached answer is not the server's: still checking, not «not prepared».
    fromCache: false,
    error: "",
  });
  const [attendance, setAttendance] = useState({
    key: "",
    ids: [] as string[],
    ready: false,
    error: "",
  });
  useEffect(() => {
    if (!db || demo || !groupId || !seasonId || !roundId) return;
    return onSnapshot(
      doc(db, "rounds", roundId),
      { includeMetadataChanges: true },
      (snap) => {
        const data = snap.data();
        const ids = Array.isArray(data?.requiredMatchIds)
          ? (data.requiredMatchIds.filter(
              (id: unknown) => typeof id === "string",
            ) as string[])
          : [];
        setMeta({
          key,
          ids,
          deadline: data?.submissionDeadline?.toMillis() ?? null,
          prepared:
            !snap.metadata.fromCache && Array.isArray(data?.requiredMatchIds),
          fromCache: snap.metadata.fromCache,
          error: "",
        });
      },
      (e) =>
        setMeta({
          key,
          ids: [],
          deadline: null,
          prepared: false,
          fromCache: false,
          error: readableError(e),
        }),
    );
  }, [key, demo]);
  useEffect(() => {
    if (!db || demo || !groupId || !seasonId || !roundId) return;
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
      { includeMetadataChanges: true },
      (snap) => {
        setAttendance({
          key,
          ids: Object.keys(snap.data()?.members || {}),
          ready: !snap.metadata.fromCache && !snap.metadata.hasPendingWrites,
          error: "",
        });
      },
      (e) =>
        setAttendance({ key, ids: [], ready: false, error: readableError(e) }),
    );
  }, [key, demo]);
  if (demo) {
    const local = roundRequirements(matches);
    return {
      requiredIds: local.matchIds,
      deadline: local.deadline,
      prepared: true,
      checking: false,
      completedIds: [
        "demo-alex",
        "demo-marta",
        ...(demoSealed ? [userId] : []),
      ],
      attendanceReady: true,
      error: "",
    };
  }
  const fallback = roundRequirements(matches);
  return {
    requiredIds:
      meta.key === key && meta.prepared ? meta.ids : fallback.matchIds,
    deadline:
      meta.key === key && meta.prepared ? meta.deadline : fallback.deadline,
    checking: meta.key !== key || meta.fromCache,
    prepared: meta.key === key && meta.prepared,
    completedIds: attendance.key === key ? attendance.ids : [],
    attendanceReady: attendance.key === key && attendance.ready,
    error:
      (meta.key === key && meta.error) ||
      (attendance.key === key && attendance.error) ||
      "",
  };
}
