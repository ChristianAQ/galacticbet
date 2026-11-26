import { appendFile } from "node:fs/promises";
import { backendFirestore } from "./backend";
import { readCalendars } from "./liveLoop";
import { CHAIN_HORIZON, MAX_WAIT, nextLiveWake, roundDeadlines } from "./liveSchedule";
import { notifyPendingRounds } from "./notifications";

/**
 * First job of the live workflow: waits for the next match (20 minutes before
 * kick-off) and sends the round reminders on time, so neither depends on
 * GitHub running the schedule on time. When the work is further away than one
 * job can wait, it asks GitHub to start the workflow again.
 *
 * Manual runs and code pushes (LIVE_WAIT=false) go straight to the live job.
 */
const output = async (line: string) => {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${line}\n`);
};

if (process.env.LIVE_WAIT !== "true") await output("go=true");
else {
  const db = backendFirestore();
  const started = Date.now();
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const clock = new Intl.DateTimeFormat("es", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  // Rounds reminded by this job (the push log already avoids repeated messages).
  const reminded = new Set<number>();
  for (;;) {
    const now = Date.now();
    const deadlines = (await roundDeadlines(db, now)).filter((d) => !reminded.has(d));
    const wake = nextLiveWake(await readCalendars(db, now), deadlines, now);
    if (!wake) {
      console.log("Directo: no hay partidos ni cierres de jornada próximos en el calendario.");
      break;
    }
    const wait = wake.at - now;
    if (wait <= 0) {
      if (wake.kind === "live") {
        console.log("Directo: hay partidos en juego o a punto de empezar; empieza el seguimiento.");
        await output("go=true");
        break;
      }
      await notifyPendingRounds(db);
      reminded.add(wake.deadline);
      continue;
    }
    const what = wake.kind === "live" ? "el próximo partido" : "el recordatorio de cierre";
    const left = MAX_WAIT - (now - started);
    if (wait > left) {
      if (wait > CHAIN_HORIZON) {
        console.log(`Directo: ${what} toca el ${clock.format(wake.at)}; nada que esperar todavía.`);
        break;
      }
      console.log(`Directo: ${what} toca el ${clock.format(wake.at)}; espera de ${Math.round(left / 60_000)} min y se vuelve a lanzar.`);
      await sleep(Math.max(left, 0));
      await output("chain=true");
      break;
    }
    console.log(`Directo: esperando hasta el ${clock.format(wake.at)} (${what}).`);
    await sleep(wait + 5_000);
  }
}
