import { Crown, Info, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { euro } from "../lib/porra";
import { euroShort, potNames, type PotSummary } from "../lib/pot";
import { useCountUp } from "../lib/motion";
import { RankAvatar } from "./RankingWidgets";
import "../styles/pot.css";

const stateLabel = {
  open: "Abierto",
  live: "En juego",
  settled: "Cerrado",
  empty: "Sin boletos",
} as const;

export function PotAmount({ cents, className = "" }: { cents: number; className?: string }) {
  const shown = useCountUp(cents, 0);
  return (
    <span className={`pot-amount ${className}`} aria-label={euro(cents)}>
      <span aria-hidden="true">{euro(shown)}</span>
    </span>
  );
}

/** Informational pot of a group round, printed like a ticket. No money moves through the app. */
export default function PotCard({
  pot,
  userId,
  manageTo,
  loading = false,
}: {
  pot: PotSummary;
  userId: string;
  /** Owner shortcut to the group settings. */
  manageTo?: string;
  loading?: boolean;
}) {
  if (pot.state === "off") return null;
  const visible = pot.players.slice(0, 6);
  const won = pot.leaders.some((r) => r.id === userId);
  const nobodyScored = pot.topPoints === 0;
  return (
    <section
      className={`pot-card is-${pot.state}${won && pot.state === "settled" ? " is-mine" : ""}`}
      aria-label="Bote de la jornada"
      aria-busy={loading}
    >
      <div className="pot-stub">
        <header className="pot-head">
          <span className="pot-eyebrow">Bote de la jornada</span>
          <span className={`pot-state is-${pot.state}`}>
            {pot.state === "live" && <i aria-hidden="true" />}
            {stateLabel[pot.state]}
          </span>
          {manageTo && (
            <Link
              className="pot-manage icon-button"
              to={manageTo}
              aria-label="Ajustar aportación del bote"
            >
              <Settings2 size={17} />
            </Link>
          )}
        </header>
        <div className="pot-main">
          <PotAmount cents={pot.totalCents} />
          <p className="pot-formula">
            {pot.players.length}{" "}
            {pot.players.length === 1 ? "jugador" : "jugadores"} ×{" "}
            {euroShort(pot.contributionCents)}
          </p>
        </div>
      </div>
      <div className="pot-body">
        {visible.length > 0 && (
          <div className="pot-players" aria-label="Han entrado en el bote">
            <span className="pot-stack" aria-hidden="true">
              {visible.map((p) => (
                <RankAvatar key={p.id} name={p.name} avatar={p.avatar} />
              ))}
              {pot.players.length > visible.length && (
                <span className="rival-avatar pot-more">
                  +{pot.players.length - visible.length}
                </span>
              )}
            </span>
            <span className="pot-players-text">
              {pot.players.length > 3
                ? `${pot.players
                    .slice(0, 3)
                    .map((p) => p.name)
                    .join(", ")} y ${pot.players.length - 3} más`
                : potNames(pot.players)}
            </span>
          </div>
        )}
        {pot.state === "empty" && (
          <p className="pot-note">
            Bote vacío. El primero que selle su boleto pone la primera moneda.
          </p>
        )}
        {pot.state === "open" && (
          <p className="pot-note">
            Cada boleto sellado antes del cierre suma su parte.
          </p>
        )}
        {(pot.state === "live" || pot.state === "settled") &&
          pot.leaders.length > 0 && (
            <div className="pot-winners">
              <span className="pot-winners-label">
                {pot.state === "settled"
                  ? pot.leaders.length > 1
                    ? "Bote a repartir"
                    : "Se lo lleva"
                  : nobodyScored
                    ? "Aún no ha puntuado nadie"
                    : pot.leaders.length > 1
                      ? "Empatados en cabeza"
                      : "Ahora mismo se lo lleva"}
              </span>
              {!(pot.state === "live" && nobodyScored) && (
                <ul>
                  {pot.leaders.slice(0, 4).map((r) => (
                    <li key={r.id} className={r.id === userId ? "is-me" : ""}>
                      <span className="pot-winner-avatar">
                        <RankAvatar name={r.name} avatar={r.avatar} />
                        <Crown size={12} aria-hidden="true" />
                      </span>
                      <span className="pot-winner-name">
                        <span>
                          {r.name}
                          {r.id === userId && <small> · Tú</small>}
                        </span>
                        <small className="pot-winner-points">
                          {r.points} pts
                        </small>
                      </span>
                      <strong className="pot-winner-share">
                        {pot.state === "settled" ? "+" : "≈ "}
                        {euro(pot.shareCents)}
                      </strong>
                    </li>
                  ))}
                  {pot.leaders.length > 4 && (
                    <li className="pot-winners-more">
                      y {pot.leaders.length - 4} más, {euro(pot.shareCents)} cada
                      uno
                    </li>
                  )}
                </ul>
              )}
              {pot.state === "settled" && pot.remainderCents > 0 && (
                <p className="pot-note">
                  Sobran {euro(pot.remainderCents)} al repartir: decidid entre
                  vosotros.
                </p>
              )}
            </div>
          )}
        <p className="pot-disclaimer">
          <Info size={12} aria-hidden="true" />
          Bote informativo. GalacticBet no toca el dinero ni cobra comisión:
          los pagos los organizáis vosotros.
        </p>
      </div>
    </section>
  );
}
