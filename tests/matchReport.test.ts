import { describe, expect, it } from "vitest";
import type { MatchEvent, ResolvedMatch } from "../src/lib/customCompetition";
import {
  applyEvents,
  decodeEvents,
  decodeLineups,
  decodeSquad,
  parseSquadList,
  reportLineups,
  reportRankings,
  reportTimeline,
  suggestedMinute,
} from "../src/lib/matchReport";

const goal = (id: string, side: "home" | "away", minute: number, over: Partial<MatchEvent> = {}): MatchEvent => ({
  id,
  kind: "goal",
  side,
  minute,
  extra: null,
  player: `Jugador ${id}`,
  playerId: `j-${id}`,
  other: null,
  otherId: null,
  ...over,
});

describe("acta del partido: el marcador sigue a los goles", () => {
  const live = { status: "live" as const, homeScore: 0, awayScore: 0, events: [] as MatchEvent[] };

  it("en directo, cada gol sube el marcador de su equipo (también en propia)", () => {
    const one = applyEvents(live, [goal("a", "home", 10)]);
    expect(one).toMatchObject({ status: "live", homeScore: 1, awayScore: 0 });
    const two = applyEvents({ ...live, ...one }, [...one.events, goal("b", "away", 20, { kind: "own-goal" })]);
    expect(two).toMatchObject({ homeScore: 1, awayScore: 1 });
  });

  it("poner goleadores a un resultado ya anotado no lo cambia", () => {
    const manual = { status: "finished" as const, homeScore: 2, awayScore: 1, events: [] as MatchEvent[] };
    const first = applyEvents(manual, [goal("a", "home", 10)]);
    expect(first).toMatchObject({ status: "finished", homeScore: 2, awayScore: 1 });
    const all = applyEvents({ ...manual, events: first.events }, [...first.events, goal("b", "home", 30), goal("c", "away", 50)]);
    expect(all).toMatchObject({ homeScore: 2, awayScore: 1 });
    // A goal beyond the score raises it.
    const more = applyEvents({ ...manual, events: all.events }, [...all.events, goal("d", "home", 80)]);
    expect(more).toMatchObject({ homeScore: 3, awayScore: 1 });
  });

  it("borrar un gol baja el marcador solo si el marcador eran justo esos goles", () => {
    const events = [goal("a", "home", 10), goal("b", "home", 30)];
    const exact = { status: "live" as const, homeScore: 2, awayScore: 0, events };
    expect(applyEvents(exact, [events[0]])).toMatchObject({ homeScore: 1 });
    const byHand = { ...exact, homeScore: 4 };
    expect(applyEvents(byHand, [events[0]])).toMatchObject({ homeScore: 4 });
    // Moving a goal to the other side moves the point.
    expect(applyEvents(exact, [events[0], { ...events[1], side: "away" }])).toMatchObject({ homeScore: 1, awayScore: 1 });
  });

  it("anotar en un partido sin empezar lo pone en juego desde 0–0; las tarjetas no puntúan", () => {
    const scheduled = { status: "scheduled" as const, homeScore: null, awayScore: null, events: [] };
    const card: MatchEvent = { ...goal("y", "away", 5), kind: "yellow-card" };
    expect(applyEvents(scheduled, [card])).toMatchObject({ status: "live", homeScore: 0, awayScore: 0 });
    expect(applyEvents(scheduled, [])).toMatchObject({ status: "scheduled", homeScore: null, awayScore: null });
  });

  it("propone el minuto del reloj en directo, o el último anotado", () => {
    const start = Date.parse("2026-11-28T10:00:00Z");
    expect(suggestedMinute({ status: "live", startAt: start, events: [] }, start + 37.5 * 60_000)).toBe(38);
    expect(suggestedMinute({ status: "finished", startAt: start, events: [goal("a", "home", 71)] })).toBe(71);
    expect(suggestedMinute({ status: "finished", startAt: start, events: [] })).toBeNull();
  });
});

