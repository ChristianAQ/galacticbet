import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { officialSync } from "./officialSync";
import { syncSportApi } from "./syncSportApi";
const token = process.env.FOOTBALL_DATA_TOKEN;
if (!token) throw new Error("Falta FOOTBALL_DATA_TOKEN (solo backend).");
// GitHub secret may contain a service-account JSON. Never log it or place it in VITE_*.
function backendCredential() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    if (!process.env.FIREBASE_PROJECT_ID)
      throw new Error(
        "Con ADC, indica explícitamente FIREBASE_PROJECT_ID para evitar escribir en un proyecto desconocido.",
      );
    return applicationDefault();
  }
  try {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT no contiene una cuenta de servicio JSON válida. Revisa el secret sin publicarlo en los logs.",
    );
  }
}
initializeApp({
  credential: backendCredential(),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();
await officialSync(db, token);
if (process.env.SPORTAPI_KEY?.trim()) {
  try {
    await syncSportApi(db, process.env.SPORTAPI_KEY);
  } catch {
    console.warn(
      "SportAPI: actualización rápida pendiente; se conservan los calendarios y puntos oficiales.",
    );
  }
}
