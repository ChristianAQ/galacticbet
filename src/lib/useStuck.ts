import { useEffect, useState } from "react";
import { MOBILE_LAYOUT_QUERY } from "./mobileViewport";

/** Height of the app bar when it sticks (mobile layout); zero on desktop. */
function stickyTopOffset() {
  const bar = document.querySelector<HTMLElement>(".topbar");
  return bar && getComputedStyle(bar).position === "sticky"
    ? bar.getBoundingClientRect().height
    : 0;
}

/**
 * Whether a `position: sticky` element is currently pinned. Render the returned
 * callback ref on a sentinel right before it; an IntersectionObserver avoids
 * scroll listeners and works with elements that mount later.
 */
export function useStuck() {
  const [node, sentinel] = useState<HTMLElement | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    setStuck(false);
    if (!node || typeof IntersectionObserver === "undefined") return;
    let observer: IntersectionObserver | undefined;
    const observe = () => {
      observer?.disconnect();
      const offset = Math.ceil(stickyTopOffset()) + 1;
      observer = new IntersectionObserver(
        ([entry]) =>
          setStuck(
            !entry.isIntersecting && entry.boundingClientRect.top < offset,
          ),
        { rootMargin: `-${offset}px 0px 0px 0px`, threshold: 0 },
      );
      observer.observe(node);
    };
    observe();
    const media = window.matchMedia(MOBILE_LAYOUT_QUERY);
    media.addEventListener("change", observe);
    return () => {
      observer?.disconnect();
      media.removeEventListener("change", observe);
    };
  }, [node]);
  return { sentinel, stuck };
}
