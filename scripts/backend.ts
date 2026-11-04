import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export function backendFirestore() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw && !process.env.FIREBASE_PROJECT_ID)
    throw new Error("Con ADC, indica explícitamente FIREBASE_PROJECT_ID.");
  let credential;
  try {
    credential = raw ? cert(JSON.parse(raw)) : applicationDefault();
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT no contiene una cuenta de servicio válida; revisa el secret sin publicarlo.",
    );
  }
  return getFirestore(
    initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID }),
  );
}
