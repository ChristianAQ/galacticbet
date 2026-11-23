import {
  hasMatchStarted,
  isRoundComplete,
  roundCore,
  roundLabel,
  type Match,
} from "./domain";

export type RoundState = "open" | "live" | "playing" | "finished";
export interface RoundOption {
  id: string;
  label: string;
  short: string;
  start: string;
  end: string;
  state: RoundState;
  matches: number;
}

export const roundStateLabel: Record<RoundState, string> = {
  open: "Abierta",
  live: "En directo",
  playing: "En curso",
  finished: "Finalizada",
};

const shortStages: Record<string, string> = {
  PLAYOFFS: "Playoffs",
  LAST_128: "1ª ronda",
  LAST_64: "1/32",
  LAST_32: "1/16",
  LAST_16: "Octavos",
  QUARTER_FINALS: "Cuartos",
  SEMI_FINALS: "Semis",
  THIRD_PLACE: "3er puesto",
  FINAL: "Final",
  PRELIMINARY_ROUND: "Previa",
  FIRST_ROUND: "1ª ronda",
  SECOND_ROUND: "2ª ronda",
  QUALIFICATION: "Clasif.",
};
const roundStages = ["REGULAR_SEASON", "LEAGUE_STAGE", "GROUP_STAGE"];

export function roundShortLabel(match: Pick<Match, "stage" | "matchday">) {
  if (roundStages.includes(match.stage) && match.matchday)
    return `J${match.matchday}`;
  if (match.stage === "FRIENDLY") return `Amist. ${match.matchday}`;
  return shortStages[match.stage] || roundLabel(match);
}

export function roundOptions(matches: Match[], now = Date.now()) {
  const byRound = new Map<string, Match[]>();
  for (const match of matches) {
    const list = byRound.get(match.roundId);
    if (list) list.push(match);
    else byRound.set(match.roundId, [match]);
  }
  // Dates of a round are those of its bulk: J23 with one match brought
  // forward to December still reads «7 feb», not «2 dic – 7 feb».
  const order = new Map<string, { phase: string; matchday: number }>();
  const options = [...byRound.entries()].map(([id, all]): RoundOption => {
    const list = roundCore(all).core;
    const first = all[0];
    order.set(id, {
      phase: `${first.seasonId}|${first.stage}`,
      matchday: roundStages.includes(first.stage) || first.stage === "FRIENDLY" ? first.matchday || 0 : 0,
    });
    const dates = list.map((m) => m.utcDate).sort();
    const started = list.some(
      (m) =>
        hasMatchStarted(m, now) ||
        ["IN_PLAY", "PAUSED", "FINISHED"].includes(m.status),
    );
    const state: RoundState = list.some((m) =>
      ["IN_PLAY", "PAUSED"].includes(m.status),
    )
      ? "live"
      : started && isRoundComplete(list)
        ? "finished"
        : started
          ? "playing"
          : "open";
    return {
      id,
      label: roundLabel(list[0]),
      short: roundShortLabel(list[0]),
      start: dates[0],
      end: dates.at(-1)!,
      state,
      matches: all.length,
    };
  });
  // Matchdays of the same phase in their own order (J14, J15 … J23), whatever
  // their dates; different phases (league, then knockouts) by date.
  return options.sort((a, b) => {
    const x = order.get(a.id)!;
    const y = order.get(b.id)!;
    if (x.phase === y.phase && x.matchday && y.matchday) return x.matchday - y.matchday;
    return a.start.localeCompare(b.start) || a.id.localeCompare(b.id, "es", { numeric: true });
  });
}

const dayMonth = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
});
const dayOnly = new Intl.DateTimeFormat("es", { day: "numeric" });

export function roundDateRange(start: string, end: string) {
  const a = new Date(start),
    b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  if (a.toDateString() === b.toDateString()) return dayMonth.format(a);
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? `${dayOnly.format(a)}–${dayMonth.format(b)}`
    : `${dayMonth.format(a)} – ${dayMonth.format(b)}`;
}
