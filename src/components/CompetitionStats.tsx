import { useMemo, useState, type CSSProperties } from "react";
import { competitionName, type CompetitionCode } from "../lib/competitions";
import type { Match } from "../lib/domain";
import { seasonLabel } from "../lib/leagueHub";
import type { Scorer } from "../lib/leagueStats";
import { haptic } from "../lib/motion";
import {
  goalsByMatchday,
  goalsLabel,
  matchesLabel,
  perMatch,
  seasonFigures,
  teamBoards,
  teamLines,
  type TeamLine,
} from "../lib/seasonFigures";
import { ColumnChart, RowBar } from "./Charts";
import { useLeagueStats } from "../lib/useLeagueStats";
import PlayerCards, { type CardPlayer } from "./PlayerCard";
import RankingCard from "./RankingCard";
import { SkeletonRows } from "./Skeleton";
import { Crest } from "./ui";

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const ago = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
function updated(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 60) return ago.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  return hours < 48 ? ago.format(-hours, "hour") : ago.format(-Math.round(hours / 24), "day");
}

/** The season so far: how many matches, goals, and how often 1, X or 2. */
const oneDecimal = new Intl.NumberFormat("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function SeasonFigures({ matches }: { matches: Match[] }) {
  const f = useMemo(() => seasonFigures(matches), [matches]);
  const byDay = useMemo(() => goalsByMatchday(matches), [matches]);
  const outcomes = [
    { sign: "1", label: "Local", value: f.home, tone: "home" },
    { sign: "X", label: "Empate", value: f.draws, tone: "draw" },
    { sign: "2", label: "Visitante", value: f.away, tone: "away" },
  ];
  return (
    <section className="season-figures" aria-labelledby="season-figures-title">
      <div className="section-heading">
        <h2 id="season-figures-title">La temporada en cifras</h2>
      </div>
      <div className="figure-grid">
        <div className="figure-tile is-wide">
          <span className="figure-label">Partidos jugados</span>
          <span className="figure-value">
            <strong className="numeral">{f.played}</strong>
            <small>de {f.total}</small>
          </span>
          <span
            className="figure-progress"
            role="progressbar"
            aria-label="Temporada jugada"
            aria-valuemin={0}
            aria-valuemax={f.total}
            aria-valuenow={f.played}
          >
            <i style={{ width: `${percent(f.played, f.total)}%` }} />
          </span>
        </div>
        <div className="figure-tile">
          <span className="figure-label">Goles</span>
          <span className="figure-value">
            <strong className="numeral">{f.goals}</strong>
          </span>
          <small>en {matchesLabel(f.played)}</small>
        </div>
        <div className="figure-tile">
          <span className="figure-label">Goles por partido</span>
          <span className="figure-value">
            <strong className="numeral">{perMatch(f.goals, f.played)}</strong>
          </span>
          <small>media de la temporada</small>
        </div>
        <div className="figure-tile">
          <span className="figure-label">Ambos marcan</span>
          <span className="figure-value">
            <strong className="numeral">{percent(f.bothScored, f.played)}</strong>
            <small>%</small>
          </span>
          <small>{matchesLabel(f.bothScored)}</small>
        </div>
        <div className="figure-tile">
          <span className="figure-label">Más de 2,5 goles</span>
          <span className="figure-value">
            <strong className="numeral">{percent(f.overTwoAndHalf, f.played)}</strong>
            <small>%</small>
          </span>
          <small>{matchesLabel(f.overTwoAndHalf)}</small>
        </div>
      </div>
      <div className="outcome-split">
        <div className="outcome-split-head">
          <h3>Resultados 1 · X · 2</h3>
          <small>{matchesLabel(f.played)}</small>
        </div>
        <div className="outcome-bar" aria-hidden="true">
          {outcomes.map((o) =>
            o.value ? (
              <i key={o.sign} className={`is-${o.tone}`} style={{ flexGrow: o.value }}>
                {percent(o.value, f.played) >= 12 && <b>{o.sign}</b>}
              </i>
            ) : null,
          )}
        </div>
        <ul className="outcome-legend">
          {outcomes.map((o) => (
            <li key={o.sign} className={`is-${o.tone}`}>
              <span className="outcome-sign">{o.sign}</span>
              <span>{o.label}</span>
              <strong>{percent(o.value, f.played)}%</strong>
              <small>{o.value}</small>
            </li>
          ))}
        </ul>
      </div>
      {byDay.length > 1 && (
        <div className="season-chart">
          <ColumnChart
            title="Goles por partido en cada jornada"
            note={`media ${perMatch(f.goals, f.played)}`}
            unit="Goles por partido"
            columns={byDay.map((d) => ({
              label: `J${d.day}`,
              value: d.average,
              display: oneDecimal.format(d.average),
              detail: `jornada ${d.day} · ${goalsLabel(d.goals)} en ${matchesLabel(d.played)}`,
            }))}
          />
        </div>
      )}
    </section>
  );
}

const SHORT_LIST = 10;
function ScorerRow({
  scorer: s,
  position,
  index,
  top,
  onOpen,
}: {
  scorer: Scorer;
  position: number;
  index: number;
  /** The leader's goals: every bar is measured against them. */
  top: number;
  onOpen: (index: number, row: HTMLElement) => void;
}) {
  const details = [
    s.played !== null ? `${s.played} PJ` : null,
    s.assists ? `${s.assists} ${s.assists === 1 ? "asistencia" : "asistencias"}` : null,
    s.penalties ? `${s.penalties} de penalti` : null,
  ].filter(Boolean);
  return (
    <li className={index === 0 ? "is-leader" : undefined} style={{ "--i": index } as CSSProperties}>
      <button
        type="button"
        className="scorer-open"
        aria-label={`${s.name}, ${s.goals} ${s.goals === 1 ? "gol" : "goles"}. Ver su cromo`}
        onClick={(event) => onOpen(index, event.currentTarget)}
      >
        <span className="scorer-position">{position}</span>
        <Crest src={s.crest} />
        <span className="scorer-person">
          <strong>{s.name}</strong>
          <small>{[s.team, ...details].join(" · ")}</small>
          <RowBar value={s.goals} max={top} />
        </span>
        <span className="scorer-goals">
          <b className="numeral">{s.goals}</b>
          <small>{s.goals === 1 ? "gol" : "goles"}</small>
        </span>
      </button>
    </li>
  );
}

