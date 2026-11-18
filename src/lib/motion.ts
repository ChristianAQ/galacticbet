import { useEffect, useRef, useState } from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Light haptic tick. Safari on iOS 18+ fires the system haptic when a native
 * switch toggles, even off-screen; Android uses the vibration API. Elsewhere,
 * and with reduced motion, it does nothing.
 */
let switchLabel: HTMLLabelElement | null = null;
export function haptic() {
  if (typeof document === "undefined" || prefersReducedMotion()) return;
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(8);
    return;
  }
  if (!/iP(hone|ad|od)/.test(navigator.userAgent)) return;
  if (!switchLabel) {
    switchLabel = document.createElement("label");
    switchLabel.ariaHidden = "true";
    switchLabel.style.cssText =
      "position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9px;top:-9px";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    switchLabel.append(input);
    document.body.append(switchLabel);
  }
  switchLabel.click();
}

/** Eases a number towards its target (money counters). Instant with reduced motion. */
export function useCountUp(target: number, startAt = target, duration = 650) {
  const [value, setValue] = useState(() =>
    prefersReducedMotion() ? target : startAt,
  );
  const from = useRef(prefersReducedMotion() ? target : startAt);
  useEffect(() => {
    const start = from.current;
    if (start === target || prefersReducedMotion()) {
      from.current = target;
      setValue(target);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(start + (target - start) * eased);
      from.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}
