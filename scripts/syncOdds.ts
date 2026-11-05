import type { Firestore } from "firebase-admin/firestore";
import { COMPETITION_CODES } from "../src/lib/competitions";
import type { Match } from "../src/lib/domain";
import {
  ODDS_FORMAT,
  decodeOddsBoard,
  validBookmakerOdds,
  type BookmakerOdds,
  type MatchOdds,
} from "../src/lib/odds";
import { canonicalTeamName } from "./espn";

export const ODDS_DOC = "odds/football";
const BUDGET_DOC = "providerBudgets/oddsapi";
const HOUR = 3_600_000;
/** The Odds API sport keys for the three active competitions. */
const SPORTS: Record<(typeof COMPETITION_CODES)[number], string> = {
  PD: "soccer_spain_la_liga",
  CL: "soccer_uefa_champs_league",
  PL: "soccer_epl",
};
// Each call costs one credit per region (h2h market only): two credits per competition.
const REGIONS = "eu,uk";
const CREDITS_PER_CALL = 2;
/** Internal monthly cap, below the 500 credits of the free plan. */
export const ODDS_MONTH_LIMIT = 440;
const REFRESH = 12 * HOUR;
const LOOKAHEAD = 4 * 24 * HOUR;

export interface OddsEvent {
  commence: string;
  home: string;
  away: string;
  bookmakers: BookmakerOdds[];
}

export function parseOddsEvents(value: unknown): OddsEvent[] {
  if (!Array.isArray(value) || value.length > 500)
    throw new Error("Cuotas: respuesta no reconocida.");
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const e = raw as Record<string, unknown>;
    if (
      typeof e.home_team !== "string" ||
      typeof e.away_team !== "string" ||
      typeof e.commence_time !== "string" ||
      !Number.isFinite(Date.parse(e.commence_time)) ||
      !Array.isArray(e.bookmakers)
    )
      return [];
    const bookmakers = e.bookmakers.flatMap((rawBook) => {
      const b = (rawBook || {}) as Record<string, unknown>;
      const market = Array.isArray(b.markets)
        ? (b.markets as Record<string, unknown>[]).find(
            (m) => m && m.key === "h2h",
          )
        : undefined;
      const outcomes = Array.isArray(market?.outcomes)
        ? (market.outcomes as Record<string, unknown>[])
        : [];
      const priceFor = (name: string) =>
        outcomes.filter((o) => o && o.name === name).map((o) => o.price);
      const [home] = priceFor(e.home_team as string);
      const [away] = priceFor(e.away_team as string);
      const [draw] = priceFor("Draw");
      const odds = {
        key: b.key,
        title: b.title,
        home,
        draw,
        away,
        updatedAt: b.last_update,
      };
      // Exactly three outcomes, each once: never infer a missing draw or side.
      return outcomes.length === 3 && validBookmakerOdds(odds) ? [odds] : [];
    });
    return [
      {
        commence: e.commence_time,
        home: e.home_team,
        away: e.away_team,
        bookmakers,
      },
    ];
  });
}

