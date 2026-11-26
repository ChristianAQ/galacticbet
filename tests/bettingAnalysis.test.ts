import { describe, expect, it } from "vitest";
import {
  ANALYSIS_FORMAT,
  analysisDays,
  decodeAnalysisBoard,
  dueAnalysisDays,
  edge,
  madridDate,
  nextAnalysis,
  pickLabel,
  settlePick,
  trackRecord,
  type BettingAnalysis,
  type MarketPrice,
} from "../src/lib/bettingAnalysis";
import type { Match } from "../src/lib/domain";
import { acceptAnalysis, clip, goalFacts } from "../scripts/bettingAnalysis";
import {
  KNOWN_MARKETS,
  findFixture,
  marketPrices,
  parseFixtures,
  parseMarketDefinitions,
  parseTournamentOdds,
} from "../scripts/oddsPapi";

const match = (over: Partial<Match>): Match => ({
  id: "m1",
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "PD-2026-14",
  matchday: 14,
  stage: "REGULAR_SEASON",
  utcDate: "2026-11-28T13:00:00Z",
  status: "TIMED",
  home: "Real Madrid CF",
  away: "Getafe CF",
  homeScore: null,
  awayScore: null,
  ...over,
});
const finished = (id: string, home: number, away: number, over: Partial<Match> = {}) =>
  match({ id, status: "FINISHED", homeScore: home, awayScore: away, ...over });

