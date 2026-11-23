import type { StatRow } from "../lib/leagueStats";
import { SkeletonRows } from "./Skeleton";
import { Crest } from "./ui";
import "../styles/leagues.css";

/** A top-five board: the leader in large type on featured ones, then the rest. */
export default function RankingCard({
  title,
  unit,
  rows,
  loading = false,
  unavailable,
  note,
  featured = false,
}: {
  title: string;
  unit: string;
  rows?: StatRow[];
  loading?: boolean;
  unavailable?: string;
  note?: string;
  /** The first board of each block prints its leader in large type. */
  featured?: boolean;
}) {
  const [leader, ...rest] = rows || [];
  const position = (i: number) =>
    rows && i && rows[i - 1].value === rows[i].value
      ? rows.findIndex((p) => p.value === rows[i].value) + 1
      : i + 1;
  return (
    <section
      className={`league-ranking-card${featured ? " is-featured" : ""}`}
      aria-busy={loading}
    >
      <header>
        <span className="eyebrow">Top 5</span>
        <h3>{title}</h3>
      </header>
      {loading ? (
        <SkeletonRows rows={3} variant="line" label={`Cargando ${title}`} />
      ) : rows?.length ? (
        <>
          {featured && leader && (
            <div className="league-ranking-leader">
              <Crest src={leader.crest} />
              <span className="league-ranking-person">
                <strong>{leader.name}</strong>
                {leader.team && <small>{leader.team}</small>}
              </span>
              <span className="league-ranking-big">
                <b className="numeral">{leader.value}</b>
                <small>{unit}</small>
              </span>
            </div>
          )}
          <ol className="league-ranking-list" start={featured ? 2 : 1}>
            {(featured ? rest : rows).map((r) => {
              const i = rows.indexOf(r);
              return (
                <li key={r.key}>
                  <span className="league-ranking-position">{position(i)}</span>
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
              );
            })}
          </ol>
        </>
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
