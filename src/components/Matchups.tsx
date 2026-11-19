import type { Matchup } from "../lib/matchInsightsData";

const day = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** Head-to-head: a compact ruled results list, winner in bold. */
export default function Matchups({
  matches,
  source = "ESPN",
}: {
  matches: Matchup[];
  source?: "ESPN" | "Football-Data.org";
}) {
  if (!matches.length) return null;
  return (
    <section
      className="match-block matchup-history"
      aria-label="Últimos enfrentamientos entre ambos equipos"
    >
      <h3 className="match-block-title">Cara a cara</h3>
      <ul>
        {matches.map((m) => (
          <li key={m.id}>
            <div className="matchup-meta">
              <time dateTime={m.date}>{day.format(new Date(m.date))}</time>
              {m.competition && <span>{m.competition}</span>}
            </div>
            <div className="matchup-scoreline">
              <span
                className={m.homeScore > m.awayScore ? "matchup-winner" : ""}
              >
                {m.home}
              </span>
              <strong
                aria-label={`${m.home}: ${m.homeScore}; ${m.away}: ${m.awayScore}`}
              >
                {m.homeScore}
                <span aria-hidden="true">–</span>
                {m.awayScore}
              </strong>
              <span
                className={m.awayScore > m.homeScore ? "matchup-winner" : ""}
              >
                {m.away}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="match-extra-note">
        Fuente: {source} ·{" "}
        {source === "ESPN"
          ? "Marcadores publicados del partido, que pueden incluir prórroga."
          : "Resultados a 90 minutos del calendario sincronizado."}{" "}
        Hasta cinco encuentros disponibles.
      </p>
    </section>
  );
}
