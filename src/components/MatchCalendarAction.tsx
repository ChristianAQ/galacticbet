import { CalendarPlus, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { Match } from "../lib/domain";
import { haptic } from "../lib/motion";
import {
  canAddMatchToCalendar,
  matchCalendarFile,
} from "../lib/matchPresentation";

export default function MatchCalendarAction({ match }: { match: Match }) {
  const [message, setMessage] = useState("");
  if (!canAddMatchToCalendar(match)) return null;
  function download() {
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
      haptic("success");
      setMessage(
        "Abre el archivo y confirma la importación en tu calendario. Incluye un aviso 30 minutos antes; el horario no se actualizará automáticamente.",
      );
    } catch {
      haptic("warning");
      setMessage(
        "No se ha podido preparar el evento. Comprueba el horario y vuelve a intentarlo.",
      );
    }
  }
  return (
    <div className="match-calendar-action">
      <button className="match-row-link" type="button" onClick={download}>
        <CalendarPlus size={18} aria-hidden="true" />
        <span>
          Añadir al calendario
          <small>Con aviso 30 minutos antes del saque</small>
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {message && (
        <p className="match-extra-note" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
