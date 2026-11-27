import { Eye, Sparkles } from "lucide-react";
import { useId, useMemo } from "react";
import { Link } from "react-router-dom";
import { modelName } from "../lib/bettingAnalysis";
import { shownBriefing, type ShownKeyMatch } from "../lib/briefing";
import { competitionName } from "../lib/competitions";
import type { Match } from "../lib/domain";
import { kickoffLabel } from "../lib/matchInsights";
import { useBriefing } from "../lib/useBriefing";
import { Crest } from "./ui";
import "../styles/briefing.css";

const hour = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });

/** «Hace 20 min», «Hace 3 h», «Ayer», then the date. */
function ago(iso: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return minutes < 1 ? "Ahora" : `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return hours < 48 ? "Ayer" : day.format(new Date(iso));
}

/** The AI's tag: what it chose and wrote is marked, as in Apuestas. */
function AiTag() {
  return (
    <span className="briefing-tag" title="Elegido y escrito por la IA">
      <Sparkles size={11} strokeWidth={2.6} aria-hidden="true" />
      IA
    </span>
  );
}

/**
 * «La IA te cuenta»: the key matches of the next days, chosen and
 * explained by the AI. Teams and times are real data; nothing shows until
 * the backend has published one.
 */
export default function AiBriefing({ matches, now, demo = false }: { matches: Match[]; now: number; demo?: boolean }) {
  const titleId = useId();
  const stored = useBriefing(!demo);
  const briefing = useMemo(() => shownBriefing(stored, matches, now), [stored, matches, now]);
  if (!briefing) return null;
  const ai = briefing.ai;
  const work = [
    ai?.model ? modelName(ai.model) : null,
    ai?.searches === undefined
      ? null
      : ai.searches === 0
        ? "sin búsqueda web"
        : `${ai.searches} ${ai.searches === 1 ? "búsqueda web" : "búsquedas web"}`,
  ].filter(Boolean);
  return (
    <section className="ai-briefing" aria-labelledby={titleId}>
      <div className="section-heading">
        <h2 id={titleId}>
          La IA te cuenta <AiTag />
        </h2>
        <time className="briefing-when" dateTime={briefing.generatedAt}>
          {ago(briefing.generatedAt, now)}
        </time>
      </div>
      <div className="briefing-lead">
        <h3>{briefing.headline}</h3>
        <p>{briefing.summary}</p>
      </div>
      <h3 className="briefing-subhead">Partidos clave</h3>
      <ul className="briefing-matches">
        {briefing.keyMatches.map((k) => (
          <KeyMatchCard key={k.matchId} match={k} now={now} />
        ))}
      </ul>
      <p className="briefing-foot">
        <AiTag /> Elegido y escrito por IA{work.length ? ` · ${work.join(" · ")}` : ""} · a las{" "}
        {hour.format(new Date(briefing.generatedAt))}. Partidos y horarios son datos reales del calendario oficial;
        puede equivocarse en el contexto.
      </p>
    </section>
  );
}

function KeyMatchCard({ match: k, now }: { match: ShownKeyMatch; now: number }) {
  const playing = k.status === "IN_PLAY" || k.status === "PAUSED";
  const scored = playing || k.status === "FINISHED";
  return (
    <li>
      <Link
        className={`briefing-match${playing ? " is-live" : ""}`}
        to={`/partido/${encodeURIComponent(k.matchId)}`}
        data-vt-match={k.matchId}
      >
        <small className="briefing-meta">
          {competitionName(k.competition, true)} ·{" "}
          {playing ? "En juego" : k.status === "FINISHED" ? "Final" : kickoffLabel(k.utcDate, now)}
        </small>
        <strong className="briefing-angle">{k.angle}</strong>
        <span className="briefing-teams">
          <span className="briefing-team">
            <Crest src={k.homeCrest} />
            <span>{k.home}</span>
          </span>
          <b className="numeral">{scored && k.homeScore != null && k.awayScore != null ? `${k.homeScore}–${k.awayScore}` : "–"}</b>
          <span className="briefing-team is-away">
            <span>{k.away}</span>
            <Crest src={k.awayCrest} />
          </span>
        </span>
        <span className="briefing-preview">{k.preview}</span>
        <span className="briefing-watch">
          <Eye size={15} aria-hidden="true" />
          <span>
            <b>Qué vigilar:</b> {k.watch}
          </span>
        </span>
      </Link>
    </li>
  );
}
