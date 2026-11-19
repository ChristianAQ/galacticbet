import { hasCurrentProbability } from "../lib/matchProbability";
import type { Match } from "../lib/domain";
import type { MatchProbability as Probability } from "../lib/matchProbability";

const stamp = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const format = (n: number) =>
  new Intl.NumberFormat("es", { maximumFractionDigits: 1 }).format(n);

/** Pre-match 1X2 probability as a split bar: ink for home, yellow for away. */
export default function MatchProbability({
  match,
  probability,
  now = Date.now(),
}: {
  match: Match;
  probability?: Probability;
  now?: number;
}) {
  if (!probability || !hasCurrentProbability(match, probability, now))
    return null;
  const options = [
    { label: match.home, value: probability.home, code: "1", side: "home" },
    { label: "Empate", value: probability.draw, code: "X", side: "draw" },
    { label: match.away, value: probability.away, code: "2", side: "away" },
  ];
  const favourite = options.reduce((a, b) => (b.value > a.value ? b : a));
  return (
    <section
      className="match-block match-probability"
      aria-label="Probabilidad previa al partido"
    >
      <h3 className="match-block-title">Quién parte con ventaja</h3>
      <div className="probability-values">
        {options.map((p) => (
          <div
            key={p.code}
            className={`is-${p.side}${p === favourite ? " is-favourite" : ""}`}
          >
            <small className="probability-code">{p.code}</small>
            <strong>
              {format(p.value)}
              <small>%</small>
            </strong>
            <span>{p.label}</span>
          </div>
        ))}
      </div>
      <div className="probability-bar" aria-hidden="true">
        {options.map((p) => (
          <span
            key={p.code}
            className={`is-${p.side}`}
            style={{ flexGrow: p.value }}
          />
        ))}
      </div>
      <p className="match-extra-note">
        {probability.model === "ESPN_ODDS"
          ? `Probabilidad implícita de cuotas 1X2 · ${probability.bookmaker} vía ESPN. Margen eliminado; no es un modelo estadístico.`
          : "Estimación del modelo ESPN; no garantiza el resultado."}
        {probability.marketUpdatedAt && (
          <>
            {" "}
            Cuotas actualizadas{" "}
            {stamp.format(new Date(probability.marketUpdatedAt))}.
          </>
        )}{" "}
        Consultado{" "}
        <time dateTime={probability.fetchedAt}>
          {stamp.format(new Date(probability.fetchedAt))}
        </time>
        .
      </p>
    </section>
  );
}
