import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import MatchStatistics from "./MatchStatistics";
import { useMatchInsight } from "../lib/useMatchInsight";
import type { MatchInsight } from "../lib/matchInsightsData";
// MatchStatistics content keeps its match-page styles; the result strip is ours.
import "../styles/matchExtras.css";
import "../styles/quiniela.css";
import { Trophy } from "lucide-react";
import type { Match } from "../lib/domain";
import { finishedMatchResult } from "../lib/matchResult";

function StatisticsContent({
  match,
  insight,
  loading = false,
}: {
  match: Match;
  insight: MatchInsight | null;
  loading?: boolean;
}) {
  return (
    <>
      {loading ? (
        <p role="status" className="result-statistics-loading">
          <span className="sr-only">Cargando estadísticas</span>
          <span className="skeleton" aria-hidden="true" />
          <span className="skeleton" aria-hidden="true" />
        </p>
      ) : insight?.statistics.length ? (
        <>
          <MatchStatistics match={match} statistics={insight.statistics} />
          <p className="match-extra-note">
            Fuente: ESPN · {new Date(insight.fetchedAt).toLocaleString("es")}
            {["EXTRA_TIME", "PENALTY_SHOOTOUT"].includes(
              match.scoreDuration || "",
            ) && " · Pueden incluir la prórroga."}
          </p>
        </>
      ) : (
        <p className="match-extra-empty">Estadísticas aún no disponibles.</p>
      )}
    </>
  );
}
/** Statistics of a finished match, fetched on demand (the group card's disclosure). */
export function MatchResultStatistics({ match }: { match: Match }) {
  const state = useMatchInsight(match);
  return state.error ? (
    <p role="alert" className="match-data-note">
      No se pudieron cargar las estadísticas.{" "}
      <button className="text-button" onClick={state.onRetry}>
        Reintentar
      </button>
    </p>
  ) : (
    <StatisticsContent
      match={match}
      insight={state.insight}
      loading={state.loading}
    />
  );
}
export default function MatchResult({
  match,
  insight,
  loading = false,
  demo = false,
}: {
  match: Match;
  insight?: MatchInsight | null;
  loading?: boolean;
  demo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const showStatistics =
    !demo &&
    (insight === undefined || loading || Boolean(insight?.statistics.length));
  const result = finishedMatchResult(match);
  if (!result) return null;
  return (
    <section className="finished-result" aria-label="Resultado del partido">
      <div className="finished-result-main">
        <div className="finished-result-score">
          <span>Resultado · 90 min</span>
          <strong>
            {result.regulation
              ? `${result.regulation.home} – ${result.regulation.away}`
              : "—"}
          </strong>
          {result.sign && <small>Signo {result.sign}</small>}
        </div>
        <div
          className={`finished-winner ${result.winnerName ? "has-winner" : ""}`}
        >
          {result.winnerName && <Trophy size={17} aria-hidden="true" />}
          <div>
            <span>
              {result.winnerName
                ? "Ganador del partido"
                : result.winner === "X"
                  ? "Partido empatado"
                  : "Ganador pendiente"}
            </span>
            <strong>
              {result.winnerName ||
                (result.winner === "X" ? "Empate" : "Por confirmar")}
            </strong>
            {result.extended && <small>{result.decision}</small>}
            {showStatistics && (
              <button
                className="result-statistics-toggle"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen((v) => !v)}
              >
                Estadísticas <ChevronDown size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
      {match.resultProvider === "SportAPI" && !demo && (
        <p className="match-data-note">Resultado: SportAPI · 90 minutos.</p>
      )}
      {showStatistics && (
        <div
          id={panelId}
          hidden={!open}
          className="match-extra-panel match-statistics-panel result-statistics-panel"
        >
          {open &&
            (insight === undefined ? (
              <MatchResultStatistics match={match} />
            ) : (
              <StatisticsContent
                match={match}
                insight={insight}
                loading={loading}
              />
            ))}
        </div>
      )}
      {!result.regulation && (
        <p className="match-data-note result-pending">
          Marcador reglamentario pendiente.
        </p>
      )}
    </section>
  );
}
