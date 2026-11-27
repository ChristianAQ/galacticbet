import { backendFirestore } from "./backend";
import { claudeCodeRunner, withFallback, type ClaudeRunner } from "./bettingAnalysis";
import { BRIEFING_SCHEMA, briefingPrompt, runBriefing } from "./aiBriefing";
import { geminiRunner } from "./geminiRunner";

/**
 * «La IA te cuenta» on Inicio, a few times a day: the key matches of the
 * next days and the stories worth reading. The same AIs as the betting
 * analysis, in the same order (Claude with the plan, then free Gemini).
 */
const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || "";
const geminiKey = process.env.GEMINI_API_KEY?.trim() || "";
const ais: { name: string; run: ClaudeRunner }[] = [];
if (token)
  ais.push({
    name: "Claude",
    run: claudeCodeRunner({
      token,
      model: process.env.CLAUDE_MODEL?.trim() || undefined,
      timeoutMs: 8 * 60_000,
      task: { system: briefingPrompt({ web: true }), schema: BRIEFING_SCHEMA },
    }),
  });
if (geminiKey)
  ais.push({
    name: "Gemini",
    run: geminiRunner({
      apiKey: geminiKey,
      model: process.env.GEMINI_MODEL?.trim() || undefined,
      task: { system: briefingPrompt({ web: false }), schema: BRIEFING_SCHEMA },
    }),
  });
if (process.env.ANALYSIS_AI?.trim().toLowerCase() === "gemini") ais.reverse();

const result = await runBriefing(backendFirestore(), {
  ai: ais.length ? withFallback(ais, console.log, "Portada IA") : undefined,
  force: process.env.BRIEFING_FORCE === "true",
  dryRun: process.env.BRIEFING_DRY_RUN === "true",
});
// A failed front page shows as a failed run (the previous one stays published).
if (result.failed) process.exitCode = 1;
