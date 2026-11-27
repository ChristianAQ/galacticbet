import { afterEach, beforeEach, expect, it, vi } from "vitest";

// A minimal in-memory Firestore: paths in, snapshots out, writes recorded.
const { stored, written } = vi.hoisted(() => ({
  stored: new Map<string, Record<string, unknown>>(),
  written: new Map<string, Record<string, unknown>>(),
}));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: () => "now",
  doc: (parent: { path?: string }, ...segments: string[]) => {
    const path = [parent.path, ...segments].filter(Boolean).join("/");
    return { path, id: segments.at(-1) };
  },
  runTransaction: (
    _store: unknown,
    run: (tx: {
      get: (ref: { path: string }) => Promise<unknown>;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<unknown>,
  ) =>
    run({
      get: async (ref) => ({
        exists: () => stored.has(ref.path),
        data: () => stored.get(ref.path),
      }),
      set: (ref, data) => void written.set(ref.path, data),
    }),
}));

import type { Firestore } from "firebase/firestore";
import { prepareGroupCompetitions } from "../src/lib/groupSetup";

const store = {} as Firestore;
beforeEach(() => {
  stored.clear();
  written.clear();
  stored.set("groups/g", { ownerId: "alice", memberIds: ["alice"] });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-07-02T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

it("una temporada nueva conserva la modalidad de la anterior", async () => {
  for (const c of ["PD", "CL", "PL"])
    stored.set(`groups/g/gameSeasons/${c}-2026`, { competition: c, mode: "exact" });
  await expect(prepareGroupCompetitions(store, "alice", "g")).resolves.toBe(true);
  for (const c of ["PD", "CL", "PL"])
    expect(written.get(`groups/g/gameSeasons/${c}-2027`)).toMatchObject({
      competition: c,
      seasonId: `${c}-2027`,
      mode: "exact",
    });
});

it("la temporada en curso manda sobre la anterior, y sin ninguna es 1X2", async () => {
  stored.set("groups/g/gameSeasons/PD-2026", { competition: "PD", mode: "exact" });
  stored.set("groups/g/gameSeasons/PD-2027", { competition: "PD", mode: "classic" });
  await prepareGroupCompetitions(store, "alice", "g");
  expect(written.has("groups/g/gameSeasons/PD-2027")).toBe(false);
  expect(written.get("groups/g/gameSeasons/CL-2027")?.mode).toBe("classic");
  stored.clear();
  written.clear();
  stored.set("groups/g", { ownerId: "alice", memberIds: ["alice"] });
  await prepareGroupCompetitions(store, "alice", "g");
  expect(written.get("groups/g/gameSeasons/PL-2027")?.mode).toBe("classic");
});
