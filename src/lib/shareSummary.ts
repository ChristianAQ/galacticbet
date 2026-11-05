import { predictionSummary, type Match, type Mode } from "./domain";
import type { RankingRow } from "./rankings";
import { pickState, roundBoard, type RoundPlayer } from "./roundBoard";

export interface QuinielaShare {
  groupName: string;
  title: string;
  mode: Mode;
  matches: Match[];
  players: RoundPlayer[];
  demo?: boolean;
}
export interface StandingsShare {
  groupName: string;
  title: string;
  rows: RankingRow[];
  showHits: boolean;
  demo?: boolean;
}

const marks = { hit: " ✅", miss: " ❌", "live-hit": " 🟢", "live-miss": "" };

export function matchScoreLabel(m: Match) {
  if (m.homeScore === null || m.awayScore === null)
    return m.status === "POSTPONED"
      ? "aplazado"
      : m.status === "CANCELLED"
        ? "cancelado"
        : "vs";
  return `${m.homeScore}-${m.awayScore}${["IN_PLAY", "PAUSED"].includes(m.status) ? " (en juego)" : ""}`;
}

const points = (n: number) => `${n} ${n === 1 ? "pt" : "pts"}`;

/** Plain text for chats, with every shared pick and provisional round points. */
export function quinielaText(q: QuinielaShare) {
  const lines = [
    `🏆 GalacticBet · ${q.groupName}${q.demo ? " (demo)" : ""}`,
    `${q.title} · ${q.mode === "classic" ? "1X2" : "Marcador exacto"}`,
    "",
  ];
  for (const m of q.matches) {
    lines.push(`⚽ ${m.home} ${matchScoreLabel(m)} ${m.away}`);
    lines.push(
      "   " +
        q.players
          .map((p) => {
            const value = p.picks[m.id];
            const state = pickState(q.mode, value, m);
            return `${p.name}: ${value ? predictionSummary(value) : "—"}${state ? marks[state] : ""}`;
          })
          .join(" · "),
    );
  }
  const board = roundBoard(q.matches, q.mode, q.players);
  if (board.some((r) => r.points || r.livePoints)) {
    lines.push("", "📊 Puntos de la jornada");
    for (const r of board)
      lines.push(
        `${r.position}. ${r.name} · ${points(r.points)}${r.livePoints ? ` (+${r.livePoints} en juego)` : ""}`,
      );
  }
  lines.push(
    "",
    "Resultados a 90 minutos. La clasificación oficial está en la app.",
  );
  return lines.join("\n");
}

export function standingsText(s: StandingsShare) {
  const lines = [
    `🏆 GalacticBet · ${s.groupName}${s.demo ? " (demo)" : ""}`,
    s.title,
    "",
  ];
  for (const r of s.rows)
    lines.push(
      `${r.position}. ${r.name} · ${points(r.points)}${s.showHits ? ` · ${r.hits} ${r.hits === 1 ? "acierto" : "aciertos"}` : ""}`,
    );
  return lines.join("\n");
}

export function shareFileName(...parts: string[]) {
  const slug = parts
    .join("-")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${slug || "galacticbet"}.png`;
}
