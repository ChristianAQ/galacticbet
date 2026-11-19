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

/** Top three on real steps: the winner stands tallest. */
export function Podium({
  rows,
  userId,
}: {
  rows: RankingRow[];
  userId: string;
}) {
  const top = rows.slice(0, 3);
  // Classic podium order: second, first, third.
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return (
    <ol className="ranking-podium" aria-label="Podio">
      {order.map((r) => (
        <li
          key={r.id}
          className={`podium-step podium-${Math.min(r.position, 3)}${r.id === userId ? " is-me" : ""}`}
        >
          <span className="podium-avatar">
            {r.position === 1 && (
              <Crown size={18} strokeWidth={2.4} aria-hidden="true" />
            )}
            <RankAvatar name={r.name} avatar={r.avatar} />
          </span>
          <strong className="podium-name">
            {r.name}
            {r.id === userId && <small> · Tú</small>}
          </strong>
          <span className="podium-points">
            {r.points} <small>pts</small>
          </span>
          <span className="podium-block" aria-label={`Posición ${r.position}`}>
            {r.position}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Your place in the table, big enough to brag about (or to motivate). */
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
      <span className="my-rank-position">
        <small>Tu puesto</small>
        <strong>
          {s.me.position}
          <i aria-hidden="true">º</i>
        </strong>
        <small className="my-rank-of">de {s.total}</small>
      </span>
      <span className="my-rank-stats">
        <span>
          <strong>{s.me.points}</strong>
          <small>{s.me.points === 1 ? "punto" : "puntos"}</small>
        </span>
        {showHits && (
          <span>
            <strong>{s.me.hits}</strong>
            <small>{s.me.hits === 1 ? "acierto" : "aciertos"}</small>
          </span>
        )}
      </span>
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
