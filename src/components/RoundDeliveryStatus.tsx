import type { Participant } from "../lib/data";
import { countdownLabel } from "../lib/matchPreview";

/**
 * Shown only while the round is open and someone still has to save: who is
 * missing, the group progress and the time left before the first kick-off.
 */
export default function RoundDeliveryStatus({
  memberIds,
  participants,
  completedIds,
  ready,
  deadline,
  clock,
  userId,
}: {
  memberIds: string[];
  participants: Participant[];
  completedIds: string[];
  ready: boolean;
  deadline: number | null;
  clock: number;
  userId: string;
}) {
  const done = memberIds.filter((id) => completedIds.includes(id));
  const missing = memberIds.filter((id) => !completedIds.includes(id));
  const validDate = deadline !== null && Number.isFinite(deadline);
  const closed = validDate && clock >= deadline;
  if (!ready || closed || !missing.length) return null;
  const me = missing.includes(userId);
  const others = missing.filter((id) => id !== userId);
  const ordered = me ? [userId, ...others] : others;
  const date = validDate
    ? new Intl.DateTimeFormat("es", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(deadline)
    : "";
  const progress = memberIds.length
    ? (done.length / memberIds.length) * 100
    : 0;
  return (
    <section className="delivery-alert panel" aria-label="Entregas pendientes">
      <div className="delivery-alert-head">
        <div>
          <strong>
            {missing.length === 1
              ? me
                ? "Solo faltas tú"
                : "Falta 1 por guardar"
              : `Faltan ${missing.length} por guardar`}
          </strong>
          <span>
            {validDate ? (
              <>
                Cierra en{" "}
                {countdownLabel(new Date(deadline).toISOString(), clock)} ·{" "}
                <time dateTime={new Date(deadline).toISOString()}>{date}</time>
              </>
            ) : (
              "Fecha de cierre pendiente"
            )}
          </span>
        </div>
        <span
          className="delivery-alert-count"
          aria-label={`${done.length} de ${memberIds.length} han guardado`}
        >
          {done.length}
          <small>/{memberIds.length}</small>
        </span>
      </div>
      <div className="delivery-alert-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <ul className="delivery-alert-people" aria-label="Pendientes">
        {ordered.map((id) => {
          const name =
            id === userId
              ? "Tú"
              : participants.find((p) => p.id === id)?.name || "Jugador";
          return (
            <li key={id} className={id === userId ? "is-me" : undefined}>
              <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
              {name}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
