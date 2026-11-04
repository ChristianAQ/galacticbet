import { expect, it, vi } from "vitest";
import {
  applySportFixture,
  createSportApiClient,
  findSportFixture,
  parseSportFixtures,
  preserveSportResult,
} from "../scripts/sportApi";
import { sportApiCandidates } from "../scripts/syncSportApi";
import { allocateSportApiRequests } from "../scripts/sportApiBudget";
import { decodeCalendar, encodeCalendar } from "../src/lib/calendar";
import { normalize } from "../scripts/normalize";
import type { Match } from "../src/lib/domain";
const date = "2026-11-04";
const now = Date.parse(date + "T22:00:00Z");
const match: Match = {
  id: "123",
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "PD-2026-REGULAR_SEASON-12",
  stage: "REGULAR_SEASON",
  matchday: 12,
  utcDate: date + "T20:00:00Z",
  status: "TIMED",
  home: "FC Barcelona",
  away: "Real Madrid CF",
  homeScore: null,
  awayScore: null,
};
const row = {
  id: 555,
  league_id: 1,
  home_team: "Barcelona",
  away_team: "Real Madrid",
  kickoff_utc: match.utcDate,
  updated_at: date + "T21:59:00Z",
  home_score: 2,
  away_score: 1,
  status: "FT",
  minute: null,
  penalty_home: null,
  penalty_away: null,
};
const fixture = (change = {}) =>
  parseSportFixtures(
    { success: true, date, data: [{ ...row, ...change }] },
    date,
  )[0];
