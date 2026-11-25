import { ArrowUpRight, CalendarClock, Flame, ShieldCheck, TrendingDown } from "lucide-react";
import type { CSSProperties } from "react";
import type { CompetitionCode } from "../lib/competitions";
import { competitionName } from "../lib/competitions";
import type { Match } from "../lib/domain";
import { seasonLabel } from "../lib/leagueHub";
import type { LeagueRow } from "../lib/leagueTable";
import type { Scorer } from "../lib/leagueStats";
import { go } from "../lib/navigation";
import {
  positionHistory,
  standingNotes,
  streakLabel,
  teamSheet,
  type SheetGame,
  type SheetSplit,
} from "../lib/teamSheet";
import CardDeck from "./CardDeck";
import { GoalsChart, Meter, PositionChart, ResultSplit } from "./Charts";
import { Crest } from "./ui";
import "../styles/teamCard.css";

const RESULT = { win: "V", draw: "E", loss: "D" } as const;
const RESULT_NAME = { win: "Victoria", draw: "Empate", loss: "Derrota" } as const;
const twoDecimals = new Intl.NumberFormat("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const shortDate = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });

function Split({ title, s }: { title: string; s: SheetSplit }) {
  return (
    <div className="team-sheet-venue">
      <span className="team-sheet-label">{title}</span>
      <strong className="numeral">
        {s.points}
        <small> pts</small>
      </strong>
      <span>
        {s.wins}V · {s.draws}E · {s.losses}D
      </span>
      <span className="team-sheet-muted">
        {s.goalsFor}:{s.goalsAgainst} en {s.played} {s.played === 1 ? "partido" : "partidos"}
      </span>
    </div>
  );
}

function Game({ game, onOpen }: { game: SheetGame; onOpen: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        className={`team-sheet-game is-${game.result}`}
        aria-label={`${RESULT_NAME[game.result!]} ${game.score} ${game.home ? "contra" : "en casa de"} ${game.opponent}`}
        onClick={() => onOpen(game.id)}
      >
        <span className="team-sheet-result">{RESULT[game.result!]}</span>
        <Crest src={game.crest} />
        <strong className="numeral">{game.score}</strong>
        <small>{game.home ? "casa" : "fuera"}</small>
      </button>
    </li>
  );
}

/** The sheet: the club at a glance, then what it needs and how it comes. */
export function TeamSheetCard({
  rows,
  index,
  matches,
  scorers,
  competition,
  seasonId,
  titleId,
  onMatch,
}: {
  rows: LeagueRow[];
  index: number;
  matches: Match[];
  scorers: Scorer[];
  competition: CompetitionCode;
  seasonId: string;
  titleId: string;
  onMatch: (id: string) => void;
}) {
  const sheet = teamSheet(rows, index, matches, scorers);
  const { row } = sheet;
  const history = positionHistory(matches, row.key);
  const recent = sheet.games.slice(-10).map((g) => ({
    label: `${g.home ? "contra" : "en casa de"} ${g.opponent} · ${shortDate.format(new Date(g.utcDate))}`,
    detail: `${g.home ? "Contra" : "En casa de"} ${g.opponent}, ${shortDate.format(new Date(g.utcDate))}`,
    scored: Number(g.score!.split("-")[0]),
    conceded: Number(g.score!.split("-")[1]),
  }));
  const percent = (s: SheetSplit) => (s.played ? Math.round((s.points / (s.played * 3)) * 100) : 0);
  const notes = standingNotes(rows, index, competition);
  const season = `${competitionName(competition, true)} ${seasonLabel(seasonId)}`;
  const streakIcon =
    sheet.streak?.kind === "wins" ? (
      <Flame size={18} aria-hidden="true" />
    ) : sheet.streak?.kind === "unbeaten" ? (
      <ShieldCheck size={18} aria-hidden="true" />
    ) : (
      <TrendingDown size={18} aria-hidden="true" />
    );
  return (
    <article className="team-sheet" aria-labelledby={titleId}>
      <header className="team-sheet-hero">
        <span className="team-sheet-position" aria-label={`${sheet.position}.º de ${sheet.size}`}>
          {sheet.position}
          <small>º</small>
        </span>
        <span className="team-sheet-points" aria-label={`${row.points} puntos`}>
          {row.points}
          <small>pts</small>
        </span>
        <span className="team-sheet-crest">
          <Crest src={row.crest} />
        </span>
        <h2 id={titleId}>{row.name}</h2>
        <p>{season}</p>
      </header>
      <div className="team-sheet-body" data-deck-scroll>
        <ul className="team-sheet-notes">
          {notes.map((note, i) => (
            <li key={note} style={{ "--i": i } as CSSProperties}>
              {note}
            </li>
          ))}
        </ul>
        <dl className="team-sheet-figures">
          <div>
            <dt>Partidos</dt>
            <dd className="numeral">{row.played}</dd>
          </div>
          <div>
            <dt>V · E · D</dt>
            <dd className="numeral">
              {row.wins}·{row.draws}·{row.losses}
            </dd>
          </div>
          <div>
            <dt>Goles</dt>
            <dd className="numeral">
              {row.goalsFor}:{row.goalsAgainst}
            </dd>
          </div>
          <div>
            <dt>Pts/partido</dt>
            <dd className="numeral">{row.played ? twoDecimals.format(row.points / row.played) : "—"}</dd>
          </div>
        </dl>
        <ResultSplit wins={row.wins} draws={row.draws} losses={row.losses} />
        {history.length > 1 && <PositionChart points={history} />}
        {sheet.last.length > 0 && (
          <section className="team-sheet-section">
            <h3>Últimos partidos</h3>
            <ol className="team-sheet-form">
              {sheet.last.map((game) => (
                <Game key={game.id} game={game} onOpen={onMatch} />
              ))}
            </ol>
            {sheet.streak && (
              <p className={`team-sheet-streak is-${sheet.streak.kind}`}>
                {streakIcon}
                {streakLabel(sheet.streak)}
              </p>
            )}
          </section>
        )}
        {recent.length > 1 && <GoalsChart games={recent} />}
        {sheet.next && (
          <section className="team-sheet-section">
            <h3>Próximo partido</h3>
            <button type="button" className="team-sheet-next" onClick={() => onMatch(sheet.next!.id)}>
              <CalendarClock size={18} aria-hidden="true" />
              <Crest src={sheet.next.crest} />
              <span>
                <strong>
                  {sheet.next.home ? "Contra" : "En casa de"} {sheet.next.opponent}
                </strong>
                <small>{when.format(new Date(sheet.next.utcDate))}</small>
              </span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
          </section>
        )}
        {sheet.home.played + sheet.away.played > 0 && (
          <section className="team-sheet-section">
            <h3>En casa y fuera</h3>
            <div className="team-sheet-meters">
              <Meter label="Casa" value={sheet.home.points} max={sheet.home.played * 3} figure={`${percent(sheet.home)}%`} />
              <Meter label="Fuera" value={sheet.away.points} max={sheet.away.played * 3} figure={`${percent(sheet.away)}%`} />
              <p className="team-sheet-muted">de los puntos que se podían ganar</p>
            </div>
            <div className="team-sheet-split">
              <Split title="Casa" s={sheet.home} />
              <Split title="Fuera" s={sheet.away} />
            </div>
            <p className="team-sheet-muted">
              {sheet.cleanSheets} {sheet.cleanSheets === 1 ? "portería a cero" : "porterías a cero"}
            </p>
          </section>
        )}
        {sheet.scorers.length > 0 && (
          <section className="team-sheet-section">
            <h3>Sus goleadores</h3>
            <ol className="team-sheet-scorers">
              {sheet.scorers.map((s) => (
                <li key={s.key}>
                  <span>{s.name}</span>
                  <strong className="numeral">{s.goals}</strong>
                  <small>{s.goals === 1 ? "gol" : "goles"}</small>
                </li>
              ))}
            </ol>
          </section>
        )}
        <footer className="team-sheet-foot">
          Resultados oficiales · {season}
          {sheet.last.length > 0 && ` · último, ${shortDate.format(new Date(sheet.last.at(-1)!.utcDate))}`}
        </footer>
      </div>
    </article>
  );
}

/**
 * A league table's team sheets: tap a team for its sheet, swipe to the one
 * above or below. A match on the sheet opens its page.
 */
export default function TeamCards({
  rows,
  start,
  origin,
  matches,
  scorers,
  competition,
  seasonId,
  onClose,
}: {
  rows: LeagueRow[];
  start: number;
  origin?: HTMLElement | null;
  matches: Match[];
  scorers: Scorer[];
  competition: CompetitionCode;
  seasonId: string;
  onClose: () => void;
}) {
  // The sheet stays open under the match: going back finds it as it was.
  const openMatch = (id: string) => go(`/partido/${encodeURIComponent(id)}`);
  return (
    <CardDeck
      count={rows.length}
      start={start}
      origin={origin}
      onClose={onClose}
      className="is-team"
      label="Más equipos"
      itemLabel={(i) => rows[i].name}
      render={(i, titleId) => (
        <TeamSheetCard
          key={rows[i].key}
          rows={rows}
          index={i}
          matches={matches}
          scorers={scorers}
          competition={competition}
          seasonId={seasonId}
          titleId={titleId}
          onMatch={openMatch}
        />
      )}
    />
  );
}

/** One team's sheet on its own (from a match page's crest): no swiping to others. */
export function SingleTeamSheet({
  rows,
  index,
  origin,
  matches,
  scorers,
  competition,
  seasonId,
  onClose,
}: {
  rows: LeagueRow[];
  index: number;
  origin?: HTMLElement | null;
  matches: Match[];
  scorers: Scorer[];
  competition: CompetitionCode;
  seasonId: string;
  onClose: () => void;
}) {
  // The sheet stays open under the match: going back finds it as it was.
  const openMatch = (id: string) => go(`/partido/${encodeURIComponent(id)}`);
  return (
    <CardDeck
      count={1}
      start={0}
      origin={origin}
      onClose={onClose}
      className="is-team"
      label="Equipo"
      itemLabel={() => rows[index].name}
      render={(_, titleId) => (
        <TeamSheetCard
          rows={rows}
          index={index}
          matches={matches}
          scorers={scorers}
          competition={competition}
          seasonId={seasonId}
          titleId={titleId}
          onMatch={openMatch}
        />
      )}
    />
  );
}
