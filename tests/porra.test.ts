import { expect, it } from "vitest";
import {
  MAX_PORRAS,
  parseContribution,
  porraStorageKey,
  porraText,
  porraTotal,
  readPorras,
  removePorra,
  savePorra,
  validPorra,
  type Porra,
} from "../src/lib/porra";
const pool: Porra = {
  id: "pool",
  title: "La porra del Clásico",
  fixture: {
    id: "1",
    competition: "PD",
    home: "FC Barcelona",
    away: "Real Madrid",
    utcDate: "2026-10-30T20:00:00Z",
  },
  players: [
    { id: "juan", name: "Juan", home: 2, away: 1 },
    { id: "pepe", name: "Pepe", home: 3, away: 1 },
  ],
  contributionCents: 250,
  demo: false,
  createdAt: 1,
  updatedAt: 1,
};
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
it("trata euros y céntimos sin errores de coma flotante", () => {
  expect(parseContribution("2,50")).toBe(250);
  expect(parseContribution("0.10")).toBe(10);
  expect(parseContribution("0")).toBe(0);
  expect(parseContribution("10000")).toBe(1_000_000);
  for (const value of [
    "",
    "-1",
    "1,234",
    "1e2",
    "2.5.0",
    "Infinity",
    "10001",
    "€2",
  ])
    expect(parseContribution(value)).toBeNull();
  expect(porraTotal(pool)).toBe(500);
  expect(
    porraTotal({
      ...pool,
      contributionCents: 10,
      players: [...pool.players, { id: "ana", name: "Ana", home: 0, away: 0 }],
    }),
  ).toBe(30);
});
it("valida participantes, goles y fechas y conserva empates cero a cero", () => {
  expect(validPorra(pool)).toBe(true);
  expect(
    validPorra({
      ...pool,
      players: [{ id: "1", name: "Ana", home: 0, away: 0 }],
    }),
  ).toBe(true);
  for (const players of [
    [],
    [{ id: "1", name: " ", home: 2, away: 1 }],
    [{ id: "1", name: "Ana", home: 1.5, away: 0 }],
    [{ id: "1", name: "Ana", home: 100, away: 0 }],
    [pool.players[0], pool.players[0]],
    Array.from({ length: 31 }, (_, i) => ({
      ...pool.players[0],
      id: String(i),
    })),
  ])
    expect(validPorra({ ...pool, players })).toBe(false);
  expect(
    validPorra({ ...pool, fixture: { ...pool.fixture, utcDate: "invalid" } }),
  ).toBe(false);
  expect(validPorra({ ...pool, contributionCents: 0.5 })).toBe(false);
});
it("guarda, vuelve a leer y edita sin duplicar porras ni perder las demás", () => {
  const store = storage(),
    key = porraStorageKey("alice");
  savePorra(store, key, pool);
  savePorra(store, key, { ...pool, id: "second", updatedAt: 2 });
  savePorra(store, key, {
    ...pool,
    title: "Editada",
    contributionCents: 300,
    updatedAt: 3,
  });
  expect(readPorras(store, key).map((p) => p.title)).toEqual([
    "Editada",
    pool.title,
  ]);
  expect(readPorras(store, key)[0].contributionCents).toBe(300);
  expect(removePorra(store, key, pool.id).map((p) => p.id)).toEqual(["second"]);
});
it("separa el guardado de cada cuenta y del invitado", () => {
  const store = storage();
  savePorra(store, porraStorageKey("alice"), pool);
  expect(readPorras(store, porraStorageKey("bob"))).toEqual([]);
  expect(readPorras(store, porraStorageKey(""))).toEqual([]);
});
it("respeta el límite y permite editar una porra existente al alcanzarlo", () => {
  const store = storage(),
    key = "p";
  for (let i = 0; i < MAX_PORRAS; i++)
    savePorra(store, key, { ...pool, id: String(i) });
  const before = store.getItem(key);
  expect(() => savePorra(store, key, { ...pool, id: "overflow" })).toThrow();
  expect(store.getItem(key)).toBe(before);
  expect(
    savePorra(store, key, { ...pool, id: "0", title: "Editada" }),
  ).toHaveLength(MAX_PORRAS);
});
it("no sobrescribe datos corruptos ni versiones desconocidas", () => {
  const store = storage(),
    key = "p";
  for (const raw of [
    "broken",
    JSON.stringify({ version: 2, porras: [pool] }),
    JSON.stringify({ version: 1, porras: [{ ...pool, players: [] }] }),
  ]) {
    store.setItem(key, raw);
    expect(() => savePorra(store, key, pool)).toThrow();
    expect(store.getItem(key)).toBe(raw);
  }
});
it("no afirma guardado si el almacenamiento falla", () => {
  const store = storage();
  savePorra(store, "p", pool);
  const before = store.getItem("p");
  const denied = {
    getItem: store.getItem,
    setItem: () => {
      throw new Error("quota");
    },
  };
  expect(() => savePorra(denied, "p", { ...pool, title: "Otra" })).toThrow();
  expect(store.getItem("p")).toBe(before);
});
it("el texto compartido incluye todos los marcadores y el dinero, identificando las demos", () => {
  const text = porraText(pool);
  expect(text).toContain("Juan: 2 – 1");
  expect(text).toContain("Pepe: 3 – 1");
  expect(text).toContain("Bote total: 5,00");
  expect(porraText({ ...pool, demo: true })).toContain("DEMO");
});
it("acepta partidos de competiciones entre amigos con su nombre y los muestra con él", async () => {
  const { fixtureSnapshot, porraLeague } = await import("../src/lib/porra");
  const friends = {
    ...pool,
    fixture: { ...pool.fixture, id: "c:liga1:L1-0", league: "Liga de los sábados" },
  };
  expect(validPorra(friends)).toBe(true);
  expect(porraLeague(friends.fixture)).toBe("Liga de los sábados");
  expect(porraLeague(pool.fixture)).not.toBe("Liga de los sábados");
  expect(validPorra({ ...friends, fixture: { ...friends.fixture, league: "" } })).toBe(false);
  expect(validPorra({ ...friends, fixture: { ...friends.fixture, league: "x".repeat(61) } })).toBe(false);
  // A league fixture still needs a known competition.
  expect(validPorra({ ...pool, fixture: { ...pool.fixture, competition: "XX" as never } })).toBe(false);
  const match = { ...pool.fixture, roundId: "r", matchday: 1, status: "TIMED", homeScore: null, awayScore: null };
  expect(fixtureSnapshot(match as never, "Liga de los sábados")).toMatchObject({ league: "Liga de los sábados" });
  expect(fixtureSnapshot(match as never)).not.toHaveProperty("league");
});
