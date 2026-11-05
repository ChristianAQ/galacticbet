import { describe, expect, it } from "vitest";
import type { Match } from "../src/lib/domain";
import { pickState, roundBoard, roundHasStarted } from "../src/lib/roundBoard";
import {
  quinielaText,
  shareFileName,
  standingsText,
} from "../src/lib/shareSummary";

const fixture = (id: string, extra: Partial<Match> = {}): Match => ({
  id,
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "PD-2026-REGULAR_SEASON-12",
  matchday: 12,
  stage: "REGULAR_SEASON",
  utcDate: "2026-11-08T20:00:00Z",
  status: "TIMED",
  home: `Local ${id}`,
  away: `Visitante ${id}`,
  homeScore: null,
  awayScore: null,
  ...extra,
});
const finished = fixture("1", {
  status: "FINISHED",
  homeScore: 2,
  awayScore: 1,
});
const live = fixture("2", { status: "IN_PLAY", homeScore: 0, awayScore: 0 });
const pending = fixture("3");
const unpublished = fixture("4", { status: "FINISHED" });
const matches = [finished, live, pending, unpublished];

describe("resumen de la jornada compartida", () => {
  it("distingue aciertos finales, provisionales y partidos sin resultado", () => {
    expect(pickState("classic", "1", finished)).toBe("hit");
    expect(pickState("classic", "2", finished)).toBe("miss");
    expect(pickState("classic", "X", live)).toBe("live-hit");
    expect(pickState("classic", "1", live)).toBe("live-miss");
    expect(pickState("classic", "1", pending)).toBe(null);
    expect(pickState("classic", "1", unpublished)).toBe(null);
    expect(pickState("classic", undefined, finished)).toBe(null);
  });

  it("suma solo resultados publicados y separa los puntos en juego", () => {
    const rows = roundBoard(matches, "exact", [
      {
        id: "a",
        name: "Ana",
        picks: { 1: { home: 2, away: 1 }, 2: { home: 1, away: 0 } },
      },
      {
        id: "b",
        name: "Bea",
        picks: { 1: { home: 1, away: 0 }, 2: { home: 0, away: 0 } },
      },
      { id: "c", name: "Carla", picks: { 1: { home: 0, away: 3 } } },
    ]);
    // Bea leads if the live 0-0 stands (1 final + 3 provisional).
    expect(rows).toEqual([
      { id: "b", name: "Bea", position: 1, points: 1, hits: 1, livePoints: 3 },
      { id: "a", name: "Ana", position: 2, points: 3, hits: 1, livePoints: 0 },
      {
        id: "c",
        name: "Carla",
        position: 3,
        points: 0,
        hits: 0,
        livePoints: 0,
      },
    ]);
  });

  it("comparte posición en empates de puntos", () => {
    const rows = roundBoard([finished], "classic", [
      { id: "b", name: "Bea", picks: { 1: "1" } },
      { id: "a", name: "Ana", picks: { 1: "1" } },
      { id: "c", name: "Carla", picks: { 1: "X" } },
    ]);
    expect(rows.map((r) => [r.name, r.position])).toEqual([
      ["Ana", 1],
      ["Bea", 1],
      ["Carla", 3],
    ]);
  });

  it("solo muestra el resumen cuando la jornada ha empezado", () => {
    expect(roundHasStarted([pending, unpublished])).toBe(false);
    expect(roundHasStarted([pending, live])).toBe(true);
  });

  it("genera un texto con todos los pronósticos y puntos", () => {
    const text = quinielaText({
      groupName: "Oficina",
      title: "LaLiga · Jornada 12",
      mode: "classic",
      matches: [finished, live],
      players: [
        { id: "a", name: "Ana", picks: { 1: "1", 2: "X" } },
        { id: "b", name: "Bea", picks: { 1: "2" } },
      ],
    });
    expect(text).toContain("⚽ Local 1 2-1 Visitante 1");
    expect(text).toContain("Ana: 1 ✅ · Bea: 2 ❌");
    expect(text).toContain("⚽ Local 2 0-0 (en juego) Visitante 2");
    expect(text).toContain("Ana: X 🟢 · Bea: —");
    expect(text).toContain("1. Ana · 1 pt (+1 en juego)");
  });

  it("genera la clasificación en texto y un nombre de archivo seguro", () => {
    expect(
      standingsText({
        groupName: "Oficina",
        title: "Todas las jornadas",
        showHits: true,
        rows: [
          {
            id: "a",
            name: "Ana",
            avatar: null,
            points: 7,
            hits: 5,
            position: 1,
          },
          {
            id: "b",
            name: "Bea",
            avatar: null,
            points: 1,
            hits: 1,
            position: 2,
          },
        ],
      }),
    ).toBe(
      "🏆 GalacticBet · Oficina\nTodas las jornadas\n\n1. Ana · 7 pts · 5 aciertos\n2. Bea · 1 pt · 1 acierto",
    );
    expect(shareFileName("quiniela", "Peña Ñandú", "LaLiga · Jornada 12")).toBe(
      "quiniela-pena-nandu-laliga-jornada-12.png",
    );
  });
});
