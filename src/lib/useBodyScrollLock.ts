import { useEffect } from "react";

let locks = 0;
let saved: { scrollY: number; styles: Partial<CSSStyleDeclaration> } | null = null;

/**
 * Fixes the page in place (fixed positioning also stops background scrolling
 * in standalone iOS Safari) and returns the release. Reference-counted, so a
 * sheet opened from another sheet keeps the position. `restore: false` lets
 * go without scrolling back: the page is being left and the next one sets
 * its own scroll.
 */
export function lockBody(): (options?: { restore?: boolean }) => void {
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
  let released = false;
  return ({ restore = true } = {}) => {
    if (released) return;
    released = true;
    if (--locks > 0 || !saved) return;
    Object.assign(body.style, saved.styles);
    if (restore) window.scrollTo(0, saved.scrollY);
    saved = null;
  };
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    return lockBody();
  }, [locked]);
}
