import { describe, expect, it } from "vitest";
import {
  BRIEFING_FRESH_MS,
  BRIEFING_SCHEMA,
  acceptBriefing,
  briefingInput,
  briefingPrompt,
  keyMatchCandidates,
  newsPool,
  runBriefing,
} from "../scripts/aiBriefing";
import { geminiRequest } from "../scripts/geminiRunner";
import { BRIEFING_DOC, BRIEFING_MAX_AGE, decodeBriefing, shownBriefing } from "../src/lib/briefing";
import type { Match } from "../src/lib/domain";
import type { FootballArticle, FootballNews } from "../src/lib/footballNews";

const now = Date.parse("2026-11-28T08:00:00Z");
const hours = (h: number) => new Date(now + h * 3_600_000).toISOString();
const match = (over: Partial<Match>): Match => ({
  id: "m1",
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "PD-2026-14",
  matchday: 14,
  stage: "REGULAR_SEASON",
  utcDate: hours(6),
  status: "TIMED",
  home: "Real Madrid CF",
  away: "FC Barcelona",
  homeCrest: "https://crests.football-data.org/86.png",
  awayCrest: "https://crests.football-data.org/81.png",
  homeScore: null,
  awayScore: null,
  ...over,
});
const article = (n: number, over: Partial<FootballArticle> = {}): FootballArticle => ({
  title: `Titular ${n}`,
  description: `Resumen ${n}`,
  url: `https://www.espn.com/futbol/nota/_/id/${n}`,
  publishedAt: hours(-n),
  competition: "PD",
  image: { url: `https://a.espncdn.com/photo/2026/1128/foto${n}.jpg`, alt: "Foto" },
  ...over,
});
const news = (articles: FootballArticle[]): FootballNews => ({
  version: 1,
  provider: "ESPN",
  linkPolicyVersion: 2,
  contentVersion: 2,
  fetchedAt: hours(-1),
  articles: articles.slice(0, 6),
  competitionArticles: { PD: articles.filter((a) => a.competition === "PD").slice(0, 6) },
});

const clasico = match({ id: "clasico" });
const derby = match({ id: "derby", home: "Atlético de Madrid", away: "Real Madrid CF", utcDate: hours(30) });
const premier = match({ id: "pl1", competition: "PL", seasonId: "PL-2026", home: "Arsenal FC", away: "Chelsea FC", utcDate: hours(26) });
const pool = [article(1), article(2), article(3, { competition: "CL" })];

const answer = {
  headline: "El Clásico abre un fin de semana de altura",
  summary: "Madrid y Barça se juegan el liderato. En Londres, derbi en la zona alta.",
  keyMatches: [
    { matchId: "derby", angle: "Derbi con el liderato en juego", preview: "El Atlético llega a dos puntos.", watch: "La presión alta del Atlético." },
    { matchId: "inventado", angle: "No existe", preview: "Nada.", watch: "Nada." },
    { matchId: "clasico", angle: "Duelo por el liderato", preview: "Empatados a 30 puntos.", watch: "Mbappé, 12 goles." },
    { matchId: "clasico", angle: "Repetido", preview: "Otra vez.", watch: "Otra vez." },
  ],
  sources: ["https://www.marca.com/futbol/real-madrid.html", "no es una web"],
};

