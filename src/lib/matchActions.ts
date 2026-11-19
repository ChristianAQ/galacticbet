import type { Match } from "./domain";
import { canAddMatchToCalendar, matchCalendarFile } from "./matchPresentation";

/** Public link to a fixture inside the app (hash router). */
export function matchUrl(match: Pick<Match, "id">) {
  return `${location.origin}${location.pathname}#/partido/${encodeURIComponent(match.id)}`;
}

/**
 * Native share sheet when available, clipboard otherwise. Resolves with a short
 * message for the UI («copiado») or "" when the system sheet handled it.
 */
export async function shareOrCopy({
  title,
  text,
  url,
}: {
  title: string;
  text?: string;
  url: string;
}) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return "";
    }
    await navigator.clipboard.writeText(url);
    return "Enlace copiado. Pégalo donde quieras.";
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return "";
    return "No se ha podido compartir. Inténtalo de nuevo.";
  }
}

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    return "Enlace copiado.";
  } catch {
    return "No se ha podido copiar el enlace.";
  }
}

export function shareMatch(match: Match) {
  return shareOrCopy({
    title: `${match.home} – ${match.away}`,
    text: `${match.home} – ${match.away} en GalacticBet`,
    url: matchUrl(match),
  });
}

/**
 * Downloads the fixture as an .ics event (same file as the match page action).
 * Returns the message to show, or "" when the fixture cannot be added.
 */
export function downloadMatchCalendar(match: Match) {
  if (!canAddMatchToCalendar(match)) return "";
  try {
    const url = URL.createObjectURL(
      new Blob([matchCalendarFile(match)], {
        type: "text/calendar;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "galacticbet-partido.ics";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return `${match.home} – ${match.away}: abre el archivo para añadirlo a tu calendario. Incluye un aviso 30 minutos antes.`;
  } catch {
    return "No se ha podido preparar el evento. Inténtalo de nuevo.";
  }
}
