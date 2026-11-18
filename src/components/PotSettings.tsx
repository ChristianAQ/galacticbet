import { Coins } from "lucide-react";
import { useId } from "react";
import { euro } from "../lib/porra";
import {
  POT_PRESETS,
  euroShort,
  parsePotInput,
  potInputValue,
} from "../lib/pot";
import { haptic } from "../lib/motion";
import "../styles/pot.css";

/** Contribution picker: quick presets plus a free amount. Value in euros text. */
export function PotField({
  value,
  onChange,
  disabled,
  members,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  members?: number;
}) {
  const id = useId();
  const cents = parsePotInput(value);
  return (
    <>
      <div
        className="pot-presets"
        role="group"
        aria-label="Aportaciones rápidas"
      >
        <button
          type="button"
          aria-pressed={cents === 0}
          disabled={disabled}
          onClick={() => {
            haptic();
            onChange("");
          }}
        >
          Sin bote
        </button>
        {POT_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={cents === preset}
            disabled={disabled}
            onClick={() => {
              haptic();
              onChange(potInputValue(preset));
            }}
          >
            {euroShort(preset)}
          </button>
        ))}
      </div>
      <label htmlFor={id}>
        Aportación por jugador y jornada
        <span className="pot-input">
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="0"
            value={value}
            disabled={disabled}
            aria-invalid={cents === null}
            onChange={(e) => onChange(e.target.value)}
          />
          <span aria-hidden="true">€</span>
        </span>
      </label>
      {cents === null ? (
        <p className="error" role="alert">
          Escribe un importe entre 0 y 1.000 €, con hasta dos decimales.
        </p>
      ) : cents > 0 && members ? (
        <p className="pot-preview">
          Con {members} {members === 1 ? "jugador" : "jugadores"}, el bote
          sería de <strong>{euro(cents * members)}</strong> por jornada.
        </p>
      ) : null}
    </>
  );
}

export function PotIntro() {
  return (
    <p className="muted pot-intro">
      <Coins size={14} aria-hidden="true" />
      <span>
        Bote informativo: la app suma
      quién entrega cada jornada y quién gana. No gestiona dinero ni cobra
      comisión.
      </span>
    </p>
  );
}
