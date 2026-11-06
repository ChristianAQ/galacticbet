import LeagueTable from "./LeagueTable";
import { competitionCode } from "../lib/competitions";
import { useMemo } from "react";
import { competitionName } from "../lib/competitions";
import type { Match } from "../lib/domain";
import { seasonLeagueTable } from "../lib/leagueTable";
import { seasonLabel } from "../lib/leagueHub";
import { Empty } from "./ui";

export default function CompetitionTable({
  matches,
  competition,
  seasonId,
  loading = false,
}: {
  matches: Match[];
  competition: string;
  seasonId: string;
  loading?: boolean;
}) {
  const rows = useMemo(
    () => seasonLeagueTable(matches, competition, seasonId),
    [matches, competition, seasonId],
  );
  return (
    <section className="panel competition-table-panel" aria-busy={loading}>
      <div className="standings-heading">
        <div>
          <h2>Clasificación</h2>
          <p>
            {competitionName(competition, true)} · {seasonLabel(seasonId)} ·
            Fase liga
          </p>
        </div>
      </div>
      {loading ? (
        <p className="league-message" role="status">
          Cargando clasificación…
        </p>
      ) : !rows.length ? (
        <Empty title="Clasificación no disponible">
          No hay equipos de una fase de liga publicados para esta temporada. Las
          eliminatorias se consultan en Partidos.
        </Empty>
      ) : (
        <>
          <div
            className="competition-table-scroll"
            role="region"
            aria-label="Clasificación completa de equipos"
          >
            <LeagueTable rows={rows} code={competitionCode(competition)} full />
          </div>
          <p className="league-source">
            Calculada con los resultados sincronizados. Orden por puntos,
            diferencia y goles a favor; puede diferir del oficial por sanciones
            o desempates particulares.
          </p>
        </>
      )}
    </section>
  );
}
