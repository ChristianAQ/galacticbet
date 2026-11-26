import { AlertTriangle, CalendarClock, Check, ChevronDown, Minus, Sparkles, X } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import CompetitionLogo from "../components/CompetitionLogo";
import Segmented from "../components/Segmented";
import { SkeletonRows } from "../components/Skeleton";
import { Crest, Empty, PageTitle } from "../components/ui";
import {
  MARKET_NAMES,
  edge,
  nextAnalysis,
  pickLabel,
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
import { demoAnalysisBoard } from "../lib/demoAnalysis";
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

/** IA's chance against the one the price implies: the gap is the value. */
function ValueBars({ pick }: { pick: AnalysisPick }) {
  const implied = 1 / pick.price;
  return (
    <div className="bet-bars" role="img" aria-label={`Estimación de la IA ${pct(pick.probability)}; la cuota paga como si fuera ${pct(implied)}`}>
      <div className="bet-bar is-ai" style={{ "--p": pick.probability } as CSSProperties}>
        <span>Estimación IA</span>
        <i aria-hidden="true" />
        <b>{pct(pick.probability)}</b>
      </div>
      <div className="bet-bar is-price" style={{ "--p": implied } as CSSProperties}>
        <span>Lo que paga la cuota</span>
        <i aria-hidden="true" />
        <b>{pct(implied)}</b>
      </div>
      {pick.fair !== undefined && (
        <p className="bet-sharp">
          Pinnacle, la casa de referencia, le da un {pct(pick.fair)}
        </p>
      )}
    </div>
  );
}

function PickCard({ pick, game, match, index }: { pick: AnalysisPick; game?: AnalysisMatch; match?: Match; index: number }) {
  const value = edge(pick.probability, pick.price);
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
        <span className="bet-value">Valor +{Math.round(value * 100)} %</span>
        <span className={`bet-confidence is-${pick.confidence}`}>Confianza {pick.confidence}</span>
        <ResultBadge pick={pick} match={match} />
      </div>
      <ValueBars pick={pick} />
      <p className="bet-reason">{pick.reason}</p>
      {pick.risk && (
        <p className="bet-risk">
          <AlertTriangle size={15} aria-hidden="true" />
          {pick.risk}
        </p>
      )}
    </li>
  );
}

function AnalysisDay({ analysis, byId, latest }: { analysis: BettingAnalysis; byId: Map<string, Match>; latest: boolean }) {
  const games = new Map(analysis.matches.map((m) => [m.matchId, m]));
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
      <p className="bet-summary">{analysis.summary}</p>
      {analysis.picks.length ? (
        <ol className="bet-picks">
          {analysis.picks.map((pick, i) => (
            <PickCard key={`${pick.matchId}-${pick.market}-${pick.selection}-${pick.line ?? ""}`} pick={pick} game={games.get(pick.matchId)} match={byId.get(pick.matchId)} index={i} />
          ))}
        </ol>
      ) : (
        <p className="bet-note">Hoy la IA no ve valor claro en ninguna cuota: mejor no forzar.</p>
      )}
      <details className="bet-previews">
        <summary>
          Partido a partido <small>{analysis.matches.length}</small>
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <ul>
          {analysis.matches.map((m) => (
            <li key={m.matchId}>
              <Link to={`/partido/${encodeURIComponent(m.matchId)}`} className="bet-preview">
                <span className="bet-preview-teams">
                  <Crest src={m.homeCrest} />
                  <strong>
                    {m.home} – {m.away}
                  </strong>
                  <time dateTime={m.utcDate}>{hour.format(new Date(m.utcDate))}</time>
                </span>
                <span className="bet-preview-text">{m.preview}</span>
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function Record({ analyses, matches }: { analyses: BettingAnalysis[]; matches: Match[] }) {
  const r = useMemo(() => trackRecord(analyses, matches), [analyses, matches]);
  if (!r.settled)
    return <p className="bet-source">El historial empieza cuando terminen los primeros partidos analizados.</p>;
  const staked = r.won + r.lost;
  return (
    <>
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
      <p className="bet-source">
        Una unidad por apuesta a la cuota de bet365 del análisis{r.void ? `; ${r.void} nulas devuelven la apuesta` : ""}.
        {r.picks > r.settled && ` ${r.picks - r.settled} por resolver.`}
      </p>
    </>
  );
}

function PastDay({ analysis, byId }: { analysis: BettingAnalysis; byId: Map<string, Match> }) {
  const results = analysis.picks.map((p) => settlePick(p, byId.get(p.matchId)));
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
          {analysis.picks.map((p) => {
            const game = analysis.matches.find((m) => m.matchId === p.matchId);
            const match = byId.get(p.matchId);
            return (
              <li key={`${p.matchId}-${p.market}-${p.selection}-${p.line ?? ""}`}>
                <span>
                  <strong>{pickLabel(p, game?.home ?? "", game?.away ?? "")}</strong>
                  <small>
                    {game ? `${game.home} – ${game.away}` : ""} · {odds.format(p.price)} {p.book ?? "bet365"}
                  </small>
                </span>
                <ResultBadge pick={p} match={match} />
              </li>
            );
          })}
          {!analysis.picks.length && <li className="bet-past-none">Sin apuestas: no había valor.</li>}
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
            <AnalysisDay analysis={latest} byId={byId} latest />
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
              <Record analyses={analyses} matches={matches} />
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
