import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import "../styles/charts.css";

/**
 * Small, quiet charts in the paper's colours. Thin marks, hairline axes,
 * one direct label where it matters. Tapping (or arrow keys on the focused
 * chart) picks a point and shows its values; a hidden table carries every
 * value for screen readers.
 */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Tap or arrow keys choose a point; it stays until tapped again. */
function usePick(count: number, xOf: (i: number) => number) {
  const [picked, setPicked] = useState<number | null>(null);
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    let best = 0;
    for (let i = 1; i < count; i++) if (Math.abs(xOf(i) - x) < Math.abs(xOf(best) - x)) best = i;
    setPicked((current) => (current === best ? null : best));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!count) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      // Handled here: the deck around it must not turn the page too.
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === "ArrowRight" ? 1 : -1;
      setPicked((current) => Math.min(count - 1, Math.max(0, (current ?? (step > 0 ? -1 : count)) + step)));
    } else if (event.key === "Escape" && picked !== null) {
      event.preventDefault();
      event.stopPropagation();
      setPicked(null);
    }
  };
  return { picked, onPointerUp, onKeyDown };
}

function ChartFrame({
  title,
  note,
  legend,
  table,
  children,
}: {
  title: string;
  note?: ReactNode;
  legend?: ReactNode;
  table: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
}) {
  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">{title}</span>
        {/* The picked point's values replace the note (read out as they change). */}
        <span className="chart-note" aria-live="polite">
          {note}
        </span>
      </figcaption>
      {legend && <div className="chart-legend">{legend}</div>}
      {children}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            {table.head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ---------- Position over the season (1 at the top) ----------

export interface PositionPoint {
  day: number;
  position: number;
  points: number;
  size: number;
}
export function PositionChart({ points }: { points: PositionPoint[] }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const height = 128;
  const pad = { top: 14, right: 34, bottom: 22, left: 26 };
  const size = Math.max(...points.map((p) => p.size), 2);
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (points.length > 1 ? (i / (points.length - 1)) * w : w / 2);
  const y = (position: number) => pad.top + ((position - 1) / (size - 1)) * h;
  const { picked, onPointerUp, onKeyDown } = usePick(points.length, x);
  const last = points.at(-1);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.position).toFixed(1)}`).join(" ");
  const ticks = [1, Math.round(size / 2), size];
  const shown = picked ?? null;
  return (
    <ChartFrame
      title="Puesto por jornada"
      note={
        shown !== null ? (
          <>
            Jornada {points[shown].day}: <strong>{points[shown].position}.º</strong> · {points[shown].points} pts
          </>
        ) : last ? (
          `${last.position}.º ahora`
        ) : undefined
      }
      table={{ head: ["Jornada", "Puesto", "Puntos"], rows: points.map((p) => [p.day, `${p.position}.º`, p.points]) }}
    >
      <div
        ref={ref}
        className="chart-plot"
        tabIndex={0}
        aria-label="Puesto en cada jornada. Usa las flechas para recorrerlo."
        onKeyDown={onKeyDown}
      >
        {width > 0 && (
          <svg width={width} height={height} onPointerUp={onPointerUp} aria-hidden="true">
            {ticks.map((t) => (
              <g key={t}>
                <line className="chart-grid" x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} />
                <text className="chart-axis" x={pad.left - 8} y={y(t) + 4} textAnchor="end">
                  {t}
                </text>
              </g>
            ))}
            <text className="chart-axis" x={x(0)} y={height - 4} textAnchor="start">
              J{points[0]?.day}
            </text>
            {points.length > 1 && (
              <text className="chart-axis" x={x(points.length - 1)} y={height - 4} textAnchor="end">
                J{last?.day}
              </text>
            )}
            {shown !== null && <line className="chart-cross" x1={x(shown)} x2={x(shown)} y1={pad.top - 6} y2={pad.top + h} />}
            <path className="chart-line" d={path} />
            {last && (
              <>
                <circle className="chart-dot" cx={x(points.length - 1)} cy={y(last.position)} r={4.5} />
                <text className="chart-end" x={x(points.length - 1) + 9} y={y(last.position) + 4}>
                  {last.position}.º
                </text>
              </>
            )}
            {shown !== null && shown !== points.length - 1 && (
              <circle className="chart-dot is-picked" cx={x(shown)} cy={y(points[shown].position)} r={4.5} />
            )}
          </svg>
        )}
      </div>
    </ChartFrame>
  );
}

// ---------- Goals for (up) and against (down), match by match ----------

export interface GoalsBar {
  label: string;
  detail: string;
  scored: number;
  conceded: number;
}
export function GoalsChart({ games }: { games: GoalsBar[] }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const height = 132;
  const pad = { top: 10, right: 6, bottom: 10, left: 22 };
  const top = Math.max(2, ...games.map((g) => Math.max(g.scored, g.conceded)));
  const w = Math.max(0, width - pad.left - pad.right);
  const mid = pad.top + (height - pad.top - pad.bottom) / 2;
  const unit = (height - pad.top - pad.bottom) / 2 / top;
  const slot = games.length ? w / games.length : 0;
  const bar = Math.max(4, Math.min(18, slot - 6));
  const x = (i: number) => pad.left + slot * i + slot / 2;
  const { picked, onPointerUp, onKeyDown } = usePick(games.length, x);
  // A column grows from the middle line; only its far end is rounded.
  const column = (cx: number, value: number, up: boolean, className: string) => {
    if (!value) return null;
    const len = value * unit;
    const r = Math.min(4, bar / 2, len);
    const x0 = cx - bar / 2;
    const x1 = cx + bar / 2;
    const end = up ? mid - len : mid + len;
    const d = up
      ? `M${x0},${mid} V${end + r} Q${x0},${end} ${x0 + r},${end} H${x1 - r} Q${x1},${end} ${x1},${end + r} V${mid} Z`
      : `M${x0},${mid} V${end - r} Q${x0},${end} ${x0 + r},${end} H${x1 - r} Q${x1},${end} ${x1},${end - r} V${mid} Z`;
    return <path className={className} d={d} />;
  };
  return (
    <ChartFrame
      title="Goles por partido"
      note={
        picked !== null && games[picked] ? (
          <>
            <strong>
              {games[picked].scored}-{games[picked].conceded}
            </strong>{" "}
            {games[picked].label}
          </>
        ) : (
          `últimos ${games.length}`
        )
      }
      legend={
        <>
          <span>
            <i className="chart-swatch is-for" /> A favor
          </span>
          <span>
            <i className="chart-swatch is-against" /> En contra
          </span>
        </>
      }
      table={{ head: ["Partido", "A favor", "En contra"], rows: games.map((g) => [g.detail, g.scored, g.conceded]) }}
    >
      <div
        ref={ref}
        className="chart-plot"
        tabIndex={0}
        aria-label="Goles a favor y en contra en cada partido. Usa las flechas para recorrerlo."
        onKeyDown={onKeyDown}
      >
        {width > 0 && (
          <svg width={width} height={height} onPointerUp={onPointerUp} aria-hidden="true">
            <text className="chart-axis" x={pad.left - 6} y={mid - top * unit + 8} textAnchor="end">
              {top}
            </text>
            <text className="chart-axis" x={pad.left - 6} y={mid + top * unit} textAnchor="end">
              {top}
            </text>
            {games.map((g, i) => (
              <g key={i} className={picked === null || picked === i ? undefined : "is-faded"}>
                {column(x(i), g.scored, true, "chart-col is-for")}
                {column(x(i), g.conceded, false, "chart-col is-against")}
              </g>
            ))}
            <line className="chart-base" x1={pad.left} x2={pad.left + w} y1={mid} y2={mid} />
          </svg>
        )}
      </div>
    </ChartFrame>
  );
}

// ---------- Columns: one value per round, the latest one stands out ----------

export interface Column {
  label: string;
  value: number;
  display: string;
  detail: string;
}
export function ColumnChart({ title, note, columns, unit }: { title: string; note?: string; columns: Column[]; unit: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const height = 136;
  const pad = { top: 22, right: 4, bottom: 22, left: 24 };
  const top = Math.max(1, Math.ceil(Math.max(...columns.map((c) => c.value), 0)));
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const slot = columns.length ? w / columns.length : 0;
  const bar = Math.max(3, Math.min(20, slot - 4));
  const x = (i: number) => pad.left + slot * i + slot / 2;
  const y = (v: number) => pad.top + h - (v / top) * h;
  const { picked, onPointerUp, onKeyDown } = usePick(columns.length, x);
  const ticks = top <= 4 ? Array.from({ length: top + 1 }, (_, i) => i) : [0, Math.round(top / 2), top];
  const lastIndex = columns.length - 1;
  return (
    <ChartFrame
      title={title}
      note={
        picked !== null && columns[picked] ? (
          <>
            <strong>{columns[picked].display}</strong> {columns[picked].detail}
          </>
        ) : (
          note
        )
      }
      table={{ head: ["Jornada", unit], rows: columns.map((c) => [c.detail, c.display]) }}
    >
      <div ref={ref} className="chart-plot" tabIndex={0} aria-label={`${title}. Usa las flechas para recorrerlo.`} onKeyDown={onKeyDown}>
        {width > 0 && (
          <svg width={width} height={height} onPointerUp={onPointerUp} aria-hidden="true">
            {ticks.map((t) => (
              <g key={t}>
                <line className="chart-grid" x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} />
                <text className="chart-axis" x={pad.left - 6} y={y(t) + 4} textAnchor="end">
                  {t}
                </text>
              </g>
            ))}
            {columns.map((c, i) => {
              const yTop = y(c.value);
              const len = pad.top + h - yTop;
              const r = Math.min(4, bar / 2, len);
              const x0 = x(i) - bar / 2;
              const x1 = x(i) + bar / 2;
              const base = pad.top + h;
              return (
                <path
                  key={i}
                  className={`chart-col ${i === (picked ?? lastIndex) ? "is-emph" : "is-muted"}`}
                  d={
                    len > 0
                      ? `M${x0},${base} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x1 - r} Q${x1},${yTop} ${x1},${yTop + r} V${base} Z`
                      : ""
                  }
                />
              );
            })}
            {(() => {
              const i = picked ?? lastIndex;
              const c = columns[i];
              if (!c) return null;
              return (
                <text className="chart-end" x={x(i)} y={y(c.value) - 6} textAnchor="middle">
                  {c.display}
                </text>
              );
            })()}
            <text className="chart-axis" x={x(0)} y={height - 4} textAnchor="middle">
              {columns[0]?.label}
            </text>
            {lastIndex > 0 && (
              <text className="chart-axis" x={x(lastIndex)} y={height - 4} textAnchor="middle">
                {columns[lastIndex].label}
              </text>
            )}
          </svg>
        )}
      </div>
    </ChartFrame>
  );
}

// ---------- Figures: meters and the thin split bar ----------

/** One ratio against its whole, with its name and figure on the same row. */
export function Meter({ label, value, max, figure }: { label: string; value: number; max: number; figure: string }) {
  const share = max ? Math.min(1, value / max) : 0;
  return (
    <div className="chart-meter" role="img" aria-label={`${label}: ${figure}`}>
      <span className="chart-meter-label">{label}</span>
      <span className="chart-meter-track" aria-hidden="true">
        <i style={{ width: `${(share * 100).toFixed(1)}%` }} />
      </span>
      <span className="chart-meter-figure">{figure}</span>
    </div>
  );
}

/** Wins, draws and losses as one thin bar; the figures beside it carry the numbers. */
export function ResultSplit({ wins, draws, losses }: { wins: number; draws: number; losses: number }) {
  const total = wins + draws + losses;
  if (!total) return null;
  return (
    <span
      className="chart-split"
      role="img"
      aria-label={`${wins} victorias, ${draws} empates y ${losses} derrotas`}
    >
      {[
        ["is-win", wins],
        ["is-draw", draws],
        ["is-loss", losses],
      ].map(([tone, n]) =>
        n ? <i key={tone as string} className={tone as string} style={{ flexGrow: n as number }} /> : null,
      )}
    </span>
  );
}

/** A thin bar under a ranking row: its value against the board's largest. */
export function RowBar({ value, max }: { value: number; max: number }) {
  return (
    <span className="chart-rowbar" aria-hidden="true">
      <i style={{ width: `${max ? Math.max(2, (value / max) * 100).toFixed(1) : 0}%` }} />
    </span>
  );
}
