import type { CSSProperties } from "react";
import { edge, hasValue, MIN_VALUE, type AnalysisMatch, type AnalysisPick, type MatchMarket } from "../lib/bettingAnalysis";
import "../styles/charts.css";

/**
 * The analysis at a glance. Colours validated with the dataviz checks:
 * 1 · X · 2 is a diverging split (amber and blue poles, a neutral grey draw)
 * with its share printed on each part; value uses the charts' emphasis for
 * «pays more» and the against red for «pays less», as goals for and against.
 */
const pct = (p: number) => `${Math.round(p * 100)} %`;
const signed = (v: number) => {
  const n = Math.round(v * 100);
  return n > 0 ? `+${n} %` : n < 0 ? `−${Math.abs(n)} %` : "0 %";
};
const decimal = new Intl.NumberFormat("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** «¿Quién gana?»: the market's chances of 1, X and 2 as one segmented bar. */
export function OutcomeChances({ market, home, away }: { market: MatchMarket; home: string; away: string }) {
  const parts = [
    { key: "home", name: home, value: market.home },
    { key: "draw", name: "Empate", value: market.draw },
    { key: "away", name: away, value: market.away },
  ];
  return (
    <figure className="bet-chart">
      <figcaption>
        <span className="bet-chart-title">¿Quién gana?</span>
        <span className="bet-chart-note">según {market.source}</span>
      </figcaption>
      <div
        className="bet-outcome"
        role="img"
        aria-label={parts.map((p) => `${p.name} ${pct(p.value)}`).join(", ")}
      >
        {parts.map((p) => (
          <i key={p.key} className={`is-${p.key}`} style={{ flexGrow: Math.max(p.value, 0.04) }} title={`${p.name}: ${pct(p.value)}`}>
            {p.value >= 0.12 && <b>{pct(p.value)}</b>}
          </i>
        ))}
      </div>
      <ul className="bet-outcome-legend" aria-hidden="true">
        {parts.map((p) => (
          <li key={p.key} className={`is-${p.key}`}>
            <i />
            <span>{p.name}</span>
            <strong>{pct(p.value)}</strong>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Goals: more than 2.5 and both scoring, each a ratio against 100 %. */
export function GoalChances({ market }: { market: MatchMarket }) {
  const rows = [
    market.over25 !== undefined && { label: "Más de 2,5 goles", value: market.over25 },
    market.btts !== undefined && { label: "Marcan los dos", value: market.btts },
  ].filter((r): r is { label: string; value: number } => Boolean(r));
  if (!rows.length) return null;
  return (
    <figure className="bet-chart">
      <figcaption>
        <span className="bet-chart-title">Goles</span>
        <span className="bet-chart-note">probabilidad</span>
      </figcaption>
      {rows.map((r) => (
        <div key={r.label} className="bet-meter" role="img" aria-label={`${r.label}: ${pct(r.value)}`}>
          <span>{r.label}</span>
          <span className="bet-meter-track" aria-hidden="true">
            <i style={{ width: `${(r.value * 100).toFixed(1)}%` }} />
          </span>
          <strong>{pct(r.value)}</strong>
        </div>
      ))}
    </figure>
  );
}

/**
 * «¿Compensa?»: the AI's chance against the one the price needs to break even
 * (1 / cuota). Past the mark, the bet pays more than it should.
 */
export function BreakEven({ pick }: { pick: Pick<AnalysisPick, "price" | "probability" | "fair"> }) {
  const needed = 1 / pick.price;
  const value = edge(pick.probability, pick.price);
  const pays = pick.probability >= needed;
  // Pinnacle's fair chance, when it priced it: where the market puts the bet.
  const fair = pick.fair;
  return (
    <figure className="bet-chart">
      <figcaption>
        <span className="bet-chart-title">¿Compensa?</span>
        <span className={`bet-chart-note${pays ? " is-good" : ""}`}>
          {hasValue(pick) ? `Sí, ${signed(value)} de valor` : pays ? `Por poco, ${signed(value)}` : `No, ${signed(value)}`}
        </span>
      </figcaption>
      <div
        className={`bet-even${pays ? " is-pays" : ""}`}
        role="img"
        aria-label={
          `La IA le da un ${pct(pick.probability)}; a cuota ${decimal.format(pick.price)} hace falta un ${pct(needed)} para que compense.` +
          (fair !== undefined ? ` El mercado (Pinnacle) le da un ${pct(fair)}.` : "")
        }
      >
        <span className="bet-even-track" aria-hidden="true">
          <i style={{ width: `${(pick.probability * 100).toFixed(1)}%` }} />
          {fair !== undefined && <b style={{ left: `${(fair * 100).toFixed(1)}%` }} />}
          <em style={{ left: `${(needed * 100).toFixed(1)}%` }} />
        </span>
        <span className="bet-even-legend" aria-hidden="true">
          <span>
            <i className="is-ai" /> IA <strong>{pct(pick.probability)}</strong>
          </span>
          {fair !== undefined && (
            <span>
              <i className="is-market" /> Mercado <strong>{pct(fair)}</strong>
            </span>
          )}
          <span>
            <i className="is-need" /> Necesita <strong>{pct(needed)}</strong> a {decimal.format(pick.price)}
          </span>
        </span>
      </div>
    </figure>
  );
}

/**
 * The day at a glance: the value of every match's best option around zero,
 * with the value threshold. Tapping a row goes to its match.
 */
export function ValueOverview({ matches, onOpen }: { matches: AnalysisMatch[]; onOpen: (matchId: string) => void }) {
  const rows = matches.flatMap((m) => (m.pick ? [{ m, value: edge(m.pick.probability, m.pick.price) }] : []));
  if (!rows.length) return null;
  // Symmetric scale in steps of 5 %, never narrower than ±10 %.
  const span = Math.max(0.1, Math.ceil((Math.max(...rows.map((r) => Math.abs(r.value))) + 0.005) * 20) / 20);
  const x = (v: number) => 50 + (Math.max(-span, Math.min(span, v)) / span) * 50;
  const valued = rows.filter((r) => hasValue(r.m.pick!)).length;
  return (
    <figure className="bet-chart bet-overview">
      <figcaption>
        <span className="bet-chart-title">De un vistazo: valor de cada partido</span>
        <span className={`bet-chart-note${valued ? " is-good" : ""}`}>
          {valued ? `${valued} con valor` : "ninguna con valor"}
        </span>
      </figcaption>
      <div className="bet-overview-axis" aria-hidden="true">
        <span>paga menos</span>
        <span>paga más</span>
      </div>
      <ul className="bet-overview-rows" style={{ "--line": `${x(MIN_VALUE)}%` } as CSSProperties}>
        {rows.map(({ m, value }) => (
          <li key={m.matchId}>
            <button
              type="button"
              onClick={() => onOpen(m.matchId)}
              aria-label={`${m.home} – ${m.away}: valor ${signed(value)}. Ver el partido`}
              title={`${m.home} – ${m.away}: ${signed(value)}`}
            >
              <span className="bet-overview-name">
                {m.home} – {m.away}
              </span>
              <span className="bet-overview-track" aria-hidden="true">
                <i
                  className={value >= 0 ? "is-up" : "is-down"}
                  style={{
                    left: `${Math.min(x(value), 50)}%`,
                    width: `${Math.max(Math.abs(x(value) - 50), 0.8)}%`,
                  }}
                />
              </span>
              <strong className={hasValue(m.pick!) ? "is-good" : undefined}>{signed(value)}</strong>
            </button>
          </li>
        ))}
      </ul>
      <p className="bet-overview-key" aria-hidden="true">
        <i /> umbral de valor: +{Math.round(MIN_VALUE * 100)} %
      </p>
    </figure>
  );
}