/** Same competition feed, kick-off within 15 minutes and venue order; unique only. */
export function findOddsEvent(match: Match, events: OddsEvent[]) {
  const home = canonicalTeamName(match.home);
  const away = canonicalTeamName(match.away);
  const candidates = events.filter(
    (e) =>
      Math.abs(Date.parse(e.commence) - Date.parse(match.utcDate)) <=
        15 * 60_000 &&
      (canonicalTeamName(e.home) === home ||
        canonicalTeamName(e.away) === away),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

export async function syncOdds(
  db: Firestore,
  key: string,
  matches: Match[],
  options: {
    now?: number;
    request?: typeof fetch;
    log?: (message: string) => void;
  } = {},
) {
  const now = options.now ?? Date.now();
  const log = options.log ?? console.log;
  const request = options.request ?? fetch;
  const upcoming = matches.filter(
    (m) =>
      ["TIMED", "SCHEDULED"].includes(m.status) &&
      Date.parse(m.utcDate) > now &&
      Date.parse(m.utcDate) - now <= LOOKAHEAD,
  );
  const [boardSnap, budgetSnap] = await db.getAll(
    db.doc(ODDS_DOC),
    db.doc(BUDGET_DOC),
  );
  const previous = decodeOddsBoard(boardSnap.data());
  const checked: Record<string, string> = {
    ...(boardSnap.data()?.checked || {}),
  };
  const month = new Date(now).toISOString().slice(0, 7);
  const budget = budgetSnap.data();
  let used = budget?.month === month ? Number(budget.used) || 0 : 0;
  let remaining =
    budget?.month === month && Number.isFinite(budget?.remaining)
      ? Number(budget.remaining)
      : Infinity;
  const due = COMPETITION_CODES.filter(
    (code) =>
      upcoming.some((m) => m.competition === code) &&
      !(now - Date.parse(checked[code] || "") < REFRESH),
  );
  // Keep fixtures that have not started; drop finished ones to bound the document.
  const odds: Record<string, MatchOdds> = Object.fromEntries(
    Object.entries(previous?.matches || {}).filter(([id]) =>
      matches.some(
        (m) => m.id === id && Date.parse(m.utcDate) > now - 3 * HOUR,
      ),
    ),
  );
  let requests = 0;
  let matched = 0;
  for (const code of due) {
    if (
      used + CREDITS_PER_CALL > ODDS_MONTH_LIMIT ||
      remaining < CREDITS_PER_CALL * 3
    ) {
      log(
        "Cuotas: presupuesto mensual alcanzado; se conservan las anteriores.",
      );
      break;
    }
    used += CREDITS_PER_CALL;
    requests++;
    let events: OddsEvent[];
    try {
      const response = await request(
        `https://api.the-odds-api.com/v4/sports/${SPORTS[code]}/odds/?regions=${REGIONS}&markets=h2h&oddsFormat=decimal&apiKey=${encodeURIComponent(key)}`,
        { redirect: "error", signal: AbortSignal.timeout(20_000) },
      );
      const header = Number(response.headers.get("x-requests-remaining"));
      if (
        Number.isFinite(header) &&
        response.headers.has("x-requests-remaining")
      )
        remaining = header;
      if (!response.ok) {
        // Status only: the URL contains the key and is never printed.
        log(
          `Cuotas ${code}: HTTP ${response.status}; se conservan las anteriores.`,
        );
        if ([401, 403, 429].includes(response.status)) break;
        continue;
      }
      const body = await response.text();
      if (body.length > 3_000_000) throw new Error();
      events = parseOddsEvents(JSON.parse(body));
    } catch {
      log(
        `Cuotas ${code}: respuesta no disponible; se conservan las anteriores.`,
      );
      break;
    }
    checked[code] = new Date(now).toISOString();
    for (const match of upcoming.filter((m) => m.competition === code)) {
      const event = findOddsEvent(match, events);
      if (!event?.bookmakers.length) continue;
      matched++;
      odds[match.id] = {
        fetchedAt: new Date(now).toISOString(),
        bookmakers: [...event.bookmakers]
          .sort((a, b) => a.title.localeCompare(b.title, "es"))
          .slice(0, 40),
      };
    }
  }
  if (requests) {
    await db.doc(BUDGET_DOC).set({
      month,
      used,
      ...(Number.isFinite(remaining) ? { remaining } : {}),
    });
    await db.doc(ODDS_DOC).set({
      formatVersion: ODDS_FORMAT,
      updatedAt: new Date(now).toISOString(),
      checked,
      matches: odds,
    });
  }
  log(
    `Cuotas: ${requests} consultas (${used}/${ODDS_MONTH_LIMIT} créditos este mes), ${matched} partidos con cuotas.`,
  );
  return { requests, matched, used };
}
