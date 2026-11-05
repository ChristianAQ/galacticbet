import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Match } from "../src/lib/domain";
import {
  bestOdds,
  decodeOddsBoard,
  impliedProbabilities,
  type BookmakerOdds,
} from "../src/lib/odds";
import {
  findOddsEvent,
  parseOddsEvents,
  syncOdds,
  ODDS_MONTH_LIMIT,
} from "../scripts/syncOdds";

const now = Date.parse("2026-11-05T12:00:00Z");
const match: Match = {
  id: "100",
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "PD-2026-REGULAR_SEASON-12",
  matchday: 12,
  stage: "REGULAR_SEASON",
  utcDate: "2026-11-07T20:00:00Z",
  status: "TIMED",
  home: "Club Atlético de Madrid",
  away: "Athletic Club",
  homeScore: null,
  awayScore: null,
};
const book = (key: string, title: string, prices: number[]) => ({
  key,
  title,
  last_update: "2026-11-05T11:00:00Z",
  markets: [
    {
      key: "h2h",
      outcomes: [
        { name: "Atlético Madrid", price: prices[0] },
        { name: "Athletic Bilbao", price: prices[2] },
        { name: "Draw", price: prices[1] },
      ],
    },
  ],
});
const feed = [
  {
    id: "abc",
    commence_time: "2026-11-07T20:00:00Z",
    home_team: "Atlético Madrid",
    away_team: "Athletic Bilbao",
    bookmakers: [
      book("williamhill", "William Hill", [1.9, 3.4, 4.2]),
      book("unibet_eu", "Unibet", [1.95, 3.3, 4.0]),
      { key: "broken", title: "Broken", markets: [] },
    ],
  },
];

function database(seed: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map(Object.entries(seed));
  const mock = {
    doc: (path: string) => ({
      path,
      async set(data: Record<string, unknown>) {
        docs.set(path, data);
      },
    }),
    async getAll(...refs: { path: string }[]) {
      return refs.map((r) => ({ data: () => docs.get(r.path) }));
    },
  };
  return { db: mock as unknown as Firestore, docs };
}

describe("cuotas de casas de apuestas", () => {
  it("acepta solo mercados 1X2 completos y empareja el partido", () => {
    const events = parseOddsEvents(feed);
    expect(events[0].bookmakers.map((b) => b.title)).toEqual([
      "William Hill",
      "Unibet",
    ]);
    expect(findOddsEvent(match, events)).toBe(events[0]);
    expect(
      findOddsEvent({ ...match, utcDate: "2026-11-07T22:00:00Z" }, events),
    ).toBe(null);
  });

  it("calcula la mejor cuota y la probabilidad sin margen", () => {
    const books = parseOddsEvents(feed)[0].bookmakers as BookmakerOdds[];
    expect(bestOdds(books).home).toEqual({ price: 1.95, titles: ["Unibet"] });
    const p = impliedProbabilities(books)!;
    expect(p.home + p.draw + p.away).toBeCloseTo(100, 6);
    expect(p.home).toBeGreaterThan(p.away);
  });

  it("publica las cuotas, respeta el refresco de 12 h y no imprime la clave", async () => {
    const { db, docs } = database();
    const log = vi.fn();
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(feed), {
          headers: { "x-requests-remaining": "480" },
        }),
    );
    const first = await syncOdds(db, "secret-key", [match], {
      now,
      request,
      log,
    });
    expect(first).toMatchObject({ requests: 1, matched: 1, used: 2 });
    const board = decodeOddsBoard(docs.get("odds/football"));
    expect(board?.matches["100"].bookmakers).toHaveLength(2);
    expect(docs.get("providerBudgets/oddsapi")).toEqual({
      month: "2026-11",
      used: 2,
      remaining: 480,
    });
    const second = await syncOdds(db, "secret-key", [match], {
      now: now + 3_600_000,
      request,
      log,
    });
    expect(second.requests).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join(" ")).not.toContain("secret-key");
  });

  it("no consulta sin partidos próximos ni por encima del límite mensual", async () => {
    const request = vi.fn<typeof fetch>();
    const idle = database();
    await syncOdds(
      idle.db,
      "k",
      [{ ...match, utcDate: "2026-12-30T20:00:00Z" }],
      {
        now,
        request,
        log: () => {},
      },
    );
    const spent = database({
      "providerBudgets/oddsapi": { month: "2026-11", used: ODDS_MONTH_LIMIT },
    });
    await syncOdds(spent.db, "k", [match], { now, request, log: () => {} });
    expect(request).not.toHaveBeenCalled();
  });
});
