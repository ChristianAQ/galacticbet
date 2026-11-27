import { describe, expect, it } from "vitest";
import {
  FORECAST_SCHEMA,
  MACHINE_WINDOW,
  acceptForecast,
  closingRounds,
  forecasterPrompt,
  runMachinePicks,
} from "../scripts/machinePicks";
import type { Match } from "../src/lib/domain";
import {
  asPick,
  decodeMachinePicks,
  favoriteScore,
  ghostPlayers,
  ghostRound,
  ghostSlips,
  machineDuel,
  machinePicksPath,
  type MachinePicks,
} from "../src/lib/machinePicks";
import { predictorProfile } from "../src/lib/predictorProfile";
import { roundBoard } from "../src/lib/roundBoard";
import {
  goalRates,
  keyResults,
  outcomeChances,
  playedMinutes,
  simFixture,
  simulateRound,
  TYPICAL_CHANCES,
} from "../src/lib/winChances";

const now = Date.parse("2026-11-28T08:00:00Z");
const hours = (h: number) => new Date(now + h * 3_600_000).toISOString();
const match = (over: Partial<Match>): Match => ({
  id: "m1",
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "PD-2026-REGULAR_SEASON-14",
  matchday: 14,
  stage: "REGULAR_SEASON",
  utcDate: hours(6),
  status: "TIMED",
  home: "Real Madrid CF",
  away: "FC Barcelona",
  homeScore: null,
  awayScore: null,
  ...over,
});
const finished = (id: string, home: number, away: number, over: Partial<Match> = {}) =>
  match({ id, status: "FINISHED", homeScore: home, awayScore: away, utcDate: hours(-30), ...over });

describe("el modelo de goles", () => {
  it("reproduce las probabilidades del mercado", () => {
    for (const p of [
      { home: 0.62, draw: 0.22, away: 0.16 },
      { home: 0.3, draw: 0.3, away: 0.4 },
      TYPICAL_CHANCES,
    ]) {
      const c = outcomeChances(goalRates(p));
      expect(Math.abs(c.home - p.home)).toBeLessThan(0.02);
      expect(Math.abs(c.away - p.away)).toBeLessThan(0.02);
    }
    const strong = goalRates({ home: 0.7, draw: 0.18, away: 0.12 });
    expect(strong.home).toBeGreaterThan(strong.away);
  });

  it("en juego, solo quedan los minutos que faltan", () => {
    const live = { id: "m1", status: "IN_PLAY", homeScore: 1, awayScore: 0, minute: "80", minuteAt: now, events: [] };
    const m = match({ status: "IN_PLAY", homeScore: 1, awayScore: 0, utcDate: hours(-1.5) });
    expect(playedMinutes(m, live, now + 2 * 60_000)).toBe(82);
    expect(playedMinutes(m, { ...live, minute: "45+2" }, now)).toBe(47);
    expect(playedMinutes(match({ status: "PAUSED" }), undefined, now)).toBe(45);
    const f = simFixture(m, TYPICAL_CHANCES, live, now)!;
    const before = simFixture(match({}), TYPICAL_CHANCES, undefined, now)!;
    expect(f).toMatchObject({ home: 1, away: 0, decided: false });
    expect(f.rest.home).toBeLessThan(before.rest.home * 0.2);
    expect(simFixture(finished("f", 2, 2), TYPICAL_CHANCES, undefined, now)).toMatchObject({ decided: true, home: 2, away: 2 });
    expect(simFixture(match({ status: "POSTPONED" }), TYPICAL_CHANCES, undefined, now)).toBeNull();
  });
});

