import { competitionName } from "./competitions";
import type { Match } from "./domain";
import type { MatchPlayer, PlayerStat } from "./matchInsightsData";

export function chronologicalGoals<T extends { minute: string }>(goals: T[]) {
  const key = (minute: string) => {
    const parts = /^(\d+)(?:\+(\d+))?$/.exec(minute.replace(/[\s'’′]/g, ""));
    return parts ? Number(parts[1]) * 1000 + Number(parts[2] || 0) : Infinity;
  };
  return [...goals].sort((a, b) => key(a.minute) - key(b.minute));
}

// Rank orders roles from goal to attack; lateral runs 0 (left flank) to 4 (right flank).
const roleCodes: Record<string, [rank: number, lateral: number]> = {
  G: [0, 2], GK: [0, 2], POR: [0, 2],
  D: [1, 2], DF: [1, 2], DEF: [1, 2], CB: [1, 2], CD: [1, 2], SW: [1, 2],
  LB: [1, 0], RB: [1, 4], LCB: [1, 1], RCB: [1, 3],
  WB: [2, 2], LWB: [2, 0], RWB: [2, 4],
  DM: [3, 2], CDM: [3, 2], LDM: [3, 1], RDM: [3, 3],
  M: [4, 2], MF: [4, 2], MID: [4, 2], MED: [4, 2], CM: [4, 2],
  LM: [4, 0], RM: [4, 4], LCM: [4, 1], RCM: [4, 3],
  AM: [5, 2], CAM: [5, 2], LAM: [5, 1], RAM: [5, 3],
  F: [6, 2], FW: [6, 2], ATT: [6, 2], DEL: [6, 2], ST: [6, 2], CF: [6, 2],
  SS: [6, 2], LW: [6, 0], RW: [6, 4], LF: [6, 1], RF: [6, 3],
};
const roleWords: [RegExp, number][] = [
  [/goal/, 0],
  [/wing ?back/, 2],
  [/back|defender|defence|defense/, 1],
  [/defensive mid/, 3],
  [/attacking mid/, 5],
  [/mid/, 4],
  [/forward|striker|wing|attack/, 6],
];

export function positionRole(position?: string) {
  const raw = (position || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/\s+/g, "");
  const suffix = /-(L|C|R)$/.exec(upper);
  const code = roleCodes[suffix ? upper.slice(0, -2) : upper];
  const side = suffix ? "LCR".indexOf(suffix[1]) + 1 : null;
  if (code) return { rank: code[0], lateral: side ?? code[1] };
  const words = raw.toLowerCase();
  const match = roleWords.find(([pattern]) => pattern.test(words));
  if (!match) return null;
  const inner = /cent/.test(words);
  return {
    rank: match[1],
    lateral: /left/.test(words)
      ? inner ? 1 : 0
      : /right/.test(words)
        ? inner ? 3 : 4
        : 2,
  };
}

const lineLabels = ["Portería", "Defensa", "Centro del campo", "Ataque"];
const lineOf = (rank: number) => (rank === 0 ? 0 : rank <= 2 ? 1 : rank <= 5 ? 2 : 3);

export function positionLines(players: MatchPlayer[]) {
  const starters = players.filter((p) => p.starter);
  const lines = lineLabels.map((label) => ({
    label,
    players: [] as MatchPlayer[],
  }));
  const unknown: MatchPlayer[] = [];
  for (const p of starters) {
    const role = positionRole(p.position);
    if (role) lines[lineOf(role.rank)].players.push(p);
    else unknown.push(p);
  }
  return { lines, unknown };
}

export function parseFormation(formation?: string) {
  const parts = (formation || "").split(/[^0-9]+/).filter(Boolean).map(Number);
  return parts.length >= 2 &&
    parts.every((n) => n >= 1 && n <= 6) &&
    parts.reduce((a, b) => a + b, 0) === 10
    ? parts
    : null;
}

// Rows from goalkeeper to attack, each ordered from the team's left to right.
export function pitchRows(players: MatchPlayer[], formation?: string) {
  const starters = players.filter((p) => p.starter);
  const roles = new Map(starters.map((p) => [p, positionRole(p.position)]));
  const byLateral = (row: MatchPlayer[]) =>
    row
      .map((p, i) => ({ p, i, l: roles.get(p)?.lateral ?? 2 }))
      .sort((a, b) => a.l - b.l || a.i - b.i)
      .map(({ p }) => p);
  const counts = parseFormation(formation);
  if (counts && starters.length === 11) {
    const known = starters.every((p) => roles.get(p));
    // Providers list the XI from goalkeeper to attack, so keep that order when roles are missing.
    const ordered = known
      ? starters
          .map((p, i) => ({ p, i, r: roles.get(p)!.rank }))
          .sort((a, b) => a.r - b.r || a.i - b.i)
          .map(({ p }) => p)
      : starters;
    let offset = 0;
    const rows = [1, ...counts].map((size) => {
      const row = ordered.slice(offset, offset + size);
      offset += size;
      return byLateral(row);
    });
    return { rows, unknown: [] as MatchPlayer[] };
  }
  const { lines, unknown } = positionLines(players);
  return {
    rows: lines.filter((l) => l.players.length).map((l) => byLateral(l.players)),
    unknown,
  };
}

/** Name endings that are not a surname: «Vinícius Júnior» is «Vinícius Jr.». */
const NAME_SUFFIX = /^(j[uú]nior|jr\.?|filho|neto|sobrinho|ii|iii)$/i;
export function shortPlayerName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && NAME_SUFFIX.test(parts[parts.length - 1])) {
    const last = parts[parts.length - 1];
    return `${parts[parts.length - 2]} ${/^j/i.test(last) ? "Jr." : last}`;
  }
  let start = parts.length - 1;
  while (
    start > 1 &&
    /^(de|del|da|do|dos|das|di|van|von|der|den|la|le|el|ter|ten)$/i.test(
      parts[start - 1],
    )
  )
    start--;
  return parts.length > 1 ? parts.slice(start).join(" ") : name;
}

/** A published minute ("70", "70'", "90+2’") with a single apostrophe. */
export const minuteMark = (minute: string) =>
  `${minute.replace(/[’′']$/, "")}'`;

/** Players who took part, most shots first; ties keep the lineup order. */
export function playersByShots(players: MatchPlayer[]) {
  const n = (p: MatchPlayer, stat: PlayerStat) => p.stats?.[stat] ?? 0;
  return players
    .filter((p) => p.stats)
    .sort(
      (a, b) =>
        n(b, "shots") - n(a, "shots") ||
        n(b, "shotsOnTarget") - n(a, "shotsOnTarget") ||
        n(b, "goals") - n(a, "goals"),
    );
}

export function statisticShares(home: string, away: string) {
  const parse = (value: string) =>
    /^\d+(?:[.,]\d+)?%?$/.test(value)
      ? Number(value.replace("%", "").replace(",", "."))
      : NaN;
  const h = parse(home),
    a = parse(away);
  if (!Number.isFinite(h) || !Number.isFinite(a) || h + a === 0) return null;
  return [(h / (h + a)) * 100, (a / (h + a)) * 100] as const;
}

export function canAddMatchToCalendar(match: Match, now = Date.now()) {
  return (
    ["TIMED", "SCHEDULED"].includes(match.status) &&
    Date.parse(match.utcDate) > now
  );
}
export function matchCalendarFile(match: Match, now = Date.now()) {
  if (!canAddMatchToCalendar(match, now))
    throw new Error("Este partido no tiene un inicio futuro confirmado.");
  const escape = (s: string) =>
    s
      .replaceAll("\\", "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replaceAll(";", "\\;")
      .replaceAll(",", "\\,");
  const date = (value: number) =>
    new Date(value)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  // Fold at 75 UTF-8 octets, without splitting accented characters (RFC 5545).
  const fold = (line: string) => {
    let out = "",
      size = 0;
    for (const char of line) {
      const bytes = new TextEncoder().encode(char).length;
      if (size + bytes > 75) {
        out += "\r\n ";
        size = 1;
      }
      out += char;
      size += bytes;
    }
    return out;
  };
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GalacticBet//Partidos//ES",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${encodeURIComponent(match.id)}@galacticbet`,
    `DTSTAMP:${date(now)}`,
    `DTSTART:${date(Date.parse(match.utcDate))}`,
    `SUMMARY:${escape(`${match.home} – ${match.away}`)}`,
    `DESCRIPTION:${escape(`${competitionName(match.competition)} · GalacticBet. Revisa el horario en la aplicación antes del partido; este evento no se actualiza automáticamente.`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:El partido comienza en 30 minutos",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(fold)
    .join("\r\n");
}
