import { describe, expect, it } from "vitest";
import {
  ANALYSIS_FORMAT,
  MAX_ANALYSES,
  analysedDays,
  archiveAnalyses,
  archivedRecord,
  analysisDays,
  comboOf,
  valueCombo,
  settleCombo,
  confidenceOf,
  matchOptions,
  optionValue,
  winChance,
  hasValue,
  marketValue,
  priceVerdict,
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
import {
  acceptAnalysis,
  clip,
  goalFacts,
  matchContext,
  MAX_PLAYER_PICKS,
  recentReports,
  settlePlayerBets,
} from "../scripts/bettingAnalysis";
import {
  pickKey as keyOf,
  playerFacts,
  samePlayer,
  settlePlayerPick,
} from "../src/lib/bettingAnalysis";
import type { MatchInsight } from "../src/lib/matchInsightsData";
import {
  KNOWN_MARKETS,
  MAX_PLAYERS_PER_MARKET,
  chooseBook,
  decodeDayOdds,
  encodeDayOdds,
  describePlayerProps,
  describeShotMarkets,
  parsePlayerMarkets,
  playerMarketKind,
  playerPrices,
  MAX_PLAYERS_PER_LINE,
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

describe("confianza y cuotas del partido", () => {
  it("one fixed scale: muy alta from 70 %, alta from 55 %, media from 40 %, baja below", () => {
    expect([0.82, 0.7, 0.69, 0.55, 0.54, 0.4, 0.39, 0.12].map((p) => confidenceOf(p).label)).toEqual([
      "muy alta", "muy alta", "alta", "alta", "media", "media", "baja", "baja",
    ]);
    expect(confidenceOf(0.62)).toMatchObject({ id: "alta", bars: 3 });
    // The chance that sets it: the AI's, never above the market's.
    expect(winChance({ probability: 0.6, fair: 0.52 })).toBe(0.52);
    expect(winChance({ probability: 0.48, fair: 0.52 })).toBe(0.48);
    expect(winChance({ probability: 0.33 })).toBe(0.33);
  });

  it("lists every main option with its chance and what it pays, most likely first", () => {
    const prices: MarketPrice[] = [
      { market: "1X2", selection: "1", price: 2.1, sharp: 2.2, fair: 0.45 },
      { market: "1X2", selection: "X", price: 3.8, sharp: 3.9, fair: 0.25 },
      { market: "1X2", selection: "2", price: 3.2, sharp: 3.3, fair: 0.3 },
      // Without Pinnacle: the bookmaker's own chances, margin removed.
      { market: "BTTS", selection: "yes", price: 1.8, book: "Winamax" },
      { market: "BTTS", selection: "no", price: 1.9, book: "Winamax" },
      // Incomplete market: left out.
      { market: "OU", selection: "over", line: 2.5, price: 1.7 },
      // Players' bets have their own place.
      { market: "SCORER", selection: "yes", player: "Kylian Mbappé", price: 2.2 },
    ];
    const options = matchOptions(prices);
    expect(options.map((o) => [o.market, o.selection, o.probability, o.sharp ?? false])).toEqual([
      ["BTTS", "yes", expect.closeTo(0.5135, 3), false],
      ["BTTS", "no", expect.closeTo(0.4865, 3), false],
      ["1X2", "1", 0.45, true],
      ["1X2", "2", 0.3, true],
      ["1X2", "X", 0.25, true],
    ]);
    expect(optionValue(options[2])).toBeCloseTo(-0.055);
    // Stored with the match and read back.
    const day = analysisDays([match({ id: "a" })], 0)[0];
    const analysis = acceptAnalysis(day, { headline: "H", summary: "S", matches: [{ matchId: "a", preview: "P" }], picks: [] }, new Map([["a", prices]]), 0)!;
    expect(analysis.matches[0].options).toEqual(options);
    const board = decodeAnalysisBoard(JSON.parse(JSON.stringify({ formatVersion: ANALYSIS_FORMAT, updatedAt: analysis.generatedAt, analyses: [analysis] })))!;
    expect(board.analyses[0].matches[0].options).toEqual(options);
  });
});

describe("apuestas de jugador: tiros y tiros a puerta", () => {
  // As OddsPapi lists them (Winamax, 27/11/2026): one outcome per step, «1+» to «6+».
  const steps = (first: number) => Array.from({ length: 6 }, (_, i) => ({ outcomeId: first + i, outcomeName: `${i + 1}+` }));
  const catalog = parsePlayerMarkets([
    { marketId: 10743, sportId: 10, playerProp: true, marketName: "Player Shots (incl. overtime)", period: "result", outcomes: steps(10744) },
    { marketId: 10753, sportId: 10, playerProp: true, marketName: "Player Shots On Goal (incl. overtime)", period: "result", outcomes: steps(10754) },
    { marketId: 10800, sportId: 10, playerProp: true, marketName: "Over Under Player Shots On Goal", period: "result", handicap: 1.5 },
  ]);

  it("recognises shots and shots on target, and offers the useful steps with the shortest prices", () => {
    expect(catalog.map((m) => playerMarketKind(m))).toEqual(["SHOTS", "SOT", null]);
    const players = (n: number, base: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), { price: base + i * 0.25, active: true, playerName: i ? `Apellido${i}, Nombre` : "Canales, Sergio" }]));
    const answer = {
      bookmakerOdds: {
        "winamax.es": {
          bookmakerIsActive: true,
          markets: {
            "10743": { marketActive: true, outcomes: { "10744": { players: players(12, 1.04) }, "10745": { players: players(12, 1.32) }, "10746": { players: players(3, 1.98) } } },
            "10753": { marketActive: true, outcomes: { "10754": { players: players(12, 1.56) }, "10755": { players: players(2, 3.25) }, "10756": { players: players(2, 8.5) } } },
          },
        },
      },
    };
    const prices = playerPrices(answer, catalog, "winamax.es", "Winamax");
    // SHOTS 2+ and 3+, SOT 1+ and 2+; at most 8 players a step, names as «Sergio Canales».
    expect(prices.map((p) => `${p.market} ${p.line}`).reduce<Record<string, number>>((n, k) => ({ ...n, [k]: (n[k] ?? 0) + 1 }), {})).toEqual({
      "SHOTS 2": MAX_PLAYERS_PER_LINE,
      "SHOTS 3": 3,
      "SOT 1": MAX_PLAYERS_PER_LINE,
      "SOT 2": 2,
    });
    expect(prices.find((p) => p.market === "SOT" && p.line === 2)).toEqual({
      market: "SOT", selection: "yes", line: 2, player: "Sergio Canales", price: 3.25, book: "Winamax",
    });
    expect(pickLabel({ market: "SOT", selection: "yes", line: 2, player: "Sergio Canales" }, "Levante", "Racing")).toBe("Sergio Canales: al menos 2 tiros a puerta");
    expect(pickLabel({ market: "SHOTS", selection: "yes", line: 1, player: "Sergio Canales" }, "Levante", "Racing")).toBe("Sergio Canales: al menos 1 tiro");
  });

  it("takes the AI's choice at the price of its own step, never another one", () => {
    const day = analysisDays([match({ id: "a" })], 0)[0];
    const prices = new Map<string, MarketPrice[]>([
      ["a", [
        { market: "SOT", selection: "yes", line: 1, player: "Iñigo Vicente", price: 1.6, book: "Winamax" },
        { market: "SOT", selection: "yes", line: 2, player: "Iñigo Vicente", price: 3.4, book: "Winamax" },
      ]],
    ]);
    const bet = (line: number | null, probability: number) => ({
      matchId: "a", market: "SOT", selection: "yes", line, player: "Inigo Vicente", probability, confidence: "media", reason: "Tira mucho.", risk: "Suplencia.",
    });
    const analysis = acceptAnalysis(day, {
      headline: "H",
      summary: "S",
      matches: [{ matchId: "a", preview: "P", bestPick: bet(1, 0.66) }],
      picks: [bet(2, 0.34), bet(null, 0.7), bet(7, 0.2)],
    }, prices, 0)!;
    expect(analysis.picks.map((p) => [p.line, p.player, p.price])).toEqual([[2, "Iñigo Vicente", 3.4]]);
    expect(analysis.matches[0].pick).toMatchObject({ market: "SOT", line: 1, price: 1.6 });
    const board = decodeAnalysisBoard(JSON.parse(JSON.stringify({ formatVersion: ANALYSIS_FORMAT, updatedAt: analysis.generatedAt, analyses: [analysis] })))!;
    expect(board.analyses[0].picks[0]).toMatchObject({ market: "SOT", line: 2, player: "Iñigo Vicente" });
  });

  it("settles with the player's numbers in the report, only once the match is over", () => {
    const insight = {
      goals: [],
      incidents: [{ minute: "70'", side: "home", kind: "substitution", player: "Suplente", playerOut: "Titular" }],
      lineups: [{ side: "home", players: [
        { name: "Sergio Canales", starter: true, stats: { shots: 4, shotsOnTarget: 1 } },
        { name: "Sin números", starter: true },
        { name: "Suplente", starter: false, subIn: "70'", stats: { shots: 0, shotsOnTarget: 0 } },
        { name: "No juega", starter: false },
      ] }],
    } as unknown as MatchInsight;
    const facts = playerFacts(insight, finished("m1", 0, 0), true);
    const bet = (market: "SHOTS" | "SOT", line: number, player: string) => settlePlayerPick({ market, line, player }, facts);
    expect(bet("SHOTS", 3, "Canales, Sergio")).toBe("won");
    expect(bet("SOT", 1, "Sergio Canales")).toBe("won");
    expect(bet("SOT", 2, "Sergio Canales")).toBe("lost");
    expect(bet("SHOTS", 1, "Suplente")).toBe("lost");
    expect(bet("SHOTS", 1, "No juega")).toBe("void");
    expect(bet("SHOTS", 1, "Sin números")).toBeNull(); // played, but no numbers to tell
    // While the match was on: reached already counts, not reached stays open.
    const live = playerFacts(insight, finished("m1", 0, 0), false);
    expect(settlePlayerPick({ market: "SHOTS", line: 3, player: "Sergio Canales" }, live)).toBe("won");
    expect(settlePlayerPick({ market: "SOT", line: 2, player: "Sergio Canales" }, live)).toBeNull();
  });
});

