export const MOBILE_LAYOUT_QUERY =
  "(max-width: 760px), (max-width: 1000px) and (max-height: 600px) and (hover: none) and (pointer: coarse)";

/** Safari gesture events complement touch-action for the installed iPhone app. */
export function configureMobileViewport() {
  const preventGesture = (event: Event) => event.preventDefault();
  const preventPinch = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault();
  };
  document.addEventListener("gesturestart", preventGesture, { passive: false });
  document.addEventListener("gesturechange", preventGesture, {
    passive: false,
  });
  document.addEventListener("touchmove", preventPinch, { passive: false });
  // iOS only applies :active styles when the page listens to touches.
  const activate = () => {};
  document.addEventListener("touchstart", activate, { passive: true });
  return () => {
    document.removeEventListener("touchstart", activate);
    document.removeEventListener("gesturestart", preventGesture);
    document.removeEventListener("gesturechange", preventGesture);
    document.removeEventListener("touchmove", preventPinch);
  };
}
