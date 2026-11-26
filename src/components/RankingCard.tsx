import type { StatRow } from "../lib/leagueStats";
import { SkeletonRows } from "./Skeleton";
import { Crest } from "./ui";
import "../styles/leagues.css";

/** A top-five board: position, crest, who and the number; featured ones mark the leader. */
/** «1 gol», «2 goles»: friends' competitions often have ones. */
const SINGULAR: Record<string, string> = {
  goles: "gol",
  asistencias: "asistencia",
  amarillas: "amarilla",
  rojas: "roja",
  "goles recibidos": "gol recibido",
  "porterías a cero": "portería a cero",
  "goles + asistencias": "gol o asistencia",
  partidos: "partido",
  puntos: "punto",
};
const unitOf = (unit: string, value: number) => (value === 1 ? SINGULAR[unit] || unit : unit);

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
  /** The first board of each block highlights its leader(s). */
  featured?: boolean;
}) {
  // Equal values side by side share the position: 1, 1, 3… (a board sorted by
  // something else, like goals per match, can have equal totals apart).
  const position = (i: number) => {
    if (!rows) return i + 1;
    let first = i;
    while (first > 0 && rows[first - 1].value === rows[i].value) first--;
    return first + 1;
  };
  return (
    <section
      className={`league-ranking-card${featured ? " is-featured" : ""}`}
      aria-busy={loading}
    >
      <h3>{title}</h3>
      {loading ? (
        <SkeletonRows rows={3} variant="line" label={`Cargando ${title}`} />
      ) : rows?.length ? (
        <ol className="league-ranking-list">
          {rows.map((r, i) => (
            <li key={r.key} className={featured && position(i) === 1 ? "is-leader" : undefined}>
              <span className="league-ranking-position">{position(i)}</span>
              <Crest src={r.crest} />
              <span className="league-ranking-person">
                <strong>{r.name}</strong>
                {r.team && <small>{r.team}</small>}
              </span>
              <span className="league-ranking-value">
                <strong className="numeral">{r.value}</strong>
                <small>{unitOf(unit, r.value)}</small>
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
