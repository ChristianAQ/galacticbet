export const ODDS_FORMAT = 1;

export interface BookmakerOdds {
  key: string;
  title: string;
  home: number;
  draw: number;
  away: number;
  updatedAt: string;
}
export interface MatchOdds {
  fetchedAt: string;
  bookmakers: BookmakerOdds[];
}
export interface OddsBoard {
  formatVersion: typeof ODDS_FORMAT;
  updatedAt: string;
  matches: Record<string, MatchOdds>;
}

const price = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 1.01 &&
  value <= 1000;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const date = (value: unknown): value is string =>
  text(value, 40) && Number.isFinite(Date.parse(value));

export function validBookmakerOdds(value: unknown): value is BookmakerOdds {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  return (
    text(b.key, 60) &&
    /^[a-z0-9_]+$/.test(b.key) &&
    text(b.title, 80) &&
    price(b.home) &&
    price(b.draw) &&
    price(b.away) &&
    date(b.updatedAt)
  );
}

/** Public, informational data. Invalid bookmakers are dropped, never repaired. */
export function decodeOddsBoard(value: unknown): OddsBoard | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    data.formatVersion !== ODDS_FORMAT ||
    !date(data.updatedAt) ||
    !data.matches ||
    typeof data.matches !== "object"
  )
    return null;
  const matches: Record<string, MatchOdds> = {};
  for (const [id, raw] of Object.entries(data.matches).slice(0, 200)) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !raw || typeof raw !== "object")
      continue;
    const entry = raw as Record<string, unknown>;
    if (!date(entry.fetchedAt) || !Array.isArray(entry.bookmakers)) continue;
    const bookmakers = entry.bookmakers.slice(0, 40).filter(validBookmakerOdds);
    if (bookmakers.length)
      matches[id] = { fetchedAt: entry.fetchedAt, bookmakers };
  }
  return { formatVersion: ODDS_FORMAT, updatedAt: data.updatedAt, matches };
}

export type OddsOutcome = "home" | "draw" | "away";
export const ODDS_OUTCOMES: OddsOutcome[] = ["home", "draw", "away"];

/** Highest price per outcome and the bookmakers offering it. */
export function bestOdds(bookmakers: BookmakerOdds[]) {
  return Object.fromEntries(
    ODDS_OUTCOMES.map((outcome) => {
      const top = Math.max(...bookmakers.map((b) => b[outcome]));
      return [
        outcome,
        {
          price: top,
          titles: bookmakers
            .filter((b) => b[outcome] === top)
            .map((b) => b.title),
        },
      ];
    }),
  ) as Record<OddsOutcome, { price: number; titles: string[] }>;
}

/** Market consensus: average implied probability with the bookmaker margin removed. */
export function impliedProbabilities(bookmakers: BookmakerOdds[]) {
  if (!bookmakers.length) return null;
  const sums = { home: 0, draw: 0, away: 0 };
  for (const b of bookmakers) {
    const total = 1 / b.home + 1 / b.draw + 1 / b.away;
    for (const outcome of ODDS_OUTCOMES)
      sums[outcome] += 1 / b[outcome] / total;
  }
  return Object.fromEntries(
    ODDS_OUTCOMES.map((o) => [o, (sums[o] / bookmakers.length) * 100]),
  ) as Record<OddsOutcome, number>;
}
