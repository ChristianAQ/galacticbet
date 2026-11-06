import { expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  buildLeagueStats,
  normalizeLeagueRanking,
  syncLeagueStats,
} from "../scripts/syncLeagueStats";
import { validLeagueStats, topFive } from "../src/lib/leagueStats";
import {
  competitionSeasons,
  leagueTab,
  seasonLabel,
} from "../src/lib/leagueHub";
import { seasonLeagueTable } from "../src/lib/leagueTable";
import {
  currentArticles,
  validNews,
  type FootballNews,
} from "../src/lib/footballNews";
import type { Match } from "../src/lib/domain";
const now = Date.parse("2026-11-06T12:00:00Z");
const fixture = (extra: Partial<Match> = {}): Match => ({
  id: "1",
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "r",
  stage: "REGULAR_SEASON",
  matchday: 1,
  utcDate: "2026-11-01T20:00:00Z",
  status: "FINISHED",
  home: "FC Barcelona",
  away: "Real Madrid",
  homeCrest: "https://crests.football-data.org/81.png",
  homeScore: 2,
  awayScore: 1,
  ...extra,
});
const player = (i: number) => ({
  player_name: `Jugador ${i}`,
  team_name: "Barcelona",
  team_id: 1,
  goals: i,
  assists: i,
  yellow_cards: i,
  red_cards: i,
});
const response = (data: unknown[], season = "2026-08-01") => ({
  success: true,
  season_from: season,
  data,
});
it("valida temporada y nombres, no acepta cifras negativas ni reutiliza escudos de otra liga", () => {
  const rows = normalizeLeagueRanking(
    response([
      player(1),
      { ...player(2), goals: -1 },
      { ...player(3), assists: null },
    ]),
    "PD",
    "PD-2026",
    [fixture()],
  );
  expect(rows[0].crest).toBe(fixture().homeCrest);
  expect(rows[1].goals).toBeUndefined();
  expect(rows[2].assists).toBeUndefined();
  expect(
    normalizeLeagueRanking(response([player(1)]), "CL", "CL-2026", [
      fixture(),
    ])[0].crest,
  ).toBeUndefined();
  expect(() =>
    normalizeLeagueRanking(
      response([player(1)], "2025-08-01"),
      "PD",
      "PD-2026",
      [],
    ),
  ).toThrow();
  expect(() =>
    normalizeLeagueRanking(
      response([player(1)], "2026-01-01"),
      "PD",
      "PD-2026",
      [],
    ),
  ).toThrow();
  expect(() =>
    normalizeLeagueRanking(
      { success: false, season_from: "2026-08-01", data: [] },
      "PD",
      "PD-2026",
      [],
    ),
  ).toThrow();
  expect(
    normalizeLeagueRanking(
      response([player(1), player(1)]),
      "PD",
      "PD-2026",
      [],
    ),
  ).toEqual([]);
});
it("construye top 5 ordenados, separa tarjetas y suma participación solo si ambas cifras están publicadas", () => {
  const goals = normalizeLeagueRanking(
    response(Array.from({ length: 8 }, (_, i) => player(i + 1))),
    "PD",
    "PD-2026",
    [],
  );
  const assists = normalizeLeagueRanking(
    response([player(8), player(7)]),
    "PD",
    "PD-2026",
    [],
  );
  const stats = buildLeagueStats(
    "PD",
    "PD-2026",
    { topscorers: goals, topassists: assists, topcards: [...goals].reverse() },
    now,
  );
  expect(stats.rankings.goals?.map((r) => r.value)).toEqual([8, 7, 6, 5, 4]);
  expect(stats.rankings.goalContributions?.map((r) => r.value)).toEqual([
    16, 14,
  ]);
  expect(stats.rankings.minutes).toBeUndefined();
  expect(stats.rankings.cleanSheets).toBeUndefined();
  expect(validLeagueStats(stats)).toBe(true);
  expect(
    validLeagueStats({
      ...stats,
      rankings: { goals: [{ ...stats.rankings.goals![0], value: -1 }] },
    }),
  ).toBe(false);
  expect(
    topFive(
      goals.map((g) => ({
        key: g.key,
        name: g.name,
        team: g.team,
        value: g.goals!,
      })),
      true,
    )[0].value,
  ).toBe(1);
});
it("la tabla separa competición y temporada, incluye equipos sin partidos y conserva V/E/D y GF/GC", () => {
  const matches = [
    fixture(),
    fixture({
      id: "2",
      status: "TIMED",
      home: "Tercero",
      homeTeamId: 3,
      away: "Real Madrid",
      homeScore: null,
      awayScore: null,
    }),
    fixture({ id: "old", seasonId: "PD-2025", homeScore: 99 }),
    fixture({ id: "cl", competition: "CL", homeScore: 90 }),
  ];
  const rows = seasonLeagueTable(matches, "PD", "PD-2026", now);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({
    name: "FC Barcelona",
    points: 3,
    played: 1,
    wins: 1,
    draws: 0,
    losses: 0,
    goalsFor: 2,
    goalsAgainst: 1,
  });
  expect(rows.find((r) => r.name === "Tercero")?.played).toBe(0);
  expect(competitionSeasons(matches, "PD")).toEqual(["PD-2026", "PD-2025"]);
  expect(seasonLabel("PD-2026")).toBe("2026/27");
  expect(leagueTab("invalid")).toBe("partidos");
});
it("las noticias de cada liga tienen feed propio, orden reciente y filtro de temporada", () => {
  const article = (competition: "PD" | "CL", day: number) => ({
    competition,
    title: `Titular ${day}`,
    url: `https://www.espn.com/${competition}/${day}`,
    publishedAt: `2026-11-0${day}T10:00:00Z`,
  });
  const news: FootballNews = {
    version: 1,
    provider: "ESPN",
    fetchedAt: new Date(now).toISOString(),
    articles: [article("PD", 6)],
    competitionArticles: { CL: [article("CL", 4), article("CL", 6)] },
  };
  expect(validNews(news)).toBe(true);
  expect(
    currentArticles(news, now, "CL", "CL-2026").map((a) => a.title),
  ).toEqual(["Titular 6", "Titular 4"]);
  expect(currentArticles(news, now, "CL", "CL-2025")).toEqual([]);
  expect(currentArticles(news, now, "PD", "CL-2026")).toEqual([]);
  expect(
    validNews({ ...news, competitionArticles: { CL: [article("PD", 6)] } }),
  ).toBe(false);
});
function database() {
  const documents = new Map<string, unknown>();
  const set = vi.fn(async (path: string, data: unknown) => {
    documents.set(path, data);
  });
  const doc = (path: string) => ({
    path,
    get: async () => ({ data: () => documents.get(path) }),
    set: async (data: unknown) => set(path, data),
  });
  const db = {
    doc,
    runTransaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        get: async (ref: { path: string }) => ({
          data: () => documents.get(ref.path),
        }),
        set: (ref: { path: string }, data: unknown) => {
          documents.set(ref.path, data);
        },
      }),
  } as unknown as Firestore;
  return { db, documents, set };
}
it("sincroniza con 3 consultas por liga, reutiliza seis horas de caché y comparte el límite mensual", async () => {
  const { db, documents, set } = database();
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () => new Response(JSON.stringify(response([player(2)]))),
    );
  const log = vi.fn();
  await syncLeagueStats(db, "TEST_KEY", [fixture()], {
    now,
    request,
    runId: "first",
    log,
  });
  expect(request).toHaveBeenCalledTimes(3);
  expect(set).toHaveBeenCalledTimes(1);
  expect(validLeagueStats(documents.get("leagueStats/PD-2026"))).toBe(true);
  expect(
    (documents.get("providerBudgets/sportapi") as { monthUsed: number })
      .monthUsed,
  ).toBe(3);
  expect(
    request.mock.calls.every(
      ([url, options]) =>
        String(url).startsWith("https://sportapi.ai/api/leagues/1/") &&
        !String(url).includes("TEST_KEY") &&
        options?.redirect === "error",
    ),
  ).toBe(true);
  await syncLeagueStats(db, "TEST_KEY", [fixture()], {
    now: now + 3600000,
    request,
    runId: "cached",
    log,
  });
  expect(request).toHaveBeenCalledTimes(3);
});
it("una temporada incorrecta o un bloqueo HTTP conserva los datos y no reintenta ni registra secretos", async () => {
  for (const invalid of [true, false]) {
    const { db, documents, set } = database();
    documents.set("leagueStats/PD-2026", { old: "KEEP" });
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        invalid
          ? new Response(JSON.stringify(response([player(2)], "2025-08-01")))
          : new Response("PRIVATE_BODY", { status: 401 }),
      );
    const log = vi.fn();
    await syncLeagueStats(db, "PRIVATE_KEY", [fixture()], {
      now,
      request,
      runId: "invalid",
      log,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    expect(documents.get("leagueStats/PD-2026")).toEqual({ old: "KEEP" });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE/);
  }
});
it("no consulta al proveedor sin calendarios o con el presupuesto mensual agotado", async () => {
  const { db, documents } = database();
  const request = vi.fn<typeof fetch>();
  await syncLeagueStats(db, "TEST_KEY", [], { now, request, runId: "empty" });
  expect(request).not.toHaveBeenCalled();
  documents.set("providerBudgets/sportapi", {
    version: 1,
    reservations: [],
    month: "2026-11",
    monthUsed: 12000,
  });
  await syncLeagueStats(db, "TEST_KEY", [fixture()], {
    now,
    request,
    runId: "quota",
  });
  expect(request).not.toHaveBeenCalled();
});
