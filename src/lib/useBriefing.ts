import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { BRIEFING_DOC, decodeBriefing, type Briefing } from "./briefing";
import { REFRESH_EVENT } from "./chrome";
import { db } from "./firebase";
import { fromServer } from "./firestoreOnline";

const TTL = 10 * 60_000;
let cached: { at: number; briefing: Briefing | null } | undefined;
let pending: Promise<Briefing | null> | undefined;

/** One public document, renewed a few times a day; read at most every ten minutes. */
function loadBriefing(force = false) {
  if (!force && cached && Date.now() - cached.at < TTL) return Promise.resolve(cached.briefing);
  if (!pending)
    pending = (
      db
        ? getDoc(doc(db, BRIEFING_DOC))
            .then(fromServer)
            .then((s) => decodeBriefing(s.data()))
        : Promise.resolve(null)
    )
      .then((briefing) => {
        cached = { at: Date.now(), briefing };
        return briefing;
      })
      .finally(() => {
        pending = undefined;
      });
  return pending;
}

/** The AI's front page; a failed read keeps what is on screen (or shows nothing). */
export function useBriefing(enabled: boolean) {
  const [briefing, setBriefing] = useState<Briefing | null>(() => (enabled ? (cached?.briefing ?? null) : null));
  useEffect(() => {
    if (!enabled) {
      setBriefing(null);
      return;
    }
    let active = true;
    const read = (force: boolean) =>
      loadBriefing(force).then(
        (next) => {
          if (active) setBriefing(next);
        },
        () => {
          /* Optional section: the rest of Inicio does not depend on it. */
        },
      );
    void read(false);
    const again = () => void read(true);
    window.addEventListener(REFRESH_EVENT, again);
    return () => {
      active = false;
      window.removeEventListener(REFRESH_EVENT, again);
    };
  }, [enabled]);
  return briefing;
}
