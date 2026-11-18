import { useEffect, useRef, type RefObject } from "react";
import { MOBILE_LAYOUT_QUERY } from "./mobileViewport";
import { prefersReducedMotion } from "./motion";

const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.55; // px per ms

/**
 * iOS-style sheet: on phones, dragging down from the top of the content follows
 * the finger and dismisses past a distance or with a quick flick. Touch events
 * (not pointer events) so the gesture can claim the scroll at the very top.
 */
export function useSheetGesture(
  panel: RefObject<HTMLElement | null>,
  backdrop: RefObject<HTMLElement | null>,
  { enabled, onDismiss }: { enabled: boolean; onDismiss: () => void },
) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const sheet = panel.current;
    if (!sheet || !enabled) return;
    const phone = window.matchMedia(MOBILE_LAYOUT_QUERY);
    let startY = 0;
    let startTime = 0;
    let lastY = 0;
    let lastTime = 0;
    let dragging = false;
    let tracking = false;
    const reset = (animate: boolean) => {
      sheet.style.transition = animate
        ? "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)"
        : "";
      sheet.style.transform = "";
      if (backdrop.current) backdrop.current.style.opacity = "";
    };
    const start = (event: TouchEvent) => {
      if (!phone.matches || event.touches.length !== 1) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [data-no-sheet-drag]"))
        return;
      tracking = sheet.scrollTop <= 0;
      dragging = false;
      startY = lastY = event.touches[0].clientY;
      startTime = lastTime = event.timeStamp;
    };
    const move = (event: TouchEvent) => {
      if (!tracking) return;
      const y = event.touches[0].clientY;
      const dy = y - startY;
      if (!dragging) {
        if (dy <= 4 || sheet.scrollTop > 0) {
          if (dy < -4) tracking = false; // user is scrolling the content up
          return;
        }
        dragging = true;
        sheet.style.transition = "none";
        sheet.style.animation = "none";
      }
      event.preventDefault();
      // Slight resistance, like UIKit sheets.
      const offset = Math.max(0, dy * 0.92);
      sheet.style.transform = `translateY(${offset}px)`;
      if (backdrop.current)
        backdrop.current.style.opacity = String(
          Math.max(0.35, 1 - offset / (sheet.offsetHeight || 600)),
        );
      lastY = y;
      lastTime = event.timeStamp;
    };
    const end = (event: TouchEvent) => {
      if (!dragging) {
        tracking = false;
        return;
      }
      dragging = tracking = false;
      const distance = lastY - startY;
      const elapsed = Math.max(1, event.timeStamp - startTime);
      const recent = Math.max(1, event.timeStamp - lastTime);
      const velocity = recent < 80 ? distance / elapsed : 0;
      if (distance > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
        if (prefersReducedMotion()) {
          dismiss.current();
          return;
        }
        sheet.style.transition =
          "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)";
        sheet.style.transform = "translateY(105%)";
        if (backdrop.current) {
          backdrop.current.style.transition = "opacity 220ms ease";
          backdrop.current.style.opacity = "0";
        }
        window.setTimeout(() => dismiss.current(), 200);
      } else reset(true);
    };
    sheet.addEventListener("touchstart", start, { passive: true });
    sheet.addEventListener("touchmove", move, { passive: false });
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
    return () => {
      sheet.removeEventListener("touchstart", start);
      sheet.removeEventListener("touchmove", move);
      sheet.removeEventListener("touchend", end);
      sheet.removeEventListener("touchcancel", end);
    };
  }, [enabled]);
}
