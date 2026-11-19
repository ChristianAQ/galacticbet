import { useSyncExternalStore } from "react";

/**
 * The service worker opens the app from its stored copy and downloads the new
 * index.html in the background. When that copy changed it says so, and the app
 * offers a reload instead of waiting for the network on every launch.
 */
const READY = "galacticbet:update-ready";
const RELOADED_AT = "galacticbet:chunk-reload";
let ready = false;

export function watchForUpdates() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "galacticbet:update" || ready) return;
    ready = true;
    window.dispatchEvent(new Event(READY));
  });
  navigator.serviceWorker.startMessages();
  // A page of the version on screen was removed by a deploy: the stored shell
  // is already the new one, so one reload switches over. Never loop.
  window.addEventListener("vite:preloadError", (event) => {
    try {
      const last = Number(sessionStorage.getItem(RELOADED_AT) || 0);
      if (Date.now() - last < 30_000) return;
      sessionStorage.setItem(RELOADED_AT, String(Date.now()));
    } catch {
      return;
    }
    event.preventDefault();
    window.location.reload();
  });
}

const subscribe = (listener: () => void) => {
  window.addEventListener(READY, listener);
  return () => window.removeEventListener(READY, listener);
};

/** True once a newer version is stored and a reload would show it. */
export function useUpdateReady() {
  return useSyncExternalStore(subscribe, () => ready);
}
