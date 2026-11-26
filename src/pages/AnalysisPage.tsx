import {
  AlertTriangle,
  ArrowUp,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Minus,
  Sparkles,
  X,
} from "lucide-react";
import { flushSync } from "react-dom";
import { useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import CompetitionLogo from "../components/CompetitionLogo";
import Segmented from "../components/Segmented";
import { SkeletonRows } from "../components/Skeleton";
import { Crest, Empty, PageTitle } from "../components/ui";
import {
  ANALYSIS_COMPETITIONS,
  MARKET_NAMES,
  archivedRecord,
  comboLegs,
  comboOf,
  isPlayerMarket,
  winChance,
  nextAnalysis,
  pickKey,
  pickLabel,
  picksOf,
  settlePick,
  trackRecord,
  type AnalysisCompetition,
  type AnalysisMatch,
  type AnalysisPick,
  type BettingAnalysis,
  type PickResult,
  type RecordArchive,
  type RecordKind,
} from "../lib/bettingAnalysis";
import { competitionName } from "../lib/competitions";
import type { Match } from "../lib/domain";
import { BreakEven, GoalChances, OutcomeChances, ValueOverview } from "../components/BetCharts";
import { ComboCard, ComboPanel, ComboResult, ComboToggle, ValueChip } from "../components/BetCombo";
import { ConfidenceChip, MatchOptions } from "../components/BetOptions";
import BetGuide from "../components/BetGuide";
import TeamForm from "../components/TeamForm";
import { demoAnalysisBoard } from "../lib/demoAnalysis";
import { haptic, prefersReducedMotion } from "../lib/motion";
import { useAnalysisBoard } from "../lib/useAnalysisBoard";
import "../styles/analysis.css";

type Filter = "all" | AnalysisCompetition;
const odds = new Intl.NumberFormat("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const units = new Intl.NumberFormat("es", { minimumFractionDigits: 1, maximumFractionDigits: 2, signDisplay: "exceptZero" });
const day = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" });
const shortDay = new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short" });
const hour = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
const when = new Intl.DateTimeFormat("es", { weekday: "long", hour: "2-digit", minute: "2-digit" });
const ago = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
/** The day of an analysis, at noon in Spain so no time zone moves it. */
const dayOf = (a: BettingAnalysis) => new Date(`${a.date}T12:00:00`);

function relative(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 60) return ago.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  return hours < 36 ? ago.format(-hours, "hour") : ago.format(-Math.round(hours / 24), "day");
}

const RESULT: Record<PickResult, { label: string; icon: typeof Check }> = {
  won: { label: "Acertada", icon: Check },
  lost: { label: "Fallada", icon: X },
  void: { label: "Nula", icon: Minus },
};

function ResultBadge({ pick, match }: { pick: AnalysisPick; match?: Match }) {
  const result = settlePick(pick, match);
  if (result) {
    const { label, icon: Icon } = RESULT[result];
    const gain = result === "won" ? pick.price - 1 : result === "lost" ? -1 : 0;
    return (
      <span className={`bet-result is-${result}`}>
        <Icon size={14} strokeWidth={3} aria-hidden="true" />
        {label}
        {result !== "void" && <b>{units.format(gain)} u</b>}
        {match && match.homeScore !== null && match.awayScore !== null && (
          <small>
            {match.homeScore}-{match.awayScore}
          </small>
        )}
      </span>
    );
  }
  if (match?.status === "IN_PLAY" || match?.status === "PAUSED")
    return (
      <span className="bet-result is-live">
        En juego{match.homeScore !== null && ` · ${match.homeScore}-${match.awayScore}`}
      </span>
    );
  return null;
}

/**
 * Secondary text, folded: the AI's words (preview, reason, risk) and where
 * this match's figures come from. What each figure means is in the guide.
 */
function Why({
  analysis,
  game,
  pick,
  preview = true,
  onHelp,
}: {
  analysis: BettingAnalysis;
  game?: AnalysisMatch;
  pick?: AnalysisPick;
  preview?: boolean;
  onHelp: () => void;
}) {
  const book = pick?.book ?? game?.pick?.book ?? analysis.bookmaker;
  const sharp = game?.market?.source === "Pinnacle" || pick?.fair !== undefined;
  return (
    <details className="bet-why">
      <summary>
        Por qué y de dónde sale
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="bet-why-body">
        {preview && game?.preview && <p>{game.preview}</p>}
        {pick && <p>{pick.reason}</p>}
        {pick?.risk && (
          <p className="bet-risk">
            <AlertTriangle size={15} aria-hidden="true" />
            {pick.risk}
          </p>
        )}
        <dl className="bet-sources">
          <div>
            <dt>Cuotas</dt>
            <dd>
              {book}
              {sharp ? " y Pinnacle" : ""}, a las {hour.format(new Date(analysis.oddsAt))}
            </dd>
          </div>
          {game?.sources?.length ? (
            <div>
              <dt>Noticias</dt>
              <dd>{game.sources.join(" · ")}</dd>
            </div>
          ) : null}
          {pick && (
            <div>
              <dt>Solidez</dt>
              <dd>
                {pick.confidence}
                {isPlayerMarket(pick.market) ? " · apuesta de jugador, sin cuota de Pinnacle" : ""}
              </dd>
            </div>
          )}
          <div>
            <dt>Análisis</dt>
            <dd>IA (Claude), {relative(analysis.generatedAt)}</dd>
          </div>
        </dl>
        <button type="button" className="text-button bet-why-help" onClick={onHelp}>
          <CircleHelp size={15} aria-hidden="true" /> Qué significa cada dato
        </button>
      </div>
    </details>
  );
}

/** Your combinada while you build it: which bets are in, add or take out, empty it. */
interface Slip {
  has: (pick: AnalysisPick) => boolean;
  toggle: (pick: AnalysisPick) => void;
  clear: () => void;
}

/** Where a bet with value sits on the page (a match can have two). */
const pickAnchor = (pick: AnalysisPick) => `bet-pick-${pickKey(pick).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
const scrollTo = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });

function PickCard({
  analysis,
  pick,
  game,
  match,
  index,
  slip,
  onHelp,
}: {
  analysis: BettingAnalysis;
  pick: AnalysisPick;
  game?: AnalysisMatch;
  match?: Match;
  index: number;
  slip?: Slip;
  onHelp: () => void;
}) {
  const home = game?.home ?? match?.home ?? "Local";
  const away = game?.away ?? match?.away ?? "Visitante";
  return (
    <li className="bet-pick" id={pickAnchor(pick)} style={{ "--i": index } as CSSProperties}>
      <Link className="bet-pick-match" to={`/partido/${encodeURIComponent(pick.matchId)}`}>
        <Crest src={game?.homeCrest} />
        <Crest src={game?.awayCrest} />
        <span>
          {home} – {away}
        </span>
        {game && <time dateTime={game.utcDate}>{hour.format(new Date(game.utcDate))}</time>}
      </Link>
      <div className="bet-pick-main">
        <div className="bet-pick-bet">
          <span className="eyebrow">{MARKET_NAMES[pick.market]}</span>
          <h3>{pickLabel(pick, home, away)}</h3>
        </div>
        <div className="bet-pick-price">
          <strong className="numeral">{odds.format(pick.price)}</strong>
          <small>{pick.book ?? "bet365"}</small>
        </div>
      </div>
      <div className="bet-pick-tags">
        <ValueChip pick={pick} />
        <ConfidenceChip chance={winChance(pick)} />
        <ResultBadge pick={pick} match={match} />
        {slip && <ComboToggle pick={pick} inSlip={slip.has(pick)} onToggle={slip.toggle} />}
      </div>
      <BreakEven pick={pick} />
      <Why analysis={analysis} game={game} pick={pick} preview={false} onHelp={onHelp} />
    </li>
  );
}

/**
 * One match, folded to a line: the teams and the recommendation with its
 * price. Open, the charts, the recommendation in full (or where it already
 * is, among the bets with value), every price and the words.
 */
function GameCard({
  analysis,
  game,
  match,
  matches,
  index,
  valued,
  slip,
  open,
  onToggle,
  onHelp,
}: {
  analysis: BettingAnalysis;
  game: AnalysisMatch;
  match?: Match;
  matches: Match[];
  index: number;
  valued: boolean;
  slip?: Slip;
  open: boolean;
  onToggle: () => void;
  onHelp: () => void;
}) {
  const pick = game.pick;
  const bodyId = `bet-game-body-${game.matchId}`;
  return (
    <li className={`bet-game${open ? " is-open" : ""}`} id={`bet-game-${game.matchId}`} style={{ "--i": index } as CSSProperties}>
      <button type="button" className="bet-game-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="bet-game-head">
          <Crest src={game.homeCrest} />
          <Crest src={game.awayCrest} />
          <strong>
            {game.home} – {game.away}
          </strong>
          <time dateTime={game.utcDate}>{hour.format(new Date(game.utcDate))}</time>
          <ChevronDown className="bet-game-chevron" size={18} aria-hidden="true" />
        </span>
        {pick && !open && (
          <span className="bet-game-summary">
            <span>
              <small>{valued ? "Con valor" : "Recomendación"}</small>
              <strong>{pickLabel(pick, game.home, game.away)}</strong>
            </span>
            <b className="numeral">{odds.format(pick.price)}</b>
            <span className="bet-game-summary-tags">
              <ValueChip pick={pick} />
              <ResultBadge pick={pick} match={match} />
            </span>
          </span>
        )}
      </button>
      {open && (
        <div className="bet-game-body" id={bodyId}>
          {game.market && <OutcomeChances market={game.market} home={game.home} away={game.away} />}
          {game.market && <GoalChances market={game.market} />}
          {match && (
            <div className="bet-form">
              <span className="bet-chart-title">Forma</span>
              <span className="bet-form-row">
                <span>{game.home}</span>
                <TeamForm match={match} side="home" matches={matches} />
              </span>
              <span className="bet-form-row">
                <span>{game.away}</span>
                <TeamForm match={match} side="away" matches={matches} />
              </span>
            </div>
          )}
          {pick &&
            (valued ? (
              // Already in full among the bets with value: a way there, not a copy.
              <button type="button" className="bet-best-link" onClick={() => scrollTo(pickAnchor(pick))}>
                <span>
                  <span className="eyebrow">Con valor</span>
                  <strong>{pickLabel(pick, game.home, game.away)}</strong>
                </span>
                <b className="numeral">{odds.format(pick.price)}</b>
                <ArrowUp size={18} aria-label="Ver en apuestas con valor" />
              </button>
            ) : (
              <div className="bet-best">
                <div className="bet-best-main">
                  <span>
                    <span className="eyebrow">Recomendación · {MARKET_NAMES[pick.market]}</span>
                    <strong>{pickLabel(pick, game.home, game.away)}</strong>
                  </span>
                  <span className="bet-best-price">
                    <b className="numeral">{odds.format(pick.price)}</b>
                    <small>{pick.book ?? "bet365"}</small>
                  </span>
                </div>
                <div className="bet-pick-tags">
                  <ValueChip pick={pick} />
                  <ConfidenceChip chance={winChance(pick)} />
                  <ResultBadge pick={pick} match={match} />
                  {slip && <ComboToggle pick={pick} inSlip={slip.has(pick)} onToggle={slip.toggle} />}
                </div>
                <BreakEven pick={pick} />
              </div>
            ))}
          {game.options?.length ? (
            <MatchOptions options={game.options} home={game.home} away={game.away} recommended={pick} />
          ) : null}
          <Why analysis={analysis} game={game} pick={valued ? undefined : pick} onHelp={onHelp} />
          <Link to={`/partido/${encodeURIComponent(game.matchId)}`} className="bet-game-link">
            Ficha del partido
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        </div>
      )}
    </li>
  );
}

function AnalysisDay({
  analysis,
  byId,
  matches,
  latest,
  slip,
  slipLegs = [],
  onHelp,
}: {
  analysis: BettingAnalysis;
  byId: Map<string, Match>;
  matches: Match[];
  latest: boolean;
  slip?: Slip;
  slipLegs?: AnalysisPick[];
  onHelp: () => void;
}) {
  const games = new Map(analysis.matches.map((m) => [m.matchId, m]));
  const combo = comboLegs(analysis);
  // Folded matches: a short list to scan; a single match opens on its own.
  const [opened, setOpened] = useState<{ id: string; ids: Set<string> }>(() => ({
    id: analysis.id,
    ids: new Set(analysis.matches.length === 1 ? [analysis.matches[0].matchId] : []),
  }));
  const openIds = opened.id === analysis.id ? opened.ids : new Set<string>();
  const toggle = (matchId: string) => {
    const ids = new Set(openIds);
    if (!ids.delete(matchId)) ids.add(matchId);
    setOpened({ id: analysis.id, ids });
  };
  // From «De un vistazo»: open that match and go to it.
  const open = (matchId: string) => {
    flushSync(() => setOpened({ id: analysis.id, ids: new Set(openIds).add(matchId) }));
    scrollTo(`bet-game-${matchId}`);
  };
  const sections = [
    { id: "bet-sec-valor", label: "Con valor", count: analysis.picks.length },
    ...(combo.length >= 2 ? [{ id: "bet-sec-combo", label: "Combinada", count: combo.length }] : []),
    { id: "bet-sec-partidos", label: "Partidos", count: analysis.matches.length },
    { id: "bet-historial", label: "Historial" },
  ];
  return (
    <article className={`bet-day${latest ? " is-latest" : ""}`} aria-labelledby={`bet-${analysis.id}`}>
      <header className="bet-day-head">
        <CompetitionLogo code={analysis.competition} small />
        <span>
          {competitionName(analysis.competition, true)} · {day.format(dayOf(analysis))}
        </span>
        <small>
          <Sparkles size={13} aria-hidden="true" /> {relative(analysis.generatedAt)}
        </small>
      </header>
      <h2 id={`bet-${analysis.id}`}>{analysis.headline}</h2>
      <nav className="bet-jump" aria-label="Ir a una parte del análisis">
        {sections.map((section) => (
          <button key={section.id} type="button" onClick={() => scrollTo(section.id)}>
            {section.label}
            {"count" in section && <small>{section.count}</small>}
          </button>
        ))}
      </nav>
      {slip && slipLegs.length > 0 && (
        <ComboPanel legs={slipLegs} games={games} onRemove={slip.toggle} onClear={slip.clear} />
      )}
      <ValueOverview matches={analysis.matches} onOpen={open} />
      <p className="bet-summary">{analysis.summary}</p>
      <h3 className="bet-subhead" id="bet-sec-valor">
        Apuestas con valor <small>{analysis.picks.length || "ninguna hoy"}</small>
      </h3>
      {analysis.picks.length ? (
        <ol className="bet-picks">
          {analysis.picks.map((pick, i) => (
            <PickCard
              key={pickKey(pick)}
              analysis={analysis}
              pick={pick}
              game={games.get(pick.matchId)}
              match={byId.get(pick.matchId)}
              index={i}
              slip={slip}
              onHelp={onHelp}
            />
          ))}
        </ol>
      ) : (
        <p className="bet-note">Hoy ninguna cuota paga bien según la IA. Abajo, la recomendación de cada partido.</p>
      )}
      {combo.length >= 2 && (
        <div id="bet-sec-combo" className="bet-anchor">
          <ComboCard legs={combo} games={games} byId={byId} />
        </div>
      )}
      <h3 className="bet-subhead" id="bet-sec-partidos">
        Partido a partido <small>{analysis.matches.length}</small>
      </h3>
      <ul className="bet-games">
        {analysis.matches.map((m, i) => (
          <GameCard
            key={m.matchId}
            analysis={analysis}
            game={m}
            match={byId.get(m.matchId)}
            matches={matches}
            index={i}
            valued={Boolean(m.pick && analysis.picks.some((p) => pickKey(p) === pickKey(m.pick!)))}
            slip={slip}
            open={openIds.has(m.matchId)}
            onToggle={() => toggle(m.matchId)}
            onHelp={onHelp}
          />
        ))}
      </ul>
    </article>
  );
}

function Record({
  analyses,
  matches,
  kind,
  archive,
  competitions,
}: {
  analyses: BettingAnalysis[];
  matches: Match[];
  kind: RecordKind;
  archive?: RecordArchive;
  competitions: readonly AnalysisCompetition[];
}) {
  // Older analyses no longer on the board still count: their totals were archived.
  const older = useMemo(() => archivedRecord(archive, competitions, kind), [archive, competitions, kind]);
  const r = useMemo(() => trackRecord(analyses, matches, kind, older?.totals), [analyses, matches, kind, older]);
  if (!r.picks) return null;
  const staked = r.won + r.lost;
  return (
    <div className="bet-record-block">
      <h3 className="bet-subhead">
        {kind === "value" ? "Apuestas con valor" : kind === "best" ? "Recomendación de cada partido" : "Combinada de valor"}
        <small>
          {r.picks} {kind === "combo" ? (r.picks === 1 ? "combinada" : "combinadas") : r.picks === 1 ? "apuesta" : "apuestas"}
        </small>
      </h3>
      {r.settled ? (
        <div className="bet-record">
          <div className="bet-tile">
            <span className="bet-tile-label">Acertadas</span>
            <span className="bet-tile-value">
              <strong className="numeral">{r.won}</strong>
              <small>de {staked}</small>
            </span>
            <small>{staked ? Math.round((r.won / staked) * 100) : 0} % de acierto</small>
          </div>
          <div className={`bet-tile ${r.units >= 0 ? "is-up" : "is-down"}`}>
            <span className="bet-tile-label">Balance</span>
            <span className="bet-tile-value">
              <strong className="numeral">{units.format(r.units)}</strong>
              <small>u</small>
            </span>
            <small>{r.yield !== null ? `${units.format(Math.round(r.yield * 100))} % por unidad` : "—"}</small>
          </div>
        </div>
      ) : null}
      <p className="bet-source">
        {r.settled
          ? `Una unidad por ${kind === "combo" ? "combinada a su cuota total" : "apuesta a la cuota del análisis"}${r.void ? `; ${r.void} nulas devuelven la apuesta` : ""}.`
          : "Se resolverán cuando terminen los partidos."}
        {r.settled > 0 && r.picks > r.settled && ` ${r.picks - r.settled} por resolver.`}
        {older && ` Desde el ${shortDay.format(new Date(`${older.since}T12:00:00`))}.`}
      </p>
    </div>
  );
}

function PastDay({ analysis, byId }: { analysis: BettingAnalysis; byId: Map<string, Match> }) {
  const valued = new Set(analysis.picks.map(pickKey));
  const all = [...analysis.picks, ...picksOf(analysis, "best").filter((p) => !valued.has(pickKey(p)))];
  const results = all.map((p) => settlePick(p, byId.get(p.matchId)));
  const combo = comboLegs(analysis);
  const [open, setOpen] = useState(false);
  return (
    <li className={`bet-past${open ? " is-open" : ""}`}>
      <button type="button" className="bet-past-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <CompetitionLogo code={analysis.competition} small />
        <span>
          <strong>{analysis.headline}</strong>
          <small>
            {competitionName(analysis.competition, true)} · {shortDay.format(dayOf(analysis))}
          </small>
        </span>
        <span className="bet-dots" aria-label={`${results.filter((r) => r === "won").length} acertadas de ${results.length}`}>
          {results.map((r, i) => (
            <i key={i} className={r ? `is-${r}` : "is-open"} />
          ))}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open && (
        <ol className="bet-past-picks">
          {all.map((p) => {
            const game = analysis.matches.find((m) => m.matchId === p.matchId);
            const match = byId.get(p.matchId);
            return (
              <li key={pickKey(p)}>
                <span>
                  <strong>
                    {pickLabel(p, game?.home ?? "", game?.away ?? "")}
                    {valued.has(pickKey(p)) && <em className="bet-tag-value">Valor</em>}
                  </strong>
                  <small>
                    {game ? `${game.home} – ${game.away}` : ""} · {odds.format(p.price)} {p.book ?? "bet365"}
                  </small>
                </span>
                <ResultBadge pick={p} match={match} />
              </li>
            );
          })}
          {combo.length >= 2 && (
            <li className="bet-past-combo">
              <span>
                <strong>
                  Combinada de {combo.length}
                  <em className="bet-tag-value">Valor</em>
                </strong>
                <small>Cuota {odds.format(comboOf(combo).price)}</small>
              </span>
              <ComboResult legs={combo} byId={byId} />
            </li>
          )}
          {!all.length && <li className="bet-past-none">Sin apuestas.</li>}
        </ol>
      )}
    </li>
  );
}

export default function AnalysisPage({ matches, demo, loading }: { matches: Match[]; demo: boolean; loading: boolean }) {
  const live = useAnalysisBoard(!demo);
  const sample = useMemo(() => (demo ? demoAnalysisBoard() : null), [demo]);
  const board = demo ? sample : live.board;
  const { loading: boardLoading, error, retry } = live;
  const [filter, setFilter] = useState<Filter>("all");
  const [guide, setGuide] = useState(false);
  const help = () => {
    haptic();
    setGuide(true);
  };
  const competitions = useMemo(() => (filter === "all" ? ANALYSIS_COMPETITIONS : [filter]), [filter]);
  const byId = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const analyses = useMemo(
    () => (board?.analyses ?? []).filter((a) => filter === "all" || a.competition === filter),
    [board, filter],
  );
  const next = useMemo(() => {
    const done = new Set(board?.analyses.map((a) => a.id) ?? []);
    const upcoming = nextAnalysis(
      matches.filter((m) => filter === "all" || m.competition === filter),
      Date.now(),
      done,
    );
    return upcoming;
  }, [matches, board, filter]);
  const [latest, ...past] = analyses;
  // Your combinada, for the analysis on top (a new one starts it empty).
  const [picked, setPicked] = useState<{ id: string; legs: AnalysisPick[] }>({ id: "", legs: [] });
  const slipLegs = latest && picked.id === latest.id ? picked.legs : [];
  const slip: Slip | undefined = latest
    ? {
        has: (pick) => slipLegs.some((l) => pickKey(l) === pickKey(pick)),
        toggle: (pick) => {
          const key = pickKey(pick);
          const inside = slipLegs.some((l) => pickKey(l) === key);
          if (!inside) haptic();
          // One bet per match: a new one of the same match takes the place of the other.
          setPicked({
            id: latest.id,
            legs: inside
              ? slipLegs.filter((l) => pickKey(l) !== key)
              : [...slipLegs.filter((l) => l.matchId !== pick.matchId), pick],
          });
        },
        clear: () => setPicked({ id: latest.id, legs: [] }),
      }
    : undefined;
  // The latest stays on top while its matches are still to be played or just ended.
  const fresh = latest && Date.now() - Date.parse(latest.generatedAt) < 2 * 86_400_000;
  return (
    <>
      <PageTitle
        eyebrow="Análisis IA · cuotas de bet365"
        title="Apuestas"
        description="Las cuotas que pagan de más según la IA, antes de cada día de LaLiga y Champions."
        titleControl={
          <button type="button" className="masthead-search" aria-label="Cómo leer el análisis" onClick={help}>
            <CircleHelp size={21} strokeWidth={2.3} aria-hidden="true" />
          </button>
        }
      />
      {guide && <BetGuide onClose={() => setGuide(false)} />}
      <Segmented<Filter>
        label="Competición"
        className="bet-filter"
        value={filter}
        options={[
          { value: "all", label: "Todo" },
          { value: "PD", label: "LaLiga" },
          { value: "CL", label: "Champions" },
        ]}
        onChange={setFilter}
      />
      {demo && <p className="bet-note">Ejemplo con los partidos de la demo.</p>}
      {!demo && (boardLoading || (loading && !board)) ? (
        <SkeletonRows rows={3} label="Cargando el análisis" />
      ) : !demo && error ? (
        <Empty
          title="No se ha podido cargar el análisis"
          action={
            <button type="button" className="button secondary" onClick={retry}>
              Reintentar
            </button>
          }
        >
          Comprueba la conexión y vuelve a intentarlo.
        </Empty>
      ) : (
        <>
          {!demo && next && (!fresh || next.day.id !== latest?.id) && (
            <p className="bet-next">
              <CalendarClock size={18} aria-hidden="true" />
              <span>
                Próximo análisis: <b>{when.format(new Date(next.at))}</b>, antes del {next.day.matches[0].home} –{" "}
                {next.day.matches[0].away} ({competitionName(next.day.competition, true)}).
              </span>
            </p>
          )}
          {latest && fresh ? (
            <AnalysisDay
              key={latest.id}
              analysis={latest}
              byId={byId}
              matches={matches}
              latest
              slip={slip}
              slipLegs={slipLegs}
              onHelp={help}
            />
          ) : (
            !latest && (
              <Empty art="net" title="Aún no hay análisis">
                Llegará solo, unos 40 minutos antes del primer partido del día de LaLiga o Champions.
              </Empty>
            )
          )}
          {(analyses.length > 0 || archivedRecord(board?.archive, competitions, "best")) && (
            <section aria-labelledby="bet-record-title" id="bet-historial" className="bet-anchor">
              <div className="section-heading">
                <h2 id="bet-record-title">Historial</h2>
              </div>
              <Record analyses={analyses} matches={matches} kind="value" archive={board?.archive} competitions={competitions} />
              <Record analyses={analyses} matches={matches} kind="best" archive={board?.archive} competitions={competitions} />
              <Record analyses={analyses} matches={matches} kind="combo" archive={board?.archive} competitions={competitions} />
              {(fresh ? past : analyses).length > 0 && (
                <ul className="bet-past-list">
                  {(fresh ? past : analyses).map((a) => (
                    <PastDay key={a.id} analysis={a} byId={byId} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
      <footer className="bet-disclaimer">
        <strong>+18</strong>
        <p>
          Información orientativa generada por IA: puede equivocarse y ninguna apuesta es segura. Las cuotas cambian;
          compruébalas en la casa de apuestas. GalacticBet no gestiona apuestas ni dinero. Juega con responsabilidad:{" "}
          <a href="https://www.jugarbien.es" target="_blank" rel="noreferrer">
            jugarbien.es
          </a>
          .
        </p>
      </footer>
    </>
  );
}
