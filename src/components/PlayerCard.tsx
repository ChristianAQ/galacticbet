import type { CSSProperties } from "react";
import { nation } from "../lib/nations";
import { playerAge, positionName } from "../lib/teamExplorer";
import CardDeck from "./CardDeck";
import { Crest } from "./ui";
import "../styles/playerCard.css";

/** The season numbers on the back of a «cromo». */
export interface CardSeason {
  /** «LaLiga 2026/27». */
  label: string;
  goals: number;
  assists: number | null;
  penalties: number | null;
  played: number | null;
  /** Place among the competition's top scorers. */
  rank?: number;
  /** Goals of the player's club in that competition, for «del equipo». */
  teamGoals?: number;
}
export interface CardPlayer {
  key: string;
  name: string;
  team: string;
  crest?: string;
  /** As the provider publishes it (Offence, Centre-Back…). */
  position?: string | null;
  nationality?: string | null;
  birthDate?: string | null;
  shirtNumber?: number | null;
  season?: CardSeason;
  /** Shown instead of the numbers when there are none. */
  note?: string;
  source: string;
}

const twoDecimals = new Intl.NumberFormat("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const initials = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
};

/** The card itself: club and number, a portrait band, who they are and their season. */
export function Cromo({ player, titleId }: { player: CardPlayer; titleId: string }) {
  const age = playerAge(player.birthDate ?? null);
  const country = nation(player.nationality);
  const position = player.position ? positionName(player.position) : null;
  const s = player.season;
  const stats = s
    ? [
        { label: "Goles", value: String(s.goals), lead: true },
        { label: "Asistencias", value: s.assists === null ? "—" : String(s.assists) },
        { label: "Partidos", value: s.played === null ? "—" : String(s.played) },
        { label: "De penalti", value: s.penalties === null ? "—" : String(s.penalties) },
        { label: "Por partido", value: s.played ? twoDecimals.format(s.goals / s.played) : "—" },
        {
          label: "Del equipo",
          value: s.teamGoals ? `${Math.round((s.goals / s.teamGoals) * 100)}%` : "—",
        },
      ]
    : null;
  return (
    <article className="cromo" aria-labelledby={titleId}>
      <div className="cromo-face">
        <header className="cromo-top">
          <span className="cromo-crest">
            <Crest src={player.crest} />
          </span>
          <span className="cromo-club">{player.team}</span>
          {player.shirtNumber != null && (
            <span className="cromo-number" aria-label={`Dorsal ${player.shirtNumber}`}>
              {player.shirtNumber}
            </span>
          )}
        </header>
        <div className="cromo-portrait">
          <span className="cromo-initials" aria-hidden="true">
            {initials(player.name)}
          </span>
          {s?.rank && (
            <span className="cromo-rank">
              <b>{s.rank}.º</b> goleador
            </span>
          )}
        </div>
        <div className="cromo-identity">
          <h2 id={titleId} className={player.name.length > 18 ? "is-long" : undefined}>
            {player.name}
          </h2>
          <p>
            {[
              position,
              country ? `${country.flag ? `${country.flag} ` : ""}${country.name}` : null,
              age !== null ? `${age} años` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Datos personales no publicados"}
          </p>
        </div>
        {stats ? (
          <dl className="cromo-stats">
            {stats.map((stat, i) => (
              <div
                key={stat.label}
                className={stat.lead ? "is-lead" : undefined}
                style={{ "--i": i } as CSSProperties}
              >
                <dt>{stat.label}</dt>
                <dd className="numeral">{stat.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="cromo-note">{player.note}</p>
        )}
        <footer className="cromo-foot">{s ? `${s.label} · ${player.source}` : `Plantilla · ${player.source}`}</footer>
      </div>
    </article>
  );
}

/**
 * The cards of a list of players (the top scorers, a squad): swipe from one
 * «cromo» to the next. See CardDeck for the gestures.
 */
export default function PlayerCards({
  players,
  start,
  origin,
  onClose,
}: {
  players: CardPlayer[];
  start: number;
  origin?: HTMLElement | null;
  onClose: () => void;
}) {
  return (
    <CardDeck
      count={players.length}
      start={start}
      origin={origin}
      onClose={onClose}
      tilt
      label="Más jugadores"
      ids={players.map((p) => p.key)}
      itemLabel={(i) => players[i].name}
      render={(i, titleId) => <Cromo key={players[i].key} player={players[i]} titleId={titleId} />}
    />
  );
}
