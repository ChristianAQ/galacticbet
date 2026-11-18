import { euro } from "./porra";
import type { RankingRow } from "./rankings";

/**
 * Informational round pot ("bote"). GalacticBet never collects, holds or pays out
 * money and keeps no commission: the group settles payments outside the app.
 */
export const MAX_POT_CENTS = 100_000; // 1.000 € per player and round
export const POT_PRESETS = [100, 200, 500, 1000];

export function validPotCents(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_POT_CENTS
  );
}

/** Groups created before the pot existed, or with corrupt data, have no pot. */
export function groupPotCents(group?: { potCents?: unknown } | null) {
  return group && validPotCents(group.potCents) ? group.potCents : 0;
}

export type PotState = "off" | "empty" | "open" | "live" | "settled";

export interface PotSummary {
  state: PotState;
  contributionCents: number;
  /** Members who delivered the round: only they put money in. */
  players: RankingRow[];
  totalCents: number;
  /** Best score among players. Provisional until the round is complete. */
  leaders: RankingRow[];
  topPoints: number;
  shareCents: number;
  /** Cents that cannot be split evenly between tied winners. */
  remainderCents: number;
}

export function roundPot({
  contributionCents,
  rows,
  participantIds,
  started,
  complete,
}: {
  contributionCents: number;
  rows: RankingRow[];
  participantIds: string[];
  started: boolean;
  complete: boolean;
}): PotSummary {
  const delivered = new Set(participantIds);
  // Former members keep their attendance, but only current members can win.
  const players = rows.filter((row) => delivered.has(row.id));
  const totalCents = validPotCents(contributionCents)
    ? contributionCents * players.length
    : 0;
  const topPoints = players.reduce((max, row) => Math.max(max, row.points), 0);
  const leaders =
    started && players.length
      ? players.filter((row) => row.points === topPoints)
      : [];
  const shareCents = leaders.length
    ? Math.floor(totalCents / leaders.length)
    : 0;
  const state: PotState = !validPotCents(contributionCents) ||
    contributionCents === 0
    ? "off"
    : !players.length
      ? "empty"
      : !started
        ? "open"
        : complete
          ? "settled"
          : "live";
  return {
    state,
    contributionCents: validPotCents(contributionCents) ? contributionCents : 0,
    players,
    totalCents,
    leaders,
    topPoints,
    shareCents,
    remainderCents: leaders.length ? totalCents - shareCents * leaders.length : 0,
  };
}

const names = (rows: RankingRow[]) =>
  new Intl.ListFormat("es", { type: "conjunction" }).format(
    rows.map((r) => r.name),
  );

/** Plain-text line used in shared standings. */
export function potText(pot: PotSummary) {
  if (pot.state === "off") return "";
  const total = `Bote: ${euro(pot.totalCents)} (${pot.players.length} × ${euro(pot.contributionCents)})`;
  if (pot.state === "settled" && pot.leaders.length)
    return `${total} · ${pot.leaders.length > 1 ? "Ganadores" : "Ganador"}: ${names(pot.leaders)} · ${euro(pot.shareCents)}${pot.leaders.length > 1 ? " cada uno" : ""}`;
  if (pot.state === "live" && pot.leaders.length)
    return `${total} · Va ganando: ${names(pot.leaders)}`;
  return total;
}

export function parsePotInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (!/^\d{1,4}([,.]\d{1,2})?$/.test(trimmed)) return null;
  const [whole, decimal = ""] = trimmed.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return validPotCents(cents) ? cents : null;
}

export function potInputValue(cents: number) {
  if (!cents) return "";
  return cents % 100
    ? (cents / 100).toFixed(2).replace(".", ",")
    : String(cents / 100);
}

export { names as potNames };

/** «5 €» instead of «5,00 €» for whole amounts, for tight spaces. */
export const euroShort = (cents: number) =>
  cents % 100 ? euro(cents) : euro(cents).replace(/,00(?=\s|\u00a0|€)/, "");
