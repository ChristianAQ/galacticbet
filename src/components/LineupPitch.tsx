import { useMemo, useState } from "react";
import type { Match } from "../lib/domain";
import type { MatchLineup, MatchPlayer } from "../lib/matchInsightsData";
import { pitchRows, shortPlayerName } from "../lib/matchPresentation";
import Segmented from "./Segmented";
import "../styles/matchExtras.css";

type Side = "home" | "away";
type View = Side | "both";

function Player({ player }: { player: MatchPlayer }) {
  const label = `${player.number ? `${player.number} · ` : ""}${player.name}${player.position ? ` (${player.position})` : ""}`;
  return (
    <span className="pitch-player" title={label} aria-label={label}>
      <b aria-hidden="true">{player.number || "—"}</b>
      <span aria-hidden="true">{shortPlayerName(player.name)}</span>
    </span>
  );
}

function TeamHalf({
  name,
  side,
  rows,
  top = false,
}: {
  name: string;
  side: Side;
  rows: MatchPlayer[][];
  top?: boolean;
}) {
  // The team at the top faces the viewer, so its left appears on the right.
  const ordered = top
    ? rows.map((row) => [...row].reverse())
    : [...rows].reverse();
  return (
    <div
      className={`pitch-half pitch-half-${side}`}
      role="group"
      aria-label={`Once de ${name}`}
    >
      {ordered.map((row, i) => (
        <div key={i} className="pitch-line">
          {row.map((p, j) => (
            <Player key={`${p.name}-${j}`} player={p} />
          ))}
        </div>
      ))}
    </div>
  );
}

function TeamCaption({
  match,
  side,
  formation,
}: {
  match: Match;
  side: Side;
  formation?: string;
}) {
  const crest = side === "home" ? match.homeCrest : match.awayCrest;
  return (
    <p className={`pitch-caption pitch-caption-${side}`}>
      {crest && <img src={crest} alt="" loading="lazy" />}
      <strong>{match[side]}</strong>
      {formation && <span>{formation}</span>}
    </p>
  );
}

export default function LineupPitch({
  match,
  lineups,
  initialSide,
}: {
  match: Match;
  lineups: MatchLineup[];
  initialSide?: Side;
}) {
  const data = useMemo(() => {
    const build = (side: Side) => {
      const lineup = lineups.find((l) => l.side === side);
      return {
        formation: lineup?.formation,
        ...pitchRows(lineup?.players || [], lineup?.formation),
      };
    };
    return { home: build("home"), away: build("away") };
  }, [lineups]);
  const both = data.home.rows.length > 0 && data.away.rows.length > 0;
  const [view, setView] = useState<View>(
    initialSide ?? (both ? "both" : data.home.rows.length ? "home" : "away"),
  );
  const views: View[] = both ? ["both", "home", "away"] : ["home", "away"];
  const shown: Side[] = view === "both" ? ["away", "home"] : [view];
  const unknown = shown.flatMap((s) => data[s].unknown);
  const hasRows = shown.some((s) => data[s].rows.length);
  const captionSide: Side = view === "both" ? "home" : view;
  return (
    <section className="lineup-map" aria-label="Alineaciones sobre el campo">
      <Segmented<View>
        label="Equipo sobre el campo"
        className="pitch-team-switch"
        value={view}
        options={views.map((v) => ({
          value: v,
          label:
            v === "both"
              ? "Ambos"
              : `${match[v]}${data[v].formation ? ` · ${data[v].formation}` : ""}`,
        }))}
        onChange={setView}
      />
      {hasRows ? (
        <>
          {view === "both" && (
            <TeamCaption
              match={match}
              side="away"
              formation={data.away.formation}
            />
          )}
          <div className={`lineup-pitch lineup-pitch-${view}`}>
            <span className="pitch-box pitch-box-top" aria-hidden="true" />
            <span className="pitch-box pitch-box-bottom" aria-hidden="true" />
            {view === "both" ? (
              <>
                <TeamHalf
                  name={match.away}
                  side="away"
                  rows={data.away.rows}
                  top
                />
                <TeamHalf name={match.home} side="home" rows={data.home.rows} />
              </>
            ) : (
              <TeamHalf name={match[view]} side={view} rows={data[view].rows} />
            )}
          </div>
          <TeamCaption
            match={match}
            side={captionSide}
            formation={data[captionSide].formation}
          />
          <p className="match-extra-note">
            Posiciones según la alineación publicada. La ubicación exacta en el
            campo puede variar.
          </p>
        </>
      ) : (
        <p className="match-extra-empty">
          El once todavía no tiene posiciones publicadas.
        </p>
      )}
      {unknown.length > 0 && (
        <div className="pitch-unassigned">
          <small>Sin posición publicada</small>
          <div>
            {unknown.map((p, i) => (
              <Player key={i} player={p} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

