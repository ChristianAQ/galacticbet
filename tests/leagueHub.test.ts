import { expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  buildLeagueStats,
  normalizeScorers,
  syncLeagueStats,
} from "../scripts/syncLeagueStats";
import { validLeagueStats, topFive } from "../src/lib/leagueStats";
import { seasonFigures, teamBoards, teamLines } from "../src/lib/seasonFigures";
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
const scorer = (i: number, extra: Record<string, unknown> = {}) => ({
  player: { id: i, name: `Jugador ${i}` },
  team: { id: 81, name: "FC Barcelona", shortName: "Barça", crest: "https://crests.football-data.org/81.png" },
  playedMatches: 12,
  goals: i,
  assists: i % 2 ? null : 1,
  penalties: 0,
  ...extra,
});
const scorers = (list: unknown[], startDate = "2026-08-15", code = "PD") => ({
  competition: { code },
  season: { startDate },
  scorers: list,
});
it("goleadores oficiales: valida temporada y competición, no inventa asistencias y ordena por goles", () => {
  const rows = normalizeScorers(
    scorers([scorer(3), scorer(7), { ...scorer(5), goals: -1 }, scorer(7), scorer(4, { team: { name: "Girona FC" } })]),
    "PD",
    "PD-2026",
  );
  expect(rows.map((r) => [r.name, r.goals])).toEqual([
    ["Jugador 7", 7],
    ["Jugador 4", 4],
    ["Jugador 3", 3],
  ]);
  expect(rows[0]).toMatchObject({ key: "p7", team: "Barça", assists: null, penalties: 0, played: 12 });
  expect(rows[0].crest).toMatch(/^https:/);
  expect(rows[1]).toMatchObject({ team: "Girona FC", assists: 1 });
  expect(rows[1].crest).toBeUndefined();
  expect(() => normalizeScorers(scorers([scorer(1)], "2025-08-15"), "PD", "PD-2026")).toThrow();
  expect(() => normalizeScorers(scorers([scorer(1)], "2026-08-15", "PL"), "PD", "PD-2026")).toThrow();
  expect(() => normalizeScorers({ scorers: "x" }, "PD", "PD-2026")).toThrow();
  const stats = buildLeagueStats("PD", "PD-2026", rows, now);
  expect(validLeagueStats(stats)).toBe(true);
  expect(validLeagueStats({ ...stats, scorers: [{ ...rows[0], goals: -1 }] })).toBe(false);
  expect(validLeagueStats({ ...stats, scorers: [rows[0], rows[0]] })).toBe(false);
  // The old SportAPI edition is not read any more.
  expect(validLeagueStats({ ...stats, version: 1, provider: "SportAPI", rankings: {} })).toBe(false);
  expect(
    topFive([1, 3, 2].map((v) => ({ key: `k${v}`, name: `N${v}`, team: "", value: v })), true)[0].value,
  ).toBe(1);
});
it("cifras de la temporada y tablas de equipos salen solo de resultados oficiales", () => {
  const m = (id: string, home: string, away: string, h: number | null, a: number | null, extra: Partial<Match> = {}) =>
    fixture({ id, home, away, homeTeamId: undefined, awayTeamId: undefined, homeCrest: undefined, homeScore: h, awayScore: a, ...extra });
  const matches = [
    m("1", "A", "B", 2, 1),
    m("2", "B", "C", 0, 0),
    m("3", "C", "A", 1, 3),
    m("4", "A", "C", 1, 1),
    m("5", "B", "A", null, null, { status: "TIMED" }),
    m("6", "C", "B", 2, 2, { status: "IN_PLAY" }),
    m("7", "C", "B", null, null, { status: "CANCELLED" }),
  ];
  expect(seasonFigures(matches)).toEqual({
    played: 4,
    total: 6,
    goals: 9,
    home: 1,
    draws: 2,
    away: 1,
    bothScored: 3,
    overTwoAndHalf: 2,
  });
  const boards = teamBoards(teamLines(matches));
  expect(boards.attack.map((r) => [r.name, r.value])).toEqual([["A", 6], ["C", 2], ["B", 1]]);
  expect(boards.attack[0].team).toBe("3 partidos · 2,0 por partido");
  expect(boards.defence.map((r) => [r.name, r.value])).toEqual([["B", 2], ["A", 3], ["C", 4]]);
  expect(boards.cleanSheets.map((r) => [r.name, r.value])).toEqual([["B", 1], ["C", 1]]);
  expect(boards.cleanSheets[0].team).toBe("de 2 partidos");
  expect(boards.home.map((r) => [r.name, r.value])).toEqual([["A", 4], ["B", 1], ["C", 0]]);
  expect(boards.home[0].team).toBe("2 partidos · 1V 1E 0D");
  expect(boards.away.map((r) => [r.name, r.value])).toEqual([["A", 3], ["C", 2], ["B", 0]]);
  // A team with far fewer matches doesn't lead «menos goleados».
  const early = [...matches, m("8", "D", "A", 0, 0)];
  expect(teamBoards(teamLines(early)).defence.map((r) => r.name)).not.toContain("D");
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
it("goleadores: una consulta por ejecución a la liga más desactualizada y seis horas de caché", async () => {
  const { db, documents, set } = database();
  const api = vi.fn(async (path: string) => scorers([scorer(5)], "2026-08-15", path.split("/")[2]) as never);
  const log = vi.fn();
  const played = [fixture(), fixture({ id: "pl", competition: "PL", seasonId: "PL-2026" })];
  documents.set("leagueStats/PD-2026", buildLeagueStats("PD", "PD-2026", [], now - 7 * 3600000));
  await syncLeagueStats(db, api, played, { now, log });
  // PL had no edition at all: it goes first, and only it.
  expect(api).toHaveBeenCalledTimes(1);
  expect(api.mock.calls[0][0]).toBe("/competitions/PL/scorers?season=2026&limit=20");
  expect(validLeagueStats(documents.get("leagueStats/PL-2026"))).toBe(true);
  await syncLeagueStats(db, api, played, { now, log });
  expect(api.mock.calls[1][0]).toMatch(/^\/competitions\/PD\//);
  await syncLeagueStats(db, api, played, { now: now + 3600000, log });
  expect(api).toHaveBeenCalledTimes(2);
  expect(set).toHaveBeenCalledTimes(2);
});
it("goleadores: sin resultados no consulta; un error o una temporada distinta conservan la edición anterior", async () => {
  const { db, documents, set } = database();
  const api = vi.fn(async () => scorers([scorer(5)]) as never);
  await syncLeagueStats(db, api, [fixture({ status: "TIMED", homeScore: null, awayScore: null })], { now, log: vi.fn() });
  expect(api).not.toHaveBeenCalled();
  for (const failure of [
    async () => {
      throw new Error("Football-Data HTTP 403");
    },
    async () => scorers([scorer(5)], "2025-08-15") as never,
  ]) {
    documents.set("leagueStats/PD-2026", { old: "KEEP" });
    const log = vi.fn();
    await syncLeagueStats(db, vi.fn(failure), [fixture()], { now, log });
    expect(documents.get("leagueStats/PD-2026")).toEqual({ old: "KEEP" });
    expect(log.mock.calls[0][0]).toMatch(/se conserva la edición anterior/);
  }
  expect(set).not.toHaveBeenCalled();
});
