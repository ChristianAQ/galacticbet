import type { CompetitionCode } from "../lib/competitions";
import { competitionName } from "../lib/competitions";
import type { LeagueRow } from "../lib/leagueTable";
import { useStuck } from "../lib/useStuck";
import { formNames } from "./TeamForm";
import { Crest } from "./ui";
import "../styles/dashboard.css";

interface Zone {
  kind: "top" | "mid" | "down";
  label: string;
  test: (position: number, size: number) => boolean;
}
// Only shown when every team is in the table, so partial early tables are not labelled.
const leagueZones: Partial<
  Record<CompetitionCode, { size: number; zones: Zone[] }>
> = {
  PD: {
    size: 20,
    zones: [
      { kind: "top", label: "Champions League", test: (p) => p <= 4 },
      { kind: "down", label: "Descenso", test: (p, n) => p > n - 3 },
    ],
  },
  PL: {
    size: 20,
    zones: [
      { kind: "top", label: "Champions League", test: (p) => p <= 4 },
      { kind: "down", label: "Descenso", test: (p, n) => p > n - 3 },
    ],
  },
  CL: {
    size: 36,
    zones: [
      { kind: "top", label: "Octavos de final", test: (p) => p <= 8 },
      { kind: "mid", label: "Playoffs", test: (p) => p > 8 && p <= 24 },
    ],
  },
};

export default function LeagueTable({
  rows,
  code,
  highlight = [],
  full = false,
}: {
  rows: LeagueRow[];
  code: CompetitionCode;
  /** Team keys to mark, e.g. both sides of the open fixture. */
  highlight?: string[];
  full?: boolean;
}) {
  const { sentinel, stuck } = useStuck();
  const config = leagueZones[code];
  const zones = config && rows.length === config.size ? config.zones : [];
  return (
    <>
      {full && (
        <span ref={sentinel} className="sticky-sentinel" aria-hidden="true" />
      )}
      <table className={full ? "competition-table" : "league-table"}>
        <caption className="sr-only">
          Clasificación de {competitionName(code)}
        </caption>
        {full && (
          <colgroup>
            <col className="competition-col-position" />
            <col />
            <col className="competition-col-stat" span={4} />
            <col className="competition-col-goals" />
            <col className="competition-col-difference" />
            <col className="competition-col-points" />
          </colgroup>
        )}
        <thead className={full && stuck ? "is-stuck" : undefined}>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Equipo</th>
            <th scope="col" title="Partidos jugados">
              PJ
            </th>
            <th
              scope="col"
              className={full ? undefined : "hide-sm"}
              title="Victorias"
            >
              {full ? "V" : "G"}
            </th>
            <th
              scope="col"
              className={full ? undefined : "hide-sm"}
              title="Empatados"
            >
              E
            </th>
            <th
              scope="col"
              className={full ? undefined : "hide-sm"}
              title="Derrotas"
            >
              {full ? "D" : "P"}
            </th>
            {full ? (
              <th scope="col" title="Goles a favor y en contra">
                +/−
              </th>
            ) : (
              <th scope="col" className="hide-sm" title="Goles">
                Goles
              </th>
            )}
            <th scope="col" title="Diferencia de goles">
              DG
            </th>
            <th scope="col">Pts</th>
            {!full && (
              <th scope="col" className="hide-md">
                Forma
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const position = i + 1;
            const zone = zones.find((z) => z.test(position, rows.length));
            const diff = r.goalsFor - r.goalsAgainst;
            const marked = highlight.includes(r.key);
            return (
              <tr
                key={r.key}
                className={
                  [
                    zone ? `zone-${zone.kind}` : "",
                    marked ? "is-highlight" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                aria-current={marked || undefined}
              >
                <td>
                  <span className="league-pos">{position}</span>
                </td>
                <th scope="row">
                  <span className="league-team" title={r.name}>
                    <Crest src={r.crest} />
                    <span>{r.name}</span>
                  </span>
                </th>
                <td>{r.played}</td>
                <td className={full ? undefined : "hide-sm"}>{r.wins}</td>
                <td className={full ? undefined : "hide-sm"}>{r.draws}</td>
                <td className={full ? undefined : "hide-sm"}>{r.losses}</td>
                {full ? (
                  <td
                    aria-label={`${r.goalsFor} a favor, ${r.goalsAgainst} en contra`}
                  >
                    {r.goalsFor}-{r.goalsAgainst}
                  </td>
                ) : (
                  <td className="hide-sm">
                    {r.goalsFor}:{r.goalsAgainst}
                  </td>
                )}
                <td>{diff > 0 ? `+${diff}` : diff}</td>
                <td>
                  <strong>{r.points}</strong>
                </td>
                {!full && (
                  <td className="hide-md">
                    <span
                      className="team-form"
                      aria-label={r.form.map((f) => formNames[f]).join(", ")}
                    >
                      {r.form.map((f, j) => (
                        <span
                          key={j}
                          className={`form-dot form-${f}`}
                          title={formNames[f]}
                        />
                      ))}
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {zones.length > 0 && (
        <ul className="league-legend">
          {zones.map((z) => (
            <li key={z.kind} className={`zone-${z.kind}`}>
              <i aria-hidden="true" />
              {z.label}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
