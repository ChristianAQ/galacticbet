import { backendFirestore } from "./backend";
import { runLiveLoop } from "./liveLoop";
import { officialSync } from "./officialSync";

const key = process.env.SPORTAPI_KEY?.trim() || "";
const token = process.env.FOOTBALL_DATA_TOKEN?.trim() || "";
if (!key)
  console.log(
    "SportAPI: configura el repository secret SPORTAPI_KEY para activar resultados rápidos. Se mantienen los eventos ESPN y el calendario oficial.",
  );
const db = backendFirestore();
const minutes = Number(process.env.LIVE_LOOP_MINUTES || 0);
const result = await runLiveLoop(db, {
  sportApiKey: key,
  durationMs:
    Number.isFinite(minutes) && minutes > 0
      ? Math.min(minutes, 50) * 60_000
      : 0,
  verify: process.env.SPORTAPI_VERIFY === "true",
  espn: process.env.ESPN_MATCH_DETAILS !== "false",
  officialSync: token ? () => officialSync(db, token) : undefined,
});
if (result.stopped) process.exitCode = 1;
