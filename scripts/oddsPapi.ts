import type { Firestore } from "firebase-admin/firestore";
import {
  GOAL_LINES,
  type AnalysisCompetition,
  type BetMarket,
  type MarketPrice,
} from "../src/lib/bettingAnalysis";
import type { Match } from "../src/lib/domain";
import { canonicalTeamName } from "./espn";

/**
 * OddsPapi v4 (free plan: 250 requests a month, every bookmaker, pre-match).
 * Prices of bet365 when OddsPapi is collecting it, otherwise of a bookmaker
 * licensed in Spain, and Pinnacle's as the fair reference.
 * The key goes in the `apiKey` query parameter, so URLs are never printed.
 */
const API = "https://api.oddspapi.io/v4";
export const ODDSPAPI_TOURNAMENTS: Record<AnalysisCompetition, number> = { PD: 8, CL: 7 };
export const BET365 = "bet365";
/** Pinnacle on self-serve plans (30 s delay): the sharp reference for fair prices. */
export const PINNACLE = "pinnacle+30";
const MARKETS_DOC = "providerCache/oddspapiMarkets";
const BUDGET_DOC = "providerBudgets/oddspapi";
/** Below the 250 of the free plan, leaving room for manual tests. */
export const ODDSPAPI_MONTH_LIMIT = 220;
const MARKETS_REFRESH = 30 * 86_400_000;

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);

/* ---------- Markets ---------- */

/** OddsPapi market id → our market, with its outcome ids. */
export interface MarketDefinition {
  marketId: string;
  market: BetMarket;
  line?: number;
  /** outcome id → our selection. */
  outcomes: Record<string, string>;
}

/**
 * Ids documented by OddsPapi (they never change): used when the market list
 * cannot be read. 1X2 101–103, both teams to score 104–105, totals 2.5 and 3.5.
 */
export const KNOWN_MARKETS: MarketDefinition[] = [
  { marketId: "101", market: "1X2", outcomes: { "101": "1", "102": "X", "103": "2" } },
  { marketId: "104", market: "BTTS", outcomes: { "104": "yes", "105": "no" } },
  { marketId: "1010", market: "OU", line: 2.5, outcomes: { "1010": "over", "1011": "under" } },
  { marketId: "1012", market: "OU", line: 3.5, outcomes: { "1012": "over", "1013": "under" } },
];

const OUTCOME_NAMES: Record<BetMarket, Record<string, string>> = {
  "1X2": { "1": "1", x: "X", "2": "2" },
  DC: { "1x": "1X", "12": "12", "2x": "X2", x2: "X2" },
  DNB: { "1": "1", "2": "2" },
  BTTS: { yes: "yes", no: "no" },
  OU: { over: "over", under: "under" },
};

/** The full-time soccer markets the analysis uses, from `/v4/markets`. */
export function parseMarketDefinitions(value: unknown): MarketDefinition[] {
  if (!Array.isArray(value)) throw new Error("OddsPapi: lista de mercados no reconocida.");
  const found: MarketDefinition[] = [];
  for (const raw of value) {
    if (!isRow(raw) || raw.sportId !== 10 || raw.playerProp === true || raw.period !== "fulltime") continue;
    const id = typeof raw.marketId === "number" || typeof raw.marketId === "string" ? String(raw.marketId) : "";
    if (!/^\d{1,9}$/.test(id) || !Array.isArray(raw.outcomes)) continue;
    const type = str(raw.marketType, 60)?.toLowerCase() || "";
    const name = str(raw.marketName, 120)?.toLowerCase() || "";
    const handicap = typeof raw.handicap === "number" ? raw.handicap : 0;
    let market: BetMarket | null = null;
    // Both teams to score is filed as «totals» in some lists: by name first.
    if (/both teams to score/.test(name) || type === "bothteamsscore") market = handicap === 0 ? "BTTS" : null;
    else if (type === "1x2" && handicap === 0) market = "1X2";
    else if (type === "doublechance" && handicap === 0) market = "DC";
    else if (type === "drawnobet" && handicap === 0) market = "DNB";
    else if (type === "totals" && (GOAL_LINES as readonly number[]).includes(handicap)) market = "OU";
    if (!market) continue;
    const outcomes: Record<string, string> = {};
    for (const o of raw.outcomes) {
      if (!isRow(o)) continue;
      const oid = typeof o.outcomeId === "number" || typeof o.outcomeId === "string" ? String(o.outcomeId) : "";
      const selection = OUTCOME_NAMES[market][(str(o.outcomeName, 40) || "").toLowerCase().replace(/\s+/g, "")];
      if (/^\d{1,9}$/.test(oid) && selection) outcomes[oid] = selection;
    }
    const expected = market === "1X2" || market === "DC" ? 3 : 2;
    if (Object.keys(outcomes).length !== expected || new Set(Object.values(outcomes)).size !== expected) continue;
    found.push({ marketId: id, market, ...(market === "OU" ? { line: handicap } : {}), outcomes });
  }
  // One definition per market and line.
  const unique = new Map(found.map((d) => [`${d.market}|${d.line ?? ""}`, d]));
  return [...unique.values()];
}

