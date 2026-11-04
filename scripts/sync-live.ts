import { backendFirestore } from "./backend";
import { syncSportApi } from "./syncSportApi";

const key = process.env.SPORTAPI_KEY;
if (key?.trim()) {
  const result = await syncSportApi(backendFirestore(), key, {
    verify: process.env.SPORTAPI_VERIFY === "true",
  });
  if (result.stopped) process.exitCode = 1;
} else
  console.log(
    "SportAPI: configura el repository secret SPORTAPI_KEY para activar resultados rápidos.",
  );
