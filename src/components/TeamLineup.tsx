import { ChevronDown } from "lucide-react";
import type { MatchLineup, MatchPlayer } from "../lib/matchInsightsData";
import "../styles/matchExtras.css";

function PlayerList({ players }: { players: MatchPlayer[] }) {
  return (
    <ul className="match-extra-players">
      {players.map((player, index) => (
        <li key={`${player.name}-${player.number || index}`}>
          <span
            className="match-extra-dorsal"
            aria-label={
              player.number ? `Dorsal ${player.number}` : "Sin dorsal"
            }
          >
            {player.number || "—"}
          </span>
          <strong>{player.name}</strong>
          {player.position && <small>{player.position}</small>}
        </li>
      ))}
    </ul>
  );
}

export default function TeamLineup({
  name,
  lineup,
}: {
  name: string;
  lineup?: MatchLineup;
}) {
  const starters = lineup?.players.filter((p) => p.starter) || [];
  const bench = lineup?.players.filter((p) => !p.starter) || [];
  return (
    <section className="match-extra-lineup">
      <div className="match-extra-lineup-heading">
        <h4>{name}</h4>
        {lineup?.formation && <span>{lineup.formation}</span>}
      </div>
      {starters.length ? (
        <>
          <p className="match-extra-squad-label">Titulares</p>
          <PlayerList players={starters} />
        </>
      ) : (
        <p className="match-extra-empty">Once inicial no disponible.</p>
      )}
      {bench.length > 0 && (
        <details className="match-extra-bench">
          <summary>
            <span>
              Suplentes <small>{bench.length}</small>
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <PlayerList players={bench} />
        </details>
      )}
    </section>
  );
}
