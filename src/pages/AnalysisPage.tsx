import { AlertTriangle, CalendarClock, Check, ChevronDown, Minus, Sparkles, X } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import CompetitionLogo from "../components/CompetitionLogo";
import Segmented from "../components/Segmented";
import { SkeletonRows } from "../components/Skeleton";
import { Crest, Empty, PageTitle } from "../components/ui";
import {
  MARKET_NAMES,
  MIN_VALUE,
  edge,
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
} from "../lib/bettingAnalysis";
import { competitionName } from "../lib/competitions";
import type { Match } from "../lib/domain";
import { BreakEven, GoalChances, OutcomeChances, ValueOverview } from "../components/BetCharts";
import TeamForm from "../components/TeamForm";
import { demoAnalysisBoard } from "../lib/demoAnalysis";
import { prefersReducedMotion } from "../lib/motion";
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
const pct = (p: number) => `${Math.round(p * 100)} %`;
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
        {match && <small>{match.homeScore}-{match.awayScore}</small>}
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
 * every figure comes from.
 */
function Why({
  analysis,
  game,
  pick,
  preview = true,
}: {
  analysis: BettingAnalysis;
  game?: AnalysisMatch;
  pick?: AnalysisPick;
  preview?: boolean;
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
        {pick?.fair !== undefined && (
          <p className="bet-why-muted">Pinnacle, la casa de referencia, le da un {pct(pick.fair)}.</p>
        )}
        <dl className="bet-sources">
          <div>
            <dt>Cuotas</dt>
            <dd>
              {book}
              {sharp ? " y Pinnacle (precio justo)" : ""}, vía OddsPapi, a las {hour.format(new Date(analysis.oddsAt))}
            </dd>
          </div>
          <div>
            <dt>Temporada</dt>
            <dd>resultados oficiales de Football-Data</dd>
          </div>
          {game?.sources?.length ? (
            <div>
              <dt>Noticias</dt>
              <dd>{game.sources.join(" · ")}</dd>
            </div>
          ) : null}
          <div>
            <dt>Análisis</dt>
            <dd>IA (Claude), {relative(analysis.generatedAt)}</dd>
          </div>
        </dl>
      </div>
    </details>
  );
}

function PickCard({
  analysis,
  pick,
  game,
  match,
  index,
}: {
  analysis: BettingAnalysis;
  pick: AnalysisPick;
  game?: AnalysisMatch;
  match?: Match;
  index: number;
}) {
  const home = game?.home ?? match?.home ?? "Local";
  const away = game?.away ?? match?.away ?? "Visitante";
  return (
    <li className="bet-pick" style={{ "--i": index } as CSSProperties}>
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
        <span className={`bet-confidence is-${pick.confidence}`}>Confianza {pick.confidence}</span>
        <ResultBadge pick={pick} match={match} />
      </div>
      <BreakEven pick={pick} />
      <Why analysis={analysis} game={game} pick={pick} preview={false} />
    </li>
  );
}

/** The value of a price, as it is: «+8 %» when it pays more than it should, «−4 %» when less. */
function ValueChip({ pick }: { pick: AnalysisPick }) {
  const value = Math.round(edge(pick.probability, pick.price) * 100);
  return value * 0.01 >= MIN_VALUE ? (
    <span className="bet-value">Valor +{value} %</span>
  ) : (
    <span className="bet-value is-flat" title="Según la IA, la cuota paga menos de lo justo o casi lo justo">
      {value > 0 ? `Valor +${value} %` : value === 0 ? "Valor 0 %" : `Sin valor (${value} %)`.replace("-", "−")}
    </span>
  );
}

/** One match at a glance: who wins, goals, form and the best option; the words, folded. */
function GameCard({
  analysis,
  game,
  match,
  matches,
  index,
  juicy,
}: {
  analysis: BettingAnalysis;
  game: AnalysisMatch;
  match?: Match;
  matches: Match[];
  index: number;
  juicy: boolean;
}) {
  const pick = game.pick;
  return (
    <li className="bet-game" id={`bet-game-${game.matchId}`} style={{ "--i": index } as CSSProperties}>
      <Link to={`/partido/${encodeURIComponent(game.matchId)}`} className="bet-game-head">
        <Crest src={game.homeCrest} />
        <Crest src={game.awayCrest} />
        <strong>
          {game.home} – {game.away}
        </strong>
        <time dateTime={game.utcDate}>{hour.format(new Date(game.utcDate))}</time>
      </Link>
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
      {pick && (
        <div className="bet-best">
          <div className="bet-best-main">
            <span>
              <span className="eyebrow">Mejor opción · {MARKET_NAMES[pick.market]}</span>
              <strong>{pickLabel(pick, game.home, game.away)}</strong>
            </span>
            <span className="bet-best-price">
              <b className="numeral">{odds.format(pick.price)}</b>
              <small>{pick.book ?? "bet365"}</small>
            </span>
          </div>
          <div className="bet-pick-tags">
            <ValueChip pick={pick} />
            {juicy ? (
              <span className="bet-confidence is-plain">Está entre las jugosas</span>
            ) : (
              <span className={`bet-confidence is-${pick.confidence}`}>Confianza {pick.confidence}</span>
            )}
            <ResultBadge pick={pick} match={match} />
          </div>
          <BreakEven pick={pick} />
        </div>
      )}
      <Why analysis={analysis} game={game} pick={juicy ? undefined : pick} />
    </li>
  );
}