/* ---------- Fixtures and odds ---------- */

export interface PapiFixture {
  fixtureId: string;
  startTime: string;
  home: string[];
  away: string[];
}
const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : isRow(value) && Array.isArray(value.data) ? value.data : isRow(value) ? [value] : [];

export function parseFixtures(value: unknown): PapiFixture[] {
  return list(value).flatMap((raw) => {
    if (!isRow(raw)) return [];
    const fixtureId = str(raw.fixtureId, 80);
    const startTime = str(raw.trueStartTime, 40) || str(raw.startTime, 40);
    if (!fixtureId || !startTime || !Number.isFinite(Date.parse(startTime))) return [];
    const names = (n: 1 | 2) =>
      [raw[`participant${n}Name`], raw[`participant${n}ShortName`]].flatMap((v) => str(v, 100) ?? []);
    const home = names(1);
    const away = names(2);
    return home.length && away.length ? [{ fixtureId, startTime, home, away }] : [];
  });
}

/** Bookmaker slug → `marketId|outcomeId` → decimal price, for one fixture. */
export type FixtureBooks = Map<string, Map<string, number>>;

/**
 * Prices of one fixture from `/v4/odds`. Only bookmakers OddsPapi is still
 * collecting (`bookmakerIsActive`), not suspended, with active prices: a
 * price kept from a week ago must never look current.
 */
export function parseFixtureOdds(value: unknown, markets: MarketDefinition[]): FixtureBooks {
  const wanted = new Map(markets.map((d) => [d.marketId, d]));
  const books: FixtureBooks = new Map();
  const raw = list(value).find(isRow);
  // Not started only (live prices are not on the free plan).
  if (!raw || (typeof raw.statusId === "number" && raw.statusId !== 0) || !isRow(raw.bookmakerOdds)) return books;
  for (const [slug, book] of Object.entries(raw.bookmakerOdds)) {
    if (!isRow(book) || book.bookmakerIsActive !== true || book.suspended === true || !isRow(book.markets)) continue;
    const own = new Map<string, number>();
    for (const [marketId, market] of Object.entries(book.markets)) {
      const definition = wanted.get(marketId);
      if (!definition || !isRow(market) || market.marketActive === false || !isRow(market.outcomes)) continue;
      for (const [outcomeId, outcome] of Object.entries(market.outcomes)) {
        if (!definition.outcomes[outcomeId] || !isRow(outcome) || !isRow(outcome.players)) continue;
        const player = outcome.players["0"];
        if (!isRow(player) || player.active === false) continue;
        const price = player.price;
        if (typeof price === "number" && Number.isFinite(price) && price >= 1.01 && price <= 1000)
          own.set(`${marketId}|${outcomeId}`, price);
      }
    }
    if (own.size) books.set(slug, own);
  }
  return books;
}

/**
 * bet365 first. When OddsPapi is not collecting it (often: bet365 is hard to
 * read), the first bookmaker licensed in Spain that prices the match.
 */
export const SOFT_BOOKS = [
  "bet365",
  "winamax.es",
  "888sport.es",
  "bwin.es",
  "codere.es",
  "leovegas.es",
  "goldenpark.es",
  "williamhill",
  "betway",
  "betsson",
] as const;
export const BOOK_NAMES: Record<string, string> = {
  bet365: "bet365",
  "winamax.es": "Winamax",
  "888sport.es": "888sport",
  "bwin.es": "bwin",
  "codere.es": "Codere",
  "leovegas.es": "LeoVegas",
  "goldenpark.es": "Golden Park",
  williamhill: "William Hill",
  betway: "Betway",
  betsson: "Betsson",
};
export function chooseBook(books: FixtureBooks) {
  return SOFT_BOOKS.find((slug) => ["101", "102", "103"].every((o) => books.get(slug)?.has(`101|${o}`))) ?? null;
}

