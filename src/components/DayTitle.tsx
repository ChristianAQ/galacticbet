import { useStuck } from "../lib/useStuck";

const weekday = new Intl.DateTimeFormat("es", { weekday: "long" });
const dayMonth = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "long",
});

/** Day separator: «Hoy»/«Mañana» or the weekday, the date and the fixture count. */
export default function DayTitle({ date, count }: { date: string; count: number }) {
  const day = new Date(date);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const relative =
    day.toDateString() === today.toDateString()
      ? "Hoy"
      : day.toDateString() === tomorrow.toDateString()
        ? "Mañana"
        : "";
  // Background only while pinned, so the resting list stays light.
  const { sentinel, stuck } = useStuck();
  return (
    <>
      <span ref={sentinel} className="sticky-sentinel" aria-hidden="true" />
      <h2
        className={`match-day-title${relative ? " is-near" : ""}${stuck ? " is-stuck" : ""}`}
      >
        <span className="match-day-name">
          {relative || weekday.format(day)}
        </span>
        <span className="match-day-date">{dayMonth.format(day)}</span>
        <i className="match-day-rule" aria-hidden="true" />
        <span className="match-day-count">
          {count} {count === 1 ? "partido" : "partidos"}
        </span>
      </h2>
    </>
  );
}
