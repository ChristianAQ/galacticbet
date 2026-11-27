import { backendFirestore } from "./backend";
import { claudeCodeRunner, withFallback, type ClaudeRunner } from "./bettingAnalysis";
import { BRIEFING_SCHEMA, briefingPrompt, runBriefing } from "./aiBriefing";
import { geminiRunner } from "./geminiRunner";
import { FORECAST_SCHEMA, forecasterPrompt, runMachinePicks } from "./machinePicks";

/**
 * A few times a day: «La IA te cuenta» on Inicio (the key matches of the
 * next days) and the slips of «IA» and «Favorito» for the rounds about to
 * close. The same AIs as the betting analysis, in the same order (Claude
 * with the plan, then free Gemini).
 */
const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || "";
const geminiKey = process.env.GEMINI_API_KEY?.trim() || "";
const dryRun = process.env.BRIEFING_DRY_RUN === "true";
/** The AIs for one task (instructions with and without web search, and the answer's schema). */
function ais(prompt: (o: { web: boolean }) => string, schema: object, label: string) {
  const list: { name: string; run: ClaudeRunner }[] = [];
  if (token)
    list.push({
      name: "Claude",
      run: claudeCodeRunner({
        token,
        model: process.env.CLAUDE_MODEL?.trim() || undefined,
        timeoutMs: 8 * 60_000,
        task: { system: prompt({ web: true }), schema },
      }),
    });
  if (geminiKey)
    list.push({
      name: "Gemini",
      run: geminiRunner({
        apiKey: geminiKey,
        model: process.env.GEMINI_MODEL?.trim() || undefined,
        task: { system: prompt({ web: false }), schema },
      }),
    });
  if (process.env.ANALYSIS_AI?.trim().toLowerCase() === "gemini") list.reverse();
  return list.length ? withFallback(list, console.log, label) : undefined;
}

const db = backendFirestore();
const result = await runBriefing(db, {
  ai: ais(briefingPrompt, BRIEFING_SCHEMA, "Portada IA"),
  force: process.env.BRIEFING_FORCE === "true",
  dryRun,
});
// The test mode only tries the front page: frozen slips are never redone.
const machines = dryRun ? { frozen: 0 } : await runMachinePicks(db, { ai: ais(forecasterPrompt, FORECAST_SCHEMA, "Quiniela de la IA") });
// A failure shows as a failed run (what was published stays).
if (result.failed || machines.failed) process.exitCode = 1;
