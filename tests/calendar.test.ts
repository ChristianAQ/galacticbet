import { afterEach, expect, it, vi } from "vitest";
import {
  CALENDAR_FORMAT,
  calendarMatch,
  decodeCalendar,
  encodeCalendar,
} from "../src/lib/calendar";
import {
  CALENDAR_STALE_LIMIT,
  CALENDAR_TTL,
  createCalendarLoader,
} from "../src/lib/calendarCache";
import type { Match } from "../src/lib/domain";

const match: Match = {
  id: "1",
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "PD-2026-REGULAR_SEASON-1",
  matchday: 1,
  stage: "REGULAR_SEASON",
  utcDate: "2026-10-24T19:00:00Z",
  status: "TIMED",
  home: "Local",
  away: "Visitante",
  homeScore: null,
  awayScore: null,
};
const storage = () => {
  const records = new Map<string, string>();
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
    records,
  };
};
afterEach(() => vi.useRealTimers());

it("filtra Copa de la caché anterior y de respuestas nuevas conservando el resto", async () => {
  const store = storage();
  const old = {
    ...match,
    id: "cup",
    competition: "CDR" as const,
    seasonId: "CDR-2026",
  };
  store.setItem(
    "galacticbet:calendar:v1:project",
    JSON.stringify({ savedAt: Date.now(), matches: [match, old] }),
  );
  const fetch = vi.fn(async () => [match, old]);
  expect(await createCalendarLoader("project", () => store, fetch)()).toEqual([
    calendarMatch(match),
  ]);
  expect(fetch).not.toHaveBeenCalled();
  expect(await createCalendarLoader("another", () => store, fetch)()).toEqual([
    calendarMatch(match),
  ]);
});

it("publica solo campos de calendario con orden estable y conserva todas las jornadas", () => {
  const other = {
    ...match,
    id: "2",
    matchday: 2,
    roundId: "PD-2026-REGULAR_SEASON-2",
  };
  const privateData = {
    ...match,
    predictions: { alice: "1" },
    syncedAt: { seconds: 1 },
  };
  const payload = encodeCalendar([other, privateData]);
  expect(payload).toBe(encodeCalendar([match, other]));
  expect(payload).not.toMatch(/predictions|syncedAt/);
  expect(
    decodeCalendar({
      formatVersion: CALENDAR_FORMAT,
      seasonId: match.seasonId,
      payload,
    }),
  ).toEqual([calendarMatch(match), calendarMatch(other)]);
});
it("rechaza versiones desconocidas, datos corruptos y temporadas mezcladas", () => {
  const data = {
    formatVersion: CALENDAR_FORMAT,
    seasonId: match.seasonId,
    payload: encodeCalendar([match]),
  };
  expect(() => decodeCalendar({ ...data, formatVersion: 99 })).toThrow();
  expect(() => decodeCalendar({ ...data, payload: "{}" })).toThrow();
  expect(() => decodeCalendar({ ...data, seasonId: "CL-2026" })).toThrow();
  expect(() =>
    decodeCalendar({
      ...data,
      payload: JSON.stringify([{ ...match, utcDate: "bad" }]),
    }),
  ).toThrow();
});
it("comparte la petición inicial, evita lecturas al recargar y refresca tras cinco minutos", async () => {
  vi.useFakeTimers();
  const local = storage();
  const fetch = vi.fn(async () => [match]);
  const load = createCalendarLoader("project", () => local, fetch);
  const [first, second] = await Promise.all([load(), load()]);
  expect(first).toEqual(second);
  expect(fetch).toHaveBeenCalledTimes(1);
  await createCalendarLoader("project", () => local, fetch)();
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(CALENDAR_TTL);
  fetch.mockResolvedValueOnce([
    { ...match, status: "FINISHED", homeScore: 1, awayScore: 0 },
  ]);
  expect((await load())[0].homeScore).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("aísla los proyectos y no confía en una fecha futura o datos locales corruptos", async () => {
  const local = storage();
  const fetch = vi.fn(async () => [match]);
  await createCalendarLoader("one", () => local, fetch)();
  await createCalendarLoader("two", () => local, fetch)();
  expect(fetch).toHaveBeenCalledTimes(2);
  local.setItem(
    "galacticbet:calendar:v1:one",
    JSON.stringify({ savedAt: Date.now() + CALENDAR_TTL, matches: [match] }),
  );
  await createCalendarLoader("one", () => local, fetch)();
  local.setItem("galacticbet:calendar:v1:one", "{broken");
  await createCalendarLoader("one", () => local, fetch)();
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("sin almacenamiento sigue usando memoria y un fallo permite reintentar sin conservar un calendario vacío", async () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  const fetch = vi
    .fn<() => Promise<Match[]>>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([])
    .mockResolvedValue([match]);
  const load = createCalendarLoader("project", blocked, fetch);
  await expect(load()).rejects.toThrow("offline");
  await expect(load()).rejects.toThrow("Aún no hay calendarios");
  expect(await load()).toEqual([calendarMatch(match)]);
  await load();
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("limita la persistencia sin perder el calendario disponible en memoria", async () => {
  const local = storage();
  const large = { ...match, home: "x".repeat(1_500_000) };
  const fetch = vi.fn(async () => [large]);
  const load = createCalendarLoader("project", () => local, fetch);
  expect(await load()).toHaveLength(1);
  expect(local.records.size).toBe(0);
  await load();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("admite calendarios antiguos y rechaza estadísticas nuevas mal formadas", () => {
  const read = (extra: object) =>
    decodeCalendar({
      formatVersion: CALENDAR_FORMAT,
      seasonId: match.seasonId,
      payload: JSON.stringify([{ ...match, ...extra }]),
    });
  expect(read({})).toHaveLength(1);
  for (const extra of [
    { winner: "HOME_TEAM" },
    { winner: 1 },
    { halfTimeHomeScore: -1 },
    { halfTimeAwayScore: "0" },
  ])
    expect(() => read(extra)).toThrow();
  expect(
    read({ winner: "2", halfTimeHomeScore: 0, halfTimeAwayScore: 1 })[0],
  ).toMatchObject({ winner: "2", halfTimeHomeScore: 0, halfTimeAwayScore: 1 });
});

it("pinta al instante una copia de hace días y la descarga fresca la sustituye", async () => {
  vi.useFakeTimers();
  const local = storage();
  const fetch = vi.fn(async () => [match]);
  await createCalendarLoader("project", () => local, fetch)();
  vi.advanceTimersByTime(2 * 24 * 3_600_000);
  fetch.mockResolvedValueOnce([
    { ...match, status: "FINISHED", homeScore: 2, awayScore: 1 },
  ]);
  const load = createCalendarLoader("project", () => local, fetch);
  // Two days old: shown at launch without a network read...
  expect(load.peek()?.[0].status).toBe("TIMED");
  expect(fetch).toHaveBeenCalledTimes(1);
  // ...but due a refresh, so load() goes to the server.
  expect((await load())[0].homeScore).toBe(2);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(load.peek()?.[0].homeScore).toBe(2);
});
it("no pinta copias de más de una semana ni datos sin calendario", async () => {
  vi.useFakeTimers();
  const local = storage();
  expect(createCalendarLoader("project", () => local, vi.fn()).peek()).toBeUndefined();
  await createCalendarLoader("project", () => local, async () => [match])();
  vi.advanceTimersByTime(CALENDAR_STALE_LIMIT);
  expect(createCalendarLoader("project", () => local, vi.fn()).peek()).toBeUndefined();
});