describe("apuestas de jugador: goleador y tarjeta", () => {
  const catalog = parsePlayerMarkets([
    { marketId: 60001, sportId: 10, playerProp: true, marketName: "Anytime Goal Scorer", period: "fulltime", outcomes: [{ outcomeId: 60001, outcomeName: "Yes" }] },
    { marketId: 60002, sportId: 10, playerProp: true, marketName: "First Goal Scorer", period: "fulltime", outcomes: [{ outcomeId: 60002, outcomeName: "Yes" }] },
    { marketId: 60003, sportId: 10, playerProp: true, marketName: "Player To Be Carded (incl. overtime)", period: "result", outcomes: [{ outcomeId: 60003, outcomeName: "Yes" }, { outcomeId: 60004, outcomeName: "No" }] },
    { marketId: 60005, sportId: 10, playerProp: true, marketName: "Anytime Goal Scorer", period: "p1", outcomes: [{ outcomeId: 60005, outcomeName: "Yes" }] },
  ]);
  it("recognises goalscorer and booking, full time only", () => {
    expect(catalog.map((m) => playerMarketKind(m))).toEqual(["SCORER", null, "CARD", null]);
  });

  it("reads the players' «yes» at the chosen bookmaker, shortest prices first", () => {
    const players = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), { price: 2 + i * 0.5, active: true, playerName: `Jugador ${i + 1}` }]));
    const answer = {
      bookmakerOdds: {
        "winamax.es": {
          bookmakerIsActive: true,
          markets: {
            "60001": { outcomes: { "60001": { players: { ...players(25), x: { price: 1.5, active: false, playerName: "Lesionado" } } } } },
            "60003": { outcomes: { "60003": { players: { "7": { price: 4.5, active: true, playerName: "Duro Pérez" } } }, "60004": { players: { "7": { price: 1.2, playerName: "Duro Pérez" } } } } },
          },
        },
        bet365: { bookmakerIsActive: false, markets: { "60001": { outcomes: { "60001": { players: players(3) } } } } },
      },
    };
    const prices = playerPrices(answer, catalog, "winamax.es", "Winamax");
    const scorers = prices.filter((p) => p.market === "SCORER");
    expect(scorers).toHaveLength(MAX_PLAYERS_PER_MARKET);
    expect(scorers[0]).toEqual({ market: "SCORER", selection: "yes", player: "Jugador 1", price: 2, book: "Winamax" });
    expect(prices.filter((p) => p.market === "CARD")).toEqual([
      { market: "CARD", selection: "yes", player: "Duro Pérez", price: 4.5, book: "Winamax" },
    ]);
    // A bookmaker OddsPapi isn't reading gives nothing.
    expect(playerPrices(answer, catalog, "bet365", "bet365")).toEqual([]);
  });

  it("names the bet and keeps the player in its key", () => {
    const pick = { matchId: "m1", market: "SCORER", selection: "yes", player: "Kylian Mbappé" } as const;
    expect(pickLabel(pick, "Real Madrid", "Getafe")).toBe("Marca Kylian Mbappé");
    expect(pickLabel({ ...pick, market: "CARD" }, "Real Madrid", "Getafe")).toBe("Tarjeta para Kylian Mbappé");
    expect(keyOf(pick)).toBe("m1|SCORER|yes||Kylian Mbappé");
    expect(keyOf({ matchId: "m1", market: "1X2", selection: "1" })).toBe("m1|1X2|1|");
  });

  it("settles from the report: scored or booked wins, played loses, didn't play is void", () => {
    expect(samePlayer("Vinícius Júnior", "Vinicius Junior")).toBe(true);
    expect(samePlayer("R. Lewandowski", "Robert Lewandowski")).toBe(true);
    expect(samePlayer("Iñaki Williams", "Nico Williams")).toBe(false);
    const insight = {
      goals: [
        { minute: "12'", scorer: "Kylian Mbappé", side: "home", kind: "goal" },
        { minute: "70'", scorer: "Djené", side: "home", kind: "own-goal" },
      ],
      incidents: [
        { minute: "40'", side: "away", kind: "yellow-card", player: "Djené" },
        { minute: "60'", side: "home", kind: "substitution", player: "Endrick", playerOut: "Kylian Mbappé" },
      ],
      lineups: [{ side: "home", players: [{ name: "Kylian Mbappé", starter: true }, { name: "Endrick", starter: false }, { name: "Jude Bellingham", starter: true }] }],
    } as unknown as MatchInsight;
    const facts = playerFacts(insight, finished("m1", 2, 0), true);
    const bet = (market: "SCORER" | "CARD", player: string) => settlePlayerPick({ market, player }, facts);
    expect(bet("SCORER", "Kylian Mbappe")).toBe("won");
    expect(bet("SCORER", "Djené")).toBe("void"); // own goal; not in the home line-up given
    expect(bet("SCORER", "Endrick")).toBe("lost"); // came on, didn't score
    expect(bet("SCORER", "Jude Bellingham")).toBe("lost");
    expect(bet("SCORER", "Luka Modric")).toBe("void"); // didn't play
    expect(bet("CARD", "Djené")).toBe("won");
    expect(bet("CARD", "Jude Bellingham")).toBe("lost");
    // Goals missing from the report: a non-scorer stays open; without line-ups too.
    expect(settlePlayerPick({ market: "SCORER", player: "Jude Bellingham" }, playerFacts(insight, finished("m1", 3, 0), true))).toBeNull();
    expect(settlePlayerPick({ market: "CARD", player: "Jude Bellingham" }, playerFacts({ ...insight, lineups: [] }, finished("m1", 2, 0), true))).toBeNull();
    // Read while the match was still on: a card or a goal already counts, the rest stays open.
    const live = playerFacts(insight, finished("m1", 2, 0), false);
    expect(settlePlayerPick({ market: "CARD", player: "Djené" }, live)).toBe("won");
    expect(settlePlayerPick({ market: "CARD", player: "Jude Bellingham" }, live)).toBeNull();
    expect(settlePlayerPick({ market: "SCORER", player: "Luka Modric" }, live)).toBeNull();
    // Some bookmakers write «Surname, Name».
    expect(samePlayer("Canales, Sergio", "Sergio Canales")).toBe(true);
  });

  it("accepts the AI's player bets on the real price, within the limits", () => {
    const day = analysisDays([match({ id: "a" }), match({ id: "b" })], 0)[0];
    const prices = new Map<string, MarketPrice[]>([
      ["a", [
        { market: "SCORER", selection: "yes", player: "Kylian Mbappé", price: 2.2, book: "Winamax" },
        { market: "CARD", selection: "yes", player: "Aurélien Tchouaméni", price: 4, book: "Winamax" },
      ]],
      ["b", [{ market: "SCORER", selection: "yes", player: "Borja Mayoral", price: 3.5, book: "Winamax" }]],
    ]);
    const bet = (matchId: string, market: string, player: string, probability: number) => ({
      matchId, market, selection: "yes", line: null, player, probability, confidence: "media", reason: "Titular y en racha.", risk: "Rotación.",
    });
    const analysis = acceptAnalysis(day, {
      headline: "H",
      summary: "S",
      matches: [{ matchId: "a", preview: "P" }],
      picks: [
        bet("a", "SCORER", "Kylian Mbappe", 0.5), // accent changed by the AI: the bookmaker's name is kept
        bet("a", "CARD", "Aurélien Tchouaméni", 0.4), // 15 points over 1/4 = 25 %: refused
        bet("b", "SCORER", "Borja Mayoral", 0.36),
        bet("b", "SCORER", "Nadie", 0.9), // not offered
      ],
    }, prices, 0)!;
    expect(analysis.picks.map((p) => [p.matchId, p.market, p.player, p.price])).toEqual([
      ["a", "SCORER", "Kylian Mbappé", 2.2],
      ["b", "SCORER", "Borja Mayoral", 3.5],
    ]);
    expect(MAX_PLAYER_PICKS).toBe(2);
    // Stored and read back with the player.
    const board = decodeAnalysisBoard(JSON.parse(JSON.stringify({ formatVersion: ANALYSIS_FORMAT, updatedAt: analysis.generatedAt, analyses: [analysis] })))!;
    expect(board.analyses[0].picks[0]).toMatchObject({ market: "SCORER", player: "Kylian Mbappé" });
  });

  it("the job settles open player bets once the report is in, and the record counts them", async () => {
    const pick = { matchId: "m1", market: "SCORER", selection: "yes", player: "Kylian Mbappé", price: 2.2, probability: 0.5, confidence: "media", reason: "R" } as const;
    const analyses = [
      {
        id: "PD-2026-11-28", competition: "PD", date: "2026-11-28", generatedAt: "2026-11-28T12:00:00Z", oddsAt: "2026-11-28T12:00:00Z",
        bookmaker: "Winamax", headline: "H", summary: "S", matches: [{ matchId: "m1", home: "Real Madrid CF", away: "Getafe CF", utcDate: "2026-11-28T13:00:00Z", preview: "P" }],
        picks: [pick],
      },
    ] as BettingAnalysis[];
    const played = finished("m1", 1, 0);
    const report: MatchInsight = {
      version: 1, matchId: "m1", competition: "PD", kickoff: played.utcDate, provider: "ESPN", eventId: "1", fetchedAt: "2026-11-28T15:00:00Z",
      goals: [{ minute: "30'", scorer: "Kylian Mbappé", side: "home", kind: "goal" }],
      incidents: [],
      lineups: [{ side: "home", players: [{ name: "Kylian Mbappé", starter: true }] }],
      statistics: [],
    };
    const docs = new Map<string, unknown>();
    const db = { doc: (path: string) => ({ get: async () => ({ data: () => docs.get(path) }) }) } as unknown as import("firebase-admin/firestore").Firestore;
    const now = Date.parse("2026-11-28T16:00:00Z");
    // No report yet: stays open.
    expect(await settlePlayerBets(db, analyses, [played], now)).toBeNull();
    const stored = (status: string) => ({ insight: report, checkedAt: "2026-11-28T15:00:00Z", kickoff: played.utcDate, status });
    // Read in play, he hadn't scored yet: still open.
    docs.set("matchInsights/m1", stored("IN_PLAY"));
    expect(await settlePlayerBets(db, [{ ...analyses[0], picks: [{ ...pick, player: "Jude Bellingham" }] }], [played], now)).toBeNull();
    docs.set("matchInsights/m1", stored("FINISHED"));
    const done = (await settlePlayerBets(db, analyses, [played], now))!;
    expect(done.settled).toBe(1);
    expect(done.analyses[0].picks[0].result).toBe("won");
    expect(trackRecord(done.analyses, [played])).toMatchObject({ won: 1, units: 1.2 });
    // A week later with no usable report: void.
    docs.clear();
    expect((await settlePlayerBets(db, analyses, [played], now + 8 * 86_400_000))!.analyses[0].picks[0].result).toBe("void");
  });
});

