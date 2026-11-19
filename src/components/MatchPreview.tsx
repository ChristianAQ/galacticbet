import { Hourglass, Lightbulb, Swords } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { Match } from "../lib/domain";
import {
  countdownLabel,
  matchPreview,
  type PreviewRecord,
  type TeamPreview,
} from "../lib/matchPreview";
import { formNames } from "./TeamForm";
import "../styles/matchPreview.css";

const formLetter = { win: "V", draw: "E", loss: "D" } as const;
const shortDate = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
});
const record = (r: PreviewRecord) => `${r.wins}V ${r.draws}E ${r.losses}D`;
const perGame = (value: number, played: number) =>
  played ? Math.round((value / played) * 10) / 10 : 0;

function CompareRow({
  label,
  home,
  away,
  lowerIsBetter = false,
  format = (v: number) => String(v).replace(".", ","),
}: {
  label: string;
  home: number;
  away: number;
  lowerIsBetter?: boolean;
  format?: (v: number) => string;
}) {
  const total = home + away;
  const share = total ? (home / total) * 100 : 50;
  const better =
    home === away ? null : (home > away) !== lowerIsBetter ? "home" : "away";
  return (
    <div className="preview-compare-row">
      <span className={better === "home" ? "is-better" : undefined}>
        {format(home)}
      </span>
      <div>
        <small>{label}</small>
        <span className="preview-compare-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${share / 100})` }} />
        </span>
      </div>
      <span className={better === "away" ? "is-better" : undefined}>
        {format(away)}
      </span>
    </div>
  );
}

function FormList({ team }: { team: TeamPreview }) {
  return (
    <div className="preview-form-team">
      <h5>{team.name}</h5>
      {team.form.length ? (
        <ol>
          {[...team.form].reverse().map((f) => (
            <li key={f.id}>
              <b
                className={`preview-result form-${f.result}`}
                title={formNames[f.result]}
              >
                {formLetter[f.result]}
              </b>
              <span>
                <small>{f.venue === "home" ? "vs" : "en"}</small> {f.opponent}
              </span>
              <strong>
                {f.goalsFor}–{f.goalsAgainst}
              </strong>
              <time dateTime={f.date}>
                {shortDate.format(new Date(f.date))}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="match-extra-empty">Sin resultados previos.</p>
      )}
    </div>
  );
}

export default function MatchPreview({
  match,
  matches,
}: {
  match: Match;
  matches: Match[];
}) {
  const headingId = useId();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  // Results only change when the calendar syncs, not with the countdown tick.
  const preview = useMemo(
    () => matchPreview(match, matches),
    [match, matches],
  );
  const { home, away, headToHead: h2h } = preview;
  const showTable = home.position !== null && away.position !== null;
  return (
    <section className="match-block match-preview" aria-labelledby={headingId}>
      <header className="match-preview-heading">
        <h3 id={headingId} className="match-block-title">
          La previa
        </h3>
        <span className="match-preview-countdown">
          <Hourglass size={14} aria-hidden="true" />
          <span>
            Saque en <strong>{countdownLabel(match.utcDate, now)}</strong>
          </span>
        </span>
      </header>
      {showTable && (
        <div className="preview-table-duel" aria-label="Clasificación actual">
          <span>
            <strong>{home.position}º</strong>
            <small>{home.points} pts</small>
          </span>
          <small>
            Clasificación
            <br />
            {preview.tableSize} equipos
          </small>
          <span>
            <strong>{away.position}º</strong>
            <small>{away.points} pts</small>
          </span>
        </div>
      )}
      {!preview.hasData ? (
        <p className="match-extra-empty">
          Aún no hay rodaje suficiente esta temporada para preparar la previa.
          Vuelve tras la primera jornada.
        </p>
      ) : (
        <>
          {(home.played > 0 || away.played > 0) && (
            <div className="preview-block">
              <h4>Esta temporada</h4>
              <div className="preview-compare">
                <div className="preview-compare-row preview-compare-head">
                  <span>{home.name}</span>
                  <span />
                  <span>{away.name}</span>
                </div>
                <CompareRow label="Partidos" home={home.played} away={away.played} />
                <CompareRow label="Victorias" home={home.wins} away={away.wins} />
                <CompareRow
                  label="Goles a favor por partido"
                  home={perGame(home.goalsFor, home.played)}
                  away={perGame(away.goalsFor, away.played)}
                />
                <CompareRow
                  label="Goles en contra por partido"
                  home={perGame(home.goalsAgainst, home.played)}
                  away={perGame(away.goalsAgainst, away.played)}
                  lowerIsBetter
                />
                <CompareRow
                  label="Porterías a cero"
                  home={home.cleanSheets}
                  away={away.cleanSheets}
                />
              </div>
              <dl className="preview-venue">
                <div>
                  <dt>{home.name} en casa</dt>
                  <dd>
                    {home.venueRecord.played
                      ? record(home.venueRecord)
                      : "Sin partidos"}
                  </dd>
                </div>
                <div>
                  <dt>{away.name} a domicilio</dt>
                  <dd>
                    {away.venueRecord.played
                      ? record(away.venueRecord)
                      : "Sin partidos"}
                  </dd>
                </div>
              </dl>
            </div>
          )}
          <div className="preview-block">
            <h4>Últimos partidos</h4>
            <div className="preview-form">
              <FormList team={home} />
              <FormList team={away} />
            </div>
          </div>
          {h2h.played > 0 && (
            <div className="preview-block">
              <h4>
                <Swords size={14} aria-hidden="true" /> Cara a cara · últimos{" "}
                {h2h.played}
              </h4>
              <div
                className="preview-h2h"
                role="img"
                aria-label={`${home.name} ${h2h.home} victorias, ${h2h.draws} empates, ${away.name} ${h2h.away} victorias`}
              >
                {h2h.home > 0 && (
                  <span className="h2h-home" style={{ flexGrow: h2h.home }}>
                    {h2h.home}
                  </span>
                )}
                {h2h.draws > 0 && (
                  <span className="h2h-draw" style={{ flexGrow: h2h.draws }}>
                    {h2h.draws}
                  </span>
                )}
                {h2h.away > 0 && (
                  <span className="h2h-away" style={{ flexGrow: h2h.away }}>
                    {h2h.away}
                  </span>
                )}
              </div>
              <div className="preview-h2h-legend" aria-hidden="true">
                <span>{home.name}</span>
                <span>Empates</span>
                <span>{away.name}</span>
              </div>
            </div>
          )}
          {preview.facts.length > 0 && (
            <div className="preview-block">
              <h4>
                <Lightbulb size={14} aria-hidden="true" /> Claves del partido
              </h4>
              <ul className="preview-facts">
                {preview.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="match-extra-note">
            Calculado con los resultados sincronizados a 90 minutos.
          </p>
        </>
      )}
    </section>
  );
}
