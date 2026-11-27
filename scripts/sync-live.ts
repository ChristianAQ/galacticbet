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
// A long match day keeps one job: the reminders of rounds closing meanwhile, every ten minutes.
let reminded = Date.now();
const result = await runLiveLoop(db, {
  sportApiKey: key,
  durationMs:
    Number.isFinite(minutes) && minutes > 0
      ? // One job for the whole match day (GitHub stops a job at 6 h): a relaunch
        // in the middle of a match would leave a couple of minutes without updates.
        Math.min(minutes, 330) * 60_000
      : 0,
  verify: process.env.SPORTAPI_VERIFY === "true",
  espn: process.env.ESPN_MATCH_DETAILS !== "false",
  officialSync: token ? () => officialSync(db, token) : undefined,
  onPass: async (now) => {
    if (now - reminded < 10 * 60_000) return;
    reminded = now;
    await notifyPendingRounds(db);
  },
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
