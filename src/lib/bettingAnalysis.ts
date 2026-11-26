import type { CompetitionCode } from "./competitions";
import { hasPublishedResult, type Match } from "./domain";
import type { MatchInsight, PlayerStats } from "./matchInsightsData";

/**
 * The AI's betting analysis: before the first match of each day of LaLiga or
 * Champions, bet365 prices are compared with Pinnacle's (the sharp
 * reference) and with the app's own data, and the AI picks the bets whose
 * price pays more than they should. Information only: nothing is bet here.
 */
export const ANALYSIS_FORMAT = 1;
export const ANALYSIS_DOC = "analysis/football";
export const ANALYSIS_COMPETITIONS = ["PD", "CL"] as const satisfies readonly CompetitionCode[];
export type AnalysisCompetition = (typeof ANALYSIS_COMPETITIONS)[number];
/** The newest ones the board keeps (about a month of match days); older ones live on in `archive`. */
export const MAX_ANALYSES = 24;
export const MAX_PICKS = 6;
/** Picks a stored analysis may hold: the AI's, plus those of matches kept from an earlier run of the day. */
export const MAX_STORED_PICKS = 12;
/**
 * With value: pays at least 3 % over the fair price by the AI's estimate, as
 * shown (rounded to a whole percent). The same rule everywhere: the job, the
 * chips, the chart line and the texts.
 */
export const MIN_VALUE = 0.03;
/**
 * The AI may not see much more than the market: a value bet it rates more than
 * 10 points above Pinnacle's fair chance is an overconfident guess, not value.
 */
export const MAX_MARKET_GAP = 0.1;
/** The analysis runs from this long before the day's first kick-off… */
export const ANALYSIS_LEAD_MS = 45 * 60_000;
/** …and is skipped once even the last match of the day is about to start. */
const LAST_CALL_MS = 10 * 60_000;

export type BetMarket = "1X2" | "DC" | "DNB" | "BTTS" | "OU" | "SCORER" | "CARD" | "SHOTS" | "SOT";
export const MARKET_SELECTIONS: Record<BetMarket, readonly string[]> = {
  "1X2": ["1", "X", "2"],
  DC: ["1X", "12", "X2"],
  DNB: ["1", "2"],
  BTTS: ["yes", "no"],
  OU: ["over", "under"],
  SCORER: ["yes"],
  CARD: ["yes"],
  SHOTS: ["yes"],
  SOT: ["yes"],
};
/**
 * A player's bet: scores at any time (SCORER), is booked (CARD), or has at
 * least `line` shots (SHOTS) or shots on target (SOT). Pinnacle doesn't price
 * them, so they have no market reference, only the AI's.
 */