describe("¿quién se lleva la jornada?", () => {
  const a = match({ id: "a" });
  const b = match({ id: "b", home: "Getafe CF", away: "Girona FC" });

  it("con todo decidido, gana quien más suma; un empate en cabeza se comparte", () => {
    const fixtures = [finished("a", 2, 0), finished("b", 1, 1)].map((m) => simFixture(m, TYPICAL_CHANCES, undefined, now)!);
    const result = simulateRound({
      fixtures,
      mode: "classic",
      runs: 100,
      players: [
        { id: "ana", picks: { a: "1", b: "X" } },
        { id: "bea", picks: { a: "1", b: "2" } },
        { id: "eva", picks: { a: "1", b: "X" } },
      ],
    });
    expect(result.win).toEqual({ ana: 1, bea: 0, eva: 1 });
    expect(result.shared.ana).toBe(1);
  });

  it("las probabilidades suman al menos 1 y siguen al marcador en directo", () => {
    const leading = match({ id: "a", status: "IN_PLAY", homeScore: 2, awayScore: 0 });
    const live = { id: "a", status: "IN_PLAY", homeScore: 2, awayScore: 0, minute: "85", minuteAt: now, events: [] };
    const fixtures = [simFixture(leading, TYPICAL_CHANCES, live, now)!, simFixture(b, TYPICAL_CHANCES, undefined, now)!];
    const players = [
      { id: "ana", picks: { a: "1" as const, b: "1" as const } },
      { id: "bea", picks: { a: "2" as const, b: "1" as const } },
    ];
    const result = simulateRound({ fixtures, players, mode: "classic", focus: "bea" });
    expect(result.win.ana).toBeGreaterThan(0.9);
    expect(result.win.ana + result.win.bea).toBeGreaterThanOrEqual(1);
    // The same inputs, the same figures: no flicker on screen.
    expect(simulateRound({ fixtures, players, mode: "classic", focus: "bea" }).win).toEqual(result.win);
    // Bea needs the comeback in «a»: that match moves her chance most.
    expect(keyResults(result)[0].matchId).toBe("a");
    expect(result.ifResult.a["2"]).toBe(1);
  });

  it("qué necesitas y el camino más probable", () => {
    const fixtures = [a, b].map((m) => simFixture(m, { home: 0.5, draw: 0.25, away: 0.25 }, undefined, now)!);
    const result = simulateRound({
      fixtures,
      mode: "classic",
      focus: "ana",
      players: [
        { id: "ana", picks: { a: "2", b: "1" } },
        { id: "bea", picks: { a: "1", b: "1" } },
      ],
    });
    // Ana only wins (or ties) if «a» is not a home win.
    expect(result.ifResult.a["1"]).toBe(0);
    expect(result.ifResult.a["2"]).toBe(1);
    expect(result.path!.signs.a).not.toBe("1");
    expect(keyResults(result).map((k) => k.matchId)).toEqual(["a"]);
  });

  it("en modo exacto, puntúa marcadores", () => {
    const fixtures = [finished("a", 2, 1)].map((m) => simFixture(m, TYPICAL_CHANCES, undefined, now)!);
    const result = simulateRound({
      fixtures,
      mode: "exact",
      runs: 10,
      players: [
        { id: "ana", picks: { a: { home: 2, away: 1 } } },
        { id: "bea", picks: { a: { home: 1, away: 0 } } },
      ],
    });
    expect(result.win).toEqual({ ana: 1, bea: 0 });
  });
});

