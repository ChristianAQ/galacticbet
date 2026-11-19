import { useEffect, useRef, useState } from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/* ---------- Haptics ---------- */

type HapticKind = "selection" | "light" | "medium" | "success" | "warning";
const vibration: Record<HapticKind, number | number[]> = {
  selection: 6,
  light: 10,
  medium: 18,
  success: [10, 60, 14],
  warning: [16, 80, 16],
};
let switchLabel: HTMLLabelElement | null = null;
function tickSwitch() {
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
/**
 * Haptic feedback. Android and other browsers use the Vibration API; Safari on
 * iOS 18+ has none, but toggling a native `switch` input fires the system tick,
 * so success/warning become a double tick. Silent with reduced motion.
 */
export function haptic(kind: HapticKind = "selection") {
  if (typeof document === "undefined" || prefersReducedMotion()) return;
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(vibration[kind]);
    return;
  }
  if (!/iP(hone|ad|od)/.test(navigator.userAgent)) return;
  tickSwitch();
  if (kind === "success" || kind === "warning")
    window.setTimeout(tickSwitch, kind === "success" ? 90 : 120);
}

/* ---------- Springs ---------- */

export interface SpringOptions {
  /** Seconds for one undamped oscillation (SwiftUI's `response`). */
  response?: number;
  /** 1 = no overshoot, lower = bouncier. */
  damping?: number;
  /** Initial velocity in "whole distances per second" (gesture release). */
  velocity?: number;
}

function springAt(t: number, w0: number, zeta: number, v0: number) {
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return (
      1 +
      Math.exp(-zeta * w0 * t) *
        (-Math.cos(wd * t) + ((v0 - zeta * w0) / wd) * Math.sin(wd * t))
    );
  }
  return 1 + Math.exp(-w0 * t) * (-1 + (v0 - w0) * t);
}

const springCache = new Map<string, { easing: string; duration: number }>();
/** Samples a damped spring into a CSS `linear()` easing plus its settle time. */
export function springEasing({
  response = 0.42,
  damping = 1,
  velocity = 0,
}: SpringOptions = {}) {
  const v = Math.round(velocity * 4) / 4;
  const key = `${response}|${damping}|${v}`;
  const hit = springCache.get(key);
  if (hit) return hit;
  const w0 = (2 * Math.PI) / response;
  let settle = 2;
  for (let t = 0; t < 2; t += 0.004) {
    let still = true;
    for (let s = t; s < t + 0.3; s += 0.02)
      if (Math.abs(1 - springAt(s, w0, damping, v)) > 0.002) {
        still = false;
        break;
      }
    if (still) {
      settle = t;
      break;
    }
  }
  const steps = 48;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const value = i === steps ? 1 : springAt((settle * i) / steps, w0, damping, v);
    points.push(`${value.toFixed(4)} ${((i / steps) * 100).toFixed(2)}%`);
  }
  const result = {
    easing: `linear(${points.join(", ")})`,
    duration: Math.max(120, Math.round(settle * 1000)),
  };
  springCache.set(key, result);
  return result;
}

const running = new WeakMap<HTMLElement, Animation>();
/**
 * Animates transform/opacity keyframes with spring physics through WAAPI, so it
 * runs on the compositor. The final keyframe is committed as inline style. A new
 * spring on the same element takes over from wherever the previous one was.
 * Resolves `true` when it completes, `false` when something interrupted it.
 */
export function springTo(
  element: HTMLElement,
  keyframes: Keyframe[],
  options: SpringOptions = {},
): Promise<boolean> {
  const final = keyframes[keyframes.length - 1];
  const previous = running.get(element);
  if (previous) {
    try {
      previous.commitStyles();
    } catch {
      /* Element not rendered: nothing to keep. */
    }
    previous.cancel();
    running.delete(element);
  }
  if (prefersReducedMotion() || typeof element.animate !== "function") {
    Object.assign(element.style, final);
    return Promise.resolve(true);
  }
  const { easing, duration } = springEasing(options);
  const animation = element.animate(keyframes, {
    duration,
    easing,
    fill: "forwards",
  });
  running.set(element, animation);
  return animation.finished
    .then(() => {
      Object.assign(element.style, final);
      animation.cancel();
      if (running.get(element) === animation) running.delete(element);
      return true;
    })
    // Interrupted by a newer gesture: the newer animation wins.
    .catch(() => false);
}

/** Rubber-band resistance used past the edges, like UIScrollView. */
export function rubberBand(distance: number, dimension: number, c = 0.55) {
  const sign = Math.sign(distance);
  const d = Math.abs(distance);
  return (sign * (d * dimension * c)) / (dimension + c * d);
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
