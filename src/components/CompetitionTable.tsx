import LeagueTable from "./LeagueTable";
import { competitionCode } from "../lib/competitions";
import { lazy, Suspense, useMemo, useState } from "react";
import { haptic } from "../lib/motion";
import { useLeagueStats } from "../lib/useLeagueStats";
import { competitionName } from "../lib/competitions";
import type { Match } from "../lib/domain";
import { seasonLeagueTable } from "../lib/leagueTable";
import { seasonLabel } from "../lib/leagueHub";
import { Empty } from "./ui";
import { SkeletonRows } from "./Skeleton";

const TeamCards = lazy(() => import("./TeamCard"));

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
  const code = competitionCode(competition);
  const [sheet, setSheet] = useState<{ index: number; row: HTMLElement } | null>(null);
  // The season's scorers (cached with Datos) name each club's top scorers.
  const stats = useLeagueStats(sheet ? seasonId : "", false);
  const own = useMemo(
    () => matches.filter((m) => m.competition === competition && m.seasonId === seasonId),
    [matches, competition, seasonId],
  );
  return (
    <section className="competition-table-panel" aria-busy={loading}>
      <header className="standings-heading">
        <h2>Clasificación</h2>
        <p>
          {competitionName(competition, true)} · {seasonLabel(seasonId)} · Fase
          liga
        </p>
      </header>
      {loading ? (
        <SkeletonRows rows={8} variant="line" label="Cargando clasificación" />
      ) : !rows.length ? (
        <Empty art="podium" title="Aquí no hay tabla que valga">
          Esta temporada no tiene fase de liga publicada. Las eliminatorias se
          siguen en Partidos.
        </Empty>
      ) : (
        <>
          <div
            className="competition-table-scroll"
            role="region"
            aria-label="Clasificación completa de equipos"
          >
            <LeagueTable
              rows={rows}
              code={code}
              full
              onTeam={
                code
                  ? (index, row) => {
                      haptic();
                      setSheet({ index, row });
                    }
                  : undefined
              }
            />
          </div>
          {sheet && code && (
            <Suspense fallback={null}>
              <TeamCards
                rows={rows}
                start={sheet.index}
                origin={sheet.row}
                matches={own}
                scorers={stats.data?.scorers || []}
                competition={code}
                seasonId={seasonId}
                onClose={() => setSheet(null)}
              />
            </Suspense>
          )}
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
