import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { isCompetition, type CompetitionCode } from "./competitions";
import { preferenceStore } from "./preferences";
import { usePreferences } from "./useGroupSelection";

/**
 * The competition chosen in Ligas, Quiniela or Clasificación — official or one
 * of your own — is one choice for the three, like the official ones always
 * were. A link becomes the choice: ?liga=, in Ligas ?competition=, and an
 * official round (?round=PD-2026-…, the avisos) or a group (?group=, «Hacer
 * quiniela» from a group), which mean the official quiniela, not the league
 * you had open. A page shown again with an older URL follows the newer choice
 * instead of undoing it.
 */
export function useLeagueChoice(uid: string, { officialParam = false } = {}) {
  const [params, setParams] = useSearchParams();
  const preferences = usePreferences(uid);
  const urlLiga = params.get("liga") || "";
  const urlCompetition = officialParam ? params.get("competition") : null;
  const urlRound = urlLiga ? "" : params.get("round") || "";
  const roundCode = /^[A-Z]{2}-\d{4}-/.test(urlRound) ? urlRound.split("-")[0] : "";
  const officialRound = isCompetition(roundCode);
  const urlGroup = urlLiga ? "" : params.get("group") || "";
  const explicitOfficial = isCompetition(urlCompetition) || officialRound || Boolean(urlGroup);
  const liga = urlLiga || (explicitOfficial || !uid ? "" : preferences.liga);
  const competition: CompetitionCode = isCompetition(urlCompetition)
    ? urlCompetition
    : officialRound
      ? (roundCode as CompetitionCode)
      : preferences.competition;

  // What the URL asks for becomes everyone's choice, but only when the URL
  // itself changes (a link, a chip). A page shown again keeps its old URL and
  // re-runs its effects: that must not bring an old choice back.
  const urlKey = urlLiga
    ? `liga:${urlLiga}`
    : isCompetition(urlCompetition)
      ? `competition:${urlCompetition}`
      : officialRound
        ? `round:${urlRound}`
        : urlGroup
          ? `group:${urlGroup}`
          : "";
  const lastUrl = useRef<string | null>(null);
  useEffect(() => {
    if (lastUrl.current === urlKey) return;
    lastUrl.current = urlKey;
    if (!uid || !urlKey) return;
    if (urlLiga) preferenceStore.update(uid, { liga: urlLiga });
    else if (explicitOfficial) preferenceStore.update(uid, { competition, liga: "" });
  }, [uid, urlKey, urlLiga, explicitOfficial, competition]);

  // Chosen elsewhere meanwhile: this page's URL follows.
  const choice = `${preferences.liga}|${preferences.competition}`;
  const seen = useRef(choice);
  useEffect(() => {
    if (!uid || seen.current === choice) return;
    seen.current = choice;
    const sameLiga = urlLiga === preferences.liga;
    const sameOfficial =
      Boolean(preferences.liga) || !officialParam || !params.has("competition") || urlCompetition === preferences.competition;
    if (sameLiga && sameOfficial) return;
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (preferences.liga) next.set("liga", preferences.liga);
        else next.delete("liga");
        if (officialParam && next.has("competition")) next.set("competition", preferences.competition);
        next.delete("round");
        next.delete("season");
        if (Boolean(urlLiga) !== Boolean(preferences.liga)) next.delete("tab");
        return next;
      },
      { replace: true },
    );
    // Only a new choice matters here; the URL is read as it is now.
  }, [uid, choice]);

  /** One of your own competitions, for the three pages. */
  const chooseLiga = (id: string, extra?: (next: URLSearchParams) => void) => {
    if (uid) {
      preferenceStore.update(uid, { liga: id });
      seen.current = `${id}|${preferences.competition}`;
    }
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("liga", id);
        next.delete("round");
        extra?.(next);
        return next;
      },
      { replace: true },
    );
  };
  /** LaLiga, Champions or Premier, for the three pages. */
  const chooseOfficial = (code: CompetitionCode, extra?: (next: URLSearchParams) => void) => {
    if (uid) {
      preferenceStore.update(uid, { competition: code, liga: "" });
      seen.current = `|${code}`;
    }
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("liga");
        next.delete("round");
        if (officialParam) next.set("competition", code);
        extra?.(next);
        return next;
      },
      { replace: true },
    );
  };
  /** Forget a competition you took off your list: back to the official one. */
  const forgetLiga = (id: string) => {
    if (uid && preferences.liga === id) {
      preferenceStore.update(uid, { liga: "" });
      seen.current = `|${preferences.competition}`;
    }
    if (urlLiga === id)
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete("liga");
          next.delete("round");
          next.delete("tab");
          return next;
        },
        { replace: true },
      );
  };
  return { liga, competition, chooseLiga, chooseOfficial, forgetLiga };
}
