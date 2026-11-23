import { useMemo } from "react";
import { leagueTable } from "../lib/leagueTable";
import type { Match } from "../lib/domain";
import { PLAYER_METRICS, topFive } from "../lib/leagueStats";
import { useLeagueStats } from "../lib/useLeagueStats";
import RankingCard from "./RankingCard";

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
        {PLAYER_METRICS.map((metric, index) => (
          <RankingCard
            key={metric.id}
            featured={index === 0}
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
          featured
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