describe("OddsPapi", () => {
  it("reads the soccer markets it needs from the official list", () => {
    const markets = parseMarketDefinitions([
      { marketId: 101, sportId: 10, period: "fulltime", marketType: "1x2", handicap: 0, playerProp: false, outcomes: [
        { outcomeId: 101, outcomeName: "1" }, { outcomeId: 102, outcomeName: "X" }, { outcomeId: 103, outcomeName: "2" }] },
      // Filed as «totals» in the list: recognised by its name.
      { marketId: 104, sportId: 10, period: "fulltime", marketType: "totals", handicap: 0, playerProp: false, marketName: "Both Teams To Score", outcomes: [
        { outcomeId: 104, outcomeName: "Yes" }, { outcomeId: 105, outcomeName: "No" }] },
      { marketId: 106, sportId: 10, period: "fulltime", marketType: "totals", handicap: 0.5, marketName: "Over Under Full Time", outcomes: [
        { outcomeId: 106, outcomeName: "Over" }, { outcomeId: 107, outcomeName: "Under" }] },
      { marketId: 1010, sportId: 10, period: "fulltime", marketType: "totals", handicap: 2.5, marketName: "Over Under Full Time", outcomes: [
        { outcomeId: 1010, outcomeName: "Over" }, { outcomeId: 1011, outcomeName: "Under" }] },
      { marketId: 101902, sportId: 10, period: "fulltime", marketType: "doublechance", handicap: 0, outcomes: [
        { outcomeId: 1, outcomeName: "1X" }, { outcomeId: 2, outcomeName: "12" }, { outcomeId: 3, outcomeName: "2X" }] },
      // First half, another sport, player props: left out.
      { marketId: 1031, sportId: 10, period: "p1", marketType: "1x2", handicap: 0, outcomes: [{ outcomeId: 1, outcomeName: "1" }] },
      { marketId: 111, sportId: 11, period: "fulltime", marketType: "1x2", handicap: 0, outcomes: [] },
    ]);
    expect(markets.map((m) => [m.marketId, m.market, m.line])).toEqual([
      ["101", "1X2", undefined],
      ["104", "BTTS", undefined],
      ["1010", "OU", 2.5],
      ["101902", "DC", undefined],
    ]);
    expect(markets[3].outcomes).toEqual({ "1": "1X", "2": "12", "3": "X2" });
    expect(() => parseMarketDefinitions({ error: {} })).toThrow();
  });

  it("parses fixtures and one bookmaker's prices, skipping inactive ones", () => {
    const fixtures = parseFixtures([
      { fixtureId: "id1", startTime: "2026-11-28T13:00:00.000Z", participant1Name: "Real Madrid", participant1ShortName: "Real Madrid", participant2Name: "Getafe CF", participant2ShortName: "Getafe" },
      { fixtureId: "bad", startTime: "nope", participant1Name: "A", participant2Name: "B" },
    ]);
    expect(fixtures).toEqual([{ fixtureId: "id1", startTime: "2026-11-28T13:00:00.000Z", home: ["Real Madrid", "Real Madrid"], away: ["Getafe CF", "Getafe"] }]);
    const price = (p: number, active = true) => ({ players: { "0": { active, price: p } } });
    const odds = parseTournamentOdds(
      [
        { fixtureId: "id1", statusId: 0, bookmakerOdds: { bet365: { bookmakerIsActive: true, suspended: false, markets: {
          "101": { marketActive: true, outcomes: { "101": price(1.5), "102": price(4.2), "103": price(6.5) } },
          "1010": { marketActive: false, outcomes: { "1010": price(1.8), "1011": price(2) } },
          "999": { marketActive: true, outcomes: { "999": price(3) } },
        } } } },
        { fixtureId: "id2", statusId: 1, bookmakerOdds: { bet365: { markets: { "101": { outcomes: { "101": price(2) } } } } } },
      ],
      "bet365",
      KNOWN_MARKETS,
    );
    expect([...odds.keys()]).toEqual(["id1"]);
    expect(Object.fromEntries(odds.get("id1")!)).toEqual({ "101|101": 1.5, "101|102": 4.2, "101|103": 6.5 });
  });

  it("matches fixtures by kick-off and team, and prices complete markets only", () => {
    const fixtures = parseFixtures([
      { fixtureId: "id1", startTime: "2026-11-28T13:00:00Z", participant1Name: "Real Madrid", participant2Name: "Getafe" },
      { fixtureId: "id9", startTime: "2026-11-28T15:15:00Z", participant1Name: "Sevilla FC", participant2Name: "Betis" },
    ]);
    expect(findFixture(match({}), fixtures)?.fixtureId).toBe("id1");
    expect(findFixture(match({ utcDate: "2026-11-28T18:00:00Z" }), fixtures)).toBeNull();
    const bet365 = new Map([["id1", new Map([["101|101", 1.5], ["101|102", 4.4], ["101|103", 7], ["104|104", 2.1]])]]);
    const pinnacle = new Map([["id1", new Map([["101|101", 1.52], ["101|102", 4.3], ["101|103", 6.6]])]]);
    const prices = marketPrices("id1", KNOWN_MARKETS, bet365, pinnacle);
    // BTTS is left out: bet365 priced only «yes».
    expect(prices.map((p) => p.selection)).toEqual(["1", "X", "2"]);
    const fair = prices.map((p) => p.fair!);
    expect(fair.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    expect(prices[0]).toMatchObject({ market: "1X2", price: 1.5, sharp: 1.52 });
    expect(marketPrices("id1", KNOWN_MARKETS, bet365, new Map())[0].fair).toBeUndefined();
  });
});

describe("picks and results", () => {
  it("names the bet in Spanish", () => {
    expect(pickLabel({ market: "1X2", selection: "2" }, "Betis", "Sevilla")).toBe("Gana Sevilla");
    expect(pickLabel({ market: "DC", selection: "1X" }, "Betis", "Sevilla")).toBe("Betis o empate");
    expect(pickLabel({ market: "OU", selection: "over", line: 2.5 }, "Betis", "Sevilla")).toBe("Más de 2,5 goles");
    expect(pickLabel({ market: "BTTS", selection: "no" }, "Betis", "Sevilla")).toBe("No marcan los dos");
  });

  it("settles every market on the 90-minute score", () => {
    const m = finished("m1", 2, 2);
    expect(settlePick({ matchId: "m1", market: "1X2", selection: "X" }, m)).toBe("won");
    expect(settlePick({ matchId: "m1", market: "DC", selection: "12" }, m)).toBe("lost");
    expect(settlePick({ matchId: "m1", market: "DNB", selection: "1" }, m)).toBe("void");
    expect(settlePick({ matchId: "m1", market: "BTTS", selection: "yes" }, m)).toBe("won");
    expect(settlePick({ matchId: "m1", market: "OU", selection: "over", line: 3.5 }, m)).toBe("won");
    expect(settlePick({ matchId: "m1", market: "OU", selection: "under", line: 2.5 }, m)).toBe("lost");
    expect(settlePick({ matchId: "m1", market: "1X2", selection: "1" }, match({}))).toBeNull();
    expect(settlePick({ matchId: "m1", market: "1X2", selection: "1" }, match({ status: "POSTPONED" }))).toBe("void");
  });

  it("keeps an honest record at one unit per pick", () => {
    const analysis = { picks: [
      { matchId: "a", market: "1X2", selection: "1", price: 2.5 },
      { matchId: "b", market: "BTTS", selection: "yes", price: 1.9 },
      { matchId: "c", market: "DNB", selection: "2", price: 2 },
      { matchId: "d", market: "1X2", selection: "1", price: 3 },
    ] } as unknown as BettingAnalysis;
    const record = trackRecord([analysis], [finished("a", 1, 0), finished("b", 1, 0), finished("c", 0, 0), match({ id: "d" })]);
    expect(record).toMatchObject({ picks: 4, settled: 3, won: 1, lost: 1, void: 1, units: 0.5 });
    expect(record.yield).toBeCloseTo(0.25);
  });
});

describe("when the analysis runs", () => {
  const day = [
    match({ id: "a", utcDate: "2026-11-28T13:00:00Z" }),
    match({ id: "b", utcDate: "2026-11-28T20:00:00Z" }),
    // Past midnight in Spain: the next day.
    match({ id: "c", utcDate: "2026-11-28T23:30:00Z" }),
    match({ id: "d", competition: "PL", utcDate: "2026-11-28T12:30:00Z" }),
    match({ id: "e", competition: "CL", utcDate: "2026-11-28T17:45:00Z" }),
  ];
  it("groups by competition and day in Spain", () => {
    const days = analysisDays(day, Date.parse("2026-11-28T08:00:00Z"));
    expect(days.map((d) => [d.id, d.matches.map((m) => m.id)])).toEqual([
      ["PD-2026-11-28", ["a", "b"]],
      ["CL-2026-11-28", ["e"]],
      ["PD-2026-11-29", ["c"]],
    ]);
    expect(madridDate("2026-11-28T23:30:00Z")).toBe("2026-11-29");
  });

  it("is due from 45 minutes before the first kick-off, once", () => {
    const at = (iso: string, done: string[] = []) => dueAnalysisDays(day, Date.parse(iso), new Set(done)).map((d) => d.id);
    expect(at("2026-11-28T12:10:00Z")).toEqual([]);
    expect(at("2026-11-28T12:20:00Z")).toEqual(["PD-2026-11-28"]);
    expect(at("2026-11-28T12:20:00Z", ["PD-2026-11-28"])).toEqual([]);
    // Missed the first match: 45 minutes before the next one of the day…
    expect(at("2026-11-28T15:00:00Z")).toEqual([]);
    expect(at("2026-11-28T19:20:00Z")).toEqual(["PD-2026-11-28"]);
    // …never with the match about to start.
    expect(at("2026-11-28T19:55:00Z")).toEqual([]);
    const next = nextAnalysis(day, Date.parse("2026-11-28T08:00:00Z"), new Set());
    expect(next?.day.id).toBe("PD-2026-11-28");
    expect(new Date(next!.at).toISOString()).toBe("2026-11-28T12:20:00.000Z");
  });
});

describe("accepting the AI's answer", () => {
  const day = analysisDays([match({ id: "a" }), match({ id: "b", home: "Sevilla FC", away: "Real Betis Balompié" })], 0)[0];
  const prices = new Map<string, MarketPrice[]>([
    ["a", [
      { market: "1X2", selection: "1", price: 1.5, sharp: 1.52, fair: 0.63 },
      { market: "OU", selection: "over", line: 2.5, price: 1.8, sharp: 1.85, fair: 0.52 },
    ]],
    ["b", [{ market: "BTTS", selection: "yes", price: 1.9 }]],
  ]);
  const pick = (over: Record<string, unknown>) => ({
    matchId: "a", market: "OU", selection: "over", line: 2.5, probability: 0.6, confidence: "media",
    reason: "Los dos equipos marcan mucho.", risk: "Rotaciones.", ...over,
  });

  it("keeps real markets with bet365's real price and value only", () => {
    const analysis = acceptAnalysis(day, {
      headline: "Goles en el Bernabéu",
      summary: "Un día con poco valor.",
      matches: [{ matchId: "a", preview: "El Madrid llega en racha." }],
      picks: [
        pick({}),
        // Same pick twice, invented market, no value, unknown match.
        pick({}),
        pick({ market: "OU", line: 4.5 }),
        pick({ market: "1X2", selection: "1", line: null, probability: 0.66 }),
        pick({ matchId: "zz" }),
        pick({ matchId: "b", market: "BTTS", selection: "yes", line: null, probability: 0.58, confidence: "rara" }),
      ],
    }, prices, Date.parse("2026-11-28T12:20:00Z"))!;
    expect(analysis.id).toBe("PD-2026-11-28");
    expect(analysis.picks.map((p) => [p.matchId, p.market, p.price])).toEqual([
      ["a", "OU", 1.8],
      ["b", "BTTS", 1.9],
    ]);
    expect(analysis.picks[0]).toMatchObject({ line: 2.5, fair: 0.52, confidence: "media" });
    expect(analysis.picks[1].confidence).toBe("baja");
    expect(edge(0.6, 1.8)).toBeCloseTo(0.08);
    expect(analysis.matches.map((m) => [m.matchId, m.preview])).toEqual([
      ["a", "El Madrid llega en racha."],
      ["b", "Sin previa."],
    ]);
    // The stored board decodes back to the same analysis.
    const board = decodeAnalysisBoard(JSON.parse(JSON.stringify({ formatVersion: ANALYSIS_FORMAT, updatedAt: analysis.generatedAt, analyses: [analysis] })));
    expect(board?.analyses[0]).toEqual(analysis);
  });

  it("refuses answers without matches and clips long texts", () => {
    expect(acceptAnalysis(day, null, prices, 0)).toBeNull();
    expect(acceptAnalysis(day, { picks: [] }, new Map(), 0)).toBeNull();
    expect(clip("uno dos tres cuatro cinco", 12)).toBe("uno dos…");
    expect(clip("  corto ", 12)).toBe("corto");
  });
});

describe("season facts for the prompt", () => {
  it("counts goals, both scored and over 2.5", () => {
    const facts = goalFacts([finished("x", 3, 1), finished("y", 0, 0, { home: "Getafe CF", away: "Real Madrid CF" })], "name:real madrid cf");
    expect(facts).toMatchObject({ partidos: 2, ambosMarcanPct: 50, masDe25Pct: 50, porteriasACero: 1, sinMarcar: 1, golesAFavorPorPartido: 1.5 });
  });
});