it("asocia únicamente competición, ambos rivales, localía y hora, sin coincidencias ambiguas", () => {
  const good = fixture();
  expect(findSportFixture(match, [good])).toEqual(good);
  for (const bad of [
    fixture({ league_id: 24 }),
    fixture({ home_team: "Real Madrid", away_team: "Barcelona" }),
    fixture({ kickoff_utc: date + "T19:00:00Z" }),
    fixture({ away_team: "Atlético Madrid" }),
  ])
    expect(findSportFixture(match, [bad])).toBeNull();
  expect(findSportFixture(match, [good, good])).toBeNull();
  expect(findSportFixture({ ...match, sportApiId: "999" }, [good])).toBeNull();
});
it("publica el resultado FT, ganador y fuente y los conserva en el calendario", () => {
  const updated = applySportFixture(match, fixture(), now);
  expect(updated).toMatchObject({
    id: match.id,
    roundId: match.roundId,
    status: "FINISHED",
    homeScore: 2,
    awayScore: 1,
    winner: "1",
    resultProvider: "SportAPI",
    sportApiId: "555",
    scoreDuration: "REGULAR",
  });
  expect(
    decodeCalendar({
      formatVersion: 1,
      seasonId: match.seasonId,
      payload: encodeCalendar([updated]),
    })[0],
  ).toEqual(updated);
});
it("acepta marcador cero y descanso, sin puntuar un encuentro en juego", () => {
  const live = fixture({
    status: "LIVE",
    minute: "HT",
    home_score: 0,
    away_score: 0,
  });
  expect(applySportFixture(match, live, now)).toMatchObject({
    status: "PAUSED",
    homeScore: 0,
    awayScore: 0,
    winner: null,
  });
  expect(
    applySportFixture(match, fixture({ status: "LIVE", minute: "90+7'" }), now)
      .status,
  ).toBe("IN_PLAY");
});
it("rechaza prórroga, penaltis, marcadores inválidos, fechas futuras y datos obsoletos", () => {
  for (const change of [
    { status: "AET" },
    { status: "PENS" },
    { penalty_home: 0 },
    { status: "LIVE", minute: "105" },
    { home_score: -1 },
    { away_score: "1" },
    { updated_at: date + "T22:30:00Z" },
    { updated_at: "invalid" },
    { updated_at: date + "T15:00:00Z" },
  ])
    expect(applySportFixture(match, fixture(change), now)).toBe(match);
  expect(
    applySportFixture(match, fixture(), Date.parse(match.utcDate) + 89 * 60000),
  ).toBe(match);
  expect(
    applySportFixture({ ...match, scoreDuration: "EXTRA_TIME" }, fixture(), now)
      .resultProvider,
  ).toBeUndefined();
});
it("prioriza el marcador oficial, conserva SportAPI frente a un calendario retrasado y acepta correcciones", () => {
  const fast = applySportFixture(match, fixture(), now);
  expect(
    preserveSportResult({ ...match, status: "FINISHED" }, fast),
  ).toMatchObject({ homeScore: 2, resultProvider: "SportAPI" });
  expect(preserveSportResult(match, fast)).toMatchObject({
    status: "FINISHED",
    homeScore: 2,
  });
  const official = { ...match, status: "FINISHED", homeScore: 1, awayScore: 1 };
  expect(preserveSportResult(official, fast)).toBe(official);
  expect(applySportFixture(official, fixture(), now)).toBe(official);
  expect(
    preserveSportResult({ ...match, utcDate: date + "T21:00:00Z" }, fast)
      .resultProvider,
  ).toBeUndefined();
  expect(
    preserveSportResult({ ...match, scoreDuration: "EXTRA_TIME" }, fast)
      .resultProvider,
  ).toBeUndefined();
  expect(
    applySportFixture(fast, fixture({ status: "LIVE", minute: "80" }), now),
  ).toBe(fast);
  expect(
    applySportFixture(fast, fixture({ home_score: 3 }), now).homeScore,
  ).toBe(3);
});
it("bloquea respuestas con envoltura errónea y no convierte fechas locales en UTC", () => {
  for (const body of [
    { success: false, date, data: [] },
    { success: true, date: "2020-01-01", data: [] },
    { success: true, date, data: {} },
  ])
    expect(() => parseSportFixtures(body, date)).toThrow();
  expect(
    parseSportFixtures(
      {
        success: true,
        date,
        data: [{ ...row, kickoff_utc: "2026-11-04 21:00:00" }],
      },
      date,
    ),
  ).toEqual([]);
});
it("no consulta calendarios sin partidos cercanos, archivados o ya confirmados por Football-Data", () => {
  expect(sportApiCandidates([match], now)).toHaveLength(1);
  expect(sportApiCandidates([{ ...match, status: "FINISHED" }], now)).toEqual(
    [],
  );
  expect(sportApiCandidates([match], now + 12 * 3600000)).toEqual([]);
  expect(
    sportApiCandidates(
      [{ ...match, utcDate: new Date(now + 16 * 60000).toISOString() }],
      now,
    ),
  ).toEqual([]);
});
it("limita también a 12000 al mes, no reinicia por cambio de día y sí por cambio de mes UTC", () => {
  const old = {
    version: 1,
    reservations: [],
    month: "2026-11",
    monthUsed: 11999,
  };
  const next = allocateSportApiRequests(old, "a", 3, now);
  expect(next.granted).toBe(1);
  expect(next.ledger.monthUsed).toBe(12000);
  expect(
    allocateSportApiRequests(next.ledger, "b", 3, now + 86400000).granted,
  ).toBe(0);
  expect(
    allocateSportApiRequests(
      next.ledger,
      "c",
      3,
      Date.parse("2026-12-01T00:00:00Z"),
    ).granted,
  ).toBe(3);
  expect(() =>
    allocateSportApiRequests(
      next.ledger,
      "d",
      3,
      Date.parse("2026-10-31T00:00:00Z"),
    ),
  ).toThrow();
});
it("usa exclusivamente el host y la cabecera documentados, sin redirecciones ni clave en URL", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ success: true, date, data: [row] })),
    );
  await createSportApiClient("PRIVATE_KEY", 1, request).fixtures(date);
  expect(request).toHaveBeenCalledWith(
    "https://sportapi.ai/api/fixtures/date/2026-11-04",
    expect.objectContaining({
      headers: { "X-Api-Key": "PRIVATE_KEY" },
      redirect: "error",
    }),
  );
});
it("un 401, 403, 429 o fallo no reintenta ni filtra cuerpos o credenciales", async () => {
  for (const status of [401, 403, 429, 500]) {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("PRIVATE_BODY", { status }));
    const client = createSportApiClient("PRIVATE_KEY", 3, request);
    await expect(client.fixtures(date)).rejects.toThrow(`HTTP ${status}`);
    await expect(client.fixtures(date)).rejects.not.toThrow(/PRIVATE/);
    expect(request).toHaveBeenCalledTimes(1);
  }
});
it("cuenta todas las peticiones y valida fechas antes de enviar la clave", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ success: true, date, data: [] })),
    );
  const client = createSportApiClient("PRIVATE_KEY", 1, request);
  await expect(client.fixtures("../keys")).rejects.toThrow();
  await client.fixtures(date);
  await expect(client.fixtures(date)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});
// Keep normalization imports covered when the primary provider later confirms a finished match.
it("la normalización oficial sigue usando regularTime en una eliminatoria", () => {
  const m = normalize(
    {
      id: 1,
      utcDate: match.utcDate,
      status: "FINISHED",
      matchday: 1,
      stage: "FINAL",
      season: { id: 1, startDate: "2026-08-01", endDate: "2027-06-01" },
      homeTeam: { name: "Barcelona" },
      awayTeam: { name: "Real Madrid" },
      score: {
        duration: "PENALTY_SHOOTOUT",
        regularTime: { home: 1, away: 1 },
        fullTime: { home: 5, away: 4 },
      },
    },
    "CL",
  );
  expect(m).toMatchObject({ homeScore: 1, awayScore: 1 });
});