describe("la IA y el favorito", () => {
  const round = "PD-2026-REGULAR_SEASON-14";
  const doc = (rounds: MachinePicks["rounds"]): MachinePicks => ({ formatVersion: 1, seasonId: "PD-2026", rounds });

  it("el favorito juega su signo con el marcador más probable", () => {
    expect(favoriteScore({ home: 0.62, draw: 0.22, away: 0.16 })).toEqual({ home: 1, away: 0 });
    expect(favoriteScore({ home: 0.82, draw: 0.12, away: 0.06 })).toEqual({ home: 2, away: 0 });
    const away = favoriteScore({ home: 0.25, draw: 0.28, away: 0.47 });
    expect(away.away).toBeGreaterThan(away.home);
    expect(asPick({ home: 2, away: 1 }, "classic")).toBe("1");
    expect(asPick({ home: 2, away: 1 }, "exact")).toEqual({ home: 2, away: 1 });
  });

  it("el documento público se valida", () => {
    const raw = doc({
      [round]: {
        frozenAt: hours(-20),
        deadline: hours(-10),
        matches: {
          a: { p: { home: 0.5, draw: 0.3, away: 0.2 }, favorite: { home: 1, away: 0 }, ai: { home: 2, away: 2 } },
          b: { favorite: { home: -1, away: 0 } },
        },
      },
      "CL-2026-x": { frozenAt: hours(-20), deadline: hours(-10), matches: {} },
    });
    const decoded = decodeMachinePicks(raw, "PD-2026")!;
    expect(Object.keys(decoded.rounds)).toEqual([round]);
    expect(Object.keys(decoded.rounds[round].matches)).toEqual(["a"]);
    expect(decodeMachinePicks(raw, "PL-2026")).toBeNull();
    expect(machinePicksPath("PD-2026")).toBe("machinePicks/PD-2026");
  });

  it("puntúan como el grupo y aparecen en el tablero de la jornada", () => {
    const r = { frozenAt: hours(-40), deadline: hours(-30), matches: { a: { favorite: { home: 1, away: 0 }, ai: { home: 1, away: 1 } }, b: { favorite: { home: 2, away: 0 }, ai: { home: 0, away: 1 } } } };
    const fixtures = [finished("a", 1, 0), finished("b", 0, 1)];
    expect(ghostRound(r, "favorite", fixtures, "classic")).toEqual({ points: 1, hits: 1 });
    expect(ghostRound(r, "ai", fixtures, "exact")).toEqual({ points: 3, hits: 1 });
    const board = roundBoard(fixtures, "classic", ghostPlayers(r, "classic"));
    expect(board.map((b) => [b.name, b.points])).toEqual([
      ["Favorito", 1],
      ["IA", 1],
    ]);
  });

  it("la quiniela de la IA se lee como un boleto: su propio perfil de pronosticador", () => {
    const fixtures = [finished("a", 1, 0, { home: "Real Betis", away: "Sevilla FC" }), finished("b", 0, 1, { home: "Getafe CF", away: "Real Betis" })];
    const machines = new Map([
      [
        "PD-2026",
        doc({
          [round]: {
            frozenAt: hours(-40),
            deadline: hours(-30),
            matches: { a: { ai: { home: 2, away: 0 }, favorite: { home: 1, away: 0 }, p: { home: 0.5, draw: 0.3, away: 0.2 } }, b: { ai: { home: 1, away: 1 }, p: { home: 0.4, draw: 0.3, away: 0.3 } } },
          },
        }),
      ],
    ]);
    // Each season's kind: signs in 1X2, scores in exact; seasons without a mode are left out.
    expect(ghostSlips(machines, { "PD-2026": "classic" }, "ai")).toEqual({ [round]: { a: "1", b: "X" } });
    expect(ghostSlips(machines, { "PD-2026": "exact" }, "ai")[round].a).toEqual({ home: 2, away: 0 });
    expect(ghostSlips(machines, {}, "ai")).toEqual({});
    const profile = predictorProfile({
      slips: ghostSlips(machines, { "PD-2026": "exact" }, "ai"),
      matches: fixtures,
      modes: { "PD-2026": "exact" },
      machines,
    })!;
    // 2-0 for a 1-0 (the sign: 1 point), 1-1 for a 0-1 (nothing); it went against the favourite in «b».
    expect(profile).toMatchObject({ matches: 2, hits: 1, points: 1, maxPoints: 6, exact: 0 });
    expect(profile.upsets).toEqual({ picked: 1, hits: 0 });
  });

  it("contra la máquina: tus jornadas frente a las suyas", () => {
    const fixtures = [finished("a", 1, 0), finished("b", 0, 1)];
    const machines = new Map([
      ["PD-2026", doc({ [round]: { frozenAt: hours(-40), deadline: hours(-30), matches: { a: { favorite: { home: 1, away: 0 }, ai: { home: 0, away: 0 } }, b: { favorite: { home: 1, away: 0 }, ai: { home: 0, away: 2 } } } } })],
    ]);
    const duel = machineDuel({
      machines,
      matches: fixtures,
      userId: "ana",
      scope: "PD",
      seasons: [
        {
          id: "PD-2026",
          competition: "PD",
          mode: "classic",
          standings: [
            { id: "ana", rounds: { [round]: { points: 2, hits: 2 } } },
            { id: "bea", rounds: { [round]: { points: 0, hits: 0 } } },
          ],
        },
      ],
    })!;
    expect(duel).toMatchObject({ rounds: 1, you: 2, ai: 1, favorite: 1, beatAi: 1, beatFavorite: 1, aheadOfAi: 1, players: 2 });
    expect(machineDuel({ machines, matches: fixtures, userId: "ana", scope: "CL", seasons: [] })).toBeNull();
  });
});

