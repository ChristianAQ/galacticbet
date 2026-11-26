import { appendFile } from "node:fs/promises";
import { backendFirestore } from "./backend";
import { readCalendars, runLiveLoop } from "./liveLoop";
import { CHAIN_HORIZON, nextLiveWake, roundDeadlines } from "./liveSchedule";
import { officialSync } from "./officialSync";
import { notifyPendingRounds } from "./notifications";

const key = process.env.SPORTAPI_KEY?.trim() || "";
const token = process.env.FOOTBALL_DATA_TOKEN?.trim() || "";
if (!key)
  console.log(
    "SportAPI: configura el repository secret SPORTAPI_KEY para activar resultados rápidos. Se mantienen los eventos ESPN y el calendario oficial.",
  );
const db = backendFirestore();
// Remind whoever has not sealed a round that closes soon (before the matches start).
await notifyPendingRounds(db);
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
// More work soon (the match goes on, the next one, a reminder): the workflow
// starts again and its first job waits for it.
if (process.env.GITHUB_OUTPUT) {
  const now = Date.now();
  const wake = nextLiveWake(await readCalendars(db, now), await roundDeadlines(db, now), now);
  if (wake && wake.at - now <= CHAIN_HORIZON) {
    console.log("Directo: queda trabajo en las próximas horas; se vuelve a lanzar para esperarlo.");
    await appendFile(process.env.GITHUB_OUTPUT, "chain=true\n");
  }
}
if (result.stopped) process.exitCode = 1;
