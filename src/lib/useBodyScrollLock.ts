import { useEffect } from "react";

let locks = 0;
let saved: { scrollY: number; styles: Partial<CSSStyleDeclaration> } | null = null;

/**
 * Fixed positioning also prevents background scrolling in standalone iOS Safari.
 * Reference-counted, so a sheet opened from another sheet keeps the position.
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const body = document.body;
    if (locks++ === 0) {
      const scrollY = window.scrollY;
      saved = {
        scrollY,
        styles: {
          position: body.style.position,
          top: body.style.top,
          left: body.style.left,
          right: body.style.right,
          width: body.style.width,
          overflow: body.style.overflow,
        },
      };
      Object.assign(body.style, {
        position: "fixed",
        top: `-${scrollY}px`,
        left: "0",
        right: "0",
        width: "100%",
        overflow: "hidden",
      });
    }
    return () => {
      if (--locks > 0 || !saved) return;
      Object.assign(body.style, saved.styles);
      window.scrollTo(0, saved.scrollY);
      saved = null;
    };
  }, [locked]);
}
