import { doc, getDoc } from "firebase/firestore";
import { fromServer } from "./firestoreOnline";
import { db } from "./firebase";
import { createMemoryCache } from "./memoryCache";
import { validDirectory, type TeamDirectory } from "./teamExplorer";
const cache = createMemoryCache(1);
const key = `galacticbet:teams:v1:${import.meta.env.VITE_FIREBASE_PROJECT_ID}`;
export function loadTeamDirectory() {
  return cache.read<TeamDirectory | null>(
    key,
    async () => {
      try {
        const raw = localStorage.getItem(key);
        if (raw && raw.length < 250000) {
          const saved = JSON.parse(raw);
          if (
            saved.at <= Date.now() &&
            Date.now() - saved.at < 3600000 &&
            validDirectory(saved.data)
          )
            return saved.data;
        }
      } catch {
        /* Storage is optional. */
      }
      if (!db) return null;
      const data = fromServer(
        await getDoc(doc(db, "teamDirectory", "featured")),
      ).data();
      if (!validDirectory(data)) return null;
      try {
        localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
      } catch {
        /* Memory cache remains available. */
      }
      return data;
    },
    120000,
  );
}
