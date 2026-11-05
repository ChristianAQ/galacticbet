import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPETITION_CODES } from "../src/lib/competitions";
import type { Match } from "../src/lib/domain";
import { type ApiMatch } from "./normalize";
import { syncCalendars } from "./calendarSync";
import { recompute } from "./recompute";
import { syncMatchInsights } from "./syncMatchInsights";
import { syncNews } from "./syncNews";
import { syncTeamDirectory } from "./syncTeamDirectory";

export const SYNC_STATUS_DOC = "syncStatus/football";

/** Official Football-Data calendars and scoring, followed by optional ESPN enrichment. */
export async function officialSync(db: Firestore, token: string) {
  async function api<T>(path: string): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`https://api.football-data.org/v4${path}`, {
        headers: { "X-Auth-Token": token },
        signal: AbortSignal.timeout(25000),
      });
      if (response.ok) return (await response.json()) as T;
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const wait = Math.min(
          30,
          Math.max(2, Number(response.headers.get("Retry-After")) || 5),
        );
        console.warn(
          `Football-Data HTTP ${response.status}: reintento en ${wait}s`,
        );
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw new Error(
        `Football-Data HTTP ${response.status} en ${path}. Comprueba acceso, cuota y plan.`,
      );
    }
    throw new Error("Reintentos agotados");
  }

  const now = new Date();
  const seasonYear = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
  const cache = new Map<string, Match[]>();
  const policies = new Map<string, string>();
  const available = await api<{
    competitions: {
      code: string;
      name: string;
      emblem: string;
      currentSeason?: { startDate: string };
    }[];
  }>("/competitions");
  for (const code of COMPETITION_CODES) {
    try {
      const competition = available.competitions.find((c) => c.code === code);
      if (!competition)
        throw new Error(`Competición ${code} no disponible en este plan.`);
      const { matches } = await api<{ matches: ApiMatch[] }>(
        `/competitions/${code}/matches?season=${seasonYear}`,
      );
      if (!Array.isArray(matches) || !matches.length)
        throw new Error(
          `Calendario ${code} vacío; se conserva la base anterior.`,
        );
      if (
        matches.some(
          (match) => match.season.startDate.slice(0, 4) !== String(seasonYear),
        )
      )
        throw new Error(
          `El proveedor no ha devuelto la temporada ${seasonYear}/${seasonYear + 1}`,
        );
      await db.doc(`competitions/${code}`).set(
        {
          code,
          name: competition.name,
          emblem: competition.emblem,
          syncedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      const normalized = await syncCalendars(db, code, matches, policies);
      for (const [seasonId, fixtures] of normalized)
        cache.set(seasonId, fixtures);
      console.log(`${code}: ${matches.length} partidos sincronizados.`);
    } catch (error) {
      console.warn(
        `::warning::${code}: ${error instanceof Error ? error.message : "No se pudo sincronizar"}. Las otras competiciones continuarán.`,
      );
    }
  }
  if (!cache.size)
    throw new Error(
      "No se pudo sincronizar ninguna competición. Revisa acceso y disponibilidad del proveedor.",
    );
  await recompute(db, cache, policies);
  try {
    await syncTeamDirectory(db, api);
  } catch {
    console.warn(
      "Plantillas: no se pudo actualizar el directorio; los resultados oficiales están guardados.",
    );
  }
  let espnBlocked = false;
  if (process.env.ESPN_NEWS !== "false") {
    try {
      espnBlocked = (await syncNews(db)) === false;
    } catch {
      console.warn(
        "::warning::No se pudo actualizar la edición de noticias. Los resultados oficiales están guardados.",
      );
    }
  }
  if (!espnBlocked && process.env.ESPN_MATCH_DETAILS !== "false") {
    try {
      const details = await syncMatchInsights(db, [...cache.values()].flat());
      if (details.stopped)
        console.warn(
          "::warning::La consulta complementaria de ESPN se interrumpió. Revisa el resumen de detalles; los resultados y puntos oficiales ya se han sincronizado.",
        );
    } catch {
      // Optional enrichment must never prevent official results or points updating.
      console.warn(
        "::warning::No se pudieron actualizar los detalles complementarios de ESPN. Los calendarios y puntos oficiales ya se han sincronizado.",
      );
    }
  }
  await db
    .doc(SYNC_STATUS_DOC)
    .set({ fullSyncAt: Date.now() }, { merge: true });
}
