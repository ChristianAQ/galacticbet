import { Crown } from "lucide-react";
import type { PickRankingRow } from "../lib/customPicks";
import { RankAvatar, RankBadge } from "./RankingWidgets";
import "../styles/standings.css";

/** The prediction table of a friends' competition: same card as a group's. */
export default function PicksTable({
  rows,
  userId,
  title,
  caption,
  showExact,
}: {
  rows: PickRankingRow[];
  userId: string;
  title: string;
  caption: string;
  showExact: boolean;
}) {
  const hasPoints = rows.some((r) => r.points > 0);
  const leader = rows[0]?.points || 0;
  return (
    <section className="standings-card" aria-labelledby="picks-table-title" hidden={!rows.length}>
      <header className="standings-heading">
        <h2 id="picks-table-title">{title}</h2>
        <span>
          {rows.length} {rows.length === 1 ? "jugador" : "jugadores"}
        </span>
      </header>
      <table className="standings-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Pos.</th>
            <th scope="col">Jugador</th>
            {showExact && (
              <th scope="col" title="Marcadores exactos">
                Ex.
              </th>
            )}
            <th scope="col" title="Aciertos">
              Ac.
            </th>
            <th scope="col">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.id === userId ? "standings-me" : undefined}>
              <td>
                <span className="standings-position">
                  <RankBadge position={r.position} />
                </span>
              </td>
              <th scope="row">
                <span className="standings-player">
                  <RankAvatar name={r.name} avatar={r.avatar} />
                  <span className="standings-name">
                    <span>
                      {r.position === 1 && hasPoints && (
                        <Crown className="standings-crown" size={14} strokeWidth={2.4} aria-label="Líder" />
                      )}
                      {r.name}
                      {r.id === userId && <small> · Tú</small>}
                    </span>
                    <span className="standings-bar" aria-hidden="true">
                      <i style={{ transform: `scaleX(${leader ? r.points / leader : 0})` }} />
                    </span>
                  </span>
                </span>
              </th>
              {showExact && <td>{r.exact}</td>}
              <td>{r.hits}</td>
              <td>
                <strong>{r.points}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
