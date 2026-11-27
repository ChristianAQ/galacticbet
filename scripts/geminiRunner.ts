import { ANALYSIS_SCHEMA, analystPrompt, type AiTask, type ClaudeAnswer, type ClaudeRunner } from "./bettingAnalysis";

/**
 * The analysis with Gemini, on the free tier of the Gemini API (a key from
 * Google AI Studio, without billing). The free tier has no Google Search for
 * current models, so the AI works with our data and ESPN's headlines only,
 * and says so in the report («sin búsqueda web»).
 *
 * Interactions API, as documented at ai.google.dev (revision 2026-05-20):
 * POST /v1beta/interactions with the key in `x-goog-api-key`, the answer as
 * JSON with the same schema Claude Code uses, and `store: false` (nothing
 * kept on Google's side beyond the request).
 */
export const GEMINI_MODEL = "gemini-3.8-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const API_REVISION = "2026-05-20";

/** The betting analysis, without web search. */
const ANALYSIS_TASK: AiTask = { system: analystPrompt({ web: false }), schema: ANALYSIS_SCHEMA };

export function geminiRequest(prompt: string, model: string, task: AiTask = ANALYSIS_TASK) {
  return {
    model,
    system_instruction: task.system,
    input: prompt,
    response_format: { type: "text", mime_type: "application/json", schema: task.schema },
    store: false,
  };
}

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The final answer of an interaction: the text of its last `model_output` step, as JSON. */
export function readInteraction(raw: unknown, requested: string): ClaudeAnswer {
  // Errors come inside a list; accept an answer shaped the same way.
  const body = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
  if (!isRow(body)) throw new Error("Gemini: respuesta vacía");
  if (body.status !== "completed") throw new Error(`Gemini: la respuesta quedó «${String(body.status)}»`);
  const steps = Array.isArray(body.steps) ? body.steps.filter(isRow) : [];
  const output = steps.filter((s) => s.type === "model_output").at(-1);
  const text = (Array.isArray(output?.content) ? output.content : [])
    .filter((c): c is Row => isRow(c) && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("")
    .trim()
    // Just in case it wraps the JSON in a code block.
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini: la respuesta no es JSON");
  }
  const model = (typeof body.model === "string" ? body.model : requested).replace(/^models\//, "");
  return {
    output: parsed,
    ...(/^[a-z0-9][a-z0-9.-]{1,79}$/.test(model) ? { model } : {}),
    // No search tool is sent: the report says «sin búsqueda web».
    searches: 0,
    turns: 1,
  };
}

export function geminiRunner(options: {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  request?: typeof fetch;
  task?: AiTask;
}): ClaudeRunner {
  const model = options.model || GEMINI_MODEL;
  const request = options.request ?? fetch;
  return async (prompt) => {
    const started = Date.now();
    const response = await request(ENDPOINT, {
      method: "POST",
      headers: {
        "x-goog-api-key": options.apiKey,
        "Content-Type": "application/json",
        "Api-Revision": API_REVISION,
      },
      body: JSON.stringify(geminiRequest(prompt, model, options.task)),
      signal: AbortSignal.timeout(options.timeoutMs ?? 6 * 60_000),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (!response.ok) {
      // Google's error body ({ error: { message, status } }, sometimes inside a list);
      // never the key, which travels in a header.
      const first = Array.isArray(body) ? body[0] : body;
      const error = isRow(first) && isRow(first.error) ? first.error : {};
      const detail = [error.status, error.message].filter((v) => typeof v === "string").join(": ");
      throw new Error(`Gemini HTTP ${response.status}${detail ? ` (${detail.replace(/\s+/g, " ").slice(0, 300)})` : ""}`);
    }
    return { ...readInteraction(body, model), durationMs: Date.now() - started };
  };
}
