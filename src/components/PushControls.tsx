import { Bell, BellRing, Share, X } from "lucide-react";
import { useState } from "react";
import { disablePush, enablePush, usePushState, type PushState } from "../lib/push";
import { haptic } from "../lib/motion";
import { readableError } from "./ui";
import "../styles/push.css";

const details: Record<PushState, string> = {
  loading: "Comprobando…",
  unsupported: "Este navegador no puede recibir avisos.",
  install: "Añade GalacticBet a la pantalla de inicio para activarlos.",
  denied: "Bloqueados. Actívalos en Ajustes › Notificaciones › GalacticBet.",
  off: "Antes del cierre si no has sellado, y tu puesto al acabar la jornada que selles.",
  on: "Antes del cierre si no has sellado, y tu puesto al acabar la jornada que selles.",
};

function usePushToggle(uid: string) {
  const state = usePushState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle(on: boolean) {
    setBusy(true);
    setError("");
    try {
      if (on) await enablePush(uid);
      else await disablePush(uid);
      haptic("success");
    } catch (e) {
      setError(
        (e as { code?: string })?.code === "offline"
          ? "Necesitas conexión para cambiar los avisos."
          : readableError(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return { state, busy, error, toggle };
}

/** Perfil › Ajustes: avisos on this device. */
export function PushRow({ uid }: { uid: string }) {
  const { state, busy, error, toggle } = usePushToggle(uid);
  const on = state === "on";
  return (
    <>
      <div className="more-row push-row">
        <span className="more-icon">
          <Bell size={20} aria-hidden="true" />
        </span>
        <span className="more-label" id="push-label">
          Avisos
          <small>{details[state]}</small>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={on}
          aria-labelledby="push-label"
          disabled={busy || !["on", "off"].includes(state)}
          onClick={() => void toggle(!on)}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p className="push-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const DISMISSED = "galacticbet:push-prompt";
const dismissedAt = (kind: string) => {
  try {
    return localStorage.getItem(`${DISMISSED}:${kind}`) !== null;
  } catch {
    return false;
  }
};

/**
 * Inicio: invites to turn avisos on (or, in iPhone Safari, to add the app to the
 * Home Screen first, the only way iOS delivers them). Dismissed for good.
 */
export function PushPrompt({ uid }: { uid: string }) {
  const { state, busy, error, toggle } = usePushToggle(uid);
  const kind = state === "install" ? "install" : "enable";
  const [hidden, setHidden] = useState(() => dismissedAt(kind));
  if (hidden || !["off", "install"].includes(state)) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(`${DISMISSED}:${kind}`, String(Date.now()));
    } catch {
      /* Hidden for this visit only. */
    }
    setHidden(true);
  };
  return (
    <section className="push-prompt" aria-labelledby="push-prompt-title">
      <span className="push-prompt-icon" aria-hidden="true">
        <BellRing size={22} />
      </span>
      <div className="push-prompt-text">
        <h2 id="push-prompt-title">Que no se te pase la jornada</h2>
        {state === "install" ? (
          <p>
            Añade GalacticBet a tu pantalla de inicio (
            <Share size={14} aria-label="Compartir" /> › Añadir a pantalla de
            inicio) y te avisaremos antes del cierre y con tu puesto al acabar
            la jornada.
          </p>
        ) : (
          <p>
            Te avisamos antes del cierre si no has sellado y, al acabar cada
            jornada que selles, en qué puesto has quedado en tu grupo.
          </p>
        )}
        {error && <p className="push-error" role="alert">{error}</p>}
        {state === "off" && (
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void toggle(true)}
          >
            <Bell size={17} aria-hidden="true" />
            {busy ? "Activando…" : "Activar avisos"}
          </button>
        )}
      </div>
      <button
        type="button"
        className="push-prompt-close icon-button"
        aria-label="Ahora no"
        onClick={dismiss}
      >
        <X size={18} />
      </button>
    </section>
  );
}
