import { predictionSummary, score, type Match, type Mode, type PredictionValue } from "./domain";
import type { Participant } from "./data";
import { buildRanking, type RankingRow, type SeasonRanking } from "./rankings";

/**
 * The story of a finished round in a group: who won it, how you did, and the
 * moments worth a message in the group chat. Display only; the official
 * totals are the backend's.
 */
export interface RoundRecap {
  roundId: string;
  /** Round ranking (points of this round only). */
  rows: RankingRow[];
  /** Season table right after this round. */
  season: RankingRow[];
  winners: RankingRow[];
  best: number;
  me: {
    points: number;
    roundPosition: number;
    seasonPosition: number;
    /** Places gained (+) or lost (−) in the season table with this round. */
    moved: number;
  } | null;
  /** Biggest climb in the season table thanks to this round. */
  climber: { name: string; id: string; places: number } | null;
  /** Longest run of consecutive scoring rounds that is still alive (≥ 3). */
  streak: { name: string; id: string; rounds: number } | null;
  /** Every fixture right. */
  perfect: RankingRow[];
  /** Players who scored nothing while others did. */
  blank: RankingRow[];
}

/** Totals counting only the given rounds. */
function upTo(seasons: SeasonRanking[], rounds: Set<string>): SeasonRanking[] {
  return seasons.map((season) => ({
    ...season,
    standings: season.standings.map((row) => {
      const kept = Object.entries(row.rounds).filter(([id]) => rounds.has(id));
      return {
        ...row,
        rounds: Object.fromEntries(kept),
        points: kept.reduce((sum, [, r]) => sum + r.points, 0),
        hits: kept.reduce((sum, [, r]) => sum + r.hits, 0),
      };
    }),
  }));
}

export function roundRecap({
  participants,
  seasons,
  scope,
  roundIds,
  roundId,
  userId,
  fixtures,
}: {
  participants: Participant[];
  seasons: SeasonRanking[];
  scope: string;
  /** Rounds of the scope in calendar order. */
  roundIds: string[];
  roundId: string;
  userId: string;
  /** Fixtures of the round (to recognise a perfect slip). */
  fixtures: Match[];
}): RoundRecap | null {
  const index = roundIds.indexOf(roundId);
  if (index < 0) return null;
  const rows = buildRanking(participants, seasons, scope, roundId);
  const best = rows[0]?.points ?? 0;
  if (best <= 0) return null;
  const through = new Set(roundIds.slice(0, index + 1));
  const before = new Set(roundIds.slice(0, index));
  const after = buildRanking(participants, upTo(seasons, through), scope);
  const prior = buildRanking(participants, upTo(seasons, before), scope);
  const priorPosition = new Map(prior.map((r) => [r.id, r.position]));
  const moved = (row: RankingRow) => (priorPosition.get(row.id) ?? row.position) - row.position;

  const mine = rows.find((r) => r.id === userId);
  const mineAfter = after.find((r) => r.id === userId);
  const climbers = index > 0 ? after.map((r) => ({ row: r, places: moved(r) })) : [];
  const top = climbers.filter((c) => c.places >= 2).sort((a, b) => b.places - a.places)[0];

  // Consecutive rounds with points, counted back from this one.
  const scored = new Map<string, Set<string>>();
  for (const season of seasons)
    for (const row of season.standings)
      for (const [id, total] of Object.entries(row.rounds))
        if (total.points > 0) scored.set(row.id, (scored.get(row.id) || new Set()).add(id));
  let streak: RoundRecap["streak"] = null;
  for (const person of participants) {
    let run = 0;
    for (let i = index; i >= 0 && scored.get(person.id)?.has(roundIds[i]); i--) run++;
    if (run >= 3 && (!streak || run > streak.rounds))
      streak = { name: person.name, id: person.id, rounds: run };
  }

  const played = fixtures.filter((m) => m.homeScore !== null && m.awayScore !== null).length;
  return {
    roundId,
    rows,
    season: after,
    winners: rows.filter((r) => r.points === best),
    best,
    me:
      mine && mineAfter
        ? {
            points: mine.points,
            roundPosition: mine.position,
            seasonPosition: mineAfter.position,
            moved: index > 0 ? moved(mineAfter) : 0,
          }
        : null,
    climber: top ? { name: top.row.name, id: top.row.id, places: top.places } : null,
    streak,
    perfect: played > 1 ? rows.filter((r) => r.hits >= played) : [],
    blank: rows.filter((r) => r.points === 0),
  };
}

/**
 * The pick fewest players got right (one or two of them), from the sealed
 * slips the group can see. Null when everybody (or nobody) got each one.
 */
