import { backendFirestore } from "./backend";
import { claudeCodeRunner, runBettingAnalysis } from "./bettingAnalysis";

// Every ten minutes: the AI's betting analysis, 45 minutes before the first
// LaLiga or Champions match of the day. Quick exit when nothing is due.
const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || "";
const dryRun = process.env.ANALYSIS_DRY_RUN === "true";
await runBettingAnalysis(backendFirestore(), {
  oddsKey: process.env.ODDSPAPI_KEY?.trim() || "",
  dryRun,
  claude: token
    ? claudeCodeRunner({ token, model: process.env.CLAUDE_MODEL?.trim() || undefined })
    : undefined,
});
