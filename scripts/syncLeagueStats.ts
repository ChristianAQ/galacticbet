import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  COMPETITION_CODES,
  type CompetitionCode,
} from "../src/lib/competitions";
import type { Match } from "../src/lib/domain";
import {
  topFive,
  validLeagueStats,
  type LeagueStats,
  type StatRow,
} from "../src/lib/leagueStats";
import { canonicalTeamName } from "./espn";
import { reserveSportApiRequests, sportApiRequestGate } from "./sportApiBudget";

const ids = { PD: 1, CL: 18, PL: 24 } as const;
const endpoints = ["topscorers", "topassists", "topcards"] as const;
type Endpoint = (typeof endpoints)[number];
type Published = {
  key: string;
  name: string;
  team: string;
  crest?: string;
} & Partial<Record<"goals" | "assists" | "yellow_cards" | "red_cards", number>>;
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 100000;

export function normalizeLeagueRanking(
  value: unknown,
  competition: CompetitionCode,
  seasonId: string,
  matches: Match[],
): Published[] {
  const body = value as {
    success?: unknown;
    season_from?: unknown;
    data?: unknown;
  } | null;
  const year = Number(seasonId.split("-")[1]);
  if (
    !body ||
    body.success !== true ||
    typeof body.season_from !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.season_from) ||
    !Number.isFinite(Date.parse(body.season_from)) ||
    new Date(body.season_from).toISOString().slice(0, 10) !==
      body.season_from ||
    Number(body.season_from.slice(0, 4)) !== year ||
    Date.parse(body.season_from) < Date.UTC(year, 5, 1) ||
    !Array.isArray(body.data) ||
    body.data.length > 100
  )
    throw new Error("Temporada o formato de estadísticas no verificable.");
  const own = matches.filter(
    (m) => m.competition === competition && m.seasonId === seasonId,
  );
  const rows: Published[] = body.data.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    if (
      typeof r.player_name !== "string" ||
      !r.player_name.trim() ||
      r.player_name.length > 120 ||
      typeof r.team_name !== "string" ||
      !r.team_name.trim() ||
      r.team_name.length > 160 ||
      !Number.isSafeInteger(r.team_id) ||
      Number(r.team_id) <= 0
    )
      return [];
    const name = r.player_name.trim(),
      team = r.team_name.trim();
    const crests = new Set(
      own.flatMap((m) =>
        (["home", "away"] as const).flatMap((side) =>
          canonicalTeamName(m[side]) === canonicalTeamName(team)
            ? [side === "home" ? m.homeCrest : m.awayCrest].filter(
                (c): c is string => Boolean(c && /^https:\/\//.test(c)),
              )
            : [],
        ),
      ),
    );
    const crest = crests.size === 1 ? [...crests][0] : undefined;
    return [
      {
        key: `${r.team_id}:${name}`,
        name,
        team,
        ...(crest ? { crest } : {}),
        ...Object.fromEntries(
          ["goals", "assists", "yellow_cards", "red_cards"]
            .filter((k) => count(r[k]))
            .map((k) => [k, r[k]]),
        ),
      },
    ];
  });
  // Names are the only player identity exposed by these endpoints. Do not double-count duplicates.
  return rows.filter(
    (r) => rows.filter((other) => other.key === r.key).length === 1,
  );
}

export function buildLeagueStats(
  competition: CompetitionCode,
  seasonId: string,
  source: Record<Endpoint, Published[]>,
  now: number,
): LeagueStats {
  const metric = (
    rows: Published[],
    key: "goals" | "assists" | "yellow_cards" | "red_cards",
  ) =>
    topFive(
      rows
        .filter((r) => count(r[key]) && r[key]! > 0)
        .map((r) => ({
          key: r.key,
          name: r.name,
          team: r.team,
          ...(r.crest ? { crest: r.crest } : {}),
          value: r[key]!,
        })),
    );
  // Both values must be published for the same identity. Missing assists are never assumed zero.
  const contributions: StatRow[] = source.topscorers.flatMap((g) => {
    const a = source.topassists.find((a) => a.key === g.key);
    return count(g.goals) && a && count(a.assists)
      ? [
          {
            key: g.key,
            name: g.name,
            team: g.team,
            ...(g.crest ? { crest: g.crest } : {}),
            value: g.goals + a.assists,
          },
        ]
      : [];
  });
  return {
    version: 1,
    provider: "SportAPI",
    competition,
    seasonId,
    fetchedAt: new Date(now).toISOString(),
    rankings: {
      goals: metric(source.topscorers, "goals"),
      assists: metric(source.topassists, "assists"),
      yellowCards: metric(source.topcards, "yellow_cards"),
      redCards: metric(source.topcards, "red_cards"),
      goalContributions: topFive(contributions),
    },
  };
}

export async function syncLeagueStats(
  db: Firestore,
  key: string,
  matches: Match[],
  options: {
    now?: number;
    request?: typeof fetch;
    runId?: string;
    log?: (message: string) => void;
  } = {},
) {
  const now = options.now ?? Date.now(),
    request = options.request ?? fetch,
    log = options.log ?? console.log;
  const year =
    new Date(now).getUTCFullYear() - (new Date(now).getUTCMonth() < 6 ? 1 : 0);
  const due: {
    competition: (typeof COMPETITION_CODES)[number];
    seasonId: string;
  }[] = [];
  for (const competition of COMPETITION_CODES) {
    const seasonId = `${competition}-${year}`;
    if (
      !matches.some(
        (m) => m.competition === competition && m.seasonId === seasonId,
      )
    )
      continue;
    const old = (await db.doc(`leagueStats/${seasonId}`).get()).data();
    if (
      validLeagueStats(old) &&
      old.seasonId === seasonId &&
      old.competition === competition &&
      Date.parse(old.fetchedAt) <= now &&
      now - Date.parse(old.fetchedAt) < 6 * 3600000
    )
      continue;
    due.push({ competition, seasonId });
  }
  if (!due.length) return;
  const reserved = await reserveSportApiRequests(
    db,
    options.runId ??
      `league-stats-${process.env.GITHUB_RUN_ID || randomUUID()}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`,
    due.length * 3,
    () => now,
  );
  const gate = sportApiRequestGate(reserved);
  for (const { competition, seasonId } of due) {
    if (gate.remaining < 3) break;
    try {
      const source = {} as Record<Endpoint, Published[]>;
      for (const endpoint of endpoints) {
        const body = await gate.run(async () => {
          const response = await request(
            `https://sportapi.ai/api/leagues/${ids[competition]}/${endpoint}?limit=100`,
            {
              headers: { "X-Api-Key": key.trim() },
              redirect: "error",
              signal: AbortSignal.timeout(20000),
            },
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          if (
            response.headers.get("X-RateLimit-Remaining") === "0" ||
            response.headers.get("X-RateLimit-Month-Remaining") === "0"
          )
            gate.stop();
          const text = await response.text();
          if (text.length > 1000000) throw new Error("size");
          return JSON.parse(text) as unknown;
        });
        source[endpoint] = normalizeLeagueRanking(
          body,
          competition,
          seasonId,
          matches,
        );
      }
      const data = buildLeagueStats(competition, seasonId, source, now);
      if (!validLeagueStats(data)) throw new Error("invalid");
      await db.doc(`leagueStats/${seasonId}`).set(data);
      log(
        `Estadísticas SportAPI ${seasonId}: goleadores, asistencias y tarjetas actualizados.`,
      );
    } catch {
      gate.stop();
      log(
        `Estadísticas SportAPI ${seasonId}: acceso, temporada o datos no verificables; se conserva la edición anterior.`,
      );
      break;
    }
  }
}
