import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useSyncExternalStore } from "react";
import { db } from "./firebase";
import { fromServer } from "./firestoreOnline";

/**
 * Avisos on this device:
 * - unsupported: this browser cannot receive them.
 * - install: iPhone/iPad Safari; only the app added to the Home Screen can.
 * - denied: blocked in the system settings.
 * - off / on: this device is (not) subscribed.
 */
export type PushState = "loading" | "unsupported" | "install" | "denied" | "off" | "on";

const SYNCED_AT = "galacticbet:push-synced";

const capable = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;
const installed = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const appleMobile = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** The service worker, if one controls the app (production builds only). */
async function worker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
}

async function deviceId(endpoint: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(endpoint),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function keyBytes(base64url: string) {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function sameKey(current: ArrayBuffer | null | undefined, publicKey: string) {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

// The public key is fetched ahead of the tap: iOS only honours a permission
// prompt (and subscription) that follows the gesture without network waits.
let publicKey: string | null = null;
async function loadPublicKey() {
  if (publicKey || !db) return publicKey;
  const data = fromServer(await getDoc(doc(db, "config/push"))).data();
  if (typeof data?.publicKey === "string") publicKey = data.publicKey;
  return publicKey;
}

// ---------- One shared state for every screen that shows it ----------

let state: PushState = "loading";
const listeners = new Set<() => void>();
function publish(next: PushState) {
  state = next;
  for (const listener of listeners) listener();
}
export async function refreshPushState() {
  if (!capable()) return publish(appleMobile() && !installed() ? "install" : "unsupported");
  if (Notification.permission === "denied") return publish("denied");
  const registration = await worker();
  if (!registration) return publish("unsupported");
  const subscription = await registration.pushManager.getSubscription();
  const next = subscription && Notification.permission === "granted" ? "on" : "off";
  if (next === "off") void loadPublicKey().catch(() => null);
  publish(next);
}
let started = false;
export function usePushState() {
  if (!started) {
    started = true;
    void refreshPushState();
  }
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

async function saveDevice(uid: string, subscription: PushSubscription) {
  if (!db) throw new Error("Firebase no está configurado.");
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) throw new Error("El navegador no dio una suscripción válida.");
  await setDoc(doc(db, "users", uid, "push", await deviceId(subscription.endpoint)), {
    endpoint: subscription.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    createdAt: serverTimestamp(),
  });
  try {
    localStorage.setItem(SYNCED_AT, `${uid}:${Date.now()}`);
  } catch {
    /* Only throttles the daily re-sync. */
  }
}

/** Must run from a tap: iOS only shows the permission prompt for a gesture. */
export async function enablePush(uid: string) {
  if (!db) throw new Error("Firebase no está configurado.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    publish(permission === "denied" ? "denied" : "off");
    return;
  }
  const key = publicKey ?? (await loadPublicKey());
  if (!key)
    throw new Error("Los avisos se están preparando. Vuelve a intentarlo en unos minutos.");
  const registration = await worker();
  if (!registration) throw new Error("Este navegador no puede recibir avisos.");
  let subscription = await registration.pushManager.getSubscription();
  // Subscribed with other keys: it would never receive ours.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(key),
  });
  await saveDevice(uid, subscription);
  publish("on");
}

/** Turns avisos off on this device (also on sign-out). */
export async function disablePush(uid: string) {
  const registration = capable() ? await worker() : null;
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    if (db && uid)
      await deleteDoc(doc(db, "users", uid, "push", await deviceId(subscription.endpoint))).catch(
        () => {},
      );
    await subscription.unsubscribe().catch(() => false);
  }
  try {
    localStorage.removeItem(SYNCED_AT);
  } catch {
    /* Nothing stored. */
  }
  if (capable()) await refreshPushState();
}

/**
 * Once a day, re-save this device: the backend forgets devices the push service
 * rejected, and browsers sometimes renew the subscription by themselves.
 */
export async function keepPushDevice(uid: string) {
  if (!uid || !capable() || Notification.permission !== "granted") return;
  try {
    const [who, at] = (localStorage.getItem(SYNCED_AT) || "").split(":");
    if (who === uid && Date.now() - Number(at) < 86_400_000) return;
  } catch {
    /* Re-save anyway. */
  }
  const registration = await worker();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await saveDevice(uid, subscription).catch(() => {});
}
