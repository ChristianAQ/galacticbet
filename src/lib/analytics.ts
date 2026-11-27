import type { Analytics } from "firebase/analytics";
import { firebaseApp } from "./firebase";

/**
 * Usage statistics (Firebase / Google Analytics), only with consent: until
 * someone says yes, the library is not even downloaded and nothing is sent
 * or stored. Only in the published app (never in development) and only when
 * the build has the project's measurement id. Screens are reported by
 * route («/partido/:id»), never with picks, names or group data.
 */
const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim() || "";
export const analyticsAvailable = Boolean(measurementId && firebaseApp && import.meta.env.PROD);

const KEY = "galacticbet:analytics-consent";
export type Consent = "granted" | "denied";
export const CONSENT_CHANGED = "galacticbet:analytics-consent";

export function readConsent(): Consent | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

let analytics: Analytics | null = null;
let starting: Promise<Analytics | null> | null = null;
let lastScreen = "";

function start() {
  if (!analyticsAvailable || readConsent() !== "granted") return Promise.resolve(null);
  starting ??= import("firebase/analytics")
    .then(async ({ initializeAnalytics, isSupported }) => {
      if (!(await isSupported())) return null;
      // Screens are sent by hand (hash routes): no automatic first page view.
      analytics = initializeAnalytics(firebaseApp!, { config: { send_page_view: false } });
      return analytics;
    })
    .catch(() => null);
  return starting;
}

export function setConsent(consent: Consent) {
  try {
    localStorage.setItem(KEY, consent);
  } catch {
    /* Without storage the question comes back next time: nothing is measured meanwhile. */
  }
  window.dispatchEvent(new Event(CONSENT_CHANGED));
  if (consent === "granted") {
    void start().then(() => lastScreen && screen(lastScreen, true));
    return;
  }
  // Withdrawn: stop sending now; the next launch does not load it at all.
  if (analytics)
    void import("firebase/analytics").then(({ setAnalyticsCollectionEnabled }) => {
      if (analytics) setAnalyticsCollectionEnabled(analytics, false);
      analytics = null;
      starting = null;
    });
}

/** A route as a screen: ids replaced, so «/partido/abc» and «/partido/xyz» are one screen. */
export function screenName(pathname: string) {
  return (
    pathname
      .replace(/^\/partido\/[^/]+/, "/partido/:id")
      .replace(/^\/competicion\/[^/]+\/partido\/[^/]+/, "/competicion/:id/partido/:id")
      .replace(/^\/competicion\/[^/]+/, "/competicion/:id") || "/"
  );
}

/** One screen view per route change (and the first one once consent is given). */
export function screen(pathname: string, force = false) {
  const name = screenName(pathname);
  if (name === lastScreen && !force) return;
  lastScreen = name;
  void start().then((a) =>
    a
      ? import("firebase/analytics").then(({ logEvent }) =>
          logEvent(a, "page_view", {
            page_title: document.title,
            page_location: `${location.origin}${location.pathname}#${name}`,
            page_path: name,
          }),
        )
      : undefined,
  );
}

/** A meaningful action («sellar_quiniela», «compartir»…), with small, non-personal details. */
export function track(event: string, params: Record<string, string | number> = {}) {
  void start().then((a) =>
    a ? import("firebase/analytics").then(({ logEvent }) => logEvent(a, event, params)) : undefined,
  );
}
