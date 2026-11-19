import { MapPin, UserRound, Users } from "lucide-react";
import type { MatchInsight } from "../lib/matchInsightsData";

/** Venue, referee and attendance as a ruled data list. */
export default function MatchMeta({
  insight,
}: {
  insight: MatchInsight | null;
}) {
  if (
    !insight ||
    !(insight.venue || insight.referee || insight.attendance !== undefined)
  )
    return null;
  return (
    <section className="match-block" aria-label="Datos del partido">
      <h3 className="match-block-title">En el acta</h3>
      <dl className="match-extra-meta">
        {insight.venue && (
          <div>
            <dt>
              <MapPin size={15} aria-hidden="true" /> Estadio
            </dt>
            <dd>{insight.venue}</dd>
          </div>
        )}
        {insight.referee && (
          <div>
            <dt>
              <UserRound size={15} aria-hidden="true" /> Árbitro
            </dt>
            <dd>{insight.referee}</dd>
          </div>
        )}
        {insight.attendance !== undefined && (
          <div>
            <dt>
              <Users size={15} aria-hidden="true" /> Asistencia
            </dt>
            <dd>{new Intl.NumberFormat("es-ES").format(insight.attendance)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
