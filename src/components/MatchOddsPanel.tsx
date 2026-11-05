import { useMemo } from "react";
import type { Match } from "../lib/domain";
import {
  bestOdds,
  impliedProbabilities,
  ODDS_OUTCOMES,
  type MatchOdds,
} from "../lib/odds";

const decimal = new Intl.NumberFormat("es", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percent = new Intl.NumberFormat("es", { maximumFractionDigits: 0 });
const updated = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default function MatchOddsPanel({
  match,
  odds,
  loading,
  error,
  demo,
}: {
  match: Match;
  odds: MatchOdds | null;
  loading: boolean;
  error: boolean;
  demo: boolean;
}) {
  const books = odds?.bookmakers || [];
  const best = useMemo(() => (books.length ? bestOdds(books) : null), [books]);
  const market = useMemo(() => impliedProbabilities(books), [books]);
  const labels = { home: match.home, draw: "Empate", away: match.away };
  const codes = { home: "1", draw: "X", away: "2" };
  if (demo)
    return (
      <p className="match-extra-empty">La demo no consulta cuotas reales.</p>
    );
  if (loading)
    return (
      <p className="match-extra-empty" role="status">
        Cargando cuotas…
      </p>
    );
  if (error || !best || !odds)
    return (
      <div className="odds-empty">
        <p className="match-extra-empty">
          {error
            ? "No se han podido cargar las cuotas. Inténtalo más tarde."
            : "Cuotas aún no publicadas para este partido. Se actualizan dos veces al día durante los cuatro días previos."}
        </p>
      </div>
    );
  return (
    <section className="odds-panel" aria-label="Cuotas 1X2">
      <div className="odds-best" role="list" aria-label="Mejor cuota">
        {ODDS_OUTCOMES.map((o) => (
          <div key={o} className="odds-best-item" role="listitem">
            <small>
              {codes[o]} · {labels[o]}
            </small>
            <strong>{decimal.format(best[o].price)}</strong>
            <span title={best[o].titles.join(", ")}>
              {best[o].titles.length > 1
                ? `${best[o].titles[0]} +${best[o].titles.length - 1}`
                : best[o].titles[0]}
            </span>
          </div>
        ))}
      </div>
      {market && (
        <div className="odds-market">
          <div className="probability-bar" aria-hidden="true">
            {ODDS_OUTCOMES.map((o) => (
              <span key={o} style={{ flexGrow: market[o] }} />
            ))}
          </div>
          <p>
            Probabilidad según el mercado:{" "}
            {ODDS_OUTCOMES.map(
              (o) => `${codes[o]} ${percent.format(market[o])}%`,
            ).join(" · ")}
          </p>
        </div>
      )}
      <div className="odds-table-wrap">
        <table className="odds-table">
          <caption className="sr-only">
            Cuotas decimales por casa de apuestas
          </caption>
          <thead>
            <tr>
              <th scope="col">Casa</th>
              <th scope="col">1</th>
              <th scope="col">X</th>
              <th scope="col">2</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.key}>
                <th scope="row">{b.title}</th>
                {ODDS_OUTCOMES.map((o) => (
                  <td
                    key={o}
                    className={b[o] === best[o].price ? "is-best" : undefined}
                  >
                    {decimal.format(b[o])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="match-extra-note">
        Cuotas decimales orientativas de {books.length}{" "}
        {books.length === 1 ? "casa" : "casas"} (The Odds API), actualizadas{" "}
        <time dateTime={odds.fetchedAt}>
          {updated.format(new Date(odds.fetchedAt))}
        </time>
        . Cambian constantemente. GalacticBet no gestiona apuestas. +18 · Juega
        con responsabilidad.
      </p>
    </section>
  );
}