describe("portada de la IA: qué puede elegir", () => {
  it("partidos sin empezar de los próximos días, los primeros antes", () => {
    const list = keyMatchCandidates(
      [
        derby,
        clasico,
        premier,
        match({ id: "jugado", status: "FINISHED", utcDate: hours(-20), homeScore: 1, awayScore: 0 }),
        match({ id: "en-juego", status: "IN_PLAY", utcDate: hours(-1) }),
        match({ id: "aplazado", status: "POSTPONED", utcDate: hours(10) }),
        match({ id: "lejano", utcDate: hours(24 * 6) }),
      ],
      now,
    );
    expect(list.map((m) => m.id)).toEqual(["clasico", "pl1", "derby"]);
  });

  it("en un parón, los siguientes de las dos próximas semanas", () => {
    const list = keyMatchCandidates([match({ id: "a", utcDate: hours(24 * 9) }), match({ id: "b", utcDate: hours(24 * 20) })], now);
    expect(list.map((m) => m.id)).toEqual(["a"]);
  });

  it("titulares de ESPN de los últimos días, sin repetir", () => {
    const old = article(9, { publishedAt: hours(-24 * 5) });
    const data = news([article(1), article(2), old]);
    data.competitionArticles = { PD: [article(1), old], CL: [article(3, { competition: "CL" })] };
    expect(newsPool(data, now).map((a) => a.title)).toEqual(["Titular 1", "Titular 2", "Titular 3"]);
    expect(newsPool({ version: 2 }, now)).toEqual([]);
  });

  it("los datos van sin cuotas, con las noticias como contexto", () => {
    const prompt = briefingInput([clasico], [clasico], new Map(), pool, now);
    expect(prompt).toContain("Real Madrid CF - FC Barcelona");
    expect(prompt).toContain("Titular 2");
    expect(prompt).not.toContain("https://www.espn.com");
    expect(prompt).not.toMatch(/cuotas|"casa"/);
    expect(briefingPrompt({ web: true })).toMatch(/WebSearch/);
    expect(briefingPrompt({ web: false })).toMatch(/No tienes búsqueda web/);
    expect(briefingPrompt({ web: false })).not.toMatch(/WebSearch/);
  });

  it("Gemini recibe las instrucciones y el esquema de la portada", () => {
    const body = geminiRequest("x", "gemini-3.8-flash", { system: briefingPrompt({ web: false }), schema: BRIEFING_SCHEMA });
    expect(body.system_instruction).toMatch(/portada de GalacticBet/);
    expect(body.response_format.schema).toBe(BRIEFING_SCHEMA);
    // The headlines are already in «Actualidad»: the AI does not list them again.
    expect(Object.keys(BRIEFING_SCHEMA.properties)).not.toContain("stories");
  });
});

describe("portada de la IA: qué se publica", () => {
  it("solo partidos nuestros, una vez cada uno, con nuestros datos", () => {
    const briefing = acceptBriefing({ ...answer, stories: [{ url: pool[0].url, why: "Ya no se usa." }] }, [clasico, derby, premier], now)!;
    // Agenda order, invented and repeated ones out.
    expect(briefing.keyMatches.map((k) => k.matchId)).toEqual(["clasico", "derby"]);
    expect(briefing.keyMatches[0]).toMatchObject({
      competition: "PD",
      home: "Real Madrid CF",
      homeCrest: "https://crests.football-data.org/86.png",
      utcDate: clasico.utcDate,
      angle: "Duelo por el liderato",
    });
    expect(briefing).not.toHaveProperty("stories");
    expect(briefing.sources).toEqual(["marca.com"]);
    expect(decodeBriefing(JSON.parse(JSON.stringify(briefing)))).toEqual(briefing);
  });

  it("recorta los textos largos y descarta una respuesta sin nada nuestro", () => {
    const long = acceptBriefing(
      { ...answer, headline: "Muy ".repeat(80), keyMatches: [{ ...answer.keyMatches[2], angle: "Un ángulo larguísimo ".repeat(6) }] },
      [clasico],
      now,
    )!;
    expect(long.headline.length).toBeLessThanOrEqual(140);
    expect(long.keyMatches[0].angle.length).toBeLessThanOrEqual(48);
    expect(long.keyMatches[0].angle.endsWith("…")).toBe(true);
    expect(acceptBriefing({ ...answer, keyMatches: [answer.keyMatches[1]] }, [clasico], now)).toBeNull();
    expect(acceptBriefing("texto", [clasico], now)).toBeNull();
  });

  it("el documento público rechaza datos malformados y formatos desconocidos", () => {
    const briefing = acceptBriefing(answer, [clasico, derby], now)!;
    const tampered = { ...briefing, keyMatches: [{ ...briefing.keyMatches[0], homeCrest: "javascript:alert(1)" }, briefing.keyMatches[1]] };
    expect(decodeBriefing(tampered)!.keyMatches.map((k) => k.matchId)).toEqual(["derby"]);
    expect(decodeBriefing({ ...briefing, formatVersion: 2 })).toBeNull();
    expect(decodeBriefing({ ...briefing, keyMatches: [] })).toBeNull();
    // Each match once: it keys the list on Inicio.
    const twice = decodeBriefing({ ...briefing, keyMatches: [briefing.keyMatches[0], briefing.keyMatches[0]] })!;
    expect(twice.keyMatches).toHaveLength(1);
  });
});

