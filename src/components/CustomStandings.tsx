import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { resolveCompetition, roundKey, toAppMatch } from "../lib/customCompetition";
import { useCompetition, useCompetitionRounds, usePeople } from "../lib/customCompetitionData";
import { entriesAsPicks } from "../lib/customRounds";
import { pickRanking } from "../lib/customPicks";
import { preferredRound } from "../lib/domain";
import { roundOptions } from "../lib/roundOptions";
import type { AppUser } from "../lib/session";
import { useClock, useClosedEntries } from "../lib/useCompetitionPicks";
import PicksTable from "./PicksTable";
import { MyRankCard } from "./RankingWidgets";
import RoundSelector from "./RoundSelector";
import { SkeletonRows } from "./Skeleton";
import { Empty } from "./ui";
import "../styles/standings.css";

/**
 * Clasificación of a friends' competition: its followers ordered by the points
 * of their sealed slips, for one round or the whole competition. Always
 * derived from the results, so a corrected result never counts twice.
 */
export default function CustomStandings({
  cid,
  user,
  period,
}: {
  cid: string;
  user: AppUser;
  period: "round" | "all";
}) {
  const data = useCompetition(cid);
  const c = data.competition;
  const view = useMemo(
    () => (c ? resolveCompetition(c, data.participants, data.matches) : null),
    [c, data.participants, data.matches],
  );
  const now = useClock();
  const [params, setParams] = useSearchParams();
  const app = useMemo(() => (c && view ? view.matches.map((m) => toAppMatch(c.id, m)) : []), [c, view]);
  const rounds = useMemo(() => roundOptions(app), [app]);
  const current = useMemo(() => preferredRound(app), [app]);
  const requested = params.get("round") || "";
  const selected = rounds.some((r) => r.id === requested) ? requested : current;
  // Only sealed slips count, and everyone's can be read once their round closes.
  const roundDocs = useCompetitionRounds(cid);
  const closed = useMemo(
    () =>
      Object.entries(roundDocs || {})
        .filter(([, r]) => r.deadline <= now)
        .map(([id, r]) => ({ id, deadline: r.deadline }))
        .sort((a, b) => a.deadline - b.deadline),
    [roundDocs, now],
  );
  const entries = useClosedEntries(cid, closed, user.uid, roundDocs !== null);
  const revealed = useMemo(() => (entries ? entriesAsPicks(entries) : null), [entries]);
  const predictors = useMemo(
    () => [...new Set([...(c?.memberIds || []), ...Object.values(revealed || {}).flatMap((p) => Object.keys(p))])],
    [c, revealed],
  );
  const people = usePeople(predictors);
  const rows = useMemo(() => {
    if (!view || !revealed) return null;
    const scoped =
      period === "round" ? view.matches.filter((m) => `${cid}:${roundKey(m)}` === selected) : view.matches;
    return pickRanking(
      scoped,
      revealed,
      predictors.map((id) => people[id] || { id, name: "Jugador", avatar: null }),
    );
  }, [view, revealed, period, cid, selected, predictors, people]);

  if (data.loading) return <SkeletonRows rows={6} variant="line" label="Cargando clasificación" />;
  if (data.missing || !c || !view)
    return (
      <Empty art="flag" title="No encontramos esta liga">
        {data.error || "Puede que la hayan borrado o que ya no la sigas."}
      </Empty>
    );
  if (c.predictionMode === "off")
    return (
      <Empty art="podium" title="Esta liga no tiene quiniela">
        Sin pronósticos no hay clasificación de jugadores. La tabla de equipos está en Ligas.
      </Empty>
    );
  const label = rounds.find((r) => r.id === selected)?.label || "Jornada";
  return (
    <>
      {period === "round" && rounds.length > 0 && (
        <RoundSelector
          rounds={rounds}
          value={selected}
          current={current}
          onChange={(id) =>
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.set("round", id);
                return next;
              },
              { replace: true },
            )
          }
        />
      )}
      <div className="standings-body">
        {!rows ? (
          <div className="standings-skeleton">
            <SkeletonRows rows={6} variant="line" label="Cargando clasificación" />
          </div>
        ) : (
          <div className="ranking-view" key={`${cid}:${period}:${selected}`}>
            <MyRankCard rows={rows} userId={user.uid} />
            <PicksTable
              rows={rows}
              userId={user.uid}
              title={period === "all" ? "La temporada" : "La jornada"}
              caption={`${c.name} · ${period === "all" ? "Temporada completa" : label}`}
              showExact={c.predictionMode === "exact" || rows.some((r) => r.exact > 0)}
            />
            {!rows.length && (
              <Empty art="podium" title="Tabla en blanco">
                Cuando alguien siga la liga y pronostique, aparecerá aquí.
              </Empty>
            )}
          </div>
        )}
      </div>
    </>
  );
}
