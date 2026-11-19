import {
  ArrowRight,
  ChevronRight,
  LogIn,
  NotebookPen,
  Plus,
  Shirt,
} from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { User } from "firebase/auth";
import { competitionName, type CompetitionCode } from "../lib/competitions";
import { matchStatusLabel, type Match } from "../lib/domain";
import type { Group } from "../lib/data";
import {
  liveMatches,
  recentResults,
  type OpenRound,
} from "../lib/homeDashboard";
import { countdownLabel } from "../lib/matchPreview";
import { preferenceStore } from "../lib/preferences";
import { roundDateRange } from "../lib/roundOptions";
import CompetitionLogo from "./CompetitionLogo";
import { Crest } from "./ui";
import { LiveMinute } from "./LiveStatus";
import { Skeleton } from "./Skeleton";
import "../styles/home.css";

const shortDate = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
});
const unitNames: Record<string, [string, string]> = {
  d: ["día", "días"],
  h: ["hora", "horas"],
  min: ["minuto", "minutos"],
};

/** «2 d 14 h» → big numerals, each with its unit beside it. */
function Countdown({ kickoff, now }: { kickoff: string; now: number }) {
  const label = countdownLabel(kickoff, now);
  const parts = [...label.matchAll(/(\d+)\s*(d|h|min)/g)].map((m) => ({
    value: m[1],
    unit: m[2],
  }));
  return (
    <p className="spotlight-countdown" aria-label={`Cierra en ${label}`}>
      {parts.map((p) => (
        <span key={p.unit} className="countdown-part" aria-hidden="true">
          <b className="numeral">{p.value}</b>
          <small>{unitNames[p.unit][Number(p.value) === 1 ? 0 : 1]}</small>
        </span>
      ))}
    </p>
  );
}

