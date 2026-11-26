import { useState } from "react";
import { SourceTag } from "./BetCharts";
import {
  confidenceOf,
  optionValue,
  pickKey,
  pickLabel,
  type AnalysisPick,
  type MatchOption,
} from "../lib/bettingAnalysis";

const odds = new Intl.NumberFormat("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Small chances keep a decimal: «8,4 %», not «8 %». */
const pct = (p: number) => new Intl.NumberFormat("es", { style: "percent", maximumFractionDigits: p < 0.1 ? 1 : 0 }).format(p);
const signedPct = (n: number) => (n > 0 ? `+${n} %` : n < 0 ? `−${Math.abs(n)} %` : "0 %");

/** Four bars, filled as far as the chance goes: readable without colour. */
function Bars({ bars }: { bars: number }) {
  return (
    <span className="bet-bars" aria-hidden="true">
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= bars ? "is-on" : undefined} />
      ))}
    </span>
  );
}

/**
 * «Confianza alta · 62 %»: the chance of winning the bet on one fixed scale
 * (muy alta from 70 %, alta from 55 %, media from 40 %, baja below).
 */
export function ConfidenceChip({ chance }: { chance: number }) {
  const level = confidenceOf(chance);
  return (
    <span
      className={`bet-confidence is-${level.id}`}
      title="Probabilidad de ganarla: la estimación de la IA, nunca por encima de la del mercado cuando Pinnacle la cotiza"
    >
      <Bars bars={level.bars} />
      Confianza {level.label} · {pct(chance)}
    </span>
  );
}

const VISIBLE = 5;

/**
 * «Cuotas del partido»: every main option with its price, its chance without
 * margin, its confidence and what it pays against that chance, most likely
 * first. The best paid and the analysis's recommendation are marked.
 */
export function MatchOptions({
  options,
  home,
  away,
  recommended,
}: {
  options: MatchOption[];
  home: string;
  away: string;
  recommended?: AnalysisPick;
}) {
  const [all, setAll] = useState(false);
  if (!options.length) return null;
  const best = options.reduce((b, o) => (optionValue(o) > optionValue(b) ? o : b), options[0]);
  const recommendedKey = recommended ? pickKey(recommended) : "";
  const keyOf = (o: MatchOption) => pickKey({ ...o, matchId: recommended?.matchId ?? "" });
  // The best paid and the recommendation always show, even past the first rows.
  const shown = all
    ? options
    : options.filter((o, i) => i < VISIBLE || o === best || keyOf(o) === recommendedKey);
  const sharp = options.every((o) => o.sharp);
  return (
    <figure className="bet-chart bet-options">
      <figcaption>
        <span className="bet-chart-title">
          Cuotas del partido <SourceTag kind="datos" />
        </span>
        <span className="bet-chart-note">{sharp ? "según Pinnacle" : "sin margen"}</span>
      </figcaption>
      <table className="bet-options-table">
        <thead>
          <tr>
            <th scope="col">Opción</th>
            <th scope="col">Cuota</th>
            <th scope="col">Prob.</th>
            <th scope="col" title="Lo que paga la cuota frente a la probabilidad del mercado: 0 % sería lo justo">
              Mercado
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((o) => {
            const level = confidenceOf(o.probability);
            const value = Math.round(optionValue(o) * 100);
            const isBest = o === best;
            const isRecommended = keyOf(o) === recommendedKey;
            return (
              <tr key={keyOf(o)} className={isRecommended ? "is-recommended" : undefined}>
                <th scope="row">
                  <span>{pickLabel(o, home, away)}</span>
                  <small>
                    <Bars bars={level.bars} />
                    Confianza {level.label}
                    {isBest && <em className="bet-tag-value">Mejor pagada</em>}
                    {isRecommended && <em className="bet-tag-plain">Recomendación</em>}
                  </small>
                </th>
                <td className="numeral">{odds.format(o.price)}</td>
                <td>{pct(o.probability)}</td>
                <td className={value > 0 ? "is-up" : undefined}>{signedPct(value)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.length < options.length || all ? (
        <button type="button" className="text-button bet-options-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Ver menos" : `Ver las ${options.length} opciones`}
        </button>
      ) : null}
    </figure>
  );
}