describe("tu perfil de pronosticador", () => {
  it("signos, contra el favorito, el mercado y tus equipos", () => {
    const round = "PD-2026-REGULAR_SEASON-14";
    const matches = [
      finished("a", 2, 0, { home: "Real Betis", away: "Sevilla FC" }),
      finished("b", 1, 1, { home: "Real Betis", away: "Getafe CF" }),
      finished("c", 0, 1, { home: "Real Betis", away: "Girona FC" }),
      finished("d", 3, 0, { home: "Atlético de Madrid", away: "Real Betis" }),
      match({ id: "e" }),
    ];
    const p = (home: number, draw: number, away: number) => ({ p: { home, draw, away } });
    const machines = new Map([
      [
        "PD-2026",
        {
          formatVersion: 1 as const,
          seasonId: "PD-2026",
          rounds: { [round]: { frozenAt: hours(-60), deadline: hours(-50), matches: { a: p(0.5, 0.3, 0.2), b: p(0.6, 0.25, 0.15), c: p(0.55, 0.25, 0.2) } } },
        },
      ],
    ]);
    const profile = predictorProfile({
      slips: { [round]: { a: "1", b: "X", c: "1", d: "2", e: "1" } },
      matches,
      modes: { "PD-2026": "classic" },
      machines,
    })!;
    expect(profile).toMatchObject({ matches: 4, hits: 2, points: 2, maxPoints: 4, exact: 0 });
    expect(profile.bySign).toEqual({ "1": { picked: 2, hits: 1 }, X: { picked: 1, hits: 1 }, "2": { picked: 1, hits: 0 } });
    // «b» against the favourite (X when the market said 1), and it came in.
    expect(profile.upsets).toEqual({ picked: 1, hits: 1 });
    expect(profile.market).toEqual({ matches: 3, you: 2, favorite: 1 });
    expect(profile.best).toMatchObject({ team: "Real Betis", matches: 4, points: 2 });
    expect(predictorProfile({ slips: {}, matches, modes: {}, machines })).toBeNull();
  });
});

