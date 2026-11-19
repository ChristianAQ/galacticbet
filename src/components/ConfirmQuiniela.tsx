import { ShieldCheck } from "lucide-react";
import {
  predictionSummary,
  type Match,
  type PredictionValue,
} from "../lib/domain";
import Modal from "./Modal";

/** Last look at the slip before sealing it: once saved, the round is closed. */
export default function ConfirmQuiniela({
  matches,
  values,
  busy,
  demo,
  error,
  onCancel,
  onConfirm,
}: {
  matches: Match[];
  values: Record<string, PredictionValue>;
  busy: boolean;
  demo: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const picked = matches.filter((m) => values[m.id]);
  const omitted = matches.length - picked.length;
  return (
    <Modal
      title="¿Sellamos tu boleto?"
      role="alertdialog"
      describedBy="confirm-quiniela-description"
      busy={busy}
      onClose={onCancel}
      detents={["medium", "large"]}
      className="confirm-quiniela"
      initialFocus="[data-cancel]"
      footer={
        <div className="confirm-buttons">
          <button
            className="button secondary"
            data-cancel
            disabled={busy}
            onClick={onCancel}
          >
            Seguir editando
          </button>
          <button className="button primary" disabled={busy} onClick={onConfirm}>
            {busy ? "Sellando…" : "Sí, sellar quiniela"}
          </button>
        </div>
      }
    >
      <p id="confirm-quiniela-description" className="confirm-lede">
        Una vez sellada,{" "}
        <strong>no podrás cambiar ningún pronóstico de esta jornada</strong>,
        aunque los partidos aún no hayan empezado.
      </p>
      <ol className="confirmation-summary">
        {picked.map((m, i) => (
          <li key={m.id}>
            <span className="confirmation-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="confirmation-teams">
              {m.home}
              <small>{m.away}</small>
            </span>
            <strong>{predictionSummary(values[m.id])}</strong>
          </li>
        ))}
      </ol>
      {omitted > 0 && (
        <p className="confirmation-note">
          {omitted}{" "}
          {omitted === 1
            ? "partido sin pronóstico quedará"
            : "partidos sin pronóstico quedarán"}{" "}
          en blanco. Los encuentros cerrados o no disponibles no se pueden
          completar.
        </p>
      )}
      <p className="confirmation-privacy">
        <ShieldCheck size={16} aria-hidden="true" />
        Solo verás los pronósticos de quienes también hayan sellado esta
        jornada, y solo ellos verán los tuyos.
      </p>
      {demo && (
        <p className="setup-notice">
          Modo demo: el sello solo dura lo que dure esta sesión de prueba.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
