import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSnapshotStore, SNAPSHOT_PREFIX } from "../src/lib/localSnapshot";

const memory = () => {
  const records = new Map<string, string>();
  return {
    records,
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => void records.set(key, value),
    removeItem: (key: string) => void records.delete(key),
    key: (index: number) => [...records.keys()][index] ?? null,
    get length() {
      return records.size;
    },
  };
};
const isNumbers = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((n) => typeof n === "number");
const HOUR = 3_600_000;

afterEach(() => vi.useRealTimers());

it("guarda y lee instantáneas dentro de su antigüedad máxima", () => {
  vi.useFakeTimers();
  const local = memory();
  const store = createSnapshotStore(() => local);
  store.write("u1:groups", [1, 2]);
  expect(store.read("u1:groups", HOUR, isNumbers)?.value).toEqual([1, 2]);
  vi.advanceTimersByTime(HOUR);
  expect(store.read("u1:groups", HOUR, isNumbers)).toBeUndefined();
});

it("descarta datos corruptos, con otra forma o fechados en el futuro", () => {
  const local = memory();
  const store = createSnapshotStore(() => local);
  local.setItem(`${SNAPSHOT_PREFIX}a`, "{broken");
  local.setItem(`${SNAPSHOT_PREFIX}b`, JSON.stringify({ savedAt: Date.now(), value: ["x"] }));
  local.setItem(
    `${SNAPSHOT_PREFIX}c`,
    JSON.stringify({ savedAt: Date.now() + HOUR, value: [1] }),
  );
  for (const key of ["a", "b", "c"])
    expect(store.read(key, HOUR, isNumbers)).toBeUndefined();
});

it("no guarda instantáneas enormes y borra la anterior", () => {
  const local = memory();
  const store = createSnapshotStore(() => local);
  store.write("big", [1]);
  store.write("big", "x".repeat(300_000));
  expect(local.records.size).toBe(0);
});

it("al cerrar sesión borra solo las instantáneas privadas", () => {
  const local = memory();
  local.setItem("galacticbet:theme", "dark");
  local.setItem("galacticbet:calendar:v1:p", "{}");
  const store = createSnapshotStore(() => local);
  store.write("u1:groups", [1]);
  store.write("u2:rankings:g", [2]);
  store.clear();
  expect([...local.records.keys()].sort()).toEqual([
    "galacticbet:calendar:v1:p",
    "galacticbet:theme",
  ]);
});

it("sin almacenamiento disponible no rompe nada", () => {
  const store = createSnapshotStore(() => {
    throw new Error("blocked");
  });
  expect(() => store.write("k", [1])).not.toThrow();
  expect(store.read("k", HOUR, isNumbers)).toBeUndefined();
  expect(() => store.clear()).not.toThrow();
});

describe("sesión recordada", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", { localStorage: memory() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("recuerda la cuenta y la olvida (con sus datos) al cerrar sesión", async () => {
    const { readSession, rememberSession } = await import("../src/lib/session");
    const { snapshots } = await import("../src/lib/localSnapshot");
    expect(readSession()).toBeNull();
    rememberSession({ uid: "u1", displayName: "Ana", photoURL: null, email: null });
    snapshots.write("u1:groups", [1]);
    expect(readSession()?.displayName).toBe("Ana");
    rememberSession(null);
    expect(readSession()).toBeNull();
    expect(snapshots.read("u1:groups", HOUR, isNumbers)).toBeUndefined();
  });

  it("otra cuenta en el mismo dispositivo no hereda instantáneas", async () => {
    const { rememberSession } = await import("../src/lib/session");
    const { snapshots } = await import("../src/lib/localSnapshot");
    rememberSession({ uid: "u1", displayName: "Ana", photoURL: null, email: null });
    snapshots.write("u1:groups", [1]);
    rememberSession({ uid: "u2", displayName: "Bea", photoURL: null, email: null });
    expect(snapshots.read("u1:groups", HOUR, isNumbers)).toBeUndefined();
  });
});
