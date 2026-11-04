import { ArrowRight, Timer } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { competitionName, type CompetitionCode } from "../lib/competitions";
import { matchStatusLabel, type Match } from "../lib/domain";
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
import "../styles/dashboard.css";

const shortDate = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
});

export function QuinielaSpotlight({
  rounds,
  now,
  userId,
}: {
  rounds: OpenRound[];
  now: number;
  userId: string;
}) {
  const [main, ...others] = rounds;
  const pick = (competition: CompetitionCode) =>
    preferenceStore.update(userId, { competition });
  return (
    <section className="home-spotlight" aria-labelledby="spotlight-title">
      <span className="eyebrow">TU PRÓXIMA QUINIELA</span>
      {main ? (
        <>
          <div className="spotlight-main">
            <CompetitionLogo code={main.competition} />
            <div>
              <h2 id="spotlight-title">{main.label}</h2>
              <p>
                {competitionName(main.competition)} · {main.matches} partidos ·{" "}
                {roundDateRange(main.start, main.end)}
              </p>
            </div>
          </div>
          <p className="spotlight-countdown">
            <Timer size={16} aria-hidden="true" />
            Cierra en <strong>{countdownLabel(main.start, now)}</strong>
          </p>
          <Link
            className="button primary full spotlight-cta"
            to={`/quiniela?round=${encodeURIComponent(main.id)}`}
            onClick={() => pick(main.competition)}
          >
            Hacer mi quiniela <ArrowRight size={16} />
          </Link>
          {others.length > 0 && (
            <ul className="spotlight-more">
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
                    <small>Cierra en {countdownLabel(r.start, now)}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <h2 id="spotlight-title">Sin jornadas abiertas</h2>
          <p className="spotlight-empty">
            Las próximas quinielas aparecerán en cuanto se publique el
            calendario.
          </p>
          <Link className="button secondary full" to="/partidos">
            Ver calendario <ArrowRight size={16} />
          </Link>
        </>
      )}
    </section>
  );
}

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
            "Últimos resultados"
          )}
        </h2>
        <Link to="/partidos">
          Ver calendario <ArrowRight size={13} />
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
          return (
            <li key={m.id}>
              <Link
                className="ticker-card"
                to={`/partidos?competition=${m.competition}&round=${encodeURIComponent(m.roundId)}`}
                aria-label={`${m.home} ${m.homeScore ?? ""} – ${m.awayScore ?? ""} ${m.away}`}
              >
                <small>
                  {competitionName(m.competition, true)} ·{" "}
                  {live.length
                    ? matchStatusLabel[m.status]
                    : shortDate.format(new Date(m.utcDate))}
                </small>
                {(["home", "away"] as const).map((side) => (
                  <span
                    key={side}
                    className={`ticker-team${winner === side ? " is-winner" : ""}`}
                  >
                    <Crest src={side === "home" ? m.homeCrest : m.awayCrest} />
                    <span>{m[side]}</span>
                    <b>
                      {side === "home"
                        ? (m.homeScore ?? "–")
                        : (m.awayScore ?? "–")}
                    </b>
                  </span>
                ))}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
