import type { CSSProperties } from "react";
import type { Match } from "../lib/domain";
import type { MatchStatistic } from "../lib/matchInsightsData";
import { statisticShares } from "../lib/matchPresentation";
import { Team } from "./ui";
import "../styles/matchExtras.css";

const lowerIsBetter = new Set([
  "Faltas",
  "Tarjetas amarillas",
  "Tarjetas rojas",
  "Fueras de juego",
]);
const labels: Record<string, string> = {
  Remates: "Tiros",
  "Remates a puerta": "Tiros a puerta",
  "Pases completados": "Pases completados",
  "Precisión de pase": "Precisión de pases",
  Córners: "Saques de esquina",
};
// Older ESPN snapshots stored the pass ratio (0.9) as "0.9%".
const shown = (label: string, value: string) =>
  label === "Precisión de pase" && /^0[.,]\d+%$/.test(value)
    ? `${Math.round(Number(value.slice(0, -1).replace(",", ".")) * 100)}%`
    : value;

/** Mirrored bars from the centre: the team on top of each stat is marked in yellow. */
export default function MatchStatistics({
  match,
  statistics,
}: {
  match: Match;
  statistics: MatchStatistic[];
}) {
  return (
    <div className="match-block match-statistics-card">
      <table className="match-extra-stats">
        <caption className="sr-only">
          Estadísticas del partido según ESPN. Se destaca la cifra más
          favorable; en faltas, tarjetas y fueras de juego, la menor.
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <Team name={match.home} crest={match.homeCrest} />
            </th>
            <th scope="col">
              <span className="sr-only">Estadística</span>
            </th>
            <th scope="col">
              <Team name={match.away} crest={match.awayCrest} />
            </th>
          </tr>
        </thead>
        <tbody>
          {statistics.map((stat, index) => {
            const shares = statisticShares(stat.home, stat.away);
            const lower = lowerIsBetter.has(stat.label);
            const highlighted =
              !shares || shares[0] === shares[1]
                ? null
                : lower
                  ? shares[0] < shares[1]
                    ? "home"
                    : "away"
                  : shares[0] > shares[1]
                    ? "home"
                    : "away";
            const value = (side: "home" | "away") => (
              <span
                className={`stat-value ${side}${highlighted === side ? " is-highlighted" : ""}`}
              >
                {shown(stat.label, stat[side])}
                {highlighted === side && (
                  <span className="sr-only">
                    {" "}
                    · {lower ? "Menor cifra" : "Mayor cifra"}
                  </span>
                )}
              </span>
            );
            return (
              <tr key={`${stat.label}-${index}`}>
                <td>{value("home")}</td>
                <th scope="row">
                  <span className="stat-label">
                    {labels[stat.label] || stat.label}
                  </span>
                  {shares && (
                    <span className="stat-bars" aria-hidden="true">
                      <i
                        className={`is-home${highlighted === "home" ? " is-highlighted" : ""}`}
                        style={{ "--share": shares[0] / 100 } as CSSProperties}
                      />
                      <i
                        className={`is-away${highlighted === "away" ? " is-highlighted" : ""}`}
                        style={{ "--share": shares[1] / 100 } as CSSProperties}
                      />
                    </span>
                  )}
                </th>
                <td>{value("away")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
