import { hasPublishedResult, type Match } from "./domain";
export type Side = "home" | "away";
export type FormResult = "win" | "draw" | "loss";
export interface TeamIdentity {
  id?: number | null;
  name: string;
}
export function teamIdentity(match: Match, side: Side): TeamIdentity {
  return {
    id: side === "home" ? match.homeTeamId : match.awayTeamId,
    name: match[side],
  };
}
function sameTeam(a: TeamIdentity, b: TeamIdentity) {
  if (a.id != null && b.id != null) return a.id === b.id;
  return (
    a.name.trim().toLocaleLowerCase("es") ===
    b.name.trim().toLocaleLowerCase("es")
  );
}
export function teamSide(match: Match, team: TeamIdentity): Side | null {
  return sameTeam(teamIdentity(match, "home"), team)
    ? "home"
    : sameTeam(teamIdentity(match, "away"), team)
      ? "away"
      : null;
}
export function hasRegulationResult(match: Match) {
  return hasPublishedResult(match);
}
export function previousResults(target: Match, matches: Match[], now: number) {
  const cutoff = Math.min(Date.parse(target.utcDate), now);
  return matches
    .filter(
      (m) =>
        m.id !== target.id &&
        hasRegulationResult(m) &&
        Date.parse(m.utcDate) < cutoff,
    )
    .sort(
      (a, b) => b.utcDate.localeCompare(a.utcDate) || a.id.localeCompare(b.id),
    );
}
export function teamResult(match: Match, side: Side): FormResult {
  const goals = side === "home" ? match.homeScore! : match.awayScore!;
  const conceded = side === "home" ? match.awayScore! : match.homeScore!;
  return goals > conceded ? "win" : goals < conceded ? "loss" : "draw";
}
export function recentForm(
  target: Match,
  side: Side,
  matches: Match[],
  now = Date.now(),
) {
  const team = teamIdentity(target, side);
  return previousResults(target, matches, now)
    .flatMap((match) => {
      const side = teamSide(match, team);
      return side ? [{ match, side, result: teamResult(match, side) }] : [];
    })
    .slice(0, 5)
    .reverse();
}
export function seasonStats(
  target: Match,
  side: Side,
  matches: Match[],
  now = Date.now(),
) {
  const stats = {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
  };
  const team = teamIdentity(target, side);
  for (const match of previousResults(target, matches, now)) {
    if (
      match.competition !== target.competition ||
      match.seasonId !== target.seasonId
    )
      continue;
    const side = teamSide(match, team);
    if (!side) continue;
    stats.played++;
    const result = teamResult(match, side);
    if (result === "win") stats.wins++;
    else if (result === "draw") stats.draws++;
    else stats.losses++;
    stats.goalsFor += side === "home" ? match.homeScore! : match.awayScore!;
    stats.goalsAgainst += side === "home" ? match.awayScore! : match.homeScore!;
  }
  return stats;
}
function samePair(a: Match, b: Match) {
  const home = teamSide(b, teamIdentity(a, "home"));
  const away = teamSide(b, teamIdentity(a, "away"));
  return home !== null && away !== null && home !== away;
}
export function headToHead(target: Match, matches: Match[], now = Date.now()) {
  return previousResults(target, matches, now)
    .filter((m) => samePair(target, m))
    .slice(0, 5);
}
const twoLeggedStages = [
  "PLAYOFFS",
  "LAST_32",
  "LAST_16",
  "QUARTER_FINALS",
  "SEMI_FINALS",
];
export function knockoutContext(
  target: Match,
  matches: Match[],
  now = Date.now(),
) {
  if (
    (target.competition === "CDR" && target.stage !== "SEMI_FINALS") ||
    !["CL", "CDR"].includes(target.competition) ||
    !twoLeggedStages.includes(target.stage)
  )
    return null;
  const legs = matches
    .filter(
      (m) =>
        m.competition === target.competition &&
        m.seasonId === target.seasonId &&
        m.stage === target.stage &&
        m.status !== "CANCELLED" &&
        samePair(target, m),
    )
    .sort(
      (a, b) => a.utcDate.localeCompare(b.utcDate) || a.id.localeCompare(b.id),
    );
  // Infer a two-leg tie only when the actual calendar supplies both reversed fixtures.
  if (
    legs.length !== 2 ||
    !legs.some((m) => m.id === target.id) ||
    teamSide(legs[1], teamIdentity(legs[0], "home")) !== "away" ||
    Date.parse(legs[0].utcDate) >= Date.parse(legs[1].utcDate)
  )
    return { leg: null, firstLeg: null, aggregate: null };
  const completed = legs.filter(
    (m) => m.status === "FINISHED" && Date.parse(m.utcDate) <= now,
  );
  const valid = completed.length > 0 && completed.every(hasRegulationResult);
  const aggregate = valid
    ? completed.reduce(
        (total, m) => {
          const homeSide = teamSide(m, teamIdentity(target, "home"));
          total.home += homeSide === "home" ? m.homeScore! : m.awayScore!;
          total.away += homeSide === "home" ? m.awayScore! : m.homeScore!;
          return total;
        },
        { home: 0, away: 0, played: completed.length },
      )
    : null;
  return {
    leg: legs[0].id === target.id ? 1 : 2,
    firstLeg: legs[0],
    aggregate,
  };
}
export function kickoffLabel(utcDate: string, now = Date.now()) {
  const date = new Date(utcDate),
    today = new Date(now),
    tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const sameDate = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const day = sameDate(date, today)
    ? "Hoy"
    : sameDate(date, tomorrow)
      ? "Mañana"
      : new Intl.DateTimeFormat("es", {
          day: "numeric",
          month: "short",
          ...(date.getFullYear() !== today.getFullYear()
            ? { year: "numeric" as const }
            : {}),
        }).format(date);
  return `${day} · ${new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(date)}`;
}