function AnalysisDay({
  analysis,
  byId,
  matches,
  latest,
}: {
  analysis: BettingAnalysis;
  byId: Map<string, Match>;
  matches: Match[];
  latest: boolean;
}) {
  const games = new Map(analysis.matches.map((m) => [m.matchId, m]));
  const open = (matchId: string) =>
    document
      .getElementById(`bet-game-${matchId}`)
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
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
      <ValueOverview matches={analysis.matches} onOpen={open} />
      <p className="bet-summary">{analysis.summary}</p>
      <h3 className="bet-subhead">
        Las más jugosas <small>{analysis.picks.length || "ninguna hoy"}</small>
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
            />
          ))}
        </ol>
      ) : (
        <p className="bet-note">
          Ninguna cuota paga hoy al menos un 3 % más de lo justo. Debajo tienes la mejor opción de cada partido, con su valor
          real.
        </p>
      )}
      <h3 className="bet-subhead">
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
            juicy={Boolean(m.pick && analysis.picks.some((p) => pickKey(p) === pickKey(m.pick!)))}
          />
        ))}
      </ul>
    </article>
  );
}

function Record({ analyses, matches, kind }: { analyses: BettingAnalysis[]; matches: Match[]; kind: "value" | "best" }) {
  const r = useMemo(() => trackRecord(analyses, matches, kind), [analyses, matches, kind]);
  if (!r.picks) return null;
  const staked = r.won + r.lost;
  return (
    <div className="bet-record-block">
      <h3 className="bet-subhead">
        {kind === "value" ? "Las jugosas" : "La mejor opción de cada partido"}
        <small>{r.picks} {r.picks === 1 ? "apuesta" : "apuestas"}</small>
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
          ? `Una unidad por apuesta a la cuota del análisis${r.void ? `; ${r.void} nulas devuelven la apuesta` : ""}.`
          : "Se resolverán cuando terminen los partidos."}
        {r.settled > 0 && r.picks > r.settled && ` ${r.picks - r.settled} por resolver.`}
      </p>
    </div>
  );
}

function PastDay({ analysis, byId }: { analysis: BettingAnalysis; byId: Map<string, Match> }) {
  const juicy = new Set(analysis.picks.map(pickKey));
  const all = [...analysis.picks, ...picksOf(analysis, "best").filter((p) => !juicy.has(pickKey(p)))];
  const results = all.map((p) => settlePick(p, byId.get(p.matchId)));
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
                    {juicy.has(pickKey(p)) && <em className="bet-juicy">Jugosa</em>}
                  </strong>
                  <small>
                    {game ? `${game.home} – ${game.away}` : ""} · {odds.format(p.price)} {p.book ?? "bet365"}
                  </small>
                </span>
                <ResultBadge pick={p} match={match} />
              </li>
            );
          })}
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
  // The latest stays on top while its matches are still to be played or just ended.
  const fresh = latest && Date.now() - Date.parse(latest.generatedAt) < 2 * 86_400_000;
  return (
    <>
      <PageTitle
        eyebrow="Análisis IA · cuotas de bet365"
        title="Apuestas"
        description="Antes del primer partido de cada día de LaLiga y Champions, la IA compara las cuotas de bet365 (u otra casa española si bet365 no está al día) con las de Pinnacle y con los datos de la temporada, y señala las que pagan más de lo que deberían."
      />
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
      {demo && <p className="bet-note">Ejemplo con los partidos de la demo: el análisis real usa cuotas reales de bet365.</p>}
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
            <AnalysisDay analysis={latest} byId={byId} matches={matches} latest />
          ) : (
            !latest && (
              <Empty art="net" title="Aún no hay análisis">
                Llegará solo, unos 40 minutos antes del primer partido del día de LaLiga o Champions.
              </Empty>
            )
          )}
          {analyses.length > 0 && (
            <section aria-labelledby="bet-record-title">
              <div className="section-heading">
                <h2 id="bet-record-title">Historial</h2>
              </div>
              <Record analyses={analyses} matches={matches} kind="value" />
              <Record analyses={analyses} matches={matches} kind="best" />
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
          compruébalas en bet365. GalacticBet no gestiona apuestas ni dinero. Juega con responsabilidad:{" "}
          <a href="https://www.jugarbien.es" target="_blank" rel="noreferrer">
            jugarbien.es
          </a>
          .
        </p>
      </footer>
    </>
  );
}
