import { useMemo } from "react";
import type { Match } from "../lib/domain";
import {
  bestOdds,
  impliedProbabilities,
  ODDS_OUTCOMES,
  type MatchOdds,
} from "../lib/odds";
import { Skeleton } from "./Skeleton";
import { Empty } from "./ui";

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

/** Printed odds board: best price per sign, market split and every bookmaker. */
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
      <Empty art="slip" title="Sin cuotas en la demo">
        Fuera del modo demo verás las cuotas reales de varias casas.
      </Empty>
    );
  if (loading)
    return (
      <div className="odds-panel" role="status" aria-label="Cargando cuotas">
        <div className="odds-best">
          {ODDS_OUTCOMES.map((o) => (
            <div key={o} className="odds-best-item">
              <Skeleton width={46} height={10} />
              <Skeleton width={64} height={30} radius={6} />
              <Skeleton width={58} height={10} />
            </div>
          ))}
        </div>
      </div>
    );
  if (error || !best || !odds)
    return (
      <Empty
        art={error ? "whistle" : "slip"}
        title={error ? "Las cuotas no han llegado" : "Cuotas aún sin publicar"}
      >
        {error
          ? "No se han podido cargar las cuotas. Inténtalo más tarde."
          : "Se actualizan dos veces al día durante los cuatro días previos al partido."}
      </Empty>
    );
  return (
    <section className="match-block odds-panel" aria-label="Cuotas 1X2">
      <h3 className="match-block-title">Mejor cuota</h3>
      <div className="odds-best" role="list">
        {ODDS_OUTCOMES.map((o) => (
          <div key={o} className={`odds-best-item is-${o}`} role="listitem">
            <small>
              <b>{codes[o]}</b> {labels[o]}
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
              <span key={o} className={`is-${o}`} style={{ flexGrow: market[o] }} />
            ))}
          </div>
          <p>
            Lo que dice el mercado:{" "}
            {ODDS_OUTCOMES.map(
              (o) => `${codes[o]} ${percent.format(market[o])} %`,
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
