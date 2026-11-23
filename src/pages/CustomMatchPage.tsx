import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Lock,
  MapPin,
  NotebookPen,
  Pencil,
  Plus,
  Shirt,
  Trophy,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CompetitionBadge } from "../components/CustomChips";
import MatchEditSheet, { MatchPicks, matchTitle } from "../components/CustomMatchSheet";
import { EventSheet, LineupSheet } from "../components/CustomMatchReport";
import LeagueTable from "../components/LeagueTable";
import LineupPitch from "../components/LineupPitch";
import { LiveMinute } from "../components/LiveStatus";
import { HeroCrest, MatchSkeleton, MatchTabs, useMatchTab } from "../components/MatchPageParts";
import MatchPreview from "../components/MatchPreview";
import MatchTimeline from "../components/MatchTimeline";
import Matchups from "../components/Matchups";
import TeamForm from "../components/TeamForm";
import TeamLineup from "../components/TeamLineup";
import { Empty, PageTitle, useCollapsingTitle } from "../components/ui";
import { useNavTitle } from "../lib/chrome";
import {
  resolveCompetition,
  roundKey,
  STATUS_LABELS,
  toAppMatch,
  type Competition,
  type CompetitionView,
  type MatchEvent,
  type Participant,
  type ResolvedMatch,
} from "../lib/customCompetition";
import {
  customFixtureId,
  useCompetition,
  useCompetitionRounds,
  useRoundsSync,
} from "../lib/customCompetitionData";
import { canPick } from "../lib/customPicks";
import { matchPageTabLabels } from "../lib/matchDetailTabs";
import { headToHead } from "../lib/matchInsights";
import { countdownLabel } from "../lib/matchPreview";
import { reportLineups, reportTimeline } from "../lib/matchReport";
import { finishedMatchResult } from "../lib/matchResult";
import { haptic } from "../lib/motion";
import { goBack } from "../lib/navigation";
import type { AppUser } from "../lib/session";
import "../styles/matchExtras.css";
import "../styles/matchPage.css";
import "../styles/customMatch.css";

const kickoffTime = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
const kickoffDay = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" });

type Tab = "preview" | "events" | "lineups" | "picks" | "table";
const TAB_LABELS: Record<Tab, string> = {
  preview: matchPageTabLabels.preview,
  events: matchPageTabLabels.events,
  lineups: matchPageTabLabels.lineups,
  picks: "Pronósticos",
  table: matchPageTabLabels.table,
};
type Sheet = { kind: "edit" } | { kind: "event"; event: MatchEvent | null } | { kind: "lineups" } | null;

/**
 * A match of a friends' competition, on the same page as any LaLiga fixture:
 * scoreboard, scorers, events, lineups, predictions and table. Its organisers
 * also get the tools to fill it in from the touchline.
 */
export default function CustomMatchPage({ user, onLogin }: { user: AppUser | null; onLogin: () => void }) {
  const { cid = "", mid = "" } = useParams();
  const data = useCompetition(cid);
  const c = data.competition;
  const view = useMemo(
    () => (c ? resolveCompetition(c, data.participants, data.matches) : null),
    [c, data.participants, data.matches],
  );
  const match = view?.matches.find((m) => m.id === mid);
  if (!c || !view || !match)
    return data.loading ? (
      <MatchSkeleton />
    ) : (
      <>
        <PageTitle eyebrow="Fuera de juego" title="Partido" />
        <Empty
          art="flag"
          title="Este partido ya no está en el calendario"
          action={
            <Link className="button primary" to={c ? `/ligas?liga=${encodeURIComponent(c.id)}` : "/ligas"}>
              Ver la competición <ArrowRight size={16} aria-hidden="true" />
            </Link>
          }
        >
          {data.error || "Puede que lo hayan borrado o que el enlace haya caducado."}
        </Empty>
      </>
    );
  return (
    <CustomMatchView
      key={match.id}
      competition={c}
      view={view}
      match={match}
      participants={data.participants}
      user={user}
      onLogin={onLogin}
    />
  );
}

