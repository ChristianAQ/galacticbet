import { Check, ChevronRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { Match, Mode, Prediction, PredictionValue } from "../lib/domain";
import MatchResult from "./MatchResult";
import { MatchRow } from "./ui";
import { LiveEvents } from "./LiveStatus";

export type PredictionLock = "sealed" | "deadline" | "kickoff" | null;

const outcomeLabels = { "1": "Local", X: "Empate", "2": "Visitante" } as const;

function PredictionCard({
  match: m,
  history,
  value,
  mode,
  lock,
  disabled,
  saving,
  demo,
  onChoose,
  onDetails,
}: {
  match: Match;
  history: Match[];
  value?: PredictionValue;
  mode: Mode;
  lock: PredictionLock;
  disabled: boolean;
  saving: boolean;
  demo: boolean;
  onChoose: (match: Match, value: PredictionValue) => void;
  onDetails: (id: string) => void;
}) {
  const locked = lock !== null;
  return (
    <article
      className={`panel prediction-card${locked ? " prediction-locked" : ""}${value ? " prediction-picked" : ""}`}
      aria-label={`${m.home} contra ${m.away}`}
    >
      <MatchRow match={m} history={history} />
      <LiveEvents match={m} />
      <div className="prediction-actions">
        <span className="prediction-state">
          {lock ? (
            <>
              <LockKeyhole size={14} />
              {lock === "sealed"
                ? "Quiniela cerrada"
                : lock === "deadline"
                  ? "Plazo cerrado"
                  : "Partido cerrado"}
            </>
          ) : saving ? (
            <>
              <LoaderCircle size={14} className="spin" />
              Guardando…
            </>
          ) : value ? (
            <>
              <Check size={14} />
              Elegido
            </>
          ) : (
            "Tu pronóstico"
          )}
        </span>
        {mode === "classic" ? (
          <div className="outcomes" role="group" aria-label="Pronóstico 1X2">
            {(["1", "X", "2"] as const).map((v) => (
              <button
                type="button"
                disabled={locked || disabled}
                aria-pressed={value === v}
                aria-label={`${v}: ${v === "1" ? `gana ${m.home}` : v === "2" ? `gana ${m.away}` : "empate"}`}
                className={value === v ? "selected" : ""}
                key={v}
                onClick={() => onChoose(m, v)}
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
            onApply={(next) => onChoose(m, next)}
          />
        )}
      </div>
      <button
        type="button"
        className="prediction-details-link"
        onClick={() => onDetails(m.id)}
      >
        {["TIMED", "SCHEDULED"].includes(m.status)
          ? "Previa y ficha del partido"
          : "Ficha del partido"}
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      {m.status === "FINISHED" && <MatchResult match={m} demo={demo} />}
    </article>
  );
}
export default memo(PredictionCard);

function ExactInput({
  disabled,
  value,
  onApply,
}: {
  disabled: boolean;
  value?: Prediction;
  onApply: (value: Prediction) => void;
}) {
  const [home, setHome] = useState(value?.home ?? 0);
  const [away, setAway] = useState(value?.away ?? 0);
  useEffect(() => {
    setHome(value?.home ?? 0);
    setAway(value?.away ?? 0);
  }, [value]);
  return (
    <form
      className="exact-input"
      onSubmit={(e) => {
        e.preventDefault();
        onApply({ home, away });
      }}
    >
      <input
        aria-label="Goles local"
        type="number"
        inputMode="numeric"
        min="0"
        max="99"
        required
        disabled={disabled}
        value={home}
        onChange={(e) => setHome(Number(e.target.value))}
      />
      <span>—</span>
      <input
        aria-label="Goles visitante"
        type="number"
        inputMode="numeric"
        min="0"
        max="99"
        required
        disabled={disabled}
        value={away}
        onChange={(e) => setAway(Number(e.target.value))}
      />
      <button className="button secondary" disabled={disabled}>
        Aplicar
      </button>
    </form>
  );
}
