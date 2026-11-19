import type { User } from "firebase/auth";
import { snapshots } from "./localSnapshot";

/** What the screens read from the signed-in account. */
export type AppUser = Pick<User, "uid" | "displayName" | "photoURL" | "email">;

const SESSION_KEY = "session";
/** Firebase keeps a session until sign-out; this only bounds forgotten devices. */
const SESSION_MAX_AGE = 60 * 24 * 3_600_000;

const text = (value: unknown) =>
  value === null || (typeof value === "string" && value.length <= 2048);
const validSession = (value: unknown): value is AppUser =>
  Boolean(value) &&
  typeof (value as AppUser).uid === "string" &&
  (value as AppUser).uid.length > 0 &&
  (value as AppUser).uid.length <= 128 &&
  text((value as AppUser).displayName) &&
  text((value as AppUser).photoURL) &&
  text((value as AppUser).email ?? null);

let memo: { user: AppUser | null } | undefined;

/**
 * The account of the last launch. Firebase needs one or two network round trips
 * to confirm it; meanwhile the app already shows that player's screens.
 */
export function readSession(): AppUser | null {
  memo ??= {
    user: snapshots.read(SESSION_KEY, SESSION_MAX_AGE, validSession)?.value ?? null,
  };
  return memo.user;
}

/** Firebase confirmed who is signed in (or nobody: then forget everything). */
export function rememberSession(user: AppUser | null) {
  const previous = readSession();
  // Signed out, or another account on this device: no snapshot may leak.
  if (!user || (previous && previous.uid !== user.uid)) snapshots.clear();
  if (!user) {
    memo = { user: null };
    return;
  }
  const next: AppUser = {
    uid: user.uid,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    email: user.email ?? null,
  };
  memo = { user: next };
  snapshots.write(SESSION_KEY, next);
}
