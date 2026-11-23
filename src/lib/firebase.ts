import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { privateCache } from "./memoryCache";
const e = import.meta.env;
export const configured = Boolean(
  e.VITE_FIREBASE_API_KEY &&
  e.VITE_FIREBASE_AUTH_DOMAIN &&
  e.VITE_FIREBASE_PROJECT_ID &&
  e.VITE_FIREBASE_APP_ID,
);
const app = configured
  ? initializeApp({
      apiKey: e.VITE_FIREBASE_API_KEY,
      authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: e.VITE_FIREBASE_PROJECT_ID,
      appId: e.VITE_FIREBASE_APP_ID,
    })
  : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
// Local development against the Firebase emulators only (never in a build).
if (import.meta.env.DEV && e.VITE_USE_EMULATORS === "true" && auth && db) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
export async function googleLogin() {
  if (!auth) throw new Error("Configura Firebase para iniciar sesión.");
  await signInWithPopup(auth, new GoogleAuthProvider());
}
export async function emailLogin(
  email: string,
  password: string,
  name?: string,
) {
  if (!auth) throw new Error("Configura Firebase para iniciar sesión.");
  if (name) {
    const r = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(r.user, { displayName: name });
    if (db)
      await setDoc(doc(db, "users", r.user.uid), {
        name,
        avatar: null,
        updatedAt: serverTimestamp(),
      });
  } else await signInWithEmailAndPassword(auth, email, password);
}
export async function logout() {
  if (auth) await signOut(auth);
  privateCache.clear();
}
export async function saveDisplayName(value: string) {
  if (!auth?.currentUser || !db)
    throw new Error("Inicia sesión para editar tu perfil.");
  const name = value.trim();
  if (!name || name.length > 100)
    throw new Error("Escribe un nombre de entre 1 y 100 caracteres.");
  const user = auth.currentUser;
  await updateProfile(user, { displayName: name });
  try {
    await setDoc(
      doc(db, "users", user.uid),
      { name, avatar: user.photoURL || null, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch {
    throw new Error(
      "El nombre se ha actualizado en tu cuenta, pero no se ha podido actualizar en tus grupos. Pulsa Guardar nombre para reintentar.",
    );
  } finally {
    privateCache.clear();
  }
}
