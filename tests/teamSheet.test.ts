import { describe, expect, it } from "vitest";
import type { Match } from "../src/lib/domain";
import { leagueTable } from "../src/lib/leagueTable";
import { currentStreak, positionHistory, standingNotes, streakLabel, teamSheet } from "../src/lib/teamSheet";
import { goalsByMatchday } from "../src/lib/seasonFigures";

const match = (id: string, day: number, home: string, away: string, h: number | null, a: number | null): Match => ({
  id,
  competition: "PD",
  seasonId: "PD-2026",
  roundId: `PD-2026-REGULAR_SEASON-${day}`,
  stage: "REGULAR_SEASON",
  matchday: day,
  utcDate: `2026-10-${String(day).padStart(2, "0")}T19:00:00Z`,
  status: h === null ? "TIMED" : "FINISHED",
  home,
  away,
  homeCrest: `https://crests.example/${home}.png`,
  awayCrest: `https://crests.example/${away}.png`,
  homeScore: h,
  awayScore: a,
});

describe("ficha de equipo", () => {
  const matches = [
    match("1", 1, "A", "B", 2, 0),
    match("2", 2, "C", "A", 1, 1),
    match("3", 3, "A", "C", 3, 1),
    match("4", 4, "B", "A", 0, 1),
    match("5", 5, "B", "C", 2, 2),
    match("6", 20, "A", "B", null, null),
  ];
  const table = leagueTable(matches);
  const now = Date.parse("2026-10-10T12:00:00Z");

  it("puesto, distancias, últimos partidos, casa y fuera, racha y próximo partido", () => {
    expect(table.map((r) => r.name)).toEqual(["A", "C", "B"]);
    const sheet = teamSheet(table, 0, matches, [], now);
    expect(sheet.position).toBe(1);
    expect(sheet.lead).toBe(10 - 2);
    expect(sheet.last.map((g) => `${g.home ? "v" : "@"}${g.opponent} ${g.score} ${g.result}`)).toEqual([
      "vB 2-0 win",
      "@C 1-1 draw",
      "vC 3-1 win",
      "@B 1-0 win",
    ]);
    expect(sheet.home).toMatchObject({ played: 2, wins: 2, points: 6, goalsFor: 5, goalsAgainst: 1 });
    expect(sheet.away).toMatchObject({ played: 2, wins: 1, draws: 1, points: 4 });
    expect(sheet.cleanSheets).toBe(2);
    expect(sheet.streak).toEqual({ kind: "wins", count: 2 });
    expect(sheet.next).toMatchObject({ opponent: "B", home: true });
    expect(teamSheet(table, 2, matches, [], now).leaderGap).toBe(10 - 1);
  });

  it("gráficos: puesto tras cada jornada y goles por partido de cada jornada", () => {
    const key = table.find((r) => r.name === "C")!.key;
    expect(positionHistory(matches, key).map((p) => [p.day, p.position, p.points])).toEqual([
      [2, 2, 1],
      [3, 2, 1],
      [4, 2, 1],
      [5, 2, 2],
    ]);
    expect(goalsByMatchday(matches).map((d) => [d.day, d.goals, d.played, d.average])).toEqual([
      [1, 2, 1, 2],
      [2, 2, 1, 2],
      [3, 4, 1, 4],
      [4, 1, 1, 1],
      [5, 4, 1, 4],
    ]);
  });

  it("goleadores del club por escudo", () => {
    const scorer = (name: string, team: string, goals: number) => ({
      key: name,
      name,
      team,
      crest: `https://crests.example/${team}.png`,
      goals,
      assists: null,
      penalties: null,
      played: null,
    });
    const sheet = teamSheet(table, 0, matches, [scorer("Uno", "A", 5), scorer("Otro", "B", 4), scorer("Dos", "A", 2)], now);
    expect(sheet.scorers.map((s) => s.name)).toEqual(["Uno", "Dos"]);
  });

  it("la racha más significativa", () => {
    expect(currentStreak(["loss", "win", "win", "win"])).toEqual({ kind: "wins", count: 3 });
    expect(currentStreak(["loss", "draw", "win", "draw"])).toEqual({ kind: "unbeaten", count: 3 });
    expect(currentStreak(["win", "loss", "loss"])).toEqual({ kind: "losses", count: 2 });
    expect(currentStreak(["win", "draw", "loss", "draw"])).toEqual({ kind: "winless", count: 3 });
    expect(currentStreak(["win", "loss"])).toBeNull();
    expect(streakLabel({ kind: "unbeaten", count: 5 })).toBe("5 partidos sin perder");
  });

  it("distancias: líder, Champions, descenso y octavos", () => {
    const rows = (points: number[]) =>
      points.map((p, i) => ({ key: `t${i}`, name: `T${i}`, played: 10, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: p, form: [] }));
    const liga = rows([30, 28, 25, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    expect(standingNotes(liga, 0, "PD")).toEqual(["Líder con 2 puntos de ventaja"]);
    expect(standingNotes(liga, 2, "PD")).toEqual(["A 5 puntos del líder", "5 puntos sobre el 5.º"]);
    expect(standingNotes(liga, 6, "PD")).toEqual(["A 12 puntos del líder", "A 4 puntos de la Champions"]);
    expect(standingNotes(liga, 12, "PD")).toEqual(["A 18 puntos del líder", "A 10 puntos de la Champions", "5 puntos sobre el descenso"]);
    expect(standingNotes(liga, 18, "PD")).toEqual(["A 24 puntos del líder", "A 16 puntos de la Champions", "A 2 puntos de la salvación"]);
    const champions = rows(Array.from({ length: 36 }, (_, i) => 36 - i));
    expect(standingNotes(champions, 12, "CL")).toEqual(["A 12 puntos del líder", "A 5 puntos de los octavos directos"]);
    expect(standingNotes(champions, 30, "CL")).toEqual(["A 30 puntos del líder", "A 7 puntos del playoff"]);
    // A partial table names only the leader.
    expect(standingNotes(liga.slice(0, 10), 6, "PD")).toEqual(["A 12 puntos del líder"]);
  });
});
