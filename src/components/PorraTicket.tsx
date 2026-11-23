import { euro, porraLeague, porraTotal, type Porra } from "../lib/porra";
import BrandMark from "./BrandMark";

/** The porra as a paper ticket: notched edges, ink header, big scores. */
export default function PorraTicket({ porra: p }: { porra: Porra }) {
  return (
    <article className="porra-ticket" aria-label="Resumen de la porra">
      <header className="porra-ticket-header">
        <span className="porra-ticket-brand">
          <BrandMark size={26} />
          <strong>
            galactic<b>bet</b>
          </strong>
        </span>
        <span className="porra-ticket-kind">
          {p.demo ? "Demo · ejemplo" : "Porra · entre amigos"}
        </span>
      </header>
      <div className="porra-ticket-match">
        <span className="eyebrow">
          {porraLeague(p.fixture)}
        </span>
        <h2>{p.title}</h2>
        <div className="porra-teams">
          <strong>{p.fixture.home}</strong>
          <span aria-hidden="true">vs</span>
          <strong>{p.fixture.away}</strong>
        </div>
        <time dateTime={p.fixture.utcDate}>
          {new Intl.DateTimeFormat("es", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(p.fixture.utcDate))}
        </time>
      </div>
      <ol
        className={`porra-ticket-players${p.players.length > 8 ? " is-dense" : ""}`}
      >
        {p.players.map((player, i) => (
          <li key={player.id}>
            <span className="porra-ticket-index" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="porra-ticket-name">{player.name}</span>
            <strong
              className="porra-ticket-score"
              aria-label={`${player.home} a ${player.away}`}
            >
              {player.home}
              <span aria-hidden="true">–</span>
              {player.away}
            </strong>
          </li>
        ))}
      </ol>
      <footer className="porra-ticket-total">
        <div>
          <strong>Bote total</strong>
          <span>
            {p.players.length} personas · {euro(p.contributionCents)} por
            persona
          </span>
        </div>
        <b className="numeral">{euro(porraTotal(p))}</b>
      </footer>
      <p className="porra-ticket-note">
        Marcador a 90 minutos · Aportaciones anotadas
      </p>
    </article>
  );
}
