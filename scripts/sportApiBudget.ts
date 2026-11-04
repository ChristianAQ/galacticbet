import type { Firestore } from "firebase-admin/firestore";

export const SPORTAPI_WINDOW_MS = 24 * 60 * 60_000;
export const SPORTAPI_REQUEST_LIMIT = 1800;
export const SPORTAPI_MONTH_LIMIT = 12000;
export const SPORTAPI_RUN_LIMIT = 40;
interface Reservation {
  id: string;
  at: number;
  count: number;
}
export interface SportApiLedger {
  version: 1;
  reservations: Reservation[];
  month?: string;
  monthUsed?: number;
}

function parseLedger(value: unknown): SportApiLedger {
  if (value === undefined) return { version: 1, reservations: [] };
  if (!value || typeof value !== "object")
    throw new Error("SportAPI: contador inválido; consultas bloqueadas.");
  const ledger = value as SportApiLedger;
  if (
    ledger.version !== 1 ||
    (ledger.month !== undefined && !/^\d{4}-\d{2}$/.test(ledger.month)) ||
    (ledger.monthUsed !== undefined &&
      (!Number.isSafeInteger(ledger.monthUsed) || ledger.monthUsed < 0)) ||
    (ledger.month === undefined) !== (ledger.monthUsed === undefined) ||
    !Array.isArray(ledger.reservations) ||
    ledger.reservations.length > SPORTAPI_REQUEST_LIMIT ||
    ledger.reservations.some(
      (r) =>
        !r ||
        typeof r.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,160}$/.test(r.id) ||
        !Number.isSafeInteger(r.at) ||
        r.at < 0 ||
        !Number.isInteger(r.count) ||
        r.count < 1 ||
        r.count > SPORTAPI_RUN_LIMIT,
    ) ||
    new Set(ledger.reservations.map((r) => r.id)).size !==
      ledger.reservations.length
  )
    throw new Error("SportAPI: contador inválido; consultas bloqueadas.");
  return ledger;
}

/** Reserve before sending any requests. Unused capacity is deliberately never refunded. */
export function allocateSportApiRequests(
  value: unknown,
  runId: string,
  requested: number,
  now: number,
): { ledger: SportApiLedger; granted: number } {
  if (
    !/^[a-zA-Z0-9_-]{1,160}$/.test(runId) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isInteger(requested) ||
    requested < 1 ||
    requested > SPORTAPI_RUN_LIMIT
  )
    throw new Error("SportAPI: reserva inválida.");
  const old = parseLedger(value);
  const month = new Date(now).toISOString().slice(0, 7);
  if (old.month && old.month > month)
    throw new Error(
      "SportAPI: reloj anterior al contador mensual; consultas bloqueadas.",
    );
  const monthUsed = old.month === month ? old.monthUsed! : 0;
  const reservations = old.reservations.filter(
    (r) => r.at >= now - SPORTAPI_WINDOW_MS,
  );
  // A repeated job must not spend the same reservation again, even after a crash.
  if (reservations.some((r) => r.id === runId))
    return {
      ledger: { version: 1, reservations, month, monthUsed },
      granted: 0,
    };
  const used = reservations.reduce((total, r) => total + r.count, 0);
  const granted = Math.max(
    0,
    Math.min(
      requested,
      SPORTAPI_REQUEST_LIMIT - used,
      SPORTAPI_MONTH_LIMIT - monthUsed,
    ),
  );
  if (granted) reservations.push({ id: runId, at: now, count: granted });
  return {
    ledger: { version: 1, reservations, month, monthUsed: monthUsed + granted },
    granted,
  };
}

/** One transaction per job reserves the whole block: no Firestore operation per HTTP call. */
export async function reserveSportApiRequests(
  db: Firestore,
  runId: string,
  requested = SPORTAPI_RUN_LIMIT,
  clock = Date.now,
): Promise<number> {
  const ref = db.doc("providerBudgets/sportapi");
  return db.runTransaction(async (tx) => {
    const previous = (await tx.get(ref)).data();
    const allocation = allocateSportApiRequests(
      previous,
      runId,
      requested,
      clock(),
    );
    if (allocation.granted) tx.set(ref, allocation.ledger);
    return allocation.granted;
  });
}

/** Consume a slot before each attempt, including failures and explicit retries. */
export function sportApiRequestGate(reserved: number) {
  if (
    !Number.isInteger(reserved) ||
    reserved < 0 ||
    reserved > SPORTAPI_RUN_LIMIT
  )
    throw new Error("SportAPI: presupuesto inválido.");
  let remaining = reserved;
  let stopped = false;
  return {
    get remaining() {
      return remaining;
    },
    stop() {
      stopped = true;
    },
    async run<T>(request: () => Promise<T>): Promise<T> {
      if (stopped || remaining <= 0)
        throw new Error("SportAPI: consultas detenidas o presupuesto agotado.");
      remaining--;
      return request();
    },
  };
}
