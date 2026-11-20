import type { Firestore } from "firebase-admin/firestore";
import webpush from "web-push";

/** Public half of the keys, read by the app to subscribe. */
export const PUSH_PUBLIC_DOC = "config/push";
/** No client rule matches it: only this backend (admin SDK) can read it. */
const PUSH_PRIVATE_DOC = "private/push";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}
export interface PushMessage {
  title: string;
  body: string;
  /** Relative to the app, e.g. "./#/quiniela?round=…". */
  url: string;
  /** Same tag: the newer notification replaces the older one. */
  tag: string;
}
type Subscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
export type PushSend = (
  subscription: Subscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;

const validKeys = (value: unknown): value is VapidKeys =>
  Boolean(value) &&
  typeof (value as VapidKeys).publicKey === "string" &&
  typeof (value as VapidKeys).privateKey === "string" &&
  (value as VapidKeys).publicKey.length > 40 &&
  (value as VapidKeys).privateKey.length > 20;

/**
 * The signing keys are created once, by the backend, and kept in Firestore:
 * no repository secret to set up. Rotating them would orphan every device, so
 * a damaged document stops the run instead of silently replacing it.
 */
export async function ensureVapidKeys(db: Firestore): Promise<VapidKeys> {
  const ref = db.doc(PUSH_PRIVATE_DOC);
  const stored = await ref.get();
  let keys: VapidKeys;
  if (!stored.exists) {
    const fresh = webpush.generateVAPIDKeys();
    try {
      await ref.create({ ...fresh, createdAt: Date.now() });
      keys = fresh;
    } catch {
      // Another job created them a moment ago.
      const again = (await ref.get()).data();
      if (!validKeys(again)) throw new Error("Claves de avisos no válidas.");
      keys = again;
    }
  } else {
    const data = stored.data();
    if (!validKeys(data))
      throw new Error(
        "El documento private/push no tiene claves válidas; revísalo en Firestore.",
      );
    keys = data;
  }
  const published = db.doc(PUSH_PUBLIC_DOC);
  if ((await published.get()).data()?.publicKey !== keys.publicKey)
    await published.set({ publicKey: keys.publicKey, formatVersion: 1 });
  return { publicKey: keys.publicKey, privateKey: keys.privateKey };
}

/** Browser push services only: the backend never posts anywhere else. */
export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com"].includes(
        url.hostname,
      ) ||
        url.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}

const contact = () =>
  process.env.GITHUB_REPOSITORY
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
    : "https://github.com";

/**
 * Sends one notification to every device of a player. Devices the push service
 * no longer knows (404/410) are forgotten. Returns how many accepted it.
 */
export async function sendToUser(
  db: Firestore,
  uid: string,
  message: PushMessage,
  keys: VapidKeys,
  send: PushSend = webpush.sendNotification,
) {
  const devices = await db.collection(`users/${uid}/push`).get();
  let delivered = 0;
  for (const device of devices.docs) {
    const { endpoint, p256dh, auth } = device.data();
    if (
      !validPushEndpoint(endpoint) ||
      typeof p256dh !== "string" ||
      typeof auth !== "string"
    ) {
      await device.ref.delete();
      continue;
    }
    try {
      await send({ endpoint, keys: { p256dh, auth } }, JSON.stringify(message), {
        vapidDetails: {
          subject: contact(),
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
        TTL: 6 * 3600,
        urgency: "high",
        topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32),
        timeout: 10_000,
      });
      delivered++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await device.ref.delete();
      else
        console.warn(
          `Avisos: el servicio de notificaciones respondió ${status ?? "sin respuesta"}.`,
        );
    }
  }
  return delivered;
}