/** Same day, kick-off within 15 minutes and at least one team by name; unique only. */
export function findFixture(match: Match, fixtures: PapiFixture[]) {
  const home = canonicalTeamName(match.home);
  const away = canonicalTeamName(match.away);
  const kickoff = Date.parse(match.utcDate);
  const candidates = fixtures.filter(
    (f) =>
      Math.abs(Date.parse(f.startTime) - kickoff) <= 15 * 60_000 &&
      (f.home.some((n) => canonicalTeamName(n) === home) || f.away.some((n) => canonicalTeamName(n) === away)),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

/** Every market the chosen bookmaker prices completely, with Pinnacle's margin removed per market. */
export function marketPrices(
  markets: MarketDefinition[],
  soft: Map<string, number>,
  sharp: Map<string, number> | undefined,
  book: string,
): MarketPrice[] {
  const result: MarketPrice[] = [];
  for (const d of markets) {
    const outcomes = Object.entries(d.outcomes);
    const softPrices = outcomes.map(([oid]) => soft.get(`${d.marketId}|${oid}`));
    if (softPrices.some((p) => p === undefined)) continue;
    const sharpPrices = outcomes.map(([oid]) => sharp?.get(`${d.marketId}|${oid}`));
    const complete = sharpPrices.every((p) => p !== undefined);
    const total = complete ? sharpPrices.reduce((sum, p) => sum + 1 / p!, 0) : 0;
    outcomes.forEach(([, selection], i) => {
      result.push({
        market: d.market,
        selection,
        ...(d.line !== undefined ? { line: d.line } : {}),
        price: softPrices[i]!,
        book,
        ...(complete
          ? { sharp: sharpPrices[i]!, fair: Math.round((1 / sharpPrices[i]! / total) * 10_000) / 10_000 }
          : {}),
      });
    });
  }
  return result;
}

/* ---------- HTTP ---------- */

export class OddsPapiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "",
  ) {
    super(message);
  }
}

export interface OddsPapiClient {
  /** Remaining requests this month, from the free `/account` endpoint (null: unknown). */
  remaining(): Promise<{ limit: number; used: number; bookmakers: string[] } | null>;
  markets(): Promise<unknown>;
  fixtures(tournamentId: number, from: string, to: string): Promise<unknown>;
  /** One fixture, several bookmakers at once (all of them when none are given). */
  fixtureOdds(fixtureId: string, bookmakers?: string[]): Promise<unknown>;
  /** Requests that used quota in this run. */
  readonly spent: number;
}

export function createOddsPapiClient(
  key: string,
  options: { request?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): OddsPapiClient {
  const request = options.request ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const last = new Map<string, number>();
  let spent = 0;
  // Minimum gap per endpoint (documented): odds 0.5 s, fixtures 2 s, the rest 1 s.
  const gaps: Record<string, number> = { odds: 600, fixtures: 2100, markets: 1100, account: 1100 };
  async function call(path: string, params: Record<string, string | number>, free = false): Promise<unknown> {
    const wait = (last.get(path) ?? -Infinity) + (gaps[path] ?? 1100) - Date.now();
    if (wait > 0) await sleep(wait);
    last.set(path, Date.now());
    const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), apiKey: key });
    if (!free) spent++;
    const response = await request(`${API}/${path}?${query}`, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { accept: "application/json" },
    });
    const body = await response.text();
    if (body.length > 25_000_000) throw new OddsPapiError("respuesta demasiado grande", response.status);
    let data: unknown = null;
    try {
      data = JSON.parse(body);
    } catch {
      throw new OddsPapiError(`HTTP ${response.status}, respuesta no JSON`, response.status);
    }
    if (!response.ok) {
      const error = isRow(data) && isRow(data.error) ? data.error : {};
      // Status and code only: the URL carries the key and is never printed.
      throw new OddsPapiError(`HTTP ${response.status} ${str(error.code, 60) || ""}`.trim(), response.status, str(error.code, 60));
    }
    return data;
  }
  return {
    async remaining() {
      try {
        const data = await call("account", {}, true);
        const subs = isRow(data) && Array.isArray(data.subscriptions) ? data.subscriptions.filter(isRow) : [];
        const current = subs.find((s) => s.is_active === true) || subs[0];
        if (!current || typeof current.request_limit !== "number" || typeof current.request_count !== "number") return null;
        return {
          limit: current.request_limit,
          used: current.request_count,
          bookmakers: isRow(current.bookmakers) ? Object.keys(current.bookmakers).slice(0, 400) : [],
        };
      } catch {
        return null;
      }
    },
    markets: () => call("markets", { language: "en" }),
    fixtures: (tournamentId, from, to) => call("fixtures", { tournamentId, from, to, statusId: 0 }),
    fixtureOdds: (fixtureId, bookmakers) =>
      call("odds", { fixtureId, ...(bookmakers?.length ? { bookmakers: bookmakers.join(",") } : {}) }),
    get spent() {
      return spent;
    },
  };
}

