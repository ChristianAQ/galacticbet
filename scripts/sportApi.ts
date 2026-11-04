import type { Match } from "../src/lib/domain";
import { outcome } from "../src/lib/domain";
import { canonicalTeamName } from "./espn";
import { sportApiRequestGate } from "./sportApiBudget";

const leagues: Record<number, Match["competition"]> = {
  1: "PD",
  18: "CL",
  24: "PL",
};
export interface SportFixture {
  id: string;
  competition: Match["competition"];
  kickoff: string;
  updated: number;
  home: string;
  away: string;
  status: string;
  minute: string;
  homeScore: number | null;
  awayScore: number | null;
  penalties: boolean;
}
const score = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 99 ? v : null;

export function parseSportFixtures(
  value: unknown,
  date: string,
): SportFixture[] {
  const body = value as {
    success?: unknown;
    date?: unknown;
    data?: unknown;
  } | null;
  if (
    !body ||
    body.success !== true ||
    body.date !== date ||
    !Array.isArray(body.data) ||
    body.data.length > 3000
  )
    throw new Error("SportAPI: respuesta de calendario no válida.");
  return body.data.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const competition = leagues[Number(r.league_id)];
    if (
      !competition ||
      !Number.isSafeInteger(r.id) ||
      Number(r.id) <= 0 ||
      typeof r.home_team !== "string" ||
      !r.home_team.trim() ||
      r.home_team.length > 160 ||
      typeof r.away_team !== "string" ||
      !r.away_team.trim() ||
      r.away_team.length > 160 ||
      typeof r.kickoff_utc !== "string" ||
      !/(Z|\+00:00)$/.test(r.kickoff_utc) ||
      !Number.isFinite(Date.parse(r.kickoff_utc)) ||
      typeof r.status !== "string"
    )
      return [];
    return [
      {
        id: String(r.id),
        competition,
        kickoff: r.kickoff_utc,
        updated:
          typeof r.updated_at === "string" && /(Z|\+00:00)$/.test(r.updated_at)
            ? Date.parse(r.updated_at)
            : NaN,
        home: r.home_team,
        away: r.away_team,
        status: r.status,
        minute: typeof r.minute === "string" ? r.minute : "",
        homeScore: score(r.home_score),
        awayScore: score(r.away_score),
        penalties: r.penalty_home != null || r.penalty_away != null,
      },
    ];
  });
}

export function findSportFixture(match: Match, fixtures: SportFixture[]) {
  const candidates = fixtures.filter(
    (f) =>
      f.competition === match.competition &&
      Math.abs(Date.parse(f.kickoff) - Date.parse(match.utcDate)) <=
        10 * 60_000 &&
      canonicalTeamName(f.home) === canonicalTeamName(match.home) &&
      canonicalTeamName(f.away) === canonicalTeamName(match.away),
  );
  // IDs, competition, both teams, venue order and kick-off must all agree.
  return candidates.length === 1 &&
    (!match.sportApiId || candidates[0].id === match.sportApiId)
    ? candidates[0]
    : null;
}

export function applySportFixture(
  match: Match,
  fixture: SportFixture,
  now: number,
): Match {
  if (
    findSportFixture(match, [fixture]) !== fixture ||
    Date.parse(match.utcDate) > now ||
    fixture.updated > now + 5 * 60_000 ||
    !Number.isFinite(fixture.updated) ||
    fixture.updated < Date.parse(fixture.kickoff) ||
    now - fixture.updated > 6 * 3600_000 ||
    fixture.homeScore === null ||
    fixture.awayScore === null ||
    fixture.penalties ||
    ["POSTPONED", "CANCELLED", "SUSPENDED", "AWARDED"].includes(match.status) ||
    ["EXTRA_TIME", "PENALTY_SHOOTOUT"].includes(match.scoreDuration || "")
  )
    return match;
  // Official completed scores always take precedence, including later corrections.
  if (
    match.status === "FINISHED" &&
    match.resultProvider !== "SportAPI" &&
    match.homeScore !== null &&
    match.awayScore !== null
  )
    return match;
  const finished = fixture.status === "FT";
  if (!finished && fixture.status !== "LIVE") return match;
  if (finished && now - Date.parse(match.utcDate) < 90 * 60_000) return match;
  if (
    !finished &&
    (match.status === "FINISHED" ||
      (fixture.minute !== "HT" &&
        !/^(?:[0-8]?\d|90)(?:\+\d{1,2})?'?$/.test(fixture.minute)))
  )
    return match;
  return {
    ...match,
    resultProvider: "SportAPI",
    sportApiId: fixture.id,
    status: finished
      ? "FINISHED"
      : fixture.minute === "HT"
        ? "PAUSED"
        : "IN_PLAY",
    scoreDuration: "REGULAR",
    homeScore: fixture.homeScore,
    awayScore: fixture.awayScore,
    winner: finished ? outcome(fixture.homeScore, fixture.awayScore) : null,
  };
}

/** A delayed primary response must not reopen a fixture or remove its faster score. */
export function preserveSportResult(incoming: Match, previous?: Match): Match {
  if (
    !previous ||
    previous.resultProvider !== "SportAPI" ||
    previous.id !== incoming.id ||
    previous.competition !== incoming.competition ||
    previous.utcDate !== incoming.utcDate ||
    previous.home !== incoming.home ||
    previous.away !== incoming.away ||
    ["EXTRA_TIME", "PENALTY_SHOOTOUT"].includes(incoming.scoreDuration || "") ||
    !(
      ["TIMED", "SCHEDULED", "IN_PLAY", "PAUSED"].includes(incoming.status) ||
      (incoming.status === "FINISHED" &&
        (incoming.homeScore === null || incoming.awayScore === null))
    )
  )
    return incoming;
  return {
    ...incoming,
    resultProvider: previous.resultProvider,
    sportApiId: previous.sportApiId,
    homeScore: previous.homeScore,
    awayScore: previous.awayScore,
    status: previous.status,
    scoreDuration: previous.scoreDuration,
    winner: previous.winner,
  };
}

export function createSportApiClient(
  key: string,
  reserved: number,
  request: typeof fetch = fetch,
) {
  const gate = sportApiRequestGate(reserved);
  if (!key.trim()) throw new Error("SportAPI: falta SPORTAPI_KEY.");
  return {
    async fixtures(date: string) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        new Date(date).toISOString().slice(0, 10) !== date
      )
        throw new Error("SportAPI: fecha de consulta inválida.");
      return gate.run(async () => {
        let status = 0;
        try {
          const response = await request(
            `https://sportapi.ai/api/fixtures/date/${date}`,
            {
              headers: { "X-Api-Key": key.trim() },
              redirect: "error",
              signal: AbortSignal.timeout(20_000),
            },
          );
          status = response.status;
          if (!response.ok) throw new Error();
          if (
            response.headers.get("X-RateLimit-Remaining") === "0" ||
            response.headers.get("X-RateLimit-Month-Remaining") === "0"
          )
            gate.stop();
          const text = await response.text();
          if (text.length > 2_000_000) throw new Error();
          return parseSportFixtures(JSON.parse(text), date);
        } catch {
          gate.stop();
          throw new Error(
            `SportAPI${status ? ` HTTP ${status}` : ""}: consulta interrumpida; revisa acceso, cobertura o cuota en el panel del proveedor.`,
          );
        }
      });
    },
  };
}