describe("números de jugador de los últimos partidos, para la IA", () => {
  type Players = MatchInsight["lineups"][number]["players"];
  // As the sync stores it: the report in `insight`.
  const stored = (m: Match, home: Players, away: Players) => ({ insight: report(m, home, away), checkedAt: m.utcDate, kickoff: m.utcDate, status: "FINISHED" });
  const report = (m: Match, home: Players, away: Players): MatchInsight => ({
    version: 1,
    matchId: m.id,
    competition: m.competition,
    kickoff: m.utcDate,
    provider: "ESPN",
    eventId: "1",
    fetchedAt: m.utcDate,
    goals: [],
    statistics: [],
    lineups: [
      { side: "home", players: home },
      { side: "away", players: away },
    ],
  });
  const fixture = match({ id: "next" });
  const r1 = finished("r1", 2, 0, { utcDate: "2026-11-20T20:00:00Z", away: "Sevilla FC" });
  // Another competition counts too; the team plays away there.
  const r2 = finished("r2", 1, 1, { utcDate: "2026-11-24T20:00:00Z", competition: "CL", home: "Liverpool FC", away: "Real Madrid CF" });
  const r0 = finished("r0", 3, 0, { utcDate: "2026-10-01T20:00:00Z", away: "Sevilla FC" });
  // Played after this kick-off: never part of its context.
  const after = finished("r3", 0, 0, { utcDate: "2026-11-29T20:00:00Z", away: "Sevilla FC" });
  const matches = [fixture, r1, r2, r0, after];
  const store = new Map<string, unknown>([
    [
      "matchInsights/r1",
      stored(
        r1,
        [
          { name: "Kylian Mbappé", starter: true, stats: { shots: 5, shotsOnTarget: 3, goals: 2 } },
          { name: "Federico Valverde", starter: true, stats: { shots: 1, foulsCommitted: 3, yellowCards: 1 } },
          { name: "Sin jugar", starter: false },
        ],
        [{ name: "Rival", starter: true, stats: { shots: 7 } }],
      ),
    ],
    [
      "matchInsights/r2",
      stored(
        r2,
        [{ name: "Mohamed Salah", starter: true, stats: { shots: 9, shotsOnTarget: 4 } }],
        [
          { name: "Kylian Mbappé", starter: true, stats: { shots: 3, shotsOnTarget: 1 } },
          { name: "Rodrygo", starter: false, subIn: "70'", stats: { shots: 2, shotsOnTarget: 2, goals: 1 } },
        ],
      ),
    ],
    ["matchInsights/r0", { roto: true }],
  ]);
  const db = { doc: (path: string) => ({ get: async () => ({ data: () => store.get(path) }) }) } as unknown as import("firebase-admin/firestore").Firestore;

  it("reads the reports of each team's last matches and sums its players' numbers, shooters first", async () => {
    const recent = await recentReports(db, [fixture], matches);
    expect(recent.wanted).toBe(3);
    expect([...recent.reports.keys()].sort()).toEqual(["r1", "r2"]);
    const context = matchContext(fixture, matches, [], [], Date.parse("2026-11-27T12:00:00Z"), recent.reports);
    expect(context.local.jugadoresUltimosPartidos).toEqual({
      partidos: 2,
      lista: [
        "Kylian Mbappé: 2 jugados (2 de titular), 8 tiros (4 a puerta), 2 goles, 0 asistencias, 0 faltas, 0 amarillas",
        "Rodrygo: 1 jugados (0 de titular), 2 tiros (2 a puerta), 1 goles, 0 asistencias, 0 faltas, 0 amarillas",
        "Federico Valverde: 1 jugados (1 de titular), 1 tiros (0 a puerta), 0 goles, 0 asistencias, 3 faltas, 1 amarillas",
      ],
    });
    // Without reports with numbers, nothing is said about the players.
    expect(context.visitante).not.toHaveProperty("jugadoresUltimosPartidos");
  });
});

