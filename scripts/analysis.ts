import { appendFile } from "node:fs/promises";
import { backendFirestore } from "./backend";
import {
  MAX_ATTEMPTS,
  claudeCodeRunner,
  planNextAnalysis,
  recordAttempt,
  runBettingAnalysis,
  withFallback,
  type ClaudeRunner,
} from "./bettingAnalysis";
import { geminiRunner } from "./geminiRunner";

/**
 * The AI's betting analysis, 45 minutes before the first LaLiga or Champions
 * match of each day.
 *
 * GitHub runs scheduled workflows hours late (or not at all) on busy days, so
 * the automatic mode does not trust the clock of its trigger: it works out
 * when the next analysis is due, waits for it inside the job (up to
 * MAX_WAIT) and, when the day is still further away, asks GitHub to start the
 * job again. Any run of the other workflows (syncs, deploys) also starts it.
 */
// Room left in the 350-minute job for the analysis: two days, each Claude (12 min) then Gemini (6 min).
const MAX_WAIT = 4 * 3_600_000 + 45 * 60_000;
/** Keep a job waiting only when a match day is this close. */
const CHAIN_HORIZON = 18 * 3_600_000;

const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || "";
const geminiKey = process.env.GEMINI_API_KEY?.trim() || "";
const dryRun = process.env.ANALYSIS_DRY_RUN === "true";
const tryAi = process.env.ANALYSIS_TRY_AI === "true";
const force = process.env.ANALYSIS_FORCE === "true";
const automatic = process.env.ANALYSIS_WAIT === "true";
const db = backendFirestore();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clock = new Intl.DateTimeFormat("es", {
  timeZone: "Europe/Madrid",
  weekday: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
// The AIs in order: Claude with the plan's token, then free Gemini if Claude
// fails (or first, with the repository variable ANALYSIS_AI=gemini).
const ais: { name: string; run: ClaudeRunner }[] = [];
if (token) ais.push({ name: "Claude", run: claudeCodeRunner({ token, model: process.env.CLAUDE_MODEL?.trim() || undefined }) });
if (geminiKey) ais.push({ name: "Gemini", run: geminiRunner({ apiKey: geminiKey, model: process.env.GEMINI_MODEL?.trim() || undefined }) });
if (process.env.ANALYSIS_AI?.trim().toLowerCase() === "gemini") ais.reverse();
const run = () =>
  runBettingAnalysis(db, {
    oddsKey: process.env.ODDSPAPI_KEY?.trim() || "",
    dryRun,
    tryAi,
    force,
    claude: ais.length ? withFallback(ais) : undefined,
  });

/** Tells the workflow to start the job again (a step after this one does it). */
async function chain(reason: string) {
  console.log(`Análisis: ${reason}; se vuelve a lanzar para seguir esperando.`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "chain=true\n");
}

if (!automatic) await run();
else {
  const plan = await planNextAnalysis(db, Date.now());
  if (!plan) console.log("Análisis: no hay días de LaLiga ni de Champions por analizar en el calendario.");
  else {
    const wait = plan.at - Date.now();
    if (wait > MAX_WAIT) {
      if (wait > CHAIN_HORIZON) console.log(`Análisis: el próximo (${plan.id}) toca el ${clock.format(plan.at)}; nada que esperar todavía.`);
      else {
        console.log(`Análisis: el próximo (${plan.id}) toca el ${clock.format(plan.at)}; espera de ${Math.round(MAX_WAIT / 60_000)} min.`);
        await sleep(MAX_WAIT);
        await chain("aún no es la hora");
      }
    } else {
      if (wait > 0) {
        console.log(`Análisis: esperando hasta el ${clock.format(plan.at)} (${plan.id}).`);
        await sleep(wait + 15_000);
      }
      const attempt = await recordAttempt(db, plan.id, Date.now());
      if (attempt > 1) console.log(`Análisis: intento ${attempt} de ${MAX_ATTEMPTS} para ${plan.id}.`);
      await run();
      // The next match day, if close: keep a job waiting for it.
      const next = await planNextAnalysis(db, Date.now());
      if (next && next.at - Date.now() <= CHAIN_HORIZON) await chain(`el siguiente (${next.id}) toca el ${clock.format(next.at)}`);
    }
  }
}
