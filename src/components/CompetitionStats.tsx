import { useMemo } from "react";
import { leagueTable } from "../lib/leagueTable";
import type { Match } from "../lib/domain";
import { PLAYER_METRICS, topFive, type StatRow } from "../lib/leagueStats";
import { useLeagueStats } from "../lib/useLeagueStats";
import { Crest } from "./ui";

function RankingCard({
  title,
  unit,
  rows,
  loading = false,
  unavailable,
  note,
}: {
  title: string;
  unit: string;
  rows?: StatRow[];
  loading?: boolean;
  unavailable?: string;
  note?: string;
}) {
  return (
    <section className="panel league-ranking-card" aria-busy={loading}>
      <header>
        <span className="eyebrow">TOP 5</span>
        <h3>{title}</h3>
      </header>
      {loading ? (
        <div
          className="league-ranking-skeleton"
          role="status"
          aria-label={`Cargando ${title}`}
        >
          <span />
          <span />
          <span />
        </div>
      ) : rows?.length ? (
        <ol className="league-ranking-list">
          {rows.map((r, i) => (
            <li key={r.key}>
              <span className="league-ranking-position">
                {i && rows[i - 1].value === r.value
                  ? rows.findIndex((p) => p.value === r.value) + 1
                  : i + 1}
              </span>
              <Crest src={r.crest} />
              <span className="league-ranking-person">
                <strong>{r.name}</strong>
                {r.team && <small>{r.team}</small>}
              </span>
              <span className="league-ranking-value">
                <strong>{r.value}</strong>
                <small>{unit}</small>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="league-ranking-empty">
          {unavailable ||
            "Todavía no hay registros publicados para esta temporada."}
        </p>
      )}
      {note && Boolean(rows?.length) && <p className="league-source">{note}</p>}
    </section>
  );
}
export default function CompetitionStats({
  matches,
  competition,
  seasonId,
  demo,
}: {
  matches: Match[];
  competition: string;
  seasonId: string;
  demo: boolean;
}) {
  const stats = useLeagueStats(seasonId, demo);
  const teams = useMemo(
    () =>
      leagueTable(
        matches.filter(
          (m) =>
            m.competition === competition &&
            m.seasonId === seasonId &&
            Date.parse(m.utcDate) <= Date.now(),
        ),
      ),
    [matches, competition, seasonId],
  );
  const teamRows = (field: "goalsFor" | "goalsAgainst") =>
    teams.map((r) => ({
      key: r.key,
      name: r.name,
      team: `${r.played} ${r.played === 1 ? "partido" : "partidos"}`,
      ...(r.crest ? { crest: r.crest } : {}),
      value: r[field],
    }));
  return (
    <div className="competition-stats">
      <div className="section-heading">
        <h2>Estadísticas de jugadores</h2>
      </div>
      <p className="league-source">
        Rankings de los registros publicados por SportAPI, hasta 100 jugadores
        por categoría. La cobertura puede ser parcial.
      </p>
      {stats.error && (
        <div className="league-notice" role="alert">
          No se han podido cargar las estadísticas.{" "}
          <button className="text-button" onClick={stats.retry}>
            Reintentar
          </button>
        </div>
      )}
      {!stats.loading && !stats.error && !stats.data && !demo && (
        <div className="league-notice" role="status">
          Aún no se han sincronizado estadísticas para esta temporada.{" "}
          <button className="text-button" onClick={stats.retry}>
            Comprobar de nuevo
          </button>
        </div>
      )}
      {demo && (
        <p className="league-notice">
          Los rankings reales no se consultan en modo demo.
        </p>
      )}
      <div className="league-rankings-grid">
        {PLAYER_METRICS.map((metric) => (
          <RankingCard
            key={metric.id}
            title={metric.label}
            unit={metric.unit}
            rows={stats.data?.rankings[metric.id]}
            loading={
              stats.loading && !["minutes", "cleanSheets"].includes(metric.id)
            }
            unavailable={
              metric.id === "minutes"
                ? "La API integrada no publica un ranking completo de minutos por competición y temporada."
                : metric.id === "cleanSheets"
                  ? "No hay un ranking de porterías a cero por portero disponible en la API integrada."
                  : stats.error
                    ? "Estadísticas temporalmente no disponibles."
                    : demo
                      ? "Disponible con datos reales fuera del modo demo."
                      : undefined
            }
            note={
              metric.id === "goalContributions"
                ? "Cobertura parcial: solo jugadores con goles y asistencias publicados por separado."
                : undefined
            }
          />
        ))}
      </div>
      {stats.data && (
        <p className="league-source">
          Fuente: SportAPI · Actualizado{" "}
          {new Date(stats.data.fetchedAt).toLocaleString("es")}
        </p>
      )}
      <div className="section-heading">
        <h2>Estadísticas de equipos</h2>
      </div>
      <div className="league-rankings-grid">
        <RankingCard
          title="Equipos más goleadores"
          unit="goles"
          rows={topFive(teamRows("goalsFor"))}
        />
        <RankingCard
          title="Equipos menos goleados"
          unit="goles recibidos"
          rows={topFive(teamRows("goalsAgainst"), true)}
        />
      </div>
      <p className="league-source">
        Calculadas con los resultados a 90 minutos de la competición y temporada
        seleccionadas, incluidas sus eliminatorias.
      </p>
    </div>
  );
}
