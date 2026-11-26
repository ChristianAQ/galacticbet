import { describe, expect, it } from "vitest";
import {
  ANALYSIS_FORMAT,
  MAX_ANALYSES,
  analysedDays,
  archiveAnalyses,
  archivedRecord,
  analysisDays,
  isJuicy,
  marketValue,
  mergeAnalysis,
  decodeAnalysisBoard,
  dueAnalysisDays,
  edge,
  madridDate,
  marketView,
  nextAnalysis,
  sourceHosts,
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
  chooseBook,
  findFixture,
  marketPrices,
  parseFixtureOdds,
  parseFixtures,
  parseMarketDefinitions,
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

  it("parses fixtures and the prices of bookmakers that are up to date", () => {
    const fixtures = parseFixtures([
      { fixtureId: "id1", startTime: "2026-11-28T13:00:00.000Z", participant1Name: "Real Madrid", participant1ShortName: "Real Madrid", participant2Name: "Getafe CF", participant2ShortName: "Getafe" },
      { fixtureId: "bad", startTime: "nope", participant1Name: "A", participant2Name: "B" },
    ]);
    expect(fixtures).toEqual([{ fixtureId: "id1", startTime: "2026-11-28T13:00:00.000Z", home: ["Real Madrid", "Real Madrid"], away: ["Getafe CF", "Getafe"] }]);
    const price = (p: number, active = true) => ({ players: { "0": { active, price: p } } });
    const oneX2 = (a: number, b: number, c: number, active = true) => ({
      "101": { marketActive: true, outcomes: { "101": price(a, active), "102": price(b, active), "103": price(c, active) } },
    });
    const books = parseFixtureOdds(
      {
        fixtureId: "id1",
        statusId: 0,
        bookmakerOdds: {
          // OddsPapi stopped collecting bet365 a week ago: its old prices never count.
          bet365: { bookmakerIsActive: false, suspended: true, markets: oneX2(2.02, 3.6, 3.2) },
          "winamax.es": { bookmakerIsActive: true, suspended: false, markets: {
            ...oneX2(2, 3.9, 3.05),
            "1010": { marketActive: false, outcomes: { "1010": price(1.8), "1011": price(2) } },
            "999": { marketActive: true, outcomes: { "999": price(3) } },
          } },
          "888sport.es": { bookmakerIsActive: true, suspended: false, markets: oneX2(2.1, 3.75, 3, false) },
          "pinnacle+30": { bookmakerIsActive: true, suspended: false, markets: oneX2(2.09, 4.07, 3.27) },
        },
      },
      KNOWN_MARKETS,
    );
    expect([...books.keys()]).toEqual(["winamax.es", "pinnacle+30"]);
    expect(Object.fromEntries(books.get("winamax.es")!)).toEqual({ "101|101": 2, "101|102": 3.9, "101|103": 3.05 });
    expect(chooseBook(books)).toBe("winamax.es");
    // bet365 comes first whenever it is up to date.
    books.set("bet365", new Map([["101|101", 2.05], ["101|102", 3.8], ["101|103", 3.1]]));
    expect(chooseBook(books)).toBe("bet365");
    expect(chooseBook(new Map())).toBeNull();
    expect(parseFixtureOdds({ fixtureId: "id2", statusId: 1, bookmakerOdds: {} }, KNOWN_MARKETS).size).toBe(0);
  });

  it("matches fixtures by kick-off and team, and prices complete markets only", () => {
    const fixtures = parseFixtures([
      { fixtureId: "id1", startTime: "2026-11-28T13:00:00Z", participant1Name: "Real Madrid", participant2Name: "Getafe" },
      { fixtureId: "id9", startTime: "2026-11-28T15:15:00Z", participant1Name: "Sevilla FC", participant2Name: "Betis" },
    ]);
    expect(findFixture(match({}), fixtures)?.fixtureId).toBe("id1");
    expect(findFixture(match({ utcDate: "2026-11-28T18:00:00Z" }), fixtures)).toBeNull();
    const bet365 = new Map([["101|101", 1.5], ["101|102", 4.4], ["101|103", 7], ["104|104", 2.1]]);
    const pinnacle = new Map([["101|101", 1.52], ["101|102", 4.3], ["101|103", 6.6]]);
    const prices = marketPrices(KNOWN_MARKETS, bet365, pinnacle, "bet365");
    // BTTS is left out: bet365 priced only «yes».
    expect(prices.map((p) => p.selection)).toEqual(["1", "X", "2"]);
    const fair = prices.map((p) => p.fair!);
    expect(fair.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    expect(prices[0]).toMatchObject({ market: "1X2", price: 1.5, sharp: 1.52, book: "bet365" });
    expect(marketPrices(KNOWN_MARKETS, bet365, undefined, "bet365")[0].fair).toBeUndefined();
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
    // The best option of each match keeps its own record.
    const withBest = { ...analysis, matches: [{ pick: { matchId: "a", market: "OU", selection: "under", line: 2.5, price: 1.7 } }, {}] } as unknown as BettingAnalysis;
    expect(trackRecord([withBest], [finished("a", 1, 0)], "best")).toMatchObject({ picks: 1, won: 1, units: 0.7 });
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
    ["b", [{ market: "BTTS", selection: "yes", price: 1.9, book: "Winamax" }]],
  ]);
  const pick = (over: Record<string, unknown>) => ({
    matchId: "a", market: "OU", selection: "over", line: 2.5, probability: 0.6, confidence: "media",
    reason: "Los dos equipos marcan mucho.", risk: "Rotaciones.", ...over,
  });

  it("keeps real markets with bet365's real price and value only", () => {
    const analysis = acceptAnalysis(day, {
      headline: "Goles en el Bernabéu",
      summary: "Un día con poco valor.",
      matches: [
        // Best option without value (−6 %): kept, as it is.
        { matchId: "a", preview: "El Madrid llega en racha.", bestPick: pick({ market: "1X2", selection: "1", line: null, probability: 0.63 }) },
        // Below 40 %: not a «best option».
        { matchId: "b", preview: "", bestPick: pick({ matchId: undefined, market: "BTTS", selection: "yes", line: null, probability: 0.3 }) },
      ],
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
    expect(analysis.picks[1]).toMatchObject({ confidence: "baja", book: "Winamax" });
    expect(analysis.bookmaker).toBe("Winamax");
    expect(edge(0.6, 1.8)).toBeCloseTo(0.08);
    expect(analysis.matches.map((m) => [m.matchId, m.preview, m.pick?.market])).toEqual([
      ["a", "El Madrid llega en racha.", "1X2"],
      ["b", "Sin previa.", undefined],
    ]);
    expect(analysis.matches[0].pick).toMatchObject({ matchId: "a", price: 1.5, probability: 0.63, fair: 0.63 });
    expect(edge(analysis.matches[0].pick!.probability, analysis.matches[0].pick!.price)).toBeLessThan(0);
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

describe("the job, end to end with fakes", () => {
  const kickoff = Date.parse("2026-11-27T20:00:00Z");
  const fixture = match({ id: "lev", home: "Levante UD", away: "Racing Santander", utcDate: "2026-11-27T20:00:00Z" });
  const store = new Map<string, unknown>();
  const db = {
    doc: (path: string) => ({
      get: async () => ({ data: () => store.get(path) }),
      set: async (value: unknown) => void store.set(path, value),
    }),
  } as unknown as import("firebase-admin/firestore").Firestore;
  const book = (prices: number[], active = true) => ({
    bookmakerIsActive: active,
    suspended: !active,
    markets: { "101": { marketActive: true, outcomes: Object.fromEntries(prices.map((p, i) => [String(101 + i), { players: { "0": { active: true, price: p } } }])) } },
  });
  let spent = 0;
  const client = {
    remaining: async () => ({ limit: 250, used: spent, bookmakers: [] }),
    markets: async () => {
      throw new Error("sin lista");
    },
    fixtures: async () => (spent++, [{ fixtureId: "f1", startTime: "2026-11-27T20:00:00Z", participant1Name: "Levante UD", participant2Name: "Racing Santander" }]),
    fixtureOdds: async () => (spent++, {
      fixtureId: "f1",
      statusId: 0,
      bookmakerOdds: { bet365: book([2.02, 3.6, 3.2], false), "winamax.es": book([2, 3.9, 3.05]), "pinnacle+30": book([2.09, 4.07, 3.27]) },
    }),
    get spent() {
      return spent;
    },
  };
  const claude = async () => ({
    output: {
      headline: "Levante favorito",
      summary: "Poco valor.",
      matches: [{ matchId: "lev", preview: "Partido igualado." }],
      picks: [{ matchId: "lev", market: "1X2", selection: "1", line: null, probability: 0.54, confidence: "media", reason: "Fuerte en casa.", risk: "Racing en forma." }],
    },
  });
  const run = (now: number, extra: Record<string, unknown> = {}) =>
    import("../scripts/bettingAnalysis").then(({ runBettingAnalysis }) =>
      runBettingAnalysis(db, { oddsKey: "k", claude, client, matches: [fixture], now, log: () => {}, ...extra }),
    );

  it("publishes once in the window, with the bookmaker that was up to date", async () => {
    expect((await run(kickoff - 3 * 3_600_000)).generated).toBe(0);
    expect((await run(kickoff - 40 * 60_000)).generated).toBe(1);
    const board = decodeAnalysisBoard(store.get("analysis/football"))!;
    expect(board.analyses[0]).toMatchObject({ id: "PD-2026-11-27", bookmaker: "Winamax" });
    expect(board.analyses[0].picks[0]).toMatchObject({ price: 2, book: "Winamax", fair: expect.any(Number) });
    // Already done: the next pass does nothing (and spends no requests).
    const before = spent;
    expect((await run(kickoff - 30 * 60_000)).generated).toBe(0);
    expect(spent).toBe(before);
  });

  it("a manual run long before is redone in the usual window", async () => {
    store.clear();
    expect((await run(kickoff - 30 * 3_600_000, { force: true })).generated).toBe(1);
    expect((await run(kickoff - 40 * 60_000)).generated).toBe(1);
    expect((await run(kickoff - 30 * 60_000)).generated).toBe(0);
    expect(decodeAnalysisBoard(store.get("analysis/football"))!.analyses).toHaveLength(1);
  });
});

describe("what the charts read", () => {
  const book = (over: Partial<MarketPrice>[]) =>
    over.map((o) => ({ market: "1X2", selection: "1", price: 2, book: "Winamax", ...o }) as MarketPrice);
  it("takes Pinnacle's fair chances when it priced every outcome, the bookmaker's otherwise", () => {
    const sharp = marketView(
      book([
        { selection: "1", price: 2, fair: 0.4645 },
        { selection: "X", price: 3.9, fair: 0.2385 },
        { selection: "2", price: 3.05, fair: 0.297 },
        { market: "OU", selection: "over", line: 2.5, price: 1.47, fair: 0.6532 },
        { market: "OU", selection: "under", line: 2.5, price: 2.6, fair: 0.3468 },
      ]),
    )!;
    expect(sharp).toEqual({ home: 0.4645, draw: 0.2385, away: 0.297, over25: 0.6532, source: "Pinnacle" });
    const soft = marketView(book([{ selection: "1", price: 2 }, { selection: "X", price: 4 }, { selection: "2", price: 4 }]))!;
    expect(soft.source).toBe("Winamax");
    expect(soft.home + soft.draw + soft.away).toBeCloseTo(1, 3);
    expect(soft.home).toBeCloseTo(0.5, 3);
    expect(marketView(book([{ selection: "1" }]))).toBeNull();
    expect(marketView(undefined)).toBeNull();
  });

  it("keeps only plain host names from what the AI read", () => {
    expect(
      sourceHosts(["https://www.marca.com/futbol/levante.html", "as.com", "AS.com", "javascript:alert(1)", "http://intranet", "  ", 7]),
    ).toEqual(["marca.com", "as.com"]);
    expect(sourceHosts("marca.com")).toEqual([]);
  });

  it("stores and reads back the market and the sources of a match", () => {
    const analysis = {
      id: "PD-2026-11-27",
      competition: "PD",
      date: "2026-11-27",
      generatedAt: "2026-11-26T10:29:33.235Z",
      oddsAt: "2026-11-26T10:29:33.235Z",
      bookmaker: "Winamax",
      headline: "Levante-Santander",
      summary: "Sin valor claro.",
      matches: [
        {
          matchId: "564765",
          home: "Levante",
          away: "Santander",
          utcDate: "2026-11-27T20:00:00Z",
          preview: "Partido abierto.",
          market: { home: 0.4645, draw: 0.2385, away: 0.297, over25: 0.6532, source: "Pinnacle" },
          sources: ["marca.com"],
        },
      ],
      picks: [],
    };
    const board = decodeAnalysisBoard({ formatVersion: ANALYSIS_FORMAT, updatedAt: analysis.generatedAt, analyses: [analysis] })!;
    expect(board.analyses[0]).toEqual(analysis);
    // Chances that do not add up are dropped, the rest of the match stays.
    const broken = { ...analysis, matches: [{ ...analysis.matches[0], market: { home: 0.9, draw: 0.5, away: 0.4, source: "Pinnacle" } }] };
    const read = decodeAnalysisBoard({ formatVersion: ANALYSIS_FORMAT, updatedAt: analysis.generatedAt, analyses: [broken] })!;
    expect(read.analyses[0].matches[0].market).toBeUndefined();
    expect(read.analyses[0].matches[0].preview).toBe("Partido abierto.");
  });
});

describe("the record never forgets and the day is analysed once", () => {
  // A LaLiga Saturday: 14:00, 16:15, 18:30 and 21:00 in Madrid.
  const saturday = [
    match({ id: "a", utcDate: "2026-11-28T13:00:00Z" }),
    match({ id: "b", utcDate: "2026-11-28T15:15:00Z" }),
    match({ id: "c", utcDate: "2026-11-28T17:30:00Z" }),
    match({ id: "d", utcDate: "2026-11-28T20:00:00Z" }),
  ];
  const made = (generatedAt: string) => [{ id: "PD-2026-11-28", generatedAt }];

  it("counts the day as done from its first kick-off, even once that match has started", () => {
    const done = analysedDays(saturday, made("2026-11-28T12:20:00Z"), 3 * 3_600_000);
    for (const t of ["2026-11-28T14:35:00Z", "2026-11-28T16:50:00Z", "2026-11-28T19:20:00Z"])
      expect(dueAnalysisDays(saturday, Date.parse(t), done)).toEqual([]);
    // A manual run the evening before is still redone in the usual window.
    const early = analysedDays(saturday, made("2026-11-27T19:00:00Z"), 3 * 3_600_000);
    expect(dueAnalysisDays(saturday, Date.parse("2026-11-28T12:20:00Z"), early).map((d) => d.id)).toEqual(["PD-2026-11-28"]);
  });

  const game = (matchId: string, utcDate: string) => ({ matchId, home: "H", away: "A", utcDate, preview: "P" });
  const tip = (matchId: string, price = 2) =>
    ({ matchId, market: "1X2", selection: "1", price, probability: 0.55, confidence: "media", reason: "R" }) as const;
  const analysis = (over: Partial<BettingAnalysis>): BettingAnalysis => ({
    id: "PD-2026-11-28",
    competition: "PD",
    date: "2026-11-28",
    generatedAt: "2026-11-28T12:20:00Z",
    oddsAt: "2026-11-28T12:19:00Z",
    bookmaker: "bet365",
    headline: "H",
    summary: "S",
    matches: [],
    picks: [],
    ...over,
  });

  it("a later analysis of the day keeps what was published for matches already started", () => {
    const before = analysis({
      matches: [game("a", "2026-11-28T13:00:00Z"), game("c", "2026-11-28T17:30:00Z")],
      picks: [tip("a"), tip("c")],
    });
    const after = analysis({ generatedAt: "2026-11-28T16:50:00Z", matches: [game("c", "2026-11-28T17:30:00Z")], picks: [] });
    const merged = mergeAnalysis(before, after, Date.parse("2026-11-28T16:50:00Z"));
    expect(merged.matches.map((m) => m.matchId)).toEqual(["a", "c"]);
    expect(merged.picks.map((p) => p.matchId)).toEqual(["a"]);
    expect(mergeAnalysis(undefined, after, 0)).toBe(after);
  });

  it("archives what leaves the board and keeps counting it", () => {
    const old = analysis({ id: "PD-2026-10-04", date: "2026-10-04", matches: [{ ...game("a", "2026-10-04T13:00:00Z"), pick: tip("a", 1.8) }], picks: [tip("a", 2.5)] });
    const archive = archiveAnalyses(undefined, [old], [finished("a", 2, 0)]);
    expect(archive.PD).toEqual({
      since: "2026-10-04",
      value: { picks: 1, settled: 1, won: 1, lost: 0, void: 0, units: 1.5 },
      best: { picks: 1, settled: 1, won: 1, lost: 0, void: 0, units: 0.8 },
    });
    // Added to, never replaced; the board reads it back.
    const later = analysis({ id: "PD-2026-10-05", date: "2026-10-05", picks: [tip("b")], matches: [game("b", "2026-10-05T13:00:00Z")] });
    const next = archiveAnalyses(archive, [later], [finished("b", 0, 1)]);
    expect(next.PD!.value).toMatchObject({ picks: 2, won: 1, lost: 1, units: 0.5 });
    expect(next.PD!.since).toBe("2026-10-04");
    const board = decodeAnalysisBoard({ formatVersion: ANALYSIS_FORMAT, updatedAt: "2026-10-06T00:00:00Z", analyses: [], archive: next })!;
    expect(board.archive).toEqual(next);
    const base = archivedRecord(board.archive, ["PD", "CL"], "value")!;
    expect(trackRecord([], [], "value", base.totals)).toMatchObject({ picks: 2, won: 1, lost: 1, units: 0.5, yield: 0.25 });
    expect(archivedRecord(board.archive, ["CL"], "value")).toBeNull();
  });

  it("«jugosa» means +3 % as shown, and never far above the market", () => {
    expect(isJuicy({ probability: 0.513, price: 2 })).toBe(true); // +2,6 % → «+3 %»
    expect(isJuicy({ probability: 0.512, price: 2 })).toBe(false); // +2,4 % → «+2 %»
    expect(marketValue({ fair: 0.45, price: 2 })).toBeCloseTo(-0.1);
    expect(marketValue({ price: 2 })).toBeNull();
    const day = analysisDays([match({ id: "a" })], 0)[0];
    const prices = new Map<string, MarketPrice[]>([["a", [{ market: "1X2", selection: "1", price: 2.2, sharp: 2.3, fair: 0.42 }]]]);
    const answer = (probability: number) => ({
      headline: "H",
      summary: "S",
      matches: [{ matchId: "a", preview: "P" }],
      picks: [{ matchId: "a", market: "1X2", selection: "1", line: null, probability, confidence: "media", reason: "R", risk: "" }],
    });
    // 0,50 is 8 points over Pinnacle's 0,42: kept. 0,56 is 14 points over: an overconfident guess.
    expect(acceptAnalysis(day, answer(0.5), prices, 0)!.picks).toHaveLength(1);
    expect(acceptAnalysis(day, answer(0.56), prices, 0)!.picks).toHaveLength(0);
    // The time of the prices is when they were read, not when the AI finished.
    const accepted = acceptAnalysis(day, answer(0.5), prices, Date.parse("2026-11-28T12:30:00Z"), Date.parse("2026-11-28T12:20:00Z"))!;
    expect([accepted.oddsAt, accepted.generatedAt]).toEqual(["2026-11-28T12:20:00.000Z", "2026-11-28T12:30:00.000Z"]);
  });

  it("the job keeps the newest analyses on the board and archives the rest", async () => {
    const { runBettingAnalysis } = await import("../scripts/bettingAnalysis");
    const fixture = match({ id: "lev", home: "Levante UD", away: "Racing Santander", utcDate: "2026-11-27T20:00:00Z" });
    // A full board of past days, each with one «jugosa» that lost.
    const past = Array.from({ length: MAX_ANALYSES }, (_, i) => {
      const date = new Date(Date.parse("2026-09-01T12:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
      return analysis({
        id: `PD-${date}`,
        date,
        generatedAt: `${date}T12:00:00.000Z`,
        matches: [game(`old${i}`, `${date}T13:00:00Z`)],
        picks: [tip(`old${i}`)],
      });
    });
    const store = new Map<string, unknown>([
      ["analysis/football", JSON.parse(JSON.stringify({ formatVersion: ANALYSIS_FORMAT, updatedAt: "2026-11-01T00:00:00Z", analyses: past }))],
    ]);
    const db = {
      doc: (path: string) => ({
        get: async () => ({ data: () => store.get(path) }),
        set: async (value: unknown) => void store.set(path, value),
      }),
    } as unknown as import("firebase-admin/firestore").Firestore;
    const one = (p: number) => ({ players: { "0": { active: true, price: p } } });
    const client = {
      remaining: async () => null,
      markets: async () => {
        throw new Error("sin lista");
      },
      fixtures: async () => [{ fixtureId: "f1", startTime: "2026-11-27T20:00:00Z", participant1Name: "Levante UD", participant2Name: "Racing Santander" }],
      fixtureOdds: async () => ({
        fixtureId: "f1",
        statusId: 0,
        bookmakerOdds: { bet365: { bookmakerIsActive: true, markets: { "101": { outcomes: { "101": one(2), "102": one(3.5), "103": one(3.6) } } } } },
      }),
      spent: 0,
    };
    const claude = async () => ({ output: { headline: "H", summary: "S", matches: [{ matchId: "lev", preview: "P" }], picks: [] } });
    const results = [fixture, ...past.map((_, i) => finished(`old${i}`, 0, 1))];
    const { generated } = await runBettingAnalysis(db, {
      oddsKey: "k",
      claude,
      client,
      matches: results,
      now: Date.parse("2026-11-27T19:20:00Z"),
      log: () => {},
    });
    expect(generated).toBe(1);
    const board = decodeAnalysisBoard(store.get("analysis/football"))!;
    expect(board.analyses).toHaveLength(MAX_ANALYSES);
    expect(board.analyses[0].id).toBe("PD-2026-11-27");
    // The oldest day left the board, and its lost pick is still on the record.
    expect(board.archive?.PD).toMatchObject({ since: "2026-09-01", value: { picks: 1, lost: 1, units: -1 } });
  });
});
