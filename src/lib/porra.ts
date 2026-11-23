import { competitionName, isKnownCompetition } from "./competitions";
import type { Match } from "./domain";

export const MAX_PORRAS = 20;
export const MAX_PORRA_PLAYERS = 30;
export type PorraFixture = Pick<
  Match,
  "id" | "competition" | "home" | "away" | "utcDate"
> & {
  /** A match of a friends' competition: its name replaces the league's. */
  league?: string;
};
export interface PorraPlayer {
  id: string;
  name: string;
  home: number;
  away: number;
}
export interface Porra {
  id: string;
  title: string;
  fixture: PorraFixture;
  players: PorraPlayer[];
  contributionCents: number;
  demo: boolean;
  createdAt: number;
  updatedAt: number;
}
type StorageAccess = Pick<Storage, "getItem" | "setItem">;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const goal = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 99;

export function parseContribution(value: string): number | null {
  if (!/^\d{1,5}([,.]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, decimal = ""] = value.trim().replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return cents <= 1_000_000 ? cents : null;
}
export function euro(cents: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}
export const porraTotal = (porra: Porra) =>
  porra.players.length * porra.contributionCents;
export function validPorra(value: unknown): value is Porra {
  if (!value || typeof value !== "object") return false;
  const p = value as Porra;
  return (
    text(p.id, 128) &&
    text(p.title, 60) &&
    Boolean(p.fixture) &&
    text(p.fixture.id, 128) &&
    (p.fixture.league === undefined
      ? isKnownCompetition(p.fixture.competition)
      : text(p.fixture.league, 60)) &&
    text(p.fixture.home, 100) &&
    text(p.fixture.away, 100) &&
    typeof p.fixture.utcDate === "string" &&
    Number.isFinite(Date.parse(p.fixture.utcDate)) &&
    Array.isArray(p.players) &&
    p.players.length > 0 &&
    p.players.length <= MAX_PORRA_PLAYERS &&
    p.players.every(
      (player) =>
        player &&
        text(player.id, 128) &&
        text(player.name, 40) &&
        goal(player.home) &&
        goal(player.away),
    ) &&
    new Set(p.players.map((player) => player.id)).size === p.players.length &&
    Number.isInteger(p.contributionCents) &&
    p.contributionCents >= 0 &&
    p.contributionCents <= 1_000_000 &&
    typeof p.demo === "boolean" &&
    Number.isFinite(p.createdAt) &&
    p.createdAt > 0 &&
    Number.isFinite(p.updatedAt) &&
    p.updatedAt >= p.createdAt
  );
}
export function fixtureSnapshot(match: Match, league?: string): PorraFixture {
  const { id, competition, home, away, utcDate } = match;
  return league
    ? { id, competition, home, away, utcDate, league }
    : { id, competition, home, away, utcDate };
}
/** «LaLiga» or the name of the friends' competition. */
export const porraLeague = (fixture: PorraFixture) =>
  fixture.league || competitionName(fixture.competition);
export function porraStorageKey(owner: string) {
  return `galacticbet:porras:v1:${owner || "guest"}`;
}
export function readPorras(storage: StorageAccess, key: string): Porra[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  if (raw.length > 300_000)
    throw new Error(
      "No se pudieron leer las porras guardadas en este dispositivo.",
    );
  let data: { version?: number; porras?: unknown };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "El archivo local de porras no se puede leer. No se han sobrescrito sus datos.",
    );
  }
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.porras) ||
    data.porras.length > MAX_PORRAS ||
    !data.porras.every(validPorra) ||
    new Set(data.porras.map((p) => p.id)).size !== data.porras.length
  )
    throw new Error(
      "El archivo local de porras no es compatible. No se han sobrescrito sus datos.",
    );
  return [...data.porras].sort((a, b) => b.updatedAt - a.updatedAt);
}
export function savePorra(storage: StorageAccess, key: string, porra: Porra) {
  if (!validPorra(porra))
    throw new Error("Revisa los nombres, marcadores y aportación de la porra.");
  const previous = readPorras(storage, key);
  const next = [porra, ...previous.filter((p) => p.id !== porra.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  if (next.length > MAX_PORRAS)
    throw new Error(
      `Puedes guardar hasta ${MAX_PORRAS} porras. Elimina alguna para crear otra.`,
    );
  storage.setItem(key, JSON.stringify({ version: 1, porras: next }));
  return next;
}
export function removePorra(storage: StorageAccess, key: string, id: string) {
  const next = readPorras(storage, key).filter((p) => p.id !== id);
  storage.setItem(key, JSON.stringify({ version: 1, porras: next }));
  return next;
}
export function porraText(p: Porra) {
  return [
    p.title,
    ...(p.demo ? ["PORRA DEMO · Partido de ejemplo"] : []),
    `${p.fixture.home} – ${p.fixture.away}`,
    new Intl.DateTimeFormat("es", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(p.fixture.utcDate)),
    "",
    ...p.players.map(
      (player) => `${player.name}: ${player.home} – ${player.away}`,
    ),
    "",
    `Aportación por persona: ${euro(p.contributionCents)}`,
    `Bote total: ${euro(porraTotal(p))}`,
    "GalacticBet · Porra entre amigos",
  ].join("\n");
}
