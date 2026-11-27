import { Check, ChevronRight, LockKeyhole, Minus, Plus } from "lucide-react";
import { memo, useEffect, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { Match, Mode, Prediction, PredictionValue } from "../lib/domain";
import { haptic, springTo } from "../lib/motion";
import { MatchRow } from "./ui";
import { LiveEvents } from "./LiveStatus";
import "../styles/quiniela.css";

/** Sealed or closed rounds show the board instead: only a started match locks a row. */
export type PredictionLock = "kickoff" | null;

const outcomeLabels = { "1": "Local", X: "Empate", "2": "Visitante" } as const;

/** A quick spring «pop» on the cell you just marked. Transform only. */
function pop(event: MouseEvent<HTMLElement>) {
  const cell = event.currentTarget;
  void springTo(
    cell,
    [{ transform: "scale(0.84)" }, { transform: "scale(1)" }],
    { response: 0.42, damping: 0.52 },
  ).then(() => {
    cell.style.transform = "";
  });
}

/**
 * One numbered row of the quiniela slip: the fixture and your 1X2 or score.
 * Tapping the fixture opens the match (preview, odds, sheet) with the crests'
 * morph; the picks sit apart below it, so a tap meant for 1, X or 2 never
 * navigates. Played matches leave the slip for the board (GroupPredictions),
 * so there is no result strip here.
 */
function PredictionCard({
  number,
  match: m,
  history,
  value,
  mode,
  lock,
  disabled,
  saving,
  onChoose,
  to,
  detailsLabel,
  plainResult = false,
}: {
  number: number;
  match: Match;
  history: Match[];
  value?: PredictionValue;
  mode: Mode;
  lock: PredictionLock;
  disabled: boolean;
  saving: boolean;
  onChoose: (match: Match, value: PredictionValue) => void;
  /** The match page the fixture opens. */
  to: string;
  /** What it opens, for screen readers. Friends' competitions have no odds or preview: just the match sheet. */
  detailsLabel?: string;
  /** Friends' matches: no «a 90 minutos» under the score. */
  plainResult?: boolean;
}) {
  const locked = lock !== null;
  return (
    <article
      className={`slip-row prediction-card${locked ? " prediction-locked" : ""}${value ? " prediction-picked" : ""}${saving ? " is-saving" : ""}`}
      aria-label={`${number}. ${m.home} contra ${m.away}`}
    >
      <span className="slip-number" aria-hidden="true">
        {String(number).padStart(2, "0")}
      </span>
      <Link
        className="slip-fixture"
        to={to}
        aria-label={`${
          detailsLabel ??
          (["TIMED", "SCHEDULED"].includes(m.status)
            ? "Previa, cuotas y ficha"
            : "Ficha del partido")
        }: ${m.home} contra ${m.away}`}
      >
        <MatchRow match={m} history={history} as="span" plainResult={plainResult} />
        <ChevronRight className="slip-fixture-go" size={16} aria-hidden="true" />
      </Link>
      <LiveEvents match={m} />
      <div className="prediction-actions">
        <span className="prediction-state" aria-live="polite">
          {lock ? (
            <>
              <LockKeyhole size={13} aria-hidden="true" />
              Ya ha empezado
            </>
          ) : saving ? (
            <>
              <i className="saving-dot" aria-hidden="true" />
              Anotando…
            </>
          ) : value ? (
            <>
              <Check size={13} aria-hidden="true" />
              Anotado
            </>
          ) : (
            "Tu pronóstico"
          )}
        </span>
        {mode === "classic" ? (
          <div className="outcomes slip-cells" role="group" aria-label="Pronóstico 1X2">
            {(["1", "X", "2"] as const).map((v) => (
              <button
                type="button"
                disabled={locked || disabled}
                aria-pressed={value === v}
                aria-label={`${v}: ${v === "1" ? `gana ${m.home}` : v === "2" ? `gana ${m.away}` : "empate"}`}
                className={`slip-cell${value === v ? " selected" : ""}`}
                key={v}
                onClick={(event) => {
                  if (value !== v) {
                    haptic();
                    pop(event);
                  }
                  onChoose(m, v);
                }}
              >
                <strong>{v}</strong>
                <small>{outcomeLabels[v]}</small>
              </button>
            ))}
          </div>
        ) : (
          <ExactInput
            disabled={locked || disabled}
            value={typeof value === "object" ? value : undefined}
            home={m.home}
            away={m.away}
            onApply={(next) => onChoose(m, next)}
          />
        )}
      </div>
    </article>
  );
}
export default memo(PredictionCard);

const clamp = (n: number) => Math.min(99, Math.max(0, Math.round(n) || 0));

/** Exact score: two big goal fields with steppers, applied as one pick. */
function ExactInput({
  disabled,
  value,
  home,
  away,
  onApply,
}: {
  disabled: boolean;
  value?: Prediction;
  home: string;
  away: string;
  onApply: (value: Prediction) => void;
}) {
  const [goals, setGoals] = useState({
    home: value?.home ?? 0,
    away: value?.away ?? 0,
  });
  // Snapshots recreate every pick object: only a different score resets the fields.
  useEffect(() => {
    setGoals({ home: value?.home ?? 0, away: value?.away ?? 0 });
  }, [value?.home, value?.away]);
  const changed =
    !value || value.home !== goals.home || value.away !== goals.away;
  const field = (side: "home" | "away", team: string) => (
    <span className="exact-side">
      <button
        type="button"
        className="exact-step"
        aria-label={`Un gol menos para ${team}`}
        disabled={disabled || goals[side] <= 0}
        onClick={() => {
          haptic();
          setGoals((g) => ({ ...g, [side]: clamp(g[side] - 1) }));
        }}
      >
        <Minus size={16} aria-hidden="true" />
      </button>
      <input
        aria-label={`Goles de ${team}`}
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        enterKeyHint="done"
        min="0"
        max="99"
        required
        disabled={disabled}
        value={goals[side]}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) =>
          setGoals((g) => ({ ...g, [side]: clamp(Number(e.target.value)) }))
        }
      />
      <button
        type="button"
        className="exact-step"
        aria-label={`Un gol más para ${team}`}
        disabled={disabled || goals[side] >= 99}
        onClick={() => {
          haptic();
          setGoals((g) => ({ ...g, [side]: clamp(g[side] + 1) }));
        }}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </span>
  );
  return (
    <form
      className="exact-input"
      onSubmit={(e) => {
        e.preventDefault();
        haptic();
        onApply(goals);
      }}
    >
      {field("home", home)}
      <span className="exact-dash" aria-hidden="true">
        –
      </span>
      {field("away", away)}
      <button
        className={`button ${changed ? "primary" : "secondary"} exact-apply`}
        disabled={disabled || !changed}
      >
        {value && !changed ? "Anotado" : "Anotar"}
      </button>
    </form>
  );
}