export const PLAYER_MARKETS: readonly BetMarket[] = ["SCORER", "CARD", "SHOTS", "SOT"];
export const isPlayerMarket = (market: BetMarket) => PLAYER_MARKETS.includes(market);
/** Goal lines offered to the AI (half goals: no pushes, easy to read). */
export const GOAL_LINES = [1.5, 2.5, 3.5] as const;
/** «N or more» shots: the steps the bookmakers price. */
export const SHOT_LINES = [1, 2, 3, 4, 5, 6] as const;
/** The markets that come with a line, and the lines they may have. */
export const MARKET_LINES: Partial<Record<BetMarket, readonly number[]>> = {
  OU: GOAL_LINES,
  SHOTS: SHOT_LINES,
  SOT: SHOT_LINES,
};
/** How solid the AI finds its own reasons (shown as such, never as the chance of winning). */
export const CONFIDENCE = ["alta", "media", "baja"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

/* ---------- Confidence: the chance a bet wins ---------- */

export type ConfidenceLevel = "muy-alta" | "alta" | "media" | "baja";
/** One fixed scale for every bet: the chance of winning it, not how it pays. */
export const CONFIDENCE_LEVELS: readonly { id: ConfidenceLevel; label: string; min: number; bars: number }[] = [
  { id: "muy-alta", label: "muy alta", min: 0.7, bars: 4 },
  { id: "alta", label: "alta", min: 0.55, bars: 3 },
  { id: "media", label: "media", min: 0.4, bars: 2 },
  { id: "baja", label: "baja", min: 0, bars: 1 },
];
export const confidenceOf = (chance: number) => CONFIDENCE_LEVELS.find((l) => chance >= l.min)!;
/**
 * The chance a bet wins, prudently: the AI's estimate, never above the
 * market's (Pinnacle without margin) when it priced it.
 */
export const winChance = (p: { probability: number; fair?: number }) =>
  p.fair !== undefined ? Math.min(p.probability, p.fair) : p.probability;

/**
 * One price of a match: bet365's (or, when bet365 is not up to date, another
 * bookmaker licensed in Spain), with Pinnacle's next to it when known.
 */
export interface MarketPrice {
  market: BetMarket;
  selection: string;
  /** Goal line (OU), or the least number of shots (SHOTS, SOT). */
  line?: number;
  /** The player, as the bookmaker names them (players' markets only). */
  player?: string;
  /** Decimal price of `book`. */
  price: number;
  /** The bookmaker of `price` («bet365», «Winamax»…). */
  book?: string;
  /** Pinnacle, decimal, margin included. */
  sharp?: number;
  /** Pinnacle's probability with its margin removed (0–1). */
  fair?: number;
}

export interface AnalysisPick {
  matchId: string;
  market: BetMarket;
  selection: string;
  line?: number;
  /** The player (players' markets only). */
  player?: string;
  /** Price when the analysis was made… */
  price: number;
  /** …at this bookmaker (bet365 when absent). */
  book?: string;
  /** The AI's estimate (0–1). */
  probability: number;
  /** Pinnacle's no-margin probability, when Pinnacle priced it. */
  fair?: number;
  confidence: Confidence;
  reason: string;
  risk?: string;
  /** A player's bet as the job settled it from the match report (ESPN). */
  result?: PickResult;
}
export interface AnalysisMatch {
  matchId: string;
  home: string;
  away: string;
  utcDate: string;
  homeCrest?: string;
  awayCrest?: string;
  preview: string;
  /**
   * The AI's best option for this match, value or not (its value is shown as
   * it is, even negative). The value bets are in `picks`.
   */
  pick?: AnalysisPick;
  /** What the market expects, for the charts. */
  market?: MatchMarket;
  /** Every main option with its price, its chance and what it pays («Cuotas del partido»). */
  options?: MatchOption[];
  /** Websites the AI read for this match (host names only). */
  sources?: string[];
}

/**
 * One option of a match as the market prices it: the bookmaker's price, the
 * chance with the margin removed, and so what it pays against that chance.
 */
export interface MatchOption {
  market: BetMarket;
  selection: string;
  line?: number;
  price: number;
  /** Chance without margin (0–1): Pinnacle's when `sharp`, else the bookmaker's own. */
  probability: number;
  sharp?: true;
}
/** What the option pays against its chance: 0 is fair, −0.05 pays 5 % less. */
export const optionValue = (o: Pick<MatchOption, "price" | "probability">) => edge(o.probability, o.price);

/** The market's chances for a match, margin removed (0–1). */
export interface MatchMarket {
  home: number;
  draw: number;
  away: number;
  /** More than 2.5 goals. */
  over25?: number;
  /** Both teams score. */
  btts?: number;
  /** Whose prices: «Pinnacle», or the bookmaker's when Pinnacle is missing. */
  source: string;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
/**
 * Chances of one market from its prices: Pinnacle's fair ones when it priced
 * every outcome, otherwise the bookmaker's with its margin removed.
 */
function chances(prices: MarketPrice[], market: BetMarket, selections: readonly string[], line?: number) {
  const own = selections.map((sel) => prices.find((p) => p.market === market && p.selection === sel && p.line === line));
  if (own.some((p) => !p)) return null;
  if (own.every((p) => p!.fair !== undefined)) return { values: own.map((p) => p!.fair!), sharp: true };
  const total = own.reduce((sum, p) => sum + 1 / p!.price, 0);
  return { values: own.map((p) => round4(1 / p!.price / total)), sharp: false };
}
/** Groups of options shown for every match (players' bets have their own place). */
const OPTION_GROUPS: { market: BetMarket; selections: readonly string[]; line?: number }[] = [
  { market: "1X2", selections: MARKET_SELECTIONS["1X2"] },
  { market: "DC", selections: MARKET_SELECTIONS.DC },
  { market: "DNB", selections: MARKET_SELECTIONS.DNB },
  { market: "BTTS", selections: MARKET_SELECTIONS.BTTS },
  ...GOAL_LINES.map((line) => ({ market: "OU" as const, selections: MARKET_SELECTIONS.OU, line })),
];
export const MAX_OPTIONS = 18;
/** The match's main options with their chance (no margin), most likely first. */
export function matchOptions(prices: MarketPrice[] | undefined): MatchOption[] {
  if (!prices?.length) return [];
  const options: MatchOption[] = [];
  for (const group of OPTION_GROUPS) {
    const result = chances(prices, group.market, group.selections, group.line);
    if (!result) continue;
    group.selections.forEach((selection, i) => {
      const own = prices.find((p) => p.market === group.market && p.selection === selection && p.line === group.line)!;
      options.push({
        market: group.market,
        selection,
        ...(group.line !== undefined ? { line: group.line } : {}),
        price: own.price,
        probability: result.values[i],
        ...(result.sharp ? { sharp: true as const } : {}),
      });
    });
  }
  return options.sort((a, b) => b.probability - a.probability).slice(0, MAX_OPTIONS);
}

export function marketView(prices: MarketPrice[] | undefined): MatchMarket | null {
  if (!prices?.length) return null;
  const result = chances(prices, "1X2", ["1", "X", "2"]);
  if (!result) return null;
  const over = chances(prices, "OU", ["over", "under"], 2.5);
  const btts = chances(prices, "BTTS", ["yes", "no"]);
  return {
    home: result.values[0],
    draw: result.values[1],
    away: result.values[2],
    ...(over ? { over25: over.values[0] } : {}),
    ...(btts ? { btts: btts.values[0] } : {}),
    source: result.sharp ? "Pinnacle" : prices[0].book ?? "bet365",
  };
}

/** Host names only, never links: what the AI read, shown as plain text. */
export function sourceHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const hosts = value.flatMap((raw) => {
    if (typeof raw !== "string" || raw.length > 300) return [];
    let host = raw.trim().toLowerCase();
    try {
      if (/^https?:\/\//.test(host)) host = new URL(host).hostname;
    } catch {
      return [];
    }
    host = host.replace(/^www\./, "").replace(/\/.*$/, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && host.length <= 80 ? [host] : [];
  });
  return [...new Set(hosts)].slice(0, 5);
}
export interface BettingAnalysis {
  /** Competition and day in Madrid: `PD-2026-11-28`. */
  id: string;
  competition: AnalysisCompetition;
  date: string;
  generatedAt: string;
  oddsAt: string;
  bookmaker: string;
  headline: string;
  summary: string;
  matches: AnalysisMatch[];
  picks: AnalysisPick[];
  /**
   * «Combinada de valor», fixed when the analysis is published: the
   * keys (pickKey) of its legs, all among `picks`, from different matches.
   */
  combo?: string[];
  /** How the AI ran: the model, its web searches and how long it took. */
  ai?: AnalysisRun;
}
/** Details of the AI's work on one analysis, as Claude Code reported them. */
export interface AnalysisRun {
  /** Model id as reported («claude-…»). */
  model?: string;
  searches?: number;
  seconds?: number;
}

/** «claude-sonnet-4-5-20250929» → «Claude Sonnet 4.5»; anything else as it came. */
export function modelName(id: string) {
  const m = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (!m) return id;
  return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

function decodeRun(raw: unknown): AnalysisRun | null {
  if (!isRow(raw)) return null;
  const run: AnalysisRun = {
    ...(typeof raw.model === "string" && /^[a-z0-9][a-z0-9.-]{1,79}$/.test(raw.model) ? { model: raw.model } : {}),
    ...(Number.isInteger(raw.searches) && (raw.searches as number) >= 0 && (raw.searches as number) <= 100
      ? { searches: raw.searches as number }
      : {}),
    ...(Number.isInteger(raw.seconds) && (raw.seconds as number) >= 0 && (raw.seconds as number) <= 7200
      ? { seconds: raw.seconds as number }
      : {}),
  };
  return Object.keys(run).length ? run : null;
}
/** Settled totals of one kind of pick (see TrackRecord). */
export interface RecordTotals {
  picks: number;
  settled: number;
  won: number;
  lost: number;
  void: number;
  units: number;
}
/** Per competition: the record of analyses that no longer fit on the board. */
export type RecordKind = "value" | "best" | "combo";
export type RecordArchive = Partial<
  Record<AnalysisCompetition, { since: string; value: RecordTotals; best: RecordTotals; combo?: RecordTotals }>
>;
export interface AnalysisBoard {
  formatVersion: typeof ANALYSIS_FORMAT;
  updatedAt: string;
  analyses: BettingAnalysis[];
  /** Older analyses, already counted: the record never forgets a pick. */
  archive?: RecordArchive;
}

/* ---------- Small helpers ---------- */

const madrid = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** The calendar day in Spain (`YYYY-MM-DD`): what «today's matches» means to the user. */
export const madridDate = (when: string | number) => madrid.format(new Date(when));

export const analysisId = (competition: AnalysisCompetition, date: string) => `${competition}-${date}`;

/** What the price pays over the estimated chance: 0.08 = 8 % of value. */
export const edge = (probability: number, price: number) => probability * price - 1;
/** Value as the app shows it, in whole percent. */
export const valuePercent = (probability: number, price: number) => Math.round(edge(probability, price) * 100);
/** A value bet by the AI's estimate (see MIN_VALUE). */
export const hasValue = (p: Pick<AnalysisPick, "probability" | "price">) =>
  valuePercent(p.probability, p.price) >= Math.round(MIN_VALUE * 100);
/** What the market (Pinnacle without its margin) says the price is worth, when it priced it. */
export const marketValue = (p: Pick<AnalysisPick, "fair" | "price">) =>
  p.fair === undefined ? null : edge(p.fair, p.price);
export type PriceVerdict = "good" | "fair" | "poor";
/** The price in plain words, by the AI's estimate: pays well from +3 %, poorly from −3 %. */
export function priceVerdict(p: Pick<AnalysisPick, "probability" | "price">): PriceVerdict {
  return hasValue(p)
    ? "good"
    : valuePercent(p.probability, p.price) <= -Math.round(MIN_VALUE * 100)
      ? "poor"
      : "fair";
}

export const pickKey = (p: { matchId: string; market: BetMarket; selection: string; line?: number; player?: string }) =>
  `${p.matchId}|${p.market}|${p.selection}|${p.line ?? ""}${p.player ? `|${p.player}` : ""}`;

const goals = new Intl.NumberFormat("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const MARKET_NAMES: Record<BetMarket, string> = {
  "1X2": "Resultado",
  DC: "Doble oportunidad",
  DNB: "Empate no válido",
  BTTS: "Ambos marcan",
  OU: "Goles",
  SCORER: "Goleador",
  CARD: "Tarjeta a jugador",
  SHOTS: "Tiros",
  SOT: "Tiros a puerta",
};
/** «Gana el Betis», «Más de 2,5 goles», «Marca Lewandowski»: the bet in words. */
export function pickLabel(pick: Pick<AnalysisPick, "market" | "selection" | "line" | "player">, home: string, away: string) {
  const side = (s: string) => (s === "1" ? home : away);
  switch (pick.market) {
    case "1X2":
      return pick.selection === "X" ? "Empate" : `Gana ${side(pick.selection)}`;
    case "DC":
      return pick.selection === "1X"
        ? `${home} o empate`
        : pick.selection === "X2"
          ? `${away} o empate`
          : "Gana cualquiera (sin empate)";
    case "DNB":
      return `${side(pick.selection)} (empate devuelve)`;
    case "BTTS":
      return pick.selection === "yes" ? "Marcan los dos" : "No marcan los dos";
    case "OU":
      return `${pick.selection === "over" ? "Más" : "Menos"} de ${goals.format(pick.line ?? 0)} goles`;
    case "SCORER":
      return `Marca ${pick.player ?? "un jugador"}`;
    case "CARD":
      return `Tarjeta para ${pick.player ?? "un jugador"}`;
    case "SHOTS":
    case "SOT": {
      const n = pick.line ?? 1;
      return `${pick.player ?? "Un jugador"}: al menos ${n} ${n === 1 ? "tiro" : "tiros"}${pick.market === "SOT" ? " a puerta" : ""}`;
    }
  }
}

/* ---------- Results ---------- */

export type PickResult = "won" | "lost" | "void";
/**
 * Regular time (the official score in the app is always the 90 minutes). A
 * player's bet carries the result the job settled from the match report.
 */
export function settlePick(
  pick: Pick<AnalysisPick, "matchId" | "market" | "selection" | "line" | "result">,
  match: Match | undefined,
): PickResult | null {
  if (!match || match.id !== pick.matchId) return null;
  if (["POSTPONED", "CANCELLED", "SUSPENDED"].includes(match.status)) return "void";
  if (isPlayerMarket(pick.market)) return pick.result ?? null;
  if (!hasPublishedResult(match)) return null;
  const h = match.homeScore!;
  const a = match.awayScore!;
  const sign = h > a ? "1" : h < a ? "2" : "X";
  const win = (yes: boolean): PickResult => (yes ? "won" : "lost");
  switch (pick.market) {
    case "1X2":
      return win(pick.selection === sign);
    case "DC":
      return win(pick.selection.includes(sign));
    case "DNB":
      return sign === "X" ? "void" : win(pick.selection === sign);
    case "BTTS":
      return win((h > 0 && a > 0) === (pick.selection === "yes"));
    case "OU": {
      const total = h + a;
      const line = pick.line ?? NaN;
      if (!Number.isFinite(line)) return null;
      if (total === line) return "void";
      return win(pick.selection === "over" ? total > line : total < line);
    }
    default:
      return null;
  }
}

/* ---------- Players' bets, from the match report ---------- */

/** What a player's bet needs from the match report: who scored, who was booked, who played. */
export interface PlayerFacts {
  /** Scorers (own goals left out)… */
  scorers: string[];
  /** …and whether every goal of the score is there. */
  goalsComplete: boolean;
  booked: string[];
  /** Starters and players brought on; null without line-ups. */
  played: string[] | null;
  /** Each player's numbers (shots…), when the report has them. */
  numbers: { name: string; stats: PlayerStats }[];
  /**
   * Read once the match was over. Before that, a bet can be won (a goal, a
   * card or a shot never go away) but not lost: the rest may still happen.
   */
  final: boolean;
}
export function playerFacts(
  insight: Pick<MatchInsight, "goals" | "incidents" | "lineups">,
  match: Match,
  final: boolean,
): PlayerFacts {
  const goals = insight.goals || [];
  const incidents = insight.incidents || [];
  const players = (insight.lineups || []).flatMap((l) => l.players);
  const starters = players.filter((p) => p.starter).map((p) => p.name);
  return {
    scorers: goals.filter((g) => g.kind !== "own-goal").map((g) => g.scorer),
    goalsComplete: goals.length === (match.homeScore ?? -1) + (match.awayScore ?? -1),
    booked: incidents.filter((i) => i.kind !== "substitution").map((i) => i.player),
    played: starters.length
      ? [
          ...starters,
          ...incidents.filter((i) => i.kind === "substitution").map((i) => i.player),
          ...players.filter((p) => !p.starter && (p.subIn || p.stats)).map((p) => p.name),
        ]
      : null,
    numbers: players.flatMap((p) => (p.stats ? [{ name: p.name, stats: p.stats }] : [])),
    final,
  };
}
/** «Canales, Sergio» (as some bookmakers write it) → «Sergio Canales». */
export const playerName = (name: string) => {
  const parts = /^([^,]+),\s*(.+)$/.exec(name.trim());
  return parts ? `${parts[2]} ${parts[1]}` : name.trim();
};
const playerKey = (name: string) =>
  playerName(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** The same player under two spellings: «Vinícius Júnior» and «Vinicius Junior», «R. Lewandowski». */
export function samePlayer(a: string, b: string) {
  const x = playerKey(a);
  const y = playerKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(" ");
  const ys = y.split(" ");
  return xs.length > 1 && ys.length > 1 && xs.at(-1) === ys.at(-1) && xs[0][0] === ys[0][0];
}
/**
 * Scores / is booked / reaches the shots: won. Didn't, and played: lost.
 * Didn't play: void (as the bookmakers settle it). Not enough in the report
 * yet (or the match was still on when it was read): null.
 */
export function settlePlayerPick(pick: Pick<AnalysisPick, "market" | "player" | "line">, facts: PlayerFacts): PickResult | null {
  const name = pick.player;
  if (!name || !isPlayerMarket(pick.market)) return null;
  const shots = pick.market === "SHOTS" || pick.market === "SOT";
  const count = shots
    ? facts.numbers.find((n) => samePlayer(n.name, name))?.stats[pick.market === "SOT" ? "shotsOnTarget" : "shots"]
    : undefined;
  const done = shots
    ? (count ?? 0) >= (pick.line ?? 1)
    : (pick.market === "SCORER" ? facts.scorers : facts.booked).some((n) => samePlayer(n, name));
  if (done) return "won";
  if (!facts.final || !facts.played || (pick.market === "SCORER" && !facts.goalsComplete)) return null;
  if (!facts.played.some((n) => samePlayer(n, name))) return "void";
  // Shots need the player's numbers: without them nothing can be said.
  return shots && count === undefined ? null : "lost";
}

export interface TrackRecord {
  picks: number;
  settled: number;
  won: number;
  lost: number;
  void: number;
  /** One unit on every settled pick: profit in units. */
  units: number;
  /** Profit per unit staked (void picks return the stake). */
  yield: number | null;
}
/** The picks of a kind: the value bets or every match's recommendation. */
export const picksOf = (analysis: BettingAnalysis, kind: "value" | "best") =>
  kind === "value" ? analysis.picks : analysis.matches.flatMap((m) => (m.pick ? [m.pick] : []));

/* ---------- Combinada ---------- */

export const MAX_COMBO_LEGS = 3;
/**
 * A combinada: the prices multiply, and so do the chances (legs of different
 * matches are independent). The bookmaker's margin multiplies too, so it only
 * has value when every leg has it.
 */
export function comboOf(legs: Pick<AnalysisPick, "price" | "probability" | "fair">[]) {
  const product = (values: number[]) => values.reduce((a, b) => a * b, 1);
  return {
    price: Math.round(product(legs.map((l) => l.price)) * 100) / 100,
    probability: product(legs.map((l) => l.probability)),
    /** The market's chance (Pinnacle without margin), when it priced every leg. */
    fair: legs.every((l) => l.fair !== undefined) ? product(legs.map((l) => l.fair!)) : undefined,
  };
}
/**
 * «Combinada de valor»: the best value bet of each match, up to three,
 * most value first; none with fewer than two matches.
 */
export function valueCombo(picks: AnalysisPick[]): AnalysisPick[] {
  const best = new Map<string, AnalysisPick>();
  for (const p of picks.filter(hasValue)) {
    const current = best.get(p.matchId);
    if (!current || edge(p.probability, p.price) > edge(current.probability, current.price)) best.set(p.matchId, p);
  }
  const legs = [...best.values()]
    .sort((a, b) => edge(b.probability, b.price) - edge(a.probability, a.price))
    .slice(0, MAX_COMBO_LEGS);
  return legs.length >= 2 ? legs : [];
}
/** The legs of an analysis's combinada, as published. */
export const comboLegs = (analysis: Pick<BettingAnalysis, "combo" | "picks">) =>
  (analysis.combo ?? []).flatMap((key) => analysis.picks.find((p) => pickKey(p) === key) ?? []);
/**
 * A combinada wins when every leg does; one lost leg loses it. A void leg
 * counts at price 1 (as bookmakers settle it); all void returns the stake.
 */
export function settleCombo(legs: AnalysisPick[], byId: Map<string, Match>) {
  let pending = false;
  let payout = 1;
  let anyWon = false;
  for (const leg of legs) {
    const result = settlePick(leg, byId.get(leg.matchId));
    if (result === "lost") return { result: "lost" as const, payout: 0 };
    if (result === null) pending = true;
    else if (result === "won") {
      anyWon = true;
      payout *= leg.price;
    }
  }
  if (pending) return null;
  return { result: anyWon ? ("won" as const) : ("void" as const), payout: Math.round(payout * 100) / 100 };
}

/**
 * Honest scoreboard of every pick of a kind on the board, one unit each,
 * on top of what older analyses already settled (`base`). A combinada is one
 * pick at its combined price.
 */
export function trackRecord(
  analyses: BettingAnalysis[],
  matches: Match[],
  kind: RecordKind = "value",
  base?: RecordTotals,
): TrackRecord {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const record: TrackRecord = { picks: 0, settled: 0, won: 0, lost: 0, void: 0, units: 0, yield: null, ...base };
  for (const analysis of analyses) {
    if (kind === "combo") {
      const legs = comboLegs(analysis);
      if (legs.length < 2) continue;
      record.picks++;
      const settled = settleCombo(legs, byId);
      if (!settled) continue;
      record.settled++;
      record[settled.result]++;
      if (settled.result === "won") record.units += settled.payout - 1;
      if (settled.result === "lost") record.units -= 1;
      continue;
    }
    for (const pick of picksOf(analysis, kind)) {
      record.picks++;
      const result = settlePick(pick, byId.get(pick.matchId));
      if (!result) continue;
      record.settled++;
      record[result]++;
      if (result === "won") record.units += pick.price - 1;
      if (result === "lost") record.units -= 1;
    }
  }
  const staked = record.won + record.lost;
  record.units = Math.round(record.units * 100) / 100;
  record.yield = staked ? record.units / staked : null;
  return record;
}

/* ---------- When to run ---------- */

export interface AnalysisDay {
  id: string;
  competition: AnalysisCompetition;
  date: string;
  /** Not yet started, earliest first. */
  matches: Match[];
  firstKickoff: number;
  lastKickoff: number;
}
const UPCOMING = ["TIMED", "SCHEDULED"];

/** The coming match days of LaLiga and Champions, grouped by competition and day in Spain. */
export function analysisDays(matches: Match[], now: number): AnalysisDay[] {
  const days = new Map<string, AnalysisDay>();
  const ordered = matches
    .filter(
      (m) =>
        (ANALYSIS_COMPETITIONS as readonly string[]).includes(m.competition) &&
        UPCOMING.includes(m.status) &&
        Date.parse(m.utcDate) > now &&
        m.home &&
        m.away &&
        m.home !== "Por determinar" &&
        m.away !== "Por determinar",
    )
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate) || a.id.localeCompare(b.id));
  for (const m of ordered) {
    const competition = m.competition as AnalysisCompetition;
    const date = madridDate(m.utcDate);
    const id = analysisId(competition, date);
    const kickoff = Date.parse(m.utcDate);
    const day = days.get(id) || { id, competition, date, matches: [], firstKickoff: kickoff, lastKickoff: kickoff };
    day.matches.push(m);
    day.lastKickoff = Math.max(day.lastKickoff, kickoff);
    days.set(id, day);
  }
  return [...days.values()].sort((a, b) => a.firstKickoff - b.firstKickoff);
}

/**
 * Days whose analysis is due now: from 45 minutes before the first kick-off
 * still to come (a run every ten minutes lands 35–45 minutes before). If
 * GitHub missed the first match, the next one of the day takes its place;
 * never with the last match about to start.
 */
/**
 * When the next analysis will be due (now, if one is due already), for the
 * job that waits for it: GitHub's schedules can run hours late.
 */
export function nextDueAt(matches: Match[], now: number, done: ReadonlySet<string>) {
  const day = analysisDays(matches, now).find((d) => !done.has(d.id) && now < d.lastKickoff - LAST_CALL_MS);
  return day ? { id: day.id, at: Math.max(now, day.firstKickoff - ANALYSIS_LEAD_MS) } : null;
}

export function dueAnalysisDays(matches: Match[], now: number, done: ReadonlySet<string>) {
  return analysisDays(matches, now).filter(
    (day) => !done.has(day.id) && now >= day.firstKickoff - ANALYSIS_LEAD_MS && now < day.lastKickoff - LAST_CALL_MS,
  );
}

/** When the first match of each day started or starts, whatever its state now. */
function dayStarts(matches: Match[]) {
  const starts = new Map<string, number>();
  for (const m of matches) {
    if (!(ANALYSIS_COMPETITIONS as readonly string[]).includes(m.competition)) continue;
    const id = analysisId(m.competition as AnalysisCompetition, madridDate(m.utcDate));
    const kickoff = Date.parse(m.utcDate);
    if (Number.isFinite(kickoff)) starts.set(id, Math.min(starts.get(id) ?? Infinity, kickoff));
  }
  return starts;
}

/**
 * Days already analysed. An analysis counts from 3 hours before the day's
 * first kick-off (a manual run earlier than that is redone with fresher
 * prices). Measured from the first match of the day even once it has
 * started: otherwise a day with matches at 14:00 and 21:00 would be analysed
 * again before the evening one.
 */
export function analysedDays(matches: Match[], analyses: Pick<BettingAnalysis, "id" | "generatedAt">[], early: number) {
  const starts = dayStarts(matches);
  return new Set(
    analyses.flatMap((a) => {
      const start = starts.get(a.id);
      return start === undefined || Date.parse(a.generatedAt) >= start - early ? [a.id] : [];
    }),
  );
}

/**
 * A new analysis of a day that had one: matches that have already started
 * keep what was published for them (and count in the record); the rest is
 * the new analysis.
 */
export function mergeAnalysis(previous: BettingAnalysis | undefined, next: BettingAnalysis, now: number): BettingAnalysis {
  if (!previous) return next;
  const fresh = new Set(next.matches.map((m) => m.matchId));
  const kept = previous.matches.filter((m) => !fresh.has(m.matchId) && Date.parse(m.utcDate) <= now);
  if (!kept.length) return next;
  const keptIds = new Set(kept.map((m) => m.matchId));
  return {
    ...next,
    matches: [...kept, ...next.matches].sort((a, b) => a.utcDate.localeCompare(b.utcDate)),
    picks: [...previous.picks.filter((p) => keptIds.has(p.matchId)), ...next.picks].slice(0, MAX_STORED_PICKS),
  };
}

/** Archived totals of a kind for some competitions (summed), and since when. */
export function archivedRecord(archive: RecordArchive | undefined, competitions: readonly AnalysisCompetition[], kind: RecordKind) {
  const entries = competitions.flatMap((c) => (archive?.[c] ? [archive[c]!] : []));
  if (!entries.length) return null;
  const totals: RecordTotals = { picks: 0, settled: 0, won: 0, lost: 0, void: 0, units: 0 };
  for (const e of entries)
    for (const key of Object.keys(totals) as (keyof RecordTotals)[]) totals[key] += e[kind]?.[key] ?? 0;
  return { totals, since: entries.map((e) => e.since).sort()[0] };
}

/** Adds the settled picks of analyses leaving the board to the archive. */
export function archiveAnalyses(archive: RecordArchive | undefined, dropped: BettingAnalysis[], matches: Match[]): RecordArchive {
  const next: RecordArchive = { ...archive };
  for (const competition of ANALYSIS_COMPETITIONS) {
    const own = dropped.filter((a) => a.competition === competition);
    if (!own.length) continue;
    const before = next[competition];
    const totals = (kind: RecordKind): RecordTotals => {
      const { yield: _yield, ...r } = trackRecord(own, matches, kind, before?.[kind]);
      return r;
    };
    const oldest = own.map((a) => a.date).sort()[0];
    next[competition] = {
      since: before && before.since < oldest ? before.since : oldest,
      value: totals("value"),
      best: totals("best"),
      combo: totals("combo"),
    };
  }
  return next;
}

/** When the next analysis should appear (for the app), or null. */
export function nextAnalysis(matches: Match[], now: number, done: ReadonlySet<string>) {
  const day = analysisDays(matches, now).find((d) => !done.has(d.id) && now < d.lastKickoff - LAST_CALL_MS);
  return day ? { day, at: Math.max(now, day.firstKickoff - ANALYSIS_LEAD_MS + 5 * 60_000) } : null;
}

/* ---------- Decoding (public document) ---------- */

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const date = (v: unknown): v is string => text(v, 40) && Number.isFinite(Date.parse(v));
const decimalPrice = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1.01 && v <= 1000;
const probability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const CREST = (v: unknown) => v === undefined || (text(v, 500) && /^https:\/\//.test(v));

export function validMarketChoice(market: unknown, selection: unknown, line: unknown, player?: unknown): market is BetMarket {
  if (typeof market !== "string" || !(market in MARKET_SELECTIONS)) return false;
  if (typeof selection !== "string" || !MARKET_SELECTIONS[market as BetMarket].includes(selection)) return false;
  if (isPlayerMarket(market as BetMarket) !== (typeof player === "string" && player.trim().length > 0 && player.length <= 60))
    return false;
  const lines = MARKET_LINES[market as BetMarket];
  return lines ? (lines as readonly unknown[]).includes(line) : line === undefined;
}

function decodePick(raw: unknown, matchIds: Set<string>): AnalysisPick | null {
  if (!isRow(raw)) return null;
  const { matchId, market, selection, line, price, confidence, reason, risk, fair, book, player, result } = raw;
  if (typeof matchId !== "string" || !matchIds.has(matchId)) return null;
  if (!validMarketChoice(market, selection, line ?? undefined, player ?? undefined)) return null;
  if (!decimalPrice(price) || !probability(raw.probability)) return null;
  if (!(CONFIDENCE as readonly unknown[]).includes(confidence) || !text(reason, 600)) return null;
  return {
    matchId,
    market,
    selection: selection as string,
    ...(MARKET_LINES[market] ? { line: line as number } : {}),
    ...(isPlayerMarket(market) ? { player: (player as string).trim() } : {}),
    price,
    ...(text(book, 40) ? { book } : {}),
    probability: raw.probability,
    ...(probability(fair) ? { fair } : {}),
    confidence: confidence as Confidence,
    reason,
    ...(text(risk, 400) ? { risk } : {}),
    ...(isPlayerMarket(market) && (result === "won" || result === "lost" || result === "void") ? { result } : {}),
  };
}

const chance = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
function decodeMarket(raw: unknown): MatchMarket | null {
  if (!isRow(raw) || !chance(raw.home) || !chance(raw.draw) || !chance(raw.away) || !text(raw.source, 40)) return null;
  if (Math.abs(raw.home + raw.draw + raw.away - 1) > 0.03) return null;
  return {
    home: raw.home,
    draw: raw.draw,
    away: raw.away,
    ...(chance(raw.over25) ? { over25: raw.over25 } : {}),
    ...(chance(raw.btts) ? { btts: raw.btts } : {}),
    source: raw.source,
  };
}

function decodeOptions(raw: unknown): MatchOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_OPTIONS).flatMap((o): MatchOption[] => {
    if (!isRow(o) || !validMarketChoice(o.market, o.selection, o.line ?? undefined)) return [];
    if (isPlayerMarket(o.market) || !decimalPrice(o.price) || !probability(o.probability)) return [];
    return [
      {
        market: o.market,
        selection: o.selection as string,
        ...(o.market === "OU" ? { line: o.line as number } : {}),
        price: o.price,
        probability: o.probability,
        ...(o.sharp === true ? { sharp: true as const } : {}),
      },
    ];
  });
}

export function decodeAnalysis(raw: unknown): BettingAnalysis | null {
  if (!isRow(raw)) return null;
  const { id, competition, generatedAt, oddsAt, bookmaker, headline, summary } = raw;
  if (!(ANALYSIS_COMPETITIONS as readonly unknown[]).includes(competition)) return null;
  if (typeof raw.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return null;
  if (id !== analysisId(competition as AnalysisCompetition, raw.date)) return null;
  if (!date(generatedAt) || !date(oddsAt) || !text(bookmaker, 40) || !text(headline, 200) || !text(summary, 1200)) return null;
  if (!Array.isArray(raw.matches) || !Array.isArray(raw.picks)) return null;
  const matches = raw.matches.slice(0, 20).flatMap((m): AnalysisMatch[] => {
    if (!isRow(m) || typeof m.matchId !== "string" || !ID.test(m.matchId)) return [];
    if (!text(m.home, 100) || !text(m.away, 100) || !date(m.utcDate) || !text(m.preview, 600)) return [];
    if (!CREST(m.homeCrest) || !CREST(m.awayCrest)) return [];
    const pick = decodePick(m.pick, new Set([m.matchId]));
    const market = decodeMarket(m.market);
    const sources = sourceHosts(m.sources);
    const options = decodeOptions(m.options);
    return [
      {
        matchId: m.matchId,
        home: m.home,
        away: m.away,
        utcDate: m.utcDate,
        ...(m.homeCrest ? { homeCrest: m.homeCrest as string } : {}),
        ...(m.awayCrest ? { awayCrest: m.awayCrest as string } : {}),
        preview: m.preview,
        ...(pick ? { pick } : {}),
        ...(market ? { market } : {}),
        ...(options.length ? { options } : {}),
        ...(sources.length ? { sources } : {}),
      },
    ];
  });
  if (!matches.length) return null;
  const ids = new Set(matches.map((m) => m.matchId));
  const picks = raw.picks.slice(0, MAX_STORED_PICKS).flatMap((p) => decodePick(p, ids) ?? []);
  // The combinada: two or three of its own picks, each of a different match.
  const keys = new Map(picks.map((p) => [pickKey(p), p.matchId]));
  const combo =
    Array.isArray(raw.combo) &&
    raw.combo.length >= 2 &&
    raw.combo.length <= MAX_COMBO_LEGS &&
    raw.combo.every((k) => typeof k === "string" && keys.has(k)) &&
    new Set(raw.combo.map((k) => keys.get(k as string))).size === raw.combo.length
      ? (raw.combo as string[])
      : null;
  return {
    id: id as string,
    competition: competition as AnalysisCompetition,
    date: raw.date,
    generatedAt: generatedAt as string,
    oddsAt: oddsAt as string,
    bookmaker: bookmaker as string,
    headline: headline as string,
    summary: summary as string,
    matches,
    picks,
    ...(combo ? { combo } : {}),
    ...(decodeRun(raw.ai) ? { ai: decodeRun(raw.ai)! } : {}),
  };
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1_000_000;
function decodeTotals(raw: unknown): RecordTotals | null {
  if (!isRow(raw)) return null;
  const { picks, settled, won, lost, units } = raw;
  const voided = raw.void;
  if (![picks, settled, won, lost, voided].every(count) || typeof units !== "number" || !Number.isFinite(units)) return null;
  return { picks, settled, won, lost, void: voided, units } as RecordTotals;
}
function decodeArchive(raw: unknown): RecordArchive | undefined {
  if (!isRow(raw)) return undefined;
  const archive: RecordArchive = {};
  for (const competition of ANALYSIS_COMPETITIONS) {
    const entry = raw[competition];
    if (!isRow(entry) || typeof entry.since !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.since)) continue;
    const value = decodeTotals(entry.value);
    const best = decodeTotals(entry.best);
    const combo = decodeTotals(entry.combo);
    if (value && best) archive[competition] = { since: entry.since, value, best, ...(combo ? { combo } : {}) };
  }
  return Object.keys(archive).length ? archive : undefined;
}

/** Public, informational data. Invalid analyses are dropped, never repaired. */
export function decodeAnalysisBoard(value: unknown): AnalysisBoard | null {
  if (!isRow(value) || value.formatVersion !== ANALYSIS_FORMAT || !date(value.updatedAt) || !Array.isArray(value.analyses))
    return null;
  const analyses = value.analyses
    .slice(0, MAX_ANALYSES)
    .flatMap((a) => decodeAnalysis(a) ?? [])
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const archive = decodeArchive(value.archive);
  return { formatVersion: ANALYSIS_FORMAT, updatedAt: value.updatedAt, analyses, ...(archive ? { archive } : {}) };
}