describe("OddsPapi: mercados de jugador (modo prueba)", () => {
  it("shows how a bookmaker prices players' shots: lines, outcomes, players and raw fields", () => {
    const catalog = parsePlayerMarkets([
      {
        marketId: 50010,
        sportId: 10,
        playerProp: true,
        marketName: "Over Under Player Shots On Goal",
        period: "fulltime",
        handicap: 1.5,
        outcomes: [
          { outcomeId: 50010, outcomeName: "Over" },
          { outcomeId: 50011, outcomeName: "Under" },
        ],
      },
      { marketId: 60001, sportId: 10, playerProp: true, marketName: "Anytime Goal Scorer", period: "fulltime", handicap: 0 },
    ]);
    expect(catalog[0]).toMatchObject({ line: 1.5 });
    expect(catalog[1]).not.toHaveProperty("line");
    const answer = {
      bookmakerOdds: {
        "winamax.es": {
          bookmakerIsActive: true,
          markets: {
            "50010": {
              marketActive: true,
              outcomes: {
                "50010": { players: { "1": { price: 1.8, playerName: "Lamine Yamal", bookmakerOutcomeId: "abc/1.5" } } },
                "50011": { players: {} },
              },
            },
            "60001": { outcomes: { "60001": { players: { "1": { price: 2.5, playerName: "Lamine Yamal" } } } } },
          },
        },
      },
    };
    expect(describeShotMarkets(answer, catalog, "winamax.es")).toEqual([
      "«Over Under Player Shots On Goal · fulltime» (id 50010, línea 1.5): " +
        'Over (id 50010): 1 jugadores (Lamine Yamal 1.8), id en la casa "abc/1.5"; campos: players · ' +
        "Under (id 50011): 0 jugadores; campos: players. Campos del mercado: marketActive, outcomes",
    ]);
    expect(describeShotMarkets(answer, catalog, "bet365")).toEqual([]);
  });

  it("lists which bookmakers price player markets, and the fields of a price", () => {
    const catalog = parsePlayerMarkets([
      { marketId: 101, sportId: 10, playerProp: false, marketName: "1X2" },
      { marketId: 50001, sportId: 10, playerProp: true, marketName: "Player Shots On Target", period: "fulltime" },
      { marketId: 50002, sportId: 10, playerProp: true, marketName: "Anytime Goalscorer" },
      { marketId: 70000, sportId: 11, playerProp: true, marketName: "Basket points" },
    ]);
    expect(catalog).toEqual([
      { marketId: "50001", name: "Player Shots On Target · fulltime", outcomes: {}, period: "fulltime" },
      { marketId: "50002", name: "Anytime Goalscorer", outcomes: {} },
    ]);
    const price = (p: number) => ({ price: p, active: true, playerName: "Vinícius Júnior" });
    const summary = describePlayerProps(
      {
        fixtureId: "f1",
        bookmakerOdds: {
          bet365: {
            bookmakerIsActive: false,
            markets: {
              "101": { outcomes: { "101": { players: { "0": price(2) } } } },
              "50002": { outcomes: { "1": { players: { "11": price(2.5), "12": price(3.1) } } } },
            },
          },
          "winamax.es": { bookmakerIsActive: true, markets: { "101": { outcomes: {} } } },
        },
      },
      catalog,
    );
    expect(summary).toEqual([
      {
        book: "bet365",
        active: false,
        markets: [{ name: "Anytime Goalscorer", outcomes: 1, players: 2, fields: ["price", "active", "playerName"] }],
      },
    ]);
    expect(describePlayerProps(null, catalog)).toEqual([]);
  });
});

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

  it("one match without prices does not lose the day; key or rate-limit errors stop it", async () => {
    const { fetchDayOdds, OddsPapiError } = await import("../scripts/oddsPapi");
    const store = new Map<string, unknown>();
    const db = {
      doc: (path: string) => ({
        get: async () => ({ data: () => store.get(path) }),
        set: async (value: unknown) => void store.set(path, value),
      }),
    } as unknown as import("firebase-admin/firestore").Firestore;
    const one = (p: number) => ({ players: { "0": { active: true, price: p } } });
    const games = [
      match({ id: "a", home: "Levante UD", away: "Elche CF", utcDate: "2026-11-28T13:00:00Z" }),
      match({ id: "b", home: "Sevilla FC", away: "Getafe CF", utcDate: "2026-11-28T15:15:00Z" }),
    ];
    let spent = 0;
    const client = (failure: Error) => ({
      remaining: async () => null,
      markets: async () => {
        throw new Error("sin lista");
      },
      fixtures: async () => (spent++, [
        { fixtureId: "fa", startTime: "2026-11-28T13:00:00Z", participant1Name: "Levante UD", participant2Name: "Elche CF" },
        { fixtureId: "fb", startTime: "2026-11-28T15:15:00Z", participant1Name: "Sevilla FC", participant2Name: "Getafe CF" },
      ]),
      fixtureOdds: async (id: string) => {
        spent++;
        if (id === "fa") throw failure;
        return { fixtureId: id, statusId: 0, bookmakerOdds: { bet365: { bookmakerIsActive: true, markets: { "101": { outcomes: { "101": one(2), "102": one(3.4), "103": one(3.8) } } } } } };
      },
      get spent() {
        return spent;
      },
    });
    const options = { now: Date.parse("2026-11-28T12:15:00Z"), log: () => {} };
    // A server error on one match: the other keeps the prices already paid for.
    const odds = await fetchDayOdds(db, client(new OddsPapiError("HTTP 500", 500)), "PD", games, options);
    expect([...odds.prices.keys()]).toEqual(["b"]);
    expect(odds.unmatched).toEqual(["Levante UD - Elche CF (cuotas no disponibles: HTTP 500)"]);
    expect(odds.requests).toBe(3);
    // Rate limit: the rest would fail too, so the day stops (and every request is counted).
    await expect(fetchDayOdds(db, client(new OddsPapiError("HTTP 429", 429)), "PD", games, options)).rejects.toThrow("HTTP 429");
    expect(store.get("providerBudgets/oddspapi")).toMatchObject({ month: "2026-11", used: 5 });
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
    // An answer of another shape: nothing of the AI's for any priced match.
    expect(acceptAnalysis(day, {}, prices, 0)).toBeNull();
    expect(acceptAnalysis(day, { analysis: { headline: "H" }, matches: [{ matchId: "zz", preview: "P" }] }, prices, 0)).toBeNull();
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

  it("a retry after the AI failed reuses the prices it already has", async () => {
    store.clear();
    const down = async () => {
      throw new Error("límite de uso del plan");
    };
    const before = spent;
    expect((await run(kickoff - 45 * 60_000, { claude: down })).generated).toBe(0);
    const paid = spent - before;
    expect(paid).toBeGreaterThan(0);
    // 20 minutes later: same prices, no new requests, and the report says when they were read.
    expect((await run(kickoff - 25 * 60_000)).generated).toBe(1);
    expect(spent - before).toBe(paid);
    const analysis = decodeAnalysisBoard(store.get("analysis/football"))!.analyses[0];
    // The time of the first read (plus the milliseconds that run took), not of the retry.
    expect(Date.parse(analysis.oddsAt) - (kickoff - 45 * 60_000)).toBeLessThan(60_000);
  });

  it("a test with the AI logs the analysis and saves nothing (and the AI reads ESPN's headlines)", async () => {
    store.clear();
    store.set("news/football", {
      version: 1,
      provider: "ESPN",
      fetchedAt: new Date(kickoff - 3_600_000).toISOString(),
      articles: [],
      competitionArticles: {
        PD: [
          {
            title: "El Levante recupera a su delantero",
            url: "https://www.espn.com.mx/futbol/nota/_/id/1",
            // Two hours before this run (30 hours before kick-off).
            publishedAt: new Date(kickoff - 32 * 3_600_000).toISOString(),
            competition: "PD",
          },
        ],
      },
    });
    const logs: string[] = [];
    const prompts: string[] = [];
    const reading = async (prompt: string) => (prompts.push(prompt), claude());
    const result = await run(kickoff - 30 * 3_600_000, { tryAi: true, claude: reading, log: (m: string) => logs.push(m) });
    expect(result.generated).toBe(0);
    expect(store.get("analysis/football")).toBeUndefined();
    expect(store.get("providerCache/oddspapiDay")).toBeUndefined();
    expect(logs.join("\n")).toMatch(/prueba con IA, no se guarda/);
    expect(logs.join("\n")).toMatch(/«Levante favorito»: \d+ apuestas con valor/);
    expect(prompts[0]).toMatch(/Noticias: los últimos titulares de ESPN/);
    expect(prompts[0]).toContain("El Levante recupera a su delantero");
  });

  it("old prices or a test run ask OddsPapi again", async () => {
    store.clear();
    const down = async () => {
      throw new Error("sin respuesta");
    };
    await run(kickoff - 3 * 3_600_000, { force: true, claude: down });
    let before = spent;
    expect((await run(kickoff - 40 * 60_000)).generated).toBe(1);
    expect(spent).toBeGreaterThan(before);
    before = spent;
    await run(kickoff - 35 * 60_000, { dryRun: true });
    expect(spent).toBeGreaterThan(before);
  });
});