function CustomMatchView({
  competition: c,
  view,
  match,
  participants,
  user,
  onLogin,
}: {
  competition: Competition;
  view: CompetitionView;
  match: ResolvedMatch;
  participants: Participant[];
  user: AppUser | null;
  onLogin: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const [sheet, setSheet] = useState<Sheet>(null);
  useNavTitle(`${match.home.name} – ${match.away.name}`);
  const board = useCollapsingTitle<HTMLDivElement>();
  const app = useMemo(() => toAppMatch(c.id, match), [c.id, match]);
  const history = useMemo(() => view.matches.map((m) => toAppMatch(c.id, m)), [c.id, view]);
  const uid = user?.uid || "";
  const owner = uid === c.ownerId;
  const runs = owner || c.adminIds.includes(uid);
  // A date, a result or a knockout side changed here also changes the quiniela's rounds.
  const roundDocs = useCompetitionRounds(runs ? c.id : "");
  useRoundsSync(c, view, roundDocs, uid);
  const canEdit = runs && (!match.locked || owner);
  const following = c.memberIds.includes(uid);
  const teams = c.participantType === "team";
  const decided = Boolean(match.home.id && match.away.id && !match.home.pending && !match.away.pending);
  const upcoming = match.status === "scheduled" && match.startAt > now;
  const playing = match.status === "live";
  const scored = app.homeScore !== null && app.awayScore !== null;
  const events = match.events || [];
  const timeline = useMemo(() => reportTimeline(events), [events]);
  const lineups = useMemo(() => reportLineups(match.lineups), [match.lineups]);
  const table = useMemo(() => {
    if (match.friendly || match.phase === "knockout") return null;
    const id = match.phase === "group" ? `group:${match.group}` : "league";
    const found = view.tables.find((t) => t.id === id);
    return found?.rows.length ? found : null;
  }, [view, match]);
  const tabs: Tab[] = [
    upcoming && !events.length ? "preview" : "events",
    ...(lineups.length || (canEdit && teams && decided) ? (["lineups"] as const) : []),
    ...(user && c.predictionMode !== "off" ? (["picks"] as const) : []),
    ...(table ? (["table"] as const) : []),
  ];
  const [tab, selectTab] = useMatchTab(tabs);
  const result = finishedMatchResult(app);
  const status = playing ? (
    <LiveMinute match={app} />
  ) : upcoming ? (
    <>
      Empieza en <b>{countdownLabel(app.utcDate, now)}</b>
    </>
  ) : result ? (
    result.extended && result.winnerName ? `Gana ${result.winnerName} en penaltis` : "Final"
  ) : (
    STATUS_LABELS[match.status]
  );
  const scorers = (side: "home" | "away") => timeline.goals.filter((g) => g.side === side);
  const hasScorers = timeline.goals.length > 0;
  const official = headToHead(app, history).map((m) => ({
    id: m.id,
    date: m.utcDate,
    home: m.home,
    away: m.away,
    homeScore: m.homeScore!,
    awayScore: m.awayScore!,
  }));
  const reportable = canEdit && teams && decided && !["postponed", "cancelled"].includes(match.status);
  const openEvent = (id: string) => {
    const event = events.find((e) => e.id === id);
    if (event) setSheet({ kind: "event", event });
  };

  return (
    <article className="match-page custom-match-page" aria-label={`${match.home.name} contra ${match.away.name}`}>
      <header
        className={`masthead match-hero${playing ? " is-live" : ""}${scored ? " is-scored" : ""}`}
        data-vt-match={match.id}
        data-vt-hero
      >
        <h1 className="sr-only">
          {match.home.name} contra {match.away.name}
        </h1>
        <p className="match-hero-meta">
          <CompetitionBadge icon={c.icon} name={c.name} />
          <span className="eyebrow">
            {c.name} · {matchTitle(match)}
          </span>
        </p>
        <div className="match-hero-board" ref={board}>
          <div className="match-hero-team is-home">
            <HeroCrest src={app.homeCrest} part="home-crest" name={match.home.name} />
            <strong className="match-hero-name">{match.home.name}</strong>
            <TeamForm match={app} side="home" matches={history} />
          </div>
          <div className="match-hero-center">
            {scored ? (
              <strong
                className="match-hero-score"
                data-vt-part="score"
                aria-label={`${app.homeScore} a ${app.awayScore}`}
              >
                <span>{app.homeScore}</span>
                <i aria-hidden="true">–</i>
                <span>{app.awayScore}</span>
              </strong>
            ) : (
              <strong className="match-hero-time" data-vt-part="score">
                {["postponed", "cancelled"].includes(match.status) ? "—" : kickoffTime.format(match.startAt)}
              </strong>
            )}
            <span className="match-hero-status">{status}</span>
            {match.homePenalties !== null && match.awayPenalties !== null && (
              <small className="match-hero-half">
                Penaltis {match.homePenalties}–{match.awayPenalties}
              </small>
            )}
          </div>
          <div className="match-hero-team is-away">
            <HeroCrest src={app.awayCrest} part="away-crest" name={match.away.name} />
            <strong className="match-hero-name">{match.away.name}</strong>
            <TeamForm match={app} side="away" matches={history} />
          </div>
        </div>
        {hasScorers && (
          <div className="match-hero-scorers" aria-label="Goleadores">
            {(["home", "away"] as const).map((side) => (
              <ul key={side} className={`is-${side}`}>
                {scorers(side).map((g) => (
                  <li key={g.id}>
                    <span>
                      {g.scorer}
                      {g.kind === "penalty" ? " (p.)" : g.kind === "own-goal" ? " (p.p.)" : ""}
                    </span>
                    <small>{g.minute}</small>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        )}
        <p className="match-hero-date">
          <CalendarDays size={14} aria-hidden="true" />
          <time dateTime={app.utcDate}>
            {kickoffDay.format(match.startAt)} · {kickoffTime.format(match.startAt)}
          </time>
          {match.location && (
            <>
              <MapPin size={14} aria-hidden="true" />
              <span>{match.location}</span>
            </>
          )}
        </p>
        {following && canPick(c, match, now) && (
          <Link
            className="button primary full match-hero-cta"
            to={`/quiniela?liga=${encodeURIComponent(c.id)}&round=${encodeURIComponent(`${c.id}:${roundKey(match)}`)}`}
          >
            Hacer mi quiniela <ArrowRight size={17} aria-hidden="true" />
          </Link>
        )}
        {!user && c.predictionMode !== "off" && (
          <button type="button" className="button primary full match-hero-cta" onClick={onLogin}>
            Entrar para pronosticar <ArrowRight size={17} aria-hidden="true" />
          </button>
        )}
        {runs && (
          <div className="custom-admin-bar" role="group" aria-label="Organización del partido">
            {canEdit ? (
              <>
                <button type="button" onClick={() => setSheet({ kind: "edit" })}>
                  <Pencil size={17} aria-hidden="true" />
                  <span>Resultado</span>
                </button>
                {reportable && (
                  <button type="button" onClick={() => setSheet({ kind: "event", event: null })}>
                    <Plus size={17} aria-hidden="true" />
                    <span>Evento</span>
                  </button>
                )}
                {teams && decided && (
                  <button type="button" onClick={() => setSheet({ kind: "lineups" })}>
                    <Shirt size={17} aria-hidden="true" />
                    <span>Alineación</span>
                  </button>
                )}
              </>
            ) : (
              <p>
                <Lock size={14} aria-hidden="true" /> Resultado confirmado: solo el propietario puede cambiarlo.
              </p>
            )}
          </div>
        )}
      </header>

      <MatchTabs tabs={tabs} labels={TAB_LABELS} value={tab} onChange={selectTab}>
        {upcoming && following && decided && (
          <Link className="match-tabs-porra" to={`/porra?partido=${encodeURIComponent(customFixtureId(c.id, match.id))}`}>
            <NotebookPen size={15} aria-hidden="true" />
            Porra rápida
          </Link>
        )}
      </MatchTabs>

      <section
        className="match-page-panel"
        role="tabpanel"
        id="match-panel"
        aria-labelledby={`match-tab-${tab}`}
        key={tab}
      >
        {tab === "preview" && (
          <>
            <MatchPreview match={app} matches={history} />
            <Matchups matches={official.slice(0, 5)} source="liga" />
            <MatchFacts match={match} />
          </>
        )}
        {tab === "events" && (
          <>
            {events.length ? (
              <MatchTimeline match={app} insight={timeline} onSelect={canEdit ? openEvent : undefined} />
            ) : (
              <Empty
                art={playing ? "whistle" : "net"}
                title={playing ? "Se juega, pero sin noticias" : "Acta sin eventos"}
              >
                {reportable
                  ? "Apunta goles, tarjetas y cambios con «Evento»: el marcador se actualiza solo."
                  : playing
                    ? "Los goles y tarjetas aparecerán aquí en cuanto la organización los anote."
                    : "La organización no ha anotado goles, tarjetas ni cambios en este partido."}
              </Empty>
            )}
            {reportable && (
              <div className="custom-report-actions">
                <button type="button" className="button secondary full" onClick={() => setSheet({ kind: "event", event: null })}>
                  <Plus size={17} aria-hidden="true" /> Añadir gol, tarjeta o cambio
                </button>
                {events.length > 0 && <p className="match-extra-note">Toca un evento para corregirlo o borrarlo.</p>}
              </div>
            )}
            <MatchFacts match={match} />
          </>
        )}
        {tab === "lineups" &&
          (lineups.length ? (
            <>
              <LineupPitch match={app} lineups={lineups} />
              <details className="lineup-full-list">
                <summary>
                  Lista completa y suplentes
                  <ArrowRight size={16} aria-hidden="true" />
                </summary>
                <div className="match-extra-lineups">
                  <TeamLineup name={match.home.name} lineup={lineups.find((l) => l.side === "home")} />
                  <TeamLineup name={match.away.name} lineup={lineups.find((l) => l.side === "away")} />
                </div>
              </details>
              {canEdit && teams && (
                <div className="custom-report-actions">
                  <button type="button" className="button secondary full" onClick={() => setSheet({ kind: "lineups" })}>
                    <Shirt size={17} aria-hidden="true" /> Editar alineaciones
                  </button>
                </div>
              )}
            </>
          ) : (
            <Empty
              art="whistle"
              title="Sin alineaciones"
              action={
                canEdit &&
                teams && (
                  <button type="button" className="button primary" onClick={() => setSheet({ kind: "lineups" })}>
                    <Shirt size={17} aria-hidden="true" /> Poner alineaciones
                  </button>
                )
              }
            >
              Elige titulares y suplentes de cada plantilla y saldrán aquí sobre el campo.
            </Empty>
          ))}
        {tab === "picks" && user && <MatchPicks competition={c} match={match} uid={uid} />}
        {tab === "table" && table && (
          <div className="match-page-table">
            <LeagueTable
              rows={table.rows}
              highlight={[match.home.id, match.away.id].filter(Boolean) as string[]}
              caption={`${table.title} de ${c.name}`}
            />
          </div>
        )}
      </section>

      <nav className="match-page-links" aria-label="Más de la competición">
        <Link to={`/ligas?liga=${encodeURIComponent(c.id)}`}>
          <Trophy size={18} aria-hidden="true" />
          <span>Ver {c.name}</span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        {user && c.predictionMode !== "off" && (
          <Link to={`/clasificacion?liga=${encodeURIComponent(c.id)}`}>
            <ClipboardList size={18} aria-hidden="true" />
            <span>Clasificación de pronósticos</span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )}
      </nav>

      {sheet?.kind === "edit" && (
        <MatchEditSheet
          competition={c}
          view={view}
          match={match}
          participants={participants}
          uid={uid}
          onClose={() => setSheet(null)}
          onDeleted={() => {
            haptic("success");
            setSheet(null);
            goBack(`/ligas?liga=${encodeURIComponent(c.id)}`);
          }}
        />
      )}
      {sheet?.kind === "event" && (
        <EventSheet
          competition={c}
          match={match}
          participants={participants}
          uid={uid}
          event={sheet.event}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "lineups" && (
        <LineupSheet
          competition={c}
          match={match}
          matches={view.matches}
          participants={participants}
          uid={uid}
          onClose={() => setSheet(null)}
        />
      )}
    </article>
  );
}

/** «En el acta»: the place and whether the result is confirmed. */
function MatchFacts({ match }: { match: ResolvedMatch }) {
  if (!match.location && !match.locked) return null;
  return (
    <section className="match-block" aria-label="Datos del partido">
      <h3 className="match-block-title">En el acta</h3>
      <dl className="match-extra-meta">
        {match.location && (
          <div>
            <dt>
              <MapPin size={15} aria-hidden="true" /> Lugar
            </dt>
            <dd>{match.location}</dd>
          </div>
        )}
        {match.locked && (
          <div>
            <dt>
              <Lock size={15} aria-hidden="true" /> Resultado
            </dt>
            <dd>Confirmado</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
