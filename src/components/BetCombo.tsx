import { Check, ChevronDown, Layers, Minus, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  comboOf,
  pickKey,
  pickLabel,
  priceVerdict,
  settleCombo,
  valuePercent,
  winChance,
  type AnalysisMatch,
  type AnalysisPick,
  type PriceVerdict,
} from "../lib/bettingAnalysis";
import type { Match } from "../lib/domain";
import { BreakEven } from "./BetCharts";
import { ConfidenceChip } from "./BetOptions";

const odds = new Intl.NumberFormat("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const units = new Intl.NumberFormat("es", { minimumFractionDigits: 1, maximumFractionDigits: 2, signDisplay: "exceptZero" });
/** Small chances keep a decimal: «8,4 %», not «8 %». */
const chance = (p: number) =>
  new Intl.NumberFormat("es", { style: "percent", maximumFractionDigits: p < 0.1 ? 1 : 0 }).format(p);
const signedPct = (n: number) => (n > 0 ? `+${n} %` : n < 0 ? `−${Math.abs(n)} %` : "0 %");

const VERDICTS: Record<PriceVerdict, string> = { good: "Paga bien", fair: "Paga lo justo", poor: "Paga poco" };

/**
 * The price in plain words, by the AI's estimate: «Paga bien · +5 %»,
 * «Paga lo justo» or «Paga poco · −4 %». What it means in euros, and the
 * market's view, are spelt out in «¿Compensa?».
 */
export function ValueChip({ pick }: { pick: Pick<AnalysisPick, "price" | "probability"> }) {
  const verdict = priceVerdict(pick);
  return (
    <span className={`bet-value${verdict === "good" ? "" : " is-flat"}`}>
      {VERDICTS[verdict]}
      {verdict !== "fair" && ` · ${signedPct(valuePercent(pick.probability, pick.price))}`}
    </span>
  );
}

/** «＋ Combinada»: adds the bet to your combinada (or takes it out). */
export function ComboToggle({ pick, inSlip, onToggle }: { pick: AnalysisPick; inSlip: boolean; onToggle: (pick: AnalysisPick) => void }) {
  return (
    <button
      type="button"
      className={`bet-combo-toggle${inSlip ? " is-in" : ""}`}
      aria-pressed={inSlip}
      onClick={() => onToggle(pick)}
    >
      {inSlip ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : <Plus size={14} strokeWidth={3} aria-hidden="true" />}
      {inSlip ? "En tu combinada" : "Combinada"}
    </button>
  );
}

/** The legs, the combined price, the real chance of landing it and its value. */
function ComboSummary({
  legs,
  games,
  onRemove,
}: {
  legs: AnalysisPick[];
  games: Map<string, AnalysisMatch>;
  onRemove?: (pick: AnalysisPick) => void;
}) {
  const combo = comboOf(legs);
  return (
    <>
      <ol className="bet-combo-legs">
        {legs.map((leg) => {
          const game = games.get(leg.matchId);
          return (
            <li key={pickKey(leg)}>
              <span>
                <strong>{pickLabel(leg, game?.home ?? "Local", game?.away ?? "Visitante")}</strong>
                <small>{game ? `${game.home} – ${game.away}` : ""}</small>
              </span>
              <b className="numeral">{odds.format(leg.price)}</b>
              {onRemove && (
                <button type="button" className="icon-button bet-combo-remove" aria-label="Quitar de la combinada" onClick={() => onRemove(leg)}>
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <div className="bet-combo-total">
        <span>
          <span className="eyebrow">Cuota total</span>
          <strong className="numeral">{odds.format(combo.price)}</strong>
        </span>
        <span className="bet-combo-chance">
          Acertarla: <b>{chance(combo.probability)}</b> según la IA
          {combo.fair !== undefined && (
            <>
              {" "}
              · <b>{chance(combo.fair)}</b> según el mercado
            </>
          )}
        </span>
      </div>
      <div className="bet-pick-tags">
        <ValueChip pick={combo} />
        <ConfidenceChip chance={winChance(combo)} />
      </div>
      <BreakEven pick={combo} />
    </>
  );
}

/** How a published combinada went: every leg won, one lost, or still to play. */
export function ComboResult({ legs, byId }: { legs: AnalysisPick[]; byId: Map<string, Match> }) {
  const settled = settleCombo(legs, byId);
  if (!settled) return null;
  const gain = settled.result === "won" ? settled.payout - 1 : settled.result === "lost" ? -1 : 0;
  const Icon = settled.result === "won" ? Check : settled.result === "lost" ? X : Minus;
  return (
    <span className={`bet-result is-${settled.result}`}>
      <Icon size={14} strokeWidth={3} aria-hidden="true" />
      {settled.result === "won" ? "Acertada" : settled.result === "lost" ? "Fallada" : "Nula"}
      {settled.result !== "void" && <b>{units.format(gain)} u</b>}
    </span>
  );
}

/** «Combinada de valor»: fixed with the analysis, with its own record. */
export function ComboCard({
  legs,
  games,
  byId,
}: {
  legs: AnalysisPick[];
  games: Map<string, AnalysisMatch>;
  byId: Map<string, Match>;
}) {
  return (
    <section className="bet-combo" aria-label="Combinada de valor">
      <header className="bet-combo-head">
        <span className="eyebrow">
          <Layers size={13} aria-hidden="true" /> Combinada de valor
        </span>
        <ComboResult legs={legs} byId={byId} />
      </header>
      <ComboSummary legs={legs} games={games} />
    </section>
  );
}

/**
 * Your combinada, built with «＋ Combinada»: pinned under the bar while you
 * pick, folded to its price; open it for the legs, the chance and the value.
 */
export function ComboPanel({
  legs,
  games,
  onRemove,
  onClear,
}: {
  legs: AnalysisPick[];
  games: Map<string, AnalysisMatch>;
  onRemove: (pick: AnalysisPick) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const combo = comboOf(legs);
  return (
    <section className={`bet-combo-panel${open ? " is-open" : ""}`} aria-label="Tu combinada">
      <button type="button" className="bet-combo-bar" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Layers size={18} aria-hidden="true" />
        <span>
          <strong>Tu combinada</strong>
          <small>
            {legs.length} {legs.length === 1 ? "apuesta" : "apuestas"} · acertarla {chance(combo.probability)}
          </small>
        </span>
        <b className="numeral">{odds.format(combo.price)}</b>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="bet-combo-body">
          {legs.length < 2 && <p className="bet-combo-note">Añade otra apuesta de otro partido para combinarlas.</p>}
          <ComboSummary legs={legs} games={games} onRemove={onRemove} />
          <button type="button" className="text-button is-destructive bet-combo-clear" onClick={onClear}>
            <Trash2 size={15} aria-hidden="true" /> Vaciar la combinada
          </button>
        </div>
      )}
    </section>
  );
}
