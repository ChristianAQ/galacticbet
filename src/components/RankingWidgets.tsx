import { Crown, TrendingDown, TrendingUp } from "lucide-react";
import { rankingSummary, type RankingRow } from "../lib/rankings";
import "../styles/standings.css";

export function RankAvatar({
  name,
  avatar,
}: {
  name: string;
  avatar: string | null;
}) {
  return (
    <span className="rival-avatar">
      {avatar ? (
        <img src={avatar} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  );
}

export function RankBadge({ position }: { position: number }) {
  return (
    <span
      className={`rank-badge${position <= 3 ? ` rank-${position}` : ""}`}
      aria-label={`Posición ${position}`}
    >
      {position}
    </span>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Your place, compact: position, points and hits on one ink strip, and the
 * one sentence that matters (gap to the leader or to the player above).
 */
export function MyRankCard({
  rows,
  userId,
  showHits = true,
}: {
  rows: RankingRow[];
  userId: string;
  showHits?: boolean;
}) {
  const s = rankingSummary(rows, userId);
  if (!s.me) return null;
  const scored = rows.some((r) => r.points > 0);
  const leading = s.me.position === 1;
  const status = !scored
    ? "Todavía no ha puntuado nadie. Todo el mundo empata a cero."
    : leading
      ? s.sharedLead
        ? "Compartes el liderato. Nadie se relaja."
        : s.total > 1
          ? `Líder con ${plural(s.me.points - (rows.find((r) => r.position > 1)?.points ?? 0), "punto")} de colchón.`
          : "Líder del grupo (y único participante)."
      : `A ${plural(s.gapToLeader, "punto")} del líder · ${plural(s.gapToAbove, "punto")} para adelantar al de arriba.`;
  return (
    <section
      className={`my-rank-card${leading && scored ? " is-leader" : ""}`}
      aria-label="Tu posición"
    >
      <div className="my-rank-main">
        <span className="my-rank-position">
          {leading && scored && (
            <Crown size={18} strokeWidth={2.4} aria-hidden="true" />
          )}
          <strong>
            {s.me.position}
            <i aria-hidden="true">º</i>
          </strong>
          <small>de {s.total}</small>
        </span>
        <dl className="my-rank-stats">
          <div>
            <dt>{s.me.points === 1 ? "Punto" : "Puntos"}</dt>
            <dd>{s.me.points}</dd>
          </div>
          {showHits && (
            <div>
              <dt>{s.me.hits === 1 ? "Acierto" : "Aciertos"}</dt>
              <dd>{s.me.hits}</dd>
            </div>
          )}
        </dl>
      </div>
      <p className="my-rank-status">
        {leading || !scored ? (
          <TrendingUp size={15} aria-hidden="true" />
        ) : (
          <TrendingDown size={15} aria-hidden="true" />
        )}
        {status}
      </p>
    </section>
  );
}