/** Hero of Inicio, printed on the ink masthead: the next slip that closes. */
export function QuinielaSpotlight({
  rounds,
  now,
  userId,
  loading,
}: {
  rounds: OpenRound[];
  now: number;
  userId: string;
  loading: boolean;
}) {
  const [main, ...others] = rounds;
  const pick = (competition: CompetitionCode) =>
    preferenceStore.update(userId, { competition });
  if (loading)
    return (
      <div className="home-spotlight" role="status" aria-label="Cargando jornadas">
        <Skeleton width={150} height={12} className="on-ink" />
        <Skeleton width="70%" height={64} radius={10} className="on-ink" />
        <Skeleton width="100%" height={50} radius={10} className="on-ink" />
      </div>
    );
  return (
    <section className="home-spotlight" aria-labelledby="spotlight-title">
      {main ? (
        <>
          <div className="spotlight-head">
            <CompetitionLogo code={main.competition} small />
            <div>
              <span className="spotlight-kicker">Tu próxima quiniela</span>
              <h2 id="spotlight-title">
                {competitionName(main.competition, true)} · {main.label}
              </h2>
            </div>
          </div>
          <span className="spotlight-closes">Cierra en</span>
          <Countdown kickoff={main.start} now={now} />
          <p className="spotlight-meta">
            {main.matches} partidos · {roundDateRange(main.start, main.end)}
          </p>
          <Link
            className="button primary full spotlight-cta"
            to={`/quiniela?round=${encodeURIComponent(main.id)}`}
            onClick={() => pick(main.competition)}
          >
            Hacer mi quiniela <ArrowRight size={18} aria-hidden="true" />
          </Link>
          {others.length > 0 && (
            <ul className="spotlight-more" aria-label="Otras jornadas abiertas">
              {others.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/quiniela?round=${encodeURIComponent(r.id)}`}
                    onClick={() => pick(r.competition)}
                  >
                    <CompetitionLogo code={r.competition} small />
                    <span>
                      <strong>{competitionName(r.competition, true)}</strong>
                      <small>{r.label}</small>
                    </span>
                    <small className="spotlight-more-time">
                      cierra en {countdownLabel(r.start, now)}
                    </small>
                    <ChevronRight size={18} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <span className="spotlight-kicker">Tu próxima quiniela</span>
          <h2 id="spotlight-title" className="spotlight-rest">
            El balón descansa
          </h2>
          <p className="spotlight-meta">
            No hay jornadas abiertas ahora mismo. En cuanto se publique el
            calendario, tu boleto estará aquí.
          </p>
          <Link className="button secondary full" to="/ligas">
            Ver calendario <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </>
      )}
    </section>
  );
}

/** Live scores, or the latest results when nothing is being played. */
export function MatchTicker({
  matches,
  now,
}: {
  matches: Match[];
  now: number;
}) {
  const live = useMemo(() => liveMatches(matches), [matches]);
  const recent = useMemo(() => recentResults(matches, now), [matches, now]);
  const list = live.length ? live : recent;
  if (!list.length) return null;
  return (
    <section className="match-ticker" aria-labelledby="ticker-title">
      <div className="section-heading">
        <h2 id="ticker-title">
          {live.length ? (
            <>
              <i className="ticker-live" aria-hidden="true" /> En directo
            </>
          ) : (
            "Lo último"
          )}
        </h2>
        <Link to="/ligas">
          Calendario <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <ul className="ticker-list">
        {list.map((m) => {
          const scored = m.homeScore !== null && m.awayScore !== null;
          const winner =
            scored && m.homeScore !== m.awayScore
              ? m.homeScore! > m.awayScore!
                ? "home"
                : "away"
              : null;
          const playing = ["IN_PLAY", "PAUSED"].includes(m.status);
          return (
            <li key={m.id}>
              <Link
                className={`ticker-card${playing ? " is-live" : ""}`}
                to={`/partido/${encodeURIComponent(m.id)}`}
                data-vt-match={m.id}
                aria-label={`${m.home} ${m.homeScore ?? ""} – ${m.awayScore ?? ""} ${m.away}`}
              >
                <small className="ticker-meta">
                  {competitionName(m.competition, true)} ·{" "}
                  {playing ? (
                    <LiveMinute match={m} />
                  ) : live.length ? (
                    matchStatusLabel[m.status]
                  ) : (
                    shortDate.format(new Date(m.utcDate))
                  )}
                </small>
                <span className="ticker-score">
                  {(["home", "away"] as const).map((side) => (
                    <span
                      key={side}
                      className={`ticker-team${winner === side ? " is-winner" : ""}${winner && winner !== side ? " is-loser" : ""}`}
                    >
                      <span
                        className="ticker-crest"
                        data-vt-part={`${side}-crest`}
                      >
                        <Crest src={side === "home" ? m.homeCrest : m.awayCrest} />
                      </span>
                      <span className="ticker-name">{m[side]}</span>
                      <b className="numeral">
                        {side === "home"
                          ? (m.homeScore ?? "–")
                          : (m.awayScore ?? "–")}
                      </b>
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Shortcuts that used to live in the side menu: quick porra, squads, and
 * — while you have no group yet — a way to start one.
 */
export function HomeTools({
  user,
  groups,
  onLogin,
}: {
  user: User | null;
  groups: Group[];
  onLogin: () => void;
}) {
  return (
    <section className="home-tools" aria-labelledby="tools-title">
      <div className="section-heading">
        <h2 id="tools-title">En el banquillo</h2>
      </div>
      {!groups.length && (
        <div className="home-crew">
          <div>
            <strong>Sin vestuario todavía</strong>
            <p>
              La quiniela sabe mejor con rivales. Monta un grupo o entra en el
              de tus amigos con su código.
            </p>
          </div>
          {user ? (
            <div className="home-crew-actions">
              <Link className="button primary" to="/grupos?action=create">
                <Plus size={18} aria-hidden="true" /> Crear grupo
              </Link>
              <Link className="button secondary" to="/grupos?join=1">
                <LogIn size={18} aria-hidden="true" /> Tengo un código
              </Link>
            </div>
          ) : (
            <div className="home-crew-actions">
              <button type="button" className="button primary" onClick={onLogin}>
                Entrar y montar mi grupo <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}
      <ul className="tool-list">
        <li>
          <Link to="/porra" className="tool-row">
            <span className="tool-icon" aria-hidden="true">
              <NotebookPen size={20} />
            </span>
            <span className="tool-text">
              <strong>Porra rápida</strong>
              <small>Un partido, vuestros marcadores y una tarjeta para el chat.</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link to="/equipos" className="tool-row">
            <span className="tool-icon" aria-hidden="true">
              <Shirt size={20} />
            </span>
            <span className="tool-text">
              <strong>Equipos y jugadores</strong>
              <small>Plantillas, dorsales y la alineación del último partido.</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        </li>
      </ul>
    </section>
  );
}