describe("el job que congela las quinielas", () => {
  const round = "PD-2026-REGULAR_SEASON-14";
  const fixtures = [match({ id: "a", utcDate: hours(10) }), match({ id: "b", home: "Getafe CF", away: "Girona FC", utcDate: hours(30) })];
  const odds = (id: string) => ({
    fetchedAt: hours(-1),
    bookmakers: [{ key: "bet", title: "Casa", home: 1.6, draw: 4, away: 5.5, updatedAt: hours(-1) }],
    id,
  });
  const setup = (stored: Record<string, unknown> = {}) => {
    const store = new Map<string, unknown>([
      ["odds/football", { formatVersion: 1, updatedAt: hours(-1), matches: { a: odds("a"), b: odds("b") } }],
      ...Object.entries(stored),
    ]);
    const db = {
      doc: (path: string) => ({
        get: async () => ({ data: () => store.get(path) }),
        set: async (value: unknown) => void store.set(path, value),
      }),
    } as unknown as import("firebase-admin/firestore").Firestore;
    return { store, db };
  };

  it("solo las jornadas que cierran en las próximas 24 horas", () => {
    expect(closingRounds(fixtures, now).map((r) => [r.roundId, r.fixtures.length])).toEqual([[round, 2]]);
    expect(closingRounds(fixtures, now - MACHINE_WINDOW)).toEqual([]);
    expect(closingRounds(fixtures, now + 11 * 3_600_000)).toEqual([]);
  });

  it("congela el favorito y la quiniela de la IA antes del cierre", async () => {
    const { store, db } = setup();
    const prompts: string[] = [];
    const ai = async (prompt: string) => (
      prompts.push(prompt),
      { output: { picks: [{ matchId: "a", home: 2, away: 1 }, { matchId: "zz", home: 1, away: 0 }, { matchId: "b", home: 12, away: 0 }] }, model: "gemini-3.8-flash", searches: 0 }
    );
    expect(await runMachinePicks(db, { ai, matches: fixtures, now, log: () => {} })).toEqual({ frozen: 3 });
    const saved = decodeMachinePicks(store.get("machinePicks/PD-2026"), "PD-2026")!;
    expect(saved.rounds[round].matches.a).toMatchObject({ ai: { home: 2, away: 1 }, favorite: { home: 1, away: 0 } });
    expect(saved.rounds[round].matches.a.p!.home).toBeCloseTo(0.591, 2);
    expect(saved.rounds[round].matches.b.ai).toBeUndefined();
    expect(saved.rounds[round].ai).toEqual({ model: "gemini-3.8-flash", searches: 0 });
    // No prices in the AI's prompt: its own opinion.
    expect(prompts[0]).not.toMatch(/cuota|bookmaker|1\.6/);
    // The next run only asks for what is missing, and never redoes the favourite.
    const again: string[] = [];
    await runMachinePicks(db, {
      ai: async (prompt) => (again.push(prompt), { output: { picks: [{ matchId: "b", home: 0, away: 0 }] } }),
      matches: fixtures,
      now: now + 3_600_000,
      log: () => {},
    });
    expect(again[0]).toContain("Getafe CF - Girona FC");
    expect(again[0]).not.toContain("Real Madrid CF - FC Barcelona");
    const after = decodeMachinePicks(store.get("machinePicks/PD-2026"), "PD-2026")!;
    expect(after.rounds[round].matches.b.ai).toEqual({ home: 0, away: 0 });
    expect(after.rounds[round].frozenAt).toBe(saved.rounds[round].frozenAt);
  });

  it("sin IA o si falla, el favorito igualmente; y nunca toca una jornada cerrada", async () => {
    const { store, db } = setup();
    expect(await runMachinePicks(db, { matches: fixtures, now, log: () => {} })).toEqual({ frozen: 2 });
    const failing = async () => {
      throw new Error("límite");
    };
    const result = await runMachinePicks(db, { ai: failing, matches: fixtures, now: now + 60_000, log: () => {} });
    expect(result.failed).toBe(true);
    expect(decodeMachinePicks(store.get("machinePicks/PD-2026"), "PD-2026")!.rounds[round].matches.a.favorite).toBeDefined();
    expect(await runMachinePicks(db, { matches: fixtures, now: now + 11 * 3_600_000, log: () => {} })).toEqual({ frozen: 0 });
  });

  it("acepta solo marcadores válidos de los partidos pedidos", () => {
    const picks = acceptForecast({ picks: [{ matchId: "a", home: 1, away: 0 }, { matchId: "a", home: 2, away: 0 }, { matchId: "b", home: 1.5, away: 0 }] }, new Set(["a", "b"]));
    expect([...picks]).toEqual([["a", { home: 1, away: 0 }]]);
    expect(acceptForecast(null, new Set(["a"])).size).toBe(0);
    expect(FORECAST_SCHEMA.required).toEqual(["picks"]);
    expect(forecasterPrompt({ web: false })).not.toMatch(/WebSearch/);
  });
});
