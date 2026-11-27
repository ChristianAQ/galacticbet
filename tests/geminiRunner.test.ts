import { describe, expect, it } from "vitest";
import { analystPrompt, competitionNews, withFallback } from "../scripts/bettingAnalysis";
import { GEMINI_MODEL, geminiRequest, geminiRunner, readInteraction } from "../scripts/geminiRunner";
import { modelName } from "../src/lib/bettingAnalysis";

const answer = { headline: "Día igualado", summary: "Poco valor.", matches: [], picks: [] };
// Shaped as the Interactions API documents its answer.
const interaction = (text: string, extra: Record<string, unknown> = {}) => ({
  id: "int_1",
  status: "completed",
  model: "gemini-3.8-flash",
  steps: [
    { type: "thought", summary: [{ type: "text", text: "Pienso…" }], signature: "x" },
    { type: "model_output", content: [{ type: "text", text }] },
  ],
  usage: { total_input_tokens: 12000, total_output_tokens: 900, total_tokens: 12900 },
  ...extra,
});
const reply = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("Gemini gratis como IA del análisis", () => {
  it("pide el JSON del análisis con las instrucciones sin búsqueda web", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const run = geminiRunner({
      apiKey: "clave-de-prueba",
      request: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return reply(200, interaction(JSON.stringify(answer)));
      },
    });
    const result = await run("Partidos de hoy (JSON): []");
    expect(result).toMatchObject({ output: answer, model: "gemini-3.8-flash", searches: 0 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("clave-de-prueba");
    expect(headers["Api-Revision"]).toBe("2026-05-20");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ model: GEMINI_MODEL, input: "Partidos de hoy (JSON): []", store: false });
    expect(body.response_format).toMatchObject({ type: "text", mime_type: "application/json" });
    expect(body.response_format.schema.required).toEqual(["headline", "summary", "matches", "picks"]);
    expect(body.tools).toBeUndefined();
    expect(body.system_instruction).not.toMatch(/WebSearch/);
    expect(body.system_instruction).toMatch(/No tienes búsqueda web/);
    // The key never goes in the URL or the body.
    expect(calls[0].url + calls[0].init.body).not.toContain("clave-de-prueba");
  });

  it("los errores de Google se explican sin la clave", async () => {
    const run = geminiRunner({
      apiKey: "clave-secreta",
      request: async () => reply(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }),
    });
    const error = await run("x").catch((e: Error) => e);
    expect(String(error)).toMatch(/Gemini HTTP 429 \(RESOURCE_EXHAUSTED: Quota exceeded\)/);
    expect(String(error)).not.toContain("clave-secreta");
    // As the API really answers a wrong key: the error inside a list.
    const wrong = geminiRunner({
      apiKey: "x",
      request: async () =>
        reply(400, [{ error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } }]),
    });
    await expect(wrong("x")).rejects.toThrow(/Gemini HTTP 400 \(INVALID_ARGUMENT: API key not valid/);
  });

  it("lee el último texto aunque venga en un bloque de código, y rechaza lo incompleto", () => {
    expect(readInteraction(interaction("```json\n" + JSON.stringify(answer) + "\n```"), GEMINI_MODEL).output).toEqual(answer);
    expect(readInteraction(interaction(JSON.stringify(answer), { model: "models/gemini-3.6-flash" }), GEMINI_MODEL).model).toBe(
      "gemini-3.6-flash",
    );
    expect(() => readInteraction(interaction("{", {}), GEMINI_MODEL)).toThrow(/no es JSON/);
    expect(() => readInteraction(interaction("{}", { status: "incomplete" }), GEMINI_MODEL)).toThrow(/incomplete/);
    expect(() => readInteraction(null, GEMINI_MODEL)).toThrow(/vacía/);
    expect(readInteraction([interaction(JSON.stringify(answer))], GEMINI_MODEL).output).toEqual(answer);
  });

  it("si Claude falla, responde Gemini con los mismos datos", async () => {
    const logs: string[] = [];
    const seen: string[] = [];
    const run = withFallback(
      [
        {
          name: "Claude",
          run: async (p) => {
            seen.push(`claude:${p}`);
            throw new Error("límite de uso");
          },
        },
        { name: "Gemini", run: async (p) => (seen.push(`gemini:${p}`), { output: answer, model: "gemini-3.8-flash", searches: 0 }) },
      ],
      (m) => logs.push(m),
    );
    expect((await run("datos")).model).toBe("gemini-3.8-flash");
    expect(seen).toEqual(["claude:datos", "gemini:datos"]);
    expect(logs[0]).toMatch(/Claude no respondió \(límite de uso\); se prueba con Gemini/);
    // All of them failing: the last error, so the retry 20 minutes later tries again.
    const down = withFallback([{ name: "Gemini", run: async () => Promise.reject(new Error("caído")) }], () => {});
    await expect(down("x")).rejects.toThrow("caído");
  });

  it("el prompt con búsqueda sigue igual para Claude", () => {
    expect(analystPrompt({ web: true })).toMatch(/usa WebSearch/);
    expect(analystPrompt({ web: false })).not.toMatch(/WebSearch|Comprueba en la web/);
    expect(geminiRequest("x", "gemini-3.8-flash").system_instruction).toBe(analystPrompt({ web: false }));
  });

  it("nombra los modelos de Gemini en la ficha técnica", () => {
    expect(modelName("gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
    expect(modelName("gemini-3.5-flash-lite")).toBe("Gemini 3.5 Flash-Lite");
    expect(modelName("gemini-4-hydrogen")).toBe("Gemini 4 Hydrogen");
    expect(modelName("gemini-3-flash-preview")).toBe("Gemini 3 Flash Preview");
    expect(modelName("gemini-flash-latest")).toBe("gemini-flash-latest");
    expect(modelName("claude-sonnet-4-5-20250929")).toBe("Claude Sonnet 4.5");
  });
});

describe("titulares de ESPN para la IA", () => {
  const now = Date.parse("2026-11-27T18:00:00Z");
  const article = (title: string, hoursAgo: number, competition = "PD") => ({
    title,
    url: `https://www.espn.com.mx/futbol/nota/_/id/${title.length}`,
    publishedAt: new Date(now - hoursAgo * 3_600_000).toISOString(),
    competition,
  });
  const db = (news: unknown) =>
    ({ doc: () => ({ get: async () => ({ data: () => news }) }) }) as unknown as import("firebase-admin/firestore").Firestore;

  it("da los de la competición de los últimos tres días", async () => {
    const news = {
      version: 1,
      provider: "ESPN",
      fetchedAt: new Date(now).toISOString(),
      articles: [article("General", 1, "CL")],
      competitionArticles: { PD: [article("Baja en el Levante", 5), article("Vieja", 24 * 5)] },
    };
    const list = await competitionNews(db(news), "PD", now);
    expect(list).toEqual([
      { titular: "Baja en el Levante", fecha: new Date(now - 5 * 3_600_000).toISOString(), url: expect.stringMatching(/^https:/) },
    ]);
    expect(await competitionNews(db(undefined), "PD", now)).toEqual([]);
  });
});
