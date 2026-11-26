import type { CompetitionCode } from "./competitions";
import { hasPublishedResult, type Match } from "./domain";

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
/** The newest ones the app keeps (about a month of match days). */
export const MAX_ANALYSES = 24;
export const MAX_PICKS = 6;
/** The analysis runs from this long before the day's first kick-off… */
export const ANALYSIS_LEAD_MS = 45 * 60_000;
/** …and is skipped once even the last match of the day is about to start. */
const LAST_CALL_MS = 10 * 60_000;

export type BetMarket = "1X2" | "DC" | "DNB" | "BTTS" | "OU";
export const MARKET_SELECTIONS: Record<BetMarket, readonly string[]> = {
  "1X2": ["1", "X", "2"],
  DC: ["1X", "12", "X2"],
  DNB: ["1", "2"],
  BTTS: ["yes", "no"],
  OU: ["over", "under"],
};
/** Goal lines offered to the AI (half goals: no pushes, easy to read). */
export const GOAL_LINES = [1.5, 2.5, 3.5] as const;
export const CONFIDENCE = ["alta", "media", "baja"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

/** One price of a match: bet365's, with Pinnacle's next to it when known. */
export interface MarketPrice {
  market: BetMarket;
  selection: string;
  /** Goal line (OU only). */
  line?: number;
  /** bet365, decimal. */
  price: number;
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
  /** bet365 price when the analysis was made. */
  price: number;
  /** The AI's estimate (0–1). */
  probability: number;
  /** Pinnacle's no-margin probability, when Pinnacle priced it. */
  fair?: number;
  confidence: Confidence;
  reason: string;
  risk?: string;
}
export interface AnalysisMatch {
  matchId: string;
  home: string;
  away: string;
  utcDate: string;
  homeCrest?: string;
  awayCrest?: string;
  preview: string;
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
}
export interface AnalysisBoard {
  formatVersion: typeof ANALYSIS_FORMAT;
  updatedAt: string;
  analyses: BettingAnalysis[];
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

export const pickKey = (p: { matchId: string; market: BetMarket; selection: string; line?: number }) =>
  `${p.matchId}|${p.market}|${p.selection}|${p.line ?? ""}`;

const goals = new Intl.NumberFormat("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const MARKET_NAMES: Record<BetMarket, string> = {
  "1X2": "Resultado",
  DC: "Doble oportunidad",
  DNB: "Empate no válido",
  BTTS: "Ambos marcan",
  OU: "Goles",
};
/** «Gana el Betis», «Más de 2,5 goles»: the bet in words. */
export function pickLabel(pick: Pick<AnalysisPick, "market" | "selection" | "line">, home: string, away: string) {
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
  }
}

/* ---------- Results ---------- */

export type PickResult = "won" | "lost" | "void";
/** Regular time (the official score in the app is always the 90 minutes). */
export function settlePick(pick: Pick<AnalysisPick, "matchId" | "market" | "selection" | "line">, match: Match | undefined): PickResult | null {
  if (!match || match.id !== pick.matchId) return null;
  if (["POSTPONED", "CANCELLED", "SUSPENDED"].includes(match.status)) return "void";
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
  }
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
/** Honest scoreboard of every pick on the board, one unit each. */
export function trackRecord(analyses: BettingAnalysis[], matches: Match[]): TrackRecord {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const record: TrackRecord = { picks: 0, settled: 0, won: 0, lost: 0, void: 0, units: 0, yield: null };
  for (const analysis of analyses)
    for (const pick of analysis.picks) {
      record.picks++;
      const result = settlePick(pick, byId.get(pick.matchId));
      if (!result) continue;
      record.settled++;
      record[result]++;
      if (result === "won") record.units += pick.price - 1;
      if (result === "lost") record.units -= 1;
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
export function dueAnalysisDays(matches: Match[], now: number, done: ReadonlySet<string>) {
  return analysisDays(matches, now).filter(
    (day) => !done.has(day.id) && now >= day.firstKickoff - ANALYSIS_LEAD_MS && now < day.lastKickoff - LAST_CALL_MS,
  );
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

export function validMarketChoice(market: unknown, selection: unknown, line: unknown): market is BetMarket {
  if (typeof market !== "string" || !(market in MARKET_SELECTIONS)) return false;
  if (typeof selection !== "string" || !MARKET_SELECTIONS[market as BetMarket].includes(selection)) return false;
  return market === "OU" ? (GOAL_LINES as readonly unknown[]).includes(line) : line === undefined;
}

function decodePick(raw: unknown, matchIds: Set<string>): AnalysisPick | null {
  if (!isRow(raw)) return null;
  const { matchId, market, selection, line, price, confidence, reason, risk, fair } = raw;
  if (typeof matchId !== "string" || !matchIds.has(matchId)) return null;
  if (!validMarketChoice(market, selection, line ?? undefined)) return null;
  if (!decimalPrice(price) || !probability(raw.probability)) return null;
  if (!(CONFIDENCE as readonly unknown[]).includes(confidence) || !text(reason, 600)) return null;
  return {
    matchId,
    market,
    selection: selection as string,
    ...(market === "OU" ? { line: line as number } : {}),
    price,
    probability: raw.probability,
    ...(probability(fair) ? { fair } : {}),
    confidence: confidence as Confidence,
    reason,
    ...(text(risk, 400) ? { risk } : {}),
  };
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
    return [
      {
        matchId: m.matchId,
        home: m.home,
        away: m.away,
        utcDate: m.utcDate,
        ...(m.homeCrest ? { homeCrest: m.homeCrest as string } : {}),
        ...(m.awayCrest ? { awayCrest: m.awayCrest as string } : {}),
        preview: m.preview,
      },
    ];
  });
  if (!matches.length) return null;
  const ids = new Set(matches.map((m) => m.matchId));
  const picks = raw.picks.slice(0, MAX_PICKS).flatMap((p) => decodePick(p, ids) ?? []);
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
  };
}

/** Public, informational data. Invalid analyses are dropped, never repaired. */
export function decodeAnalysisBoard(value: unknown): AnalysisBoard | null {
  if (!isRow(value) || value.formatVersion !== ANALYSIS_FORMAT || !date(value.updatedAt) || !Array.isArray(value.analyses))
    return null;
  const analyses = value.analyses
    .slice(0, MAX_ANALYSES)
    .flatMap((a) => decodeAnalysis(a) ?? [])
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  return { formatVersion: ANALYSIS_FORMAT, updatedAt: value.updatedAt, analyses };
}
