import { describe, expect, it } from "vitest";
import {
  chronologicalGoals,
  positionLines,
  statisticShares,
  matchCalendarFile,
  minuteMark,
  playersByShots,
  canAddMatchToCalendar,
} from "../src/lib/matchPresentation";
import { demoMatches } from "../src/lib/demo";
describe("Presentación de partidos", () => {
  it("lista solo a quien ha jugado, con más tiros primero y el orden del once en los empates", () => {
    const players = [
      { name: "Portero", starter: true, stats: { saves: 3 } },
      { name: "Suplente", starter: false },
      { name: "Lateral", starter: true, stats: { shots: 2, shotsOnTarget: 0 } },
      { name: "Delantero", starter: true, stats: { shots: 2, shotsOnTarget: 1 } },
      { name: "Central", starter: true, stats: { shots: 0 } },
      { name: "Extremo", starter: true, stats: { shots: 5 } },
    ];
    expect(playersByShots(players).map((p) => p.name)).toEqual([
      "Extremo",
      "Delantero",
      "Lateral",
      "Portero",
      "Central",
    ]);
    expect(players[0].name).toBe("Portero");
    expect(["70'", "70", "90+2’"].map(minuteMark)).toEqual([
      "70'",
      "70'",
      "90+2'",
    ]);
  });
  it("ordena descuentos antes de la segunda parte sin modificar los eventos originales", () => {
    const goals = ["46'", "45+3'", "45'", "90'+2'", "Desconocido"].map(
      (minute) => ({
        minute,
        side: "home" as const,
        scorer: "Jugador",
        kind: "goal" as const,
      }),
    );
    expect(chronologicalGoals(goals).map((g) => g.minute)).toEqual([
      "45'",
      "45+3'",
      "46'",
      "90'+2'",
      "Desconocido",
    ]);
    expect(goals[0].minute).toBe("46'");
  });
  it("sitúa únicamente titulares con posición conocida y separa los desconocidos", () => {
    const players = [
      { name: "Portero", position: "GK", starter: true },
      { name: "Defensa", position: "CB", starter: true },
      { name: "Sin posición", starter: true },
      { name: "Suplente", position: "ST", starter: false },
    ];
    const result = positionLines(players);
    expect(result.lines[0].players[0].name).toBe("Portero");
    expect(result.lines[1].players[0].name).toBe("Defensa");
    expect(result.unknown.map((p) => p.name)).toEqual(["Sin posición"]);
    expect(result.lines[3].players).toEqual([]);
  });
  it("calcula proporciones y deja neutros el 0–0 y los datos no numéricos", () => {
    expect(statisticShares("60%", "40%")).toEqual([60, 40]);
    expect(statisticShares("0", "3")).toEqual([0, 100]);
    expect(statisticShares("0", "0")).toBeNull();
    expect(statisticShares("—", "3")).toBeNull();
  });
  it("exporta fecha UTC y recordatorio, escapa texto y pliega UTF-8 sin inyectar campos", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const match = {
      ...demoMatches[0],
      utcDate: "2026-01-02T20:00:00Z",
      home: "Á".repeat(90) + "\nBEGIN:VEVENT,;",
    };
    const file = matchCalendarFile(match, now);
    expect(file).toContain("DTSTART:20260102T200000Z");
    expect(file).toContain("TRIGGER:-PT30M");
    expect(
      file.split("\r\n").filter((line) => line === "BEGIN:VEVENT"),
    ).toHaveLength(1);
    expect(file.replace(/\r\n /g, "")).toContain("\\nBEGIN:VEVENT\\,\\;");
    expect(
      file
        .split("\r\n")
        .every((line) => new TextEncoder().encode(line).length <= 75),
    ).toBe(true);
    expect(canAddMatchToCalendar({ ...match, status: "POSTPONED" }, now)).toBe(
      false,
    );
    expect(() =>
      matchCalendarFile({ ...match, status: "FINISHED" }, now),
    ).toThrow();
    expect(canAddMatchToCalendar(match, Date.parse(match.utcDate))).toBe(false);
  });
});
