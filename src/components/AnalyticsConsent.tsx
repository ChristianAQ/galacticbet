import { BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";
import { analyticsAvailable, CONSENT_CHANGED, readConsent, setConsent } from "../lib/analytics";

/** The stored choice, kept in step with any other place that changes it. */
function useConsent() {
  const [consent, setState] = useState(readConsent);
  useEffect(() => {
    const sync = () => setState(readConsent());
    window.addEventListener(CONSENT_CHANGED, sync);
    return () => window.removeEventListener(CONSENT_CHANGED, sync);
  }, []);
  return consent;
}

/**
 * Asked once, a few seconds after opening the app, and never in the way of
 * a more urgent notice: may GalacticBet measure how it is used? Nothing is
 * measured (or stored by Google) until the answer is yes.
 */
export function ConsentPrompt({ hidden }: { hidden: boolean }) {
  const consent = useConsent();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 4000);
    return () => window.clearTimeout(timer);
  }, []);
  if (!analyticsAvailable || consent !== null || !ready || hidden) return null;
  return (
    <div className="toast is-update is-consent" role="dialog" aria-label="Estadísticas de uso">
      <p>
        ¿Nos dejas medir qué pantallas se usan para mejorar la app? Usa Google Analytics, con cookies; nunca tus
        quinielas ni tus grupos.
      </p>
      <button type="button" className="toast-action" onClick={() => setConsent("granted")}>
        Vale
      </button>
      <button type="button" className="toast-secondary" onClick={() => setConsent("denied")}>
        No
      </button>
    </div>
  );
}

/** Perfil › Ajustes: the same choice, to change it at any time. */
export function ConsentRow() {
  const consent = useConsent();
  if (!analyticsAvailable) return null;
  const on = consent === "granted";
  return (
    <div className="more-row push-row">
      <span className="more-icon">
        <BarChart3 size={20} aria-hidden="true" />
      </span>
      <span className="more-label" id="consent-label">
        Estadísticas de uso
        <small>{on ? "Ayudas a mejorar la app (Google Analytics)" : "No se mide nada"}</small>
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={on}
        aria-labelledby="consent-label"
        onClick={() => setConsent(on ? "denied" : "granted")}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
