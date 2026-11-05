import { isCompetition } from "./competitions";
import { competitionName } from "./competitions";
import {
  preferredRound,
  roundLabelFromId,
  type Match,
  type Mode,
} from "./domain";
import type { Participant } from "./data";

export interface RankingTotal {
  points: number;
  hits: number;
}
export interface SeasonRanking {
  mode?: Mode;
  id: string;
  competition: string;
  standings: {
    id: string;
    points: number;
    hits: number;
    rounds: Record<string, RankingTotal>;
  }[];
}
export interface RankingRow extends Participant, RankingTotal {
  position: number;
}

// Only backend totals contribute points. The roster supplies names and zero rows.
export function buildRanking(
  participants: Participant[],
  seasons: SeasonRanking[],
  scope: string,
  roundId = "",
): RankingRow[] {
  const totals = new Map(
    participants.map((p) => [p.id, { ...p, points: 0, hits: 0 }]),
  );
  for (const season of seasons) {
    if (!isCompetition(season.competition)) continue;
    if (scope !== "global" && scope !== season.competition) continue;
    for (const standing of season.standings) {
      const row = totals.get(standing.id);
      const value = roundId ? standing.rounds[roundId] : standing;
      if (!row || !value) continue;
      row.points += value.points;
      row.hits += value.hits;
    }
  }
  const sorted = [...totals.values()].sort(
    (a, b) =>
      b.points - a.points ||
      a.name.localeCompare(b.name, "es") ||
      a.id.localeCompare(b.id),
  );
  let position = 1;
  return sorted.map((row, index) => {
    if (index && row.points !== sorted[index - 1].points) position = index + 1;
    return { ...row, position };
  });
}

// Unknown or mixed modes keep the hit count; only confirmed classic scopes hide it.
export function isClassicRanking(
  seasons: SeasonRanking[],
  scope: string,
  roundId = "",
) {
  const relevant = seasons.filter(
    (s) =>
      isCompetition(s.competition) &&
      (scope === "global" || scope === s.competition) &&
      (!roundId || roundId.startsWith(`${s.id}-`)),
  );
  return relevant.length > 0 && relevant.every((s) => s.mode === "classic");
}

export function rankingSummary(rows: RankingRow[], userId: string) {
  const me = rows.find((r) => r.id === userId) || null;
  const leaderPoints = rows[0]?.points ?? 0;
  const above = me
    ? rows.filter((r) => r.points > me.points).at(-1) || null
    : null;
  return {
    me,
    total: rows.length,
    leaderPoints,
    gapToLeader: me ? leaderPoints - me.points : 0,
    gapToAbove: me && above ? above.points - me.points : 0,
    above,
    sharedLead:
      me?.position === 1 && rows.filter((r) => r.position === 1).length > 1,
  };
}

export function rankingRounds(
  seasons: SeasonRanking[],
  matches: Match[],
  scope: string,
) {
  const active = seasons.filter(
    (s) =>
      isCompetition(s.competition) &&
      (scope === "global" || s.competition === scope),
  );
  const seasonIds = new Set(active.map((s) => s.id));
  const rounds = new Map<
    string,
    { id: string; label: string; kickoff: string }
  >();
  function add(id: string, kickoff = "") {
    const [competition, year] = id.split("-");
    const previous = rounds.get(id);
    rounds.set(id, {
      id,
      label: `${competitionName(competition, true)} · ${roundLabelFromId(id)} · ${year}/${String(Number(year) + 1).slice(-2)}`,
      kickoff:
        previous?.kickoff && (!kickoff || previous.kickoff < kickoff)
          ? previous.kickoff
          : kickoff,
    });
  }
  for (const season of active)
    for (const row of season.standings)
      for (const id of Object.keys(row.rounds)) add(id);
  for (const match of matches)
    if (
      seasonIds.has(match.seasonId) &&
      active.some(
        (s) => s.id === match.seasonId && s.competition === match.competition,
      )
    )
      add(match.roundId, match.utcDate);
  return [...rounds.values()].sort(
    (a, b) =>
      (a.kickoff || "9999").localeCompare(b.kickoff || "9999") ||
      a.id.localeCompare(b.id, "es", { numeric: true }),
  );
}

// Use the same complete-round policy as matches and predictions.
export function currentRankingRound(
  matches: Match[],
  roundIds: string[],
  now = Date.now(),
) {
  const allowed = new Set(roundIds);
  const fixtures = matches.filter(
    (m) => allowed.has(m.roundId) && Number.isFinite(Date.parse(m.utcDate)),
  );
  return preferredRound(fixtures, now) || roundIds.at(-1) || "";
}

/**
 * Places gained (positive) or lost with one round: compares the current totals with
 * the same totals minus that round. Display only; ties share positions as usual.
 */
export function rankingMovement(total: RankingRow[], round: RankingRow[]) {
  const gained = new Map(round.map((r) => [r.id, r.points]));
  const before = total
    .map((r) => ({ ...r, points: r.points - (gained.get(r.id) || 0) }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        a.name.localeCompare(b.name, "es") ||
        a.id.localeCompare(b.id),
    );
  const previous = new Map<string, number>();
  let position = 1;
  before.forEach((row, index) => {
    if (index && row.points !== before[index - 1].points) position = index + 1;
    previous.set(row.id, position);
  });
  return new Map(
    total.map((r) => [r.id, (previous.get(r.id) ?? r.position) - r.position]),
  );
}

/** Latest round of the scope where somebody already scored, for «Última jornada». */
export function latestScoredRound(
  participants: Participant[],
  seasons: SeasonRanking[],
  scope: string,
  roundIds: string[],
) {
  for (const id of [...roundIds].reverse()) {
    const rows = buildRanking(participants, seasons, scope, id);
    if (rows.some((r) => r.points > 0)) return { id, rows };
  }
  return null;
}