describe("acta del partido: lectura y presentación", () => {
  it("descarta lo que no tiene forma de evento, jugador o alineación", () => {
    expect(
      decodeEvents([
        goal("a", "home", 10),
        { ...goal("b", "home", 20), player: "" },
        { ...goal("c", "home", 20), kind: "yellow-card", player: "" },
        { ...goal("d", "home", 999) },
        { ...goal("e", "left" as "home", 5) },
        "basura",
      ]).map((e) => [e.id, e.player]),
    ).toEqual([
      ["a", "Jugador a"],
      ["b", ""],
    ]);
    expect(decodeSquad([{ id: "j1", name: " Ana ", number: 7, position: "DEL" }, { id: "j1", name: "Copia" }, { name: "Sin id" }])).toEqual([
      { id: "j1", name: "Ana", number: 7, position: "DEL" },
    ]);
    expect(decodeLineups({ home: [{ id: "j1", name: "Ana", number: 100, position: "X", starter: true }] })).toEqual({
      home: [{ id: "j1", name: "Ana", number: null, position: null, starter: true }],
      away: [],
    });
    expect(decodeLineups({ home: [], away: [] })).toBeNull();
  });

  it("se dibuja con la línea de tiempo y el campo de los partidos oficiales", () => {
    const sub: MatchEvent = { ...goal("s", "away", 60), kind: "substitution", player: "Entra", other: "Sale" };
    const { goals, incidents } = reportTimeline([goal("a", "home", 45, { extra: 2, other: "Asistente" }), sub]);
    expect(goals).toEqual([
      { id: "a", minute: "45+2'", scorer: "Jugador a", side: "home", kind: "goal", assist: "Asistente" },
    ]);
    expect(incidents).toEqual([
      { id: "s", minute: "60'", side: "away", kind: "substitution", player: "Entra", playerOut: "Sale" },
    ]);
    expect(
      reportLineups({ home: [{ id: "j1", name: "Ana", number: 1, position: "POR", starter: true }], away: [] }),
    ).toEqual([{ side: "home", players: [{ name: "Ana", number: "1", position: "POR", starter: true }] }]);
  });

  it("pegar una lista: dorsal y posición opcionales, delante o detrás", () => {
    expect(parseSquadList("1 Juan García POR\n4. Luis Martín (defensa)\nAna Ruiz - 10\nDEL 9 Pedro\n\n  ")).toEqual([
      { name: "Juan García", number: 1, position: "POR" },
      { name: "Luis Martín", number: 4, position: "DEF" },
      { name: "Ana Ruiz", number: 10, position: null },
      { name: "Pedro", number: 9, position: "DEL" },
    ]);
  });

  it("goleadores, asistencias y tarjetas de toda la competición", () => {
    const side = (id: string, name: string) => ({ id, name, icon: null, pending: false });
    const match = (id: string, events: MatchEvent[]) =>
      ({ id, home: side("p1", "Rayo"), away: side("p2", "Sol"), events }) as unknown as ResolvedMatch;
    const rankings = reportRankings({
      matches: [
        match("m1", [goal("a", "home", 10, { player: "Ana", playerId: "ana", other: "Bea", otherId: "bea" })]),
        match("m2", [
          goal("b", "home", 5, { player: "Ana", playerId: "ana" }),
          goal("c", "away", 7, { kind: "own-goal", player: "Ana", playerId: "ana" }),
          { ...goal("d", "away", 9, { player: "Carla", playerId: "carla" }), kind: "second-yellow" },
        ]),
      ],
    });
    expect(rankings.scorers).toEqual([{ key: "p1:ana", name: "Ana", team: "Rayo", value: 2 }]);
    expect(rankings.assists.map((r) => [r.name, r.value])).toEqual([["Bea", 1]]);
    expect(rankings.red.map((r) => [r.name, r.team, r.value])).toEqual([["Carla", "Sol", 1]]);
    expect(rankings.yellow).toEqual([]);
  });
});