export function rarestHit(
  mode: Mode,
  fixtures: Match[],
  entries: Record<string, Record<string, PredictionValue>>,
  names: Map<string, string>,
) {
  const players = Object.keys(entries);
  if (players.length < 3) return null;
  let rarest: { match: Match; pick: string; ids: string[]; names: string[] } | null = null;
  for (const match of fixtures) {
    if (match.homeScore === null || match.awayScore === null) continue;
    const result = { home: match.homeScore, away: match.awayScore };
    const right = players.filter((uid) => {
      const value = entries[uid][match.id];
      return value !== undefined && score(mode, value, result) > 0;
    });
    if (!right.length || right.length > 2) continue;
    if (!rarest || right.length < rarest.names.length)
      rarest = {
        match,
        pick: predictionSummary(entries[right[0]][match.id]),
        ids: right,
        names: right.map((uid) => names.get(uid) || "Jugador"),
      };
  }
  return rarest;
}

const pts = (n: number) => `${n} ${n === 1 ? "punto" : "puntos"}`;
const list = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;

/**
 * One line per highlight. With `you`, lines about that player speak to them
 * («Llevas…»); without it (text shared to the group) everyone is named.
 */
export function recapHighlights(
  recap: RoundRecap,
  rare: ReturnType<typeof rarestHit>,
  you = "",
): { kind: "rare" | "perfect" | "streak" | "climb" | "blank"; text: string }[] {
  const lines: ReturnType<typeof recapHighlights> = [];
  if (rare) {
    const match = `el ${rare.pick} del ${rare.match.home}–${rare.match.away}`;
    const others = rare.names.filter((_, i) => rare.ids[i] !== you);
    const mine = rare.ids.includes(you);
    lines.push({
      kind: "rare",
      text: mine
        ? others.length
          ? `Solo tú y ${list(others)} acertasteis ${match}.`
          : `Solo tú acertaste ${match}.`
        : rare.names.length === 1
          ? `Solo ${rare.names[0]} acertó ${match}.`
          : `Solo ${list(rare.names)} acertaron ${match}.`,
    });
  }
  if (recap.perfect.length) {
    const others = recap.perfect.filter((r) => r.id !== you).map((r) => r.name);
    const mine = others.length < recap.perfect.length;
    lines.push({
      kind: "perfect",
      text: mine
        ? others.length
          ? `Pleno de ${list(others)} y tuyo: todos los partidos acertados.`
          : "¡Pleno! Acertaste todos los partidos."
        : `Pleno de ${list(others)}: todos los partidos acertados.`,
    });
  }
  if (recap.streak)
    lines.push({
      kind: "streak",
      text:
        recap.streak.id === you
          ? `Llevas ${recap.streak.rounds} jornadas seguidas puntuando.`
          : `${recap.streak.name} lleva ${recap.streak.rounds} jornadas seguidas puntuando.`,
    });
  if (recap.climber)
    lines.push({
      kind: "climb",
      text:
        recap.climber.id === you
          ? `Subes ${recap.climber.places} puestos en la general.`
          : `${recap.climber.name} sube ${recap.climber.places} puestos en la general.`,
    });
  if (recap.blank.length && recap.blank.length < recap.rows.length)
    lines.push({
      kind: "blank",
      text:
        recap.blank.length > 1
          ? `${recap.blank.length} jugadores se quedaron en blanco.`
          : recap.blank[0].id === you
            ? "Te quedaste en blanco esta vez."
            : `${recap.blank[0].name} se quedó en blanco.`,
    });
  return lines;
}

/** Chat text: «🏆 LaLiga · Jornada 13 en Los del barrio» and the highlights. */
export function recapText({
  groupName,
  title,
  recap,
  highlights,
}: {
  groupName: string;
  title: string;
  recap: RoundRecap;
  highlights: ReturnType<typeof recapHighlights>;
}) {
  const icons = { rare: "⚡", perfect: "🎯", streak: "🔥", climb: "📈", blank: "🥶" };
  const winner =
    recap.winners.length === 1
      ? `Ganó ${recap.winners[0].name} con ${pts(recap.best)}.`
      : `Empate arriba: ${list(recap.winners.map((w) => w.name))}, con ${pts(recap.best)}.`;
  return [
    `🏆 ${title} · ${groupName}`,
    winner,
    ...highlights.map((h) => `${icons[h.kind]} ${h.text}`),
    "",
    "📊 La general",
    ...recap.season.slice(0, 5).map((r) => `${r.position}. ${r.name} · ${r.points} pts`),
    "",
    "Juega la próxima en GalacticBet.",
  ].join("\n");
}