describe("portada de la IA en Inicio", () => {
  const briefing = acceptBriefing(answer, [clasico, derby], now)!;

  it("no se enseña si es vieja", () => {
    expect(shownBriefing(briefing, [], now + BRIEFING_MAX_AGE + 1)).toBeNull();
    expect(shownBriefing(null, [], now)).toBeNull();
  });

  it("los partidos clave siguen el calendario: en juego, aplazados y ya pasados", () => {
    const live = shownBriefing(briefing, [{ ...clasico, status: "IN_PLAY", homeScore: 1, awayScore: 0 }], now + 7 * 3_600_000)!;
    expect(live.keyMatches[0]).toMatchObject({ matchId: "clasico", status: "IN_PLAY", homeScore: 1 });
    const later = shownBriefing(briefing, [], now + 9 * 3_600_000)!;
    expect(later.keyMatches.map((k) => k.matchId)).toEqual(["derby"]);
    const postponed = shownBriefing(briefing, [{ ...derby, status: "POSTPONED" }], now)!;
    expect(postponed.keyMatches.map((k) => k.matchId)).toEqual(["clasico"]);
    // A new time from the calendar wins over the stored one.
    const moved = shownBriefing(briefing, [{ ...clasico, utcDate: hours(8) }], now)!;
    expect(moved.keyMatches[0].utcDate).toBe(hours(8));
    // All of them played: the section goes away.
    expect(shownBriefing(briefing, [], now + 33 * 3_600_000)).toBeNull();
  });
});

describe("el job de la portada, con dobles", () => {
  const setup = (stored: Record<string, unknown> = {}) => {
    const store = new Map<string, unknown>([["news/football", news(pool)], ...Object.entries(stored)]);
    const db = {
      doc: (path: string) => ({
        get: async () => ({ data: () => store.get(path) }),
        set: async (value: unknown) => void store.set(path, value),
      }),
    } as unknown as import("firebase-admin/firestore").Firestore;
    return { store, db };
  };
  const options = { matches: [clasico, derby, premier], now, log: () => {} };

  it("publica una portada válida con cómo trabajó la IA", async () => {
    const { store, db } = setup();
    const prompts: string[] = [];
    const ai = async (prompt: string) => (prompts.push(prompt), { output: answer, model: "gemini-3.8-flash", searches: 0, durationMs: 4000 });
    expect(await runBriefing(db, { ...options, ai })).toEqual({ generated: 1 });
    const saved = decodeBriefing(store.get(BRIEFING_DOC))!;
    expect(saved.keyMatches).toHaveLength(2);
    expect(saved.ai).toEqual({ model: "gemini-3.8-flash", searches: 0, seconds: 4 });
    expect(prompts[0]).toContain("Titular 1");
  });

  it("no gasta la IA si la portada es reciente, salvo a mano", async () => {
    const recent = acceptBriefing(answer, [clasico, derby], now - BRIEFING_FRESH_MS / 2)!;
    const { db } = setup({ [BRIEFING_DOC]: recent });
    let calls = 0;
    const ai = async () => (calls++, { output: answer });
    expect(await runBriefing(db, { ...options, ai })).toEqual({ generated: 0 });
    expect(calls).toBe(0);
    expect(await runBriefing(db, { ...options, ai, force: true })).toEqual({ generated: 1 });
    expect(calls).toBe(1);
  });

  it("si la IA falla o responde mal, se conserva la anterior y el job lo dice", async () => {
    const old = acceptBriefing(answer, [clasico, derby], now - 10 * 3_600_000)!;
    const { store, db } = setup({ [BRIEFING_DOC]: old });
    const failing = async () => {
      throw new Error("límite de uso");
    };
    expect(await runBriefing(db, { ...options, ai: failing })).toEqual({ generated: 0, failed: true });
    expect(await runBriefing(db, { ...options, ai: async () => ({ output: { headline: "x" } }) })).toEqual({ generated: 0, failed: true });
    expect(store.get(BRIEFING_DOC)).toBe(old);
  });

  it("la prueba no guarda nada", async () => {
    const { store, db } = setup();
    expect(await runBriefing(db, { ...options, ai: async () => ({ output: answer }), dryRun: true })).toEqual({ generated: 0 });
    expect(store.has(BRIEFING_DOC)).toBe(false);
  });
});