/** Top scorers from the same provider as the results; each opens its «cromo». */
function Scorers({
  competition,
  seasonId,
  demo,
  lines,
}: {
  competition: CompetitionCode;
  seasonId: string;
  demo: boolean;
  lines: TeamLine[];
}) {
  const stats = useLeagueStats(seasonId, demo);
  const [all, setAll] = useState(false);
  const [card, setCard] = useState<{ index: number; row: HTMLElement } | null>(null);
  const list = stats.data?.scorers || [];
  const cards = useMemo(
    () =>
      list.map((s): CardPlayer => {
        // The club's goals in this competition: same crest (same provider), or same name.
        const club =
          (s.crest && lines.find((t) => t.crest === s.crest)) ||
          lines.find((t) => t.name.toLocaleLowerCase("es") === s.team.toLocaleLowerCase("es"));
        return {
          key: s.key,
          name: s.name,
          team: s.team,
          crest: s.crest,
          position: s.position,
          nationality: s.nationality,
          birthDate: s.birthDate,
          shirtNumber: s.shirtNumber,
          source: "Football-Data.org",
          season: {
            label: `${competitionName(competition, true)} ${seasonLabel(seasonId)}`,
            goals: s.goals,
            assists: s.assists,
            penalties: s.penalties,
            played: s.played,
            rank: list.findIndex((other) => other.goals === s.goals) + 1,
            teamGoals: club?.goalsFor,
          },
        };
      }),
    [list, lines, competition, seasonId],
  );
  const shown = all ? list : list.slice(0, SHORT_LIST);
  // Equal goals share the position: 1, 2, 2, 4…
  const position = (i: number) => list.findIndex((s) => s.goals === list[i].goals) + 1;
  return (
    <section className="scorers" aria-labelledby="scorers-title">
      <div className="section-heading">
        <h2 id="scorers-title">Goleadores</h2>
      </div>
      {stats.loading ? (
        <SkeletonRows rows={4} variant="line" label="Cargando goleadores" />
      ) : list.length ? (
        <>
          <ol className="scorer-list">
            {shown.map((s, i) => (
              <ScorerRow
                key={s.key}
                scorer={s}
                position={position(i)}
                index={i}
                top={list[0].goals}
                onOpen={(index, row) => {
                  haptic();
                  setCard({ index, row });
                }}
              />
            ))}
          </ol>
          {card && (
            <PlayerCards players={cards} start={card.index} origin={card.row} onClose={() => setCard(null)} />
          )}
          {list.length > SHORT_LIST && (
            <button type="button" className="text-button scorer-more" onClick={() => setAll(!all)}>
              {all ? "Ver menos" : `Ver los ${list.length}`}
            </button>
          )}
          <p className="league-source">
            Toca un jugador para ver su cromo. Fuente: Football-Data.org, la misma que los resultados ·
            actualizado {updated(stats.data!.fetchedAt)}
          </p>
        </>
      ) : (
        <p className="league-ranking-empty">
          {demo
            ? "Los goleadores oficiales se cargan con los datos reales, fuera de la demo."
            : stats.error
              ? "No se han podido cargar los goleadores."
              : "Los goleadores llegarán con la próxima sincronización."}
          {stats.error && (
            <>
              {" "}
              <button type="button" className="text-button" onClick={stats.retry}>
                Reintentar
              </button>
            </>
          )}
        </p>
      )}
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
  competition: CompetitionCode;
  seasonId: string;
  demo: boolean;
}) {
  const own = useMemo(
    () => matches.filter((m) => m.competition === competition && m.seasonId === seasonId),
    [matches, competition, seasonId],
  );
  const lines = useMemo(() => teamLines(own), [own]);
  const boards = useMemo(() => teamBoards(lines), [lines]);
  const started = lines.length > 0;
  const uneven = new Set(lines.map((t) => t.played)).size > 1;
  return (
    <div className="competition-stats">
      {started ? (
        <SeasonFigures matches={own} />
      ) : (
        <p className="league-notice">La temporada aún no ha empezado: las cifras llegarán con el primer resultado.</p>
      )}
      <Scorers competition={competition} seasonId={seasonId} demo={demo} lines={lines} />
      {started && (
        <section aria-labelledby="team-boards-title">
          <div className="section-heading">
            <h2 id="team-boards-title">Equipos</h2>
          </div>
          <div className="league-rankings-grid">
            <RankingCard featured title="Más goleadores" unit="goles" rows={boards.attack} />
            <RankingCard
              title="Menos goleados"
              unit="goles recibidos"
              rows={boards.defence}
              note={uneven ? "Ordenado por goles recibidos por partido." : undefined}
            />
            <RankingCard title="Porterías a cero" unit="a cero" rows={boards.cleanSheets} />
            <RankingCard title="Mejor local" unit="puntos" rows={boards.home} />
            <RankingCard title="Mejor visitante" unit="puntos" rows={boards.away} />
          </div>
          <p className="league-source">
            Calculado con los resultados oficiales a 90 minutos de {competitionName(competition, true)}{" "}
            {seasonLabel(seasonId)}.
          </p>
        </section>
      )}
    </div>
  );
}