describe("prices kept for a retry", () => {
  const prices = new Map([["a", [{ market: "1X2" as const, selection: "1", price: 2.1, book: "Winamax" }]]]);
  const stored = (at: number) => encodeDayOdds("PD-2026-11-27", ["a", "b"], { prices, unmatched: ["X - Y"], requests: 3 }, at)!;

  it("come back for the same day while they are recent", () => {
    const back = decodeDayOdds(stored(1000), "PD-2026-11-27", ["a", "b"], 1000 + 30 * 60_000)!;
    expect(back.prices.get("a")).toEqual(prices.get("a"));
    expect(back).toMatchObject({ unmatched: ["X - Y"], requests: 0, fetchedAt: 1000 });
    // A match that started meanwhile is simply left out.
    expect(decodeDayOdds(stored(1000), "PD-2026-11-27", ["b"], 2000)!.prices.size).toBe(0);
  });

  it("are not used for another day, when old, or when a match was not asked", () => {
    expect(decodeDayOdds(stored(1000), "CL-2026-11-27", ["a"], 2000)).toBeUndefined();
    expect(decodeDayOdds(stored(1000), "PD-2026-11-27", ["a"], 1000 + 61 * 60_000)).toBeUndefined();
    expect(decodeDayOdds(stored(1000), "PD-2026-11-27", ["a", "c"], 2000)).toBeUndefined();
    expect(decodeDayOdds({ ...stored(1000), payload: "{roto" }, "PD-2026-11-27", ["a"], 2000)).toBeUndefined();
    expect(decodeDayOdds(undefined, "PD-2026-11-27", ["a"], 2000)).toBeUndefined();
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

type AnalysisPickLike = BettingAnalysis["picks"][number];
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
      combo: { picks: 0, settled: 0, won: 0, lost: 0, void: 0, units: 0 },
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

  it("archives last season's days with that season's results, after the summer", async () => {
    const { pastSeasonMatches } = await import("../scripts/bettingAnalysis");
    const { CALENDAR_FORMAT, encodeCalendar } = await import("../src/lib/calendar");
    const may = finished("may", 0, 1, { seasonId: "PD-2025", roundId: "PD-2025-38", utcDate: "2026-05-24T19:00:00Z" });
    const store = new Map<string, unknown>([
      ["calendars/PD-2025", { formatVersion: CALENDAR_FORMAT, seasonId: "PD-2025", payload: encodeCalendar([may]) }],
    ]);
    const read: string[] = [];
    const db = {
      doc: (path: string) => ({ path }),
      getAll: async (...refs: { path: string }[]) =>
        refs.map(({ path }) => (read.push(path), { exists: store.has(path), data: () => store.get(path) })),
    } as unknown as import("firebase-admin/firestore").Firestore;
    const dropped = [analysis({ id: "PD-2026-05-24", date: "2026-05-24", matches: [game("may", "2026-05-24T19:00:00Z")], picks: [tip("may")] })];
    // August: the current calendars no longer hold May's match; last season's do.
    const past = await pastSeasonMatches(db, dropped, Date.parse("2026-08-16T12:00:00Z"));
    expect(read).toEqual(["calendars/PD-2025", "calendars/CL-2025", "calendars/PL-2025"]);
    expect(archiveAnalyses(undefined, dropped, []).PD!.value).toMatchObject({ picks: 1, settled: 0 });
    expect(archiveAnalyses(undefined, dropped, past).PD!.value).toMatchObject({ picks: 1, settled: 1, lost: 1, units: -1 });
    // Same season: nothing more to read.
    read.length = 0;
    expect(await pastSeasonMatches(db, dropped, Date.parse("2026-06-01T12:00:00Z"))).toEqual([]);
    expect(read).toEqual([]);
  });

  it("la combinada de valor: una por partido, la de más valor, y se fija al publicar", () => {
    const leg = (matchId: string, price: number, probability: number, over: Partial<AnalysisPickLike> = {}) =>
      ({ matchId, market: "1X2", selection: "1", price, probability, confidence: "media", reason: "R", ...over }) as const;
    const picks = [
      leg("a", 2, 0.55), // +10 %
      leg("a", 1.8, 0.6, { market: "BTTS", selection: "yes" }), // +8 %: same match, the better one stays
      leg("b", 2.5, 0.43, { fair: 0.4 }), // +7,5 %
      leg("c", 1.5, 0.67), // +0,5 %: no value
    ];
    expect(valueCombo(picks).map((p) => [p.matchId, p.market])).toEqual([
      ["a", "1X2"],
      ["b", "1X2"],
    ]);
    expect(valueCombo([leg("a", 2, 0.55)])).toEqual([]);
    // Prices and chances multiply; the market's only when it priced every leg.
    expect(comboOf([leg("a", 2, 0.55, { fair: 0.5 }), leg("b", 2.5, 0.43, { fair: 0.4 })])).toEqual({
      price: 5,
      probability: expect.closeTo(0.2365, 4),
      fair: expect.closeTo(0.2, 4),
    });
    expect(comboOf([leg("a", 2, 0.55), leg("b", 2.5, 0.43, { fair: 0.4 })]).fair).toBeUndefined();
    // Settled: all won pays the product; a void leg counts at 1; one lost loses it.
    const legs = [leg("a", 2, 0.55), leg("b", 2.5, 0.43)];
    const byId = (a: Match, b: Match) => new Map([["a", a], ["b", b]]);
    expect(settleCombo(legs, byId(finished("a", 1, 0), finished("b", 2, 1)))).toEqual({ result: "won", payout: 5 });
    expect(settleCombo(legs, byId(finished("a", 1, 0), match({ id: "b", status: "POSTPONED" })))).toEqual({ result: "won", payout: 2 });
    expect(settleCombo(legs, byId(finished("a", 0, 1), match({ id: "b" })))).toEqual({ result: "lost", payout: 0 });
    expect(settleCombo(legs, byId(finished("a", 1, 0), match({ id: "b" })))).toBeNull();
    // One pick at the combined price in its own record, read back from the board.
    const day = analysis({ picks: legs as unknown as BettingAnalysis["picks"], matches: [game("a", "2026-11-28T13:00:00Z"), game("b", "2026-11-28T15:00:00Z")], combo: legs.map((l) => `${l.matchId}|1X2|1|`) });
    const board = decodeAnalysisBoard(JSON.parse(JSON.stringify({ formatVersion: ANALYSIS_FORMAT, updatedAt: day.generatedAt, analyses: [day] })))!;
    expect(board.analyses[0].combo).toEqual(["a|1X2|1|", "b|1X2|1|"]);
    expect(trackRecord(board.analyses, [finished("a", 1, 0), finished("b", 2, 1)], "combo")).toMatchObject({ picks: 1, won: 1, units: 4 });
    // A combinada that doesn't fit (same match twice, unknown pick) is dropped, the analysis stays.
    const twice = decodeAnalysisBoard({ formatVersion: ANALYSIS_FORMAT, updatedAt: day.generatedAt, analyses: [{ ...day, combo: ["a|1X2|1|", "a|1X2|1|"] }] })!;
    expect(twice.analyses[0].combo).toBeUndefined();
    expect(twice.analyses[0].picks).toHaveLength(2);
  });

  it("a value bet means +3 % as shown, and never far above the market", () => {
    expect(hasValue({ probability: 0.513, price: 2 })).toBe(true); // +2,6 % → «+3 %»
    expect(hasValue({ probability: 0.512, price: 2 })).toBe(false); // +2,4 % → «+2 %»
    expect(marketValue({ fair: 0.45, price: 2 })).toBeCloseTo(-0.1);
    expect(marketValue({ price: 2 })).toBeNull();
    // In plain words: pays well from +3 %, poorly from −3 %, fair in between.
    expect(
      [0.53, 0.513, 0.51, 0.49, 0.486, 0.48].map((probability) => priceVerdict({ probability, price: 2 })),
    ).toEqual(["good", "good", "fair", "fair", "poor", "poor"]);
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
    // A full board of past days, each with one value bet that lost.
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

describe("waiting for the next analysis and what the AI reports", () => {
  it("knows when the next analysis is due, even hours ahead", async () => {
    const { nextDueAt } = await import("../src/lib/bettingAnalysis");
    const day = [
      match({ id: "a", utcDate: "2026-11-28T13:00:00Z" }),
      match({ id: "b", utcDate: "2026-11-28T20:00:00Z" }),
      match({ id: "c", competition: "CL", utcDate: "2026-12-01T20:00:00Z" }),
    ];
    const at = (iso: string, done: string[] = []) => nextDueAt(day, Date.parse(iso), new Set(done));
    expect(at("2026-11-28T06:00:00Z")).toEqual({ id: "PD-2026-11-28", at: Date.parse("2026-11-28T12:15:00Z") });
    // Already due: now.
    expect(at("2026-11-28T12:30:00Z")).toEqual({ id: "PD-2026-11-28", at: Date.parse("2026-11-28T12:30:00Z") });
    // Done: the next match day.
    expect(at("2026-11-28T12:30:00Z", ["PD-2026-11-28"])?.id).toBe("CL-2026-12-01");
    expect(at("2026-12-02T00:00:00Z")).toBeNull();
  });

  it("names the model and reads the searches from Claude Code's result", async () => {
    const { modelName } = await import("../src/lib/bettingAnalysis");
    const { runDetails } = await import("../scripts/bettingAnalysis");
    expect(modelName("claude-sonnet-4-5-20250929")).toBe("Claude Sonnet 4.5");
    expect(modelName("claude-opus-5")).toBe("Claude Opus 5");
    expect(modelName("otro-modelo")).toBe("otro-modelo");
    expect(
      runDetails({
        usage: { server_tool_use: { web_search_requests: 4 } },
        modelUsage: { "claude-haiku-4-5": { outputTokens: 30 }, "claude-sonnet-4-5": { outputTokens: 900, webSearchRequests: 4 } },
      }),
    ).toEqual({ model: "claude-sonnet-4-5", searches: 4 });
    expect(runDetails({})).toEqual({});
  });

  it("keeps the run details of a stored analysis", () => {
    const base = {
      id: "PD-2026-11-27", competition: "PD", date: "2026-11-27",
      generatedAt: "2026-11-26T10:29:33.235Z", oddsAt: "2026-11-26T10:29:33.235Z", bookmaker: "Winamax",
      headline: "Titular", summary: "Resumen.",
      matches: [{ matchId: "1", home: "A", away: "B", utcDate: "2026-11-27T20:00:00Z", preview: "Previa." }],
      picks: [],
    };
    const read = (ai: unknown) =>
      decodeAnalysisBoard({ formatVersion: ANALYSIS_FORMAT, updatedAt: base.generatedAt, analyses: [{ ...base, ai }] })!.analyses[0].ai;
    expect(read({ model: "claude-sonnet-4-5", searches: 3, seconds: 41 })).toEqual({ model: "claude-sonnet-4-5", searches: 3, seconds: 41 });
    expect(read({ model: "<script>", searches: -1 })).toBeUndefined();
  });
});

describe("retries of the automatic analysis", () => {
  it("spaces failed attempts and gives up after three, without looping", async () => {
    const { planFrom, RETRY_GAP_MS } = await import("../scripts/bettingAnalysis");
    const day = [match({ id: "a", utcDate: "2026-11-28T13:00:00Z" }), match({ id: "b", utcDate: "2026-11-28T20:00:00Z" })];
    const now = Date.parse("2026-11-28T12:20:00Z");
    // Never tried: due now.
    expect(planFrom(day, [], {}, now)).toEqual({ id: "PD-2026-11-28", at: now });
    // Failed 5 minutes ago: not before 20 minutes after that attempt.
    const last = now - 5 * 60_000;
    expect(planFrom(day, [], { "PD-2026-11-28": { count: 1, last } }, now)?.at).toBe(last + RETRY_GAP_MS);
    // Three attempts: that day is left alone.
    expect(planFrom(day, [], { "PD-2026-11-28": { count: 3, last } }, now)).toBeNull();
  });
});