/* ---------- One match day ---------- */

/** Cached market list (one request a month), falling back to the documented ids. */
async function marketList(db: Firestore, client: OddsPapiClient, now: number, log: (m: string) => void) {
  const snap = await db.doc(MARKETS_DOC).get();
  const cached = snap.data();
  if (cached && now - Number(cached.fetchedAt) < MARKETS_REFRESH && Array.isArray(cached.markets) && cached.markets.length)
    return cached.markets as MarketDefinition[];
  try {
    const parsed = parseMarketDefinitions(await client.markets());
    const merged = new Map([...KNOWN_MARKETS, ...parsed].map((d) => [`${d.market}|${d.line ?? ""}`, d]));
    const markets = [...merged.values()];
    await db.doc(MARKETS_DOC).set({ fetchedAt: now, markets });
    log(`OddsPapi: ${parsed.length} mercados reconocidos en la lista oficial.`);
    return markets;
  } catch (error) {
    log(`OddsPapi: lista de mercados no disponible (${error instanceof Error ? error.message : "error"}); se usan los conocidos.`);
    return KNOWN_MARKETS;
  }
}

export interface DayOdds {
  /** Our match id → prices of the chosen bookmaker (with Pinnacle's when available). */
  prices: Map<string, MarketPrice[]>;
  unmatched: string[];
  requests: number;
}

/**
 * One request for the day's fixtures (team names), then one per match with
 * bet365, the Spanish fallbacks and Pinnacle together. Keeps a monthly count
 * below the free plan.
 */
export async function fetchDayOdds(
  db: Firestore,
  client: OddsPapiClient,
  competition: AnalysisCompetition,
  matches: Match[],
  options: { now: number; log: (m: string) => void; debug?: boolean },
): Promise<DayOdds> {
  const { now, log, debug } = options;
  const month = new Date(now).toISOString().slice(0, 7);
  const budgetRef = db.doc(BUDGET_DOC);
  const budget = (await budgetRef.get()).data();
  const used = budget?.month === month ? Number(budget.used) || 0 : 0;
  const account = await client.remaining();
  if (account) log(`OddsPapi: ${account.used}/${account.limit} peticiones usadas este mes.`);
  const needed = matches.length + 2;
  const left = account ? account.limit - account.used : Infinity;
  if (used + needed > ODDSPAPI_MONTH_LIMIT || left < needed)
    throw new OddsPapiError("presupuesto mensual alcanzado", 429, "MONTH_BUDGET");
  const before = client.spent;
  try {
    const markets = await marketList(db, client, now, log);
    const tournament = ODDSPAPI_TOURNAMENTS[competition];
    const first = Math.min(...matches.map((m) => Date.parse(m.utcDate)));
    const lastKick = Math.max(...matches.map((m) => Date.parse(m.utcDate)));
    const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
    const fixtures = parseFixtures(await client.fixtures(tournament, iso(first - 3_600_000), iso(lastKick + 3_600_000)));
    const prices = new Map<string, MarketPrice[]>();
    const unmatched: string[] = [];
    for (const match of matches) {
      const fixture = findFixture(match, fixtures);
      if (!fixture) {
        unmatched.push(`${match.home} - ${match.away}`);
        continue;
      }
      const books = parseFixtureOdds(await client.fixtureOdds(fixture.fixtureId, [...SOFT_BOOKS, PINNACLE]), markets);
      const slug = chooseBook(books);
      if (!slug) {
        unmatched.push(`${match.home} - ${match.away} (ninguna casa con cuotas al día)`);
        continue;
      }
      const list = marketPrices(markets, books.get(slug)!, books.get(PINNACLE), BOOK_NAMES[slug] ?? slug);
      prices.set(match.id, list);
      if (debug || slug !== BET365)
        log(
          `OddsPapi: ${match.home} - ${match.away}: ${slug === BET365 ? "bet365" : `bet365 no está al día, se usa ${BOOK_NAMES[slug] ?? slug}`}; ` +
            `${list.length} cuotas${books.has(PINNACLE) ? ", con Pinnacle" : ", sin Pinnacle"}.`,
        );
    }
    if (unmatched.length && fixtures.length)
      log(
        `OddsPapi: nombres disponibles: ${fixtures
          .map((f) => `${f.home[0]} - ${f.away[0]} (${f.startTime.slice(0, 16)})`)
          .join("; ")
          .slice(0, 1500)}`,
      );
    return { prices, unmatched, requests: client.spent - before };
  } finally {
    const spent = client.spent - before;
    if (spent) await budgetRef.set({ month, used: used + spent, updatedAt: now });
  }
}
