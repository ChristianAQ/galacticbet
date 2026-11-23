import { describe, expect, it } from "vitest";
import {
  decideTie,
  fixturePlan,
  formatAvailability,
  generateFixtures,
  groupPlans,
  leagueQualifierOptions,
  localParts,
  matchesSearch,
  recommendedFormat,
  recurringFixtures,
  resolveCompetition,
  roundRobin,
  searchQueryTerm,
  searchTerms,
  seedOrder,
  splitGroups,
  toAppMatch,
  validateSetup,
  zonedInstant,
  type CompetitionSetup,
  type CustomMatch,
  type Fixture,
  type Participant,
} from "../src/lib/customCompetition";
import { roundOptions } from "../src/lib/roundOptions";

const people = (n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Equipo ${i + 1}`,
    kind: "team",
    userId: null,
    icon: null,
    seed: i,
  }));
const setup = (over: Partial<CompetitionSetup> = {}): CompetitionSetup => ({
  name: "Liga de los sábados",
  sport: "Fútbol 7",
  icon: null,
  participantType: "team",
  format: "league",
  legs: 1,
  knockoutLegs: 1,
  qualifiers: 0,
  groups: 0,
  thirdPlace: false,
  predictionMode: "exact",
  schedule: {
    start: "2026-10-17",
    time: "10:00",
    everyDays: 7,
    slotMinutes: 0,
    location: "Polideportivo",
    timeZone: "Europe/Madrid",
  },
  ...over,
});
const asMatch = (f: Fixture, over: Partial<CustomMatch> = {}): CustomMatch => ({
  ...f,
  status: "scheduled",
  homeScore: null,
  awayScore: null,
  homePenalties: null,
  awayPenalties: null,
  locked: false,
  ...over,
});
const finished = (f: Fixture, home: number, away: number, extra: Partial<CustomMatch> = {}) =>
  asMatch(f, { status: "finished", homeScore: home, awayScore: away, ...extra });
const madrid = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
});

describe("Liga todos contra todos", () => {
  it("cada pareja se enfrenta una vez por vuelta y nadie juega dos veces el mismo día", () => {
    for (const n of [2, 4, 5, 6, 9, 10]) {
      const ids = people(n).map((p) => p.id);
      const rounds = roundRobin(ids, 1);
      expect(rounds).toHaveLength(n % 2 ? n : n - 1);
      const pairs = new Set<string>();
      for (const round of rounds) {
        const playing = round.flat();
        expect(new Set(playing).size).toBe(playing.length);
        // Odd counts: exactly one rests each round.
        expect(playing.length).toBe(n % 2 ? n - 1 : n);
        for (const [h, a] of round) pairs.add([h, a].sort().join("-"));
      }
      expect(pairs.size).toBe((n * (n - 1)) / 2);
    }
  });

  it("ida y vuelta: la segunda vuelta invierte el campo y reparte las localías", () => {
    const ids = people(6).map((p) => p.id);
    const rounds = roundRobin(ids, 2);
    expect(rounds).toHaveLength(10);
    const home = new Map<string, number>();
    for (const [h] of rounds.flat()) home.set(h, (home.get(h) || 0) + 1);
    // Five home games each: every pair hosts once.
    expect([...home.values()]).toEqual([5, 5, 5, 5, 5, 5]);
    expect(rounds[5]).toEqual(rounds[0].map(([h, a]) => [a, h]));
  });

  it("fecha cada jornada el mismo día de la semana y a la misma hora, también tras el cambio de hora", () => {
    const fixtures = generateFixtures(setup(), people(4));
    expect(fixtures).toHaveLength(6);
    // 17, 24 and 31 October 2026 (clocks go back on the 25th).
    const days = [...new Set(fixtures.map((f) => f.startAt))];
    expect(days).toHaveLength(3);
    for (const instant of days) expect(madrid.format(instant)).toBe("sábado, 10:00");
    expect(days[1] - days[0]).toBe(7 * 86400_000);
    expect(days[2] - days[1]).toBe(7 * 86400_000 + 3600_000);
    expect(fixtures.every((f) => f.location === "Polideportivo")).toBe(true);
  });

  it("partidos seguidos en el mismo campo cuando hay minutos entre partidos", () => {
    const fixtures = generateFixtures(setup({ schedule: { ...setup().schedule, slotMinutes: 60 } }), people(4));
    const first = fixtures.filter((f) => f.round === 1).map((f) => madrid.format(f.startAt));
    expect(first).toEqual(["sábado, 10:00", "sábado, 11:00"]);
    // Past midnight rolls over to the next day (still winter time at 00:30).
    expect(zonedInstant("2026-03-28", 23 * 60 + 90, "Europe/Madrid")).toBe(Date.parse("2026-03-28T23:30:00Z"));
    // After the change, 10:00 in Madrid is 08:00 UTC.
    expect(zonedInstant("2026-03-29", 600, "Europe/Madrid")).toBe(Date.parse("2026-03-29T08:00:00Z"));
  });
});

describe("Eliminatorias y formatos combinados", () => {
  it("siembra el cuadro para que los dos mejores solo se crucen en la final", () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const fixtures = generateFixtures(setup({ format: "knockout", thirdPlace: true }), people(8));
    const qf = fixtures.filter((f) => f.stage === "QUARTER_FINALS");
    expect(qf.map((f) => [f.homeId, f.awayId])).toEqual([
      ["p1", "p8"],
      ["p4", "p5"],
      ["p2", "p7"],
      ["p3", "p6"],
    ]);
    const sf = fixtures.filter((f) => f.stage === "SEMI_FINALS");
    expect(sf.map((f) => [f.homeSlot, f.awaySlot])).toEqual([
      ["winner:Q1", "winner:Q2"],
      ["winner:Q3", "winner:Q4"],
    ]);
    const finalDay = fixtures.filter((f) => f.startAt === fixtures.at(-1)!.startAt);
    expect(finalDay.map((f) => f.stage)).toEqual(["THIRD_PLACE", "FINAL"]);
    expect(finalDay[0]).toMatchObject({ homeSlot: "loser:S1", awaySlot: "loser:S2" });
  });

  it("liga de 10 y los 4 primeros a semifinales de ida y vuelta con final a partido único", () => {
    const s = setup({ format: "league_knockout", qualifiers: 4, knockoutLegs: 2, thirdPlace: true });
    const fixtures = generateFixtures(s, people(10));
    expect(fixtures.filter((f) => f.phase === "league")).toHaveLength(45);
    const semis = fixtures.filter((f) => f.stage === "SEMI_FINALS");
    expect(semis.map((f) => [f.tie, f.leg, f.homeSlot, f.awaySlot])).toEqual([
      ["S1", 1, "league:4", "league:1"],
      ["S2", 1, "league:3", "league:2"],
      ["S1", 2, "league:1", "league:4"],
      ["S2", 2, "league:2", "league:3"],
    ]);
    expect(fixtures.filter((f) => f.stage === "FINAL")).toHaveLength(1);
    // 45 league + 4 semi-final legs + third place + final.
    expect(fixturePlan(s, 10)).toMatchObject({ matches: 51, days: 9 + 2 + 1 });
  });

  it("grupos equilibrados y cruces A1–B2 / B1–A2 en mitades opuestas", () => {
    expect(splitGroups(["1", "2", "3", "4", "5", "6", "7", "8"], 2)).toEqual([
      ["1", "4", "5", "8"],
      ["2", "3", "6", "7"],
    ]);
    const s = setup({ format: "groups_knockout", groups: 4, qualifiers: 2 });
    const fixtures = generateFixtures(s, people(12));
    expect(new Set(fixtures.filter((f) => f.phase === "group").map((f) => f.group))).toEqual(
      new Set(["A", "B", "C", "D"]),
    );
    expect(
      fixtures.filter((f) => f.stage === "QUARTER_FINALS").map((f) => `${f.homeSlot} ${f.awaySlot}`),
    ).toEqual([
      "group:A:1 group:B:2",
      "group:C:1 group:D:2",
      "group:B:1 group:A:2",
      "group:D:1 group:C:2",
    ]);
  });

  it("ofrece solo los formatos que encajan con los participantes y recomienda uno", () => {
    expect(formatAvailability(10).knockout).toMatch(/2, 4, 8/);
    expect(formatAvailability(8).knockout).toBeNull();
    expect(leagueQualifierOptions(10)).toEqual([2, 4, 8]);
    expect(groupPlans(10)).toEqual([
      { groups: 2, qualifiers: 1 },
      { groups: 2, qualifiers: 2 },
    ]);
    expect(formatAvailability(5).groups_knockout).toMatch(/6/);
    expect(recommendedFormat(4)).toMatchObject({ format: "league" });
    expect(recommendedFormat(10)).toEqual({ format: "league_knockout", qualifiers: 4, groups: 0 });
    expect(recommendedFormat(16)).toEqual({ format: "groups_knockout", groups: 4, qualifiers: 2 });
  });

  it("valida nombres, duplicados, formato y tamaño del calendario", () => {
    const names = (n: number) => people(n).map((p) => p.name);
    expect(validateSetup(setup(), names(6))).toBeNull();
    expect(validateSetup(setup({ name: "AB" }), names(6))).toMatch(/nombre/);
    expect(validateSetup(setup(), ["Rayo", "rayo", "Sol"])).toMatch(/mismo nombre/);
    expect(validateSetup(setup({ format: "knockout" }), names(6))).toMatch(/2, 4, 8/);
    expect(validateSetup(setup({ format: "league_knockout", qualifiers: 8 }), names(6))).toMatch(/fase final/);
    expect(validateSetup(setup({ legs: 2 }), names(32))).toMatch(/máximo es 500/);
    expect(
      validateSetup(setup({ schedule: { ...setup().schedule, time: "25:00" } }), names(4)),
    ).toMatch(/hora/);
  });

  it("partidos recurrentes: el mismo cruce cada sábado", () => {
    const series = recurringFixtures({
      homeId: "p1",
      awayId: "p2",
      start: "2026-11-07",
      time: "18:30",
      everyDays: 7,
      count: 4,
      location: "Pista 2",
      timeZone: "Europe/Madrid",
      firstRound: 3,
      id: (i) => `R${i}`,
    });
    expect(series.map((f) => f.round)).toEqual([3, 4, 5, 6]);
    expect(series.map((f) => madrid.format(f.startAt))).toEqual(Array(4).fill("sábado, 18:30"));
  });
});

describe("Clasificación y cuadro calculados a partir de los resultados", () => {
  const four = people(4);

  it("tabla con puntos, diferencia y goles; los cancelados y pendientes no cuentan", () => {
    const fixtures = generateFixtures(setup(), four);
    const matches = fixtures.map((f, i) =>
      i === 0 ? finished(f, 2, 0) : i === 1 ? finished(f, 1, 1) : i === 2 ? asMatch(f, { status: "cancelled" }) : asMatch(f),
    );
    const view = resolveCompetition({ format: "league" }, four, matches);
    const table = view.tables[0];
    expect(table.complete).toBe(false);
    expect(table.rows).toHaveLength(4);
    const winner = table.rows[0];
    expect(winner).toMatchObject({ points: 3, played: 1, wins: 1, goalsFor: 2, goalsAgainst: 0 });
    expect(table.rows.reduce((sum, r) => sum + r.played, 0)).toBe(4);
    expect(view.champion).toBeNull();
    // A corrected result simply changes the inputs: nothing accumulates twice.
    const corrected = matches.map((m, i) => (i === 0 ? { ...m, homeScore: 0, awayScore: 3 } : m));
    const again = resolveCompetition({ format: "league" }, four, corrected).tables[0].rows;
    expect(again.reduce((sum, r) => sum + r.points, 0)).toBe(3 + 2);
  });

  it("las plazas del cuadro se llenan al terminar la liga y el campeón sale de la final", () => {
    const s = setup({ format: "league_knockout", qualifiers: 2 });
    const fixtures = generateFixtures(s, four);
    const league = fixtures.filter((f) => f.phase === "league");
    const final = fixtures.find((f) => f.stage === "FINAL")!;
    // p1 wins every league match, p2 is second.
    const scores = (f: Fixture) =>
      f.homeId === "p1" || f.awayId === "p1"
        ? f.homeId === "p1" ? [3, 0] : [0, 3]
        : f.homeId === "p2" ? [2, 0] : f.awayId === "p2" ? [0, 2] : [1, 1];
    const partial = [...league.slice(0, -1).map((f) => finished(f, ...(scores(f) as [number, number]))), asMatch(league.at(-1)!), asMatch(final)];
    const waiting = resolveCompetition(s, four, partial).matches.find((m) => m.stage === "FINAL")!;
    expect(waiting.home).toMatchObject({ pending: true, name: "1.º de la liga" });
    const done = [...league.map((f) => finished(f, ...(scores(f) as [number, number]))), finished(final, 1, 1, { homePenalties: 4, awayPenalties: 5 })];
    const view = resolveCompetition(s, four, done);
    const decided = view.matches.find((m) => m.stage === "FINAL")!;
    expect([decided.home.id, decided.away.id]).toEqual(["p1", "p2"]);
    expect(view.ties.F.winner).toBe("p2");
    expect(view.champion?.name).toBe("Equipo 2");
    const app = toAppMatch("c1", decided);
    expect(app).toMatchObject({ scoreDuration: "PENALTY_SHOOTOUT", winner: "2", home: "Equipo 1" });
  });

  it("eliminatoria a doble partido: global, penaltis en la vuelta y vuelta cancelada", () => {
    const s = setup({ format: "knockout", knockoutLegs: 2 });
    const fixtures = generateFixtures(s, four);
    const [s1ida, s1vuelta] = fixtures.filter((f) => f.tie === "S1").sort((a, b) => a.leg! - b.leg!);
    expect([s1ida.homeId, s1vuelta.homeId]).toEqual(["p4", "p1"]);
    const legs = (ida: [number, number], vuelta: [number, number], extra: Partial<CustomMatch> = {}) =>
      resolveCompetition(s, four, [finished(s1ida, ...ida), finished(s1vuelta, ...vuelta, extra)]).ties.S1;
    // p4 2-1 p1, then p1 3-1 p4: p1 through 4-3.
    expect(legs([2, 1], [3, 1])).toMatchObject({ winner: "p1", loser: "p4" });
    // 2-1 then 1-0: 2-2 overall, p4 wins on penalties in the return leg.
    expect(legs([2, 1], [1, 0], { homePenalties: 3, awayPenalties: 4 })).toMatchObject({ winner: "p4" });
    expect(legs([2, 1], [1, 0]).winner).toBeNull();
    const cancelled = resolveCompetition(s, four, [finished(s1ida, 2, 1), asMatch(s1vuelta, { status: "cancelled" })]);
    expect(cancelled.ties.S1.winner).toBeNull();
    expect(decideTie([])).toEqual({ winner: null, loser: null, aggregate: null });
  });

  it("se muestra como cualquier otra jornada en el selector de rondas", () => {
    const s = setup({ format: "league_knockout", qualifiers: 2 });
    const view = resolveCompetition(s, four, generateFixtures(s, four).map((f) => asMatch(f)));
    const rounds = roundOptions(view.matches.map((m) => toAppMatch("c1", m)));
    expect(rounds.map((r) => r.short)).toEqual(["J1", "J2", "J3", "Final"]);
  });

  it("un amistoso en una liga va en su propia jornada, no se mezcla con la J1", () => {
    const s = setup();
    const league = generateFixtures(s, four).map((f) => asMatch(f));
    const [friendly] = recurringFixtures({
      homeId: "p1",
      awayId: "p2",
      start: "2026-11-07",
      time: "18:30",
      everyDays: 7,
      count: 1,
      location: "",
      timeZone: "Europe/Madrid",
      firstRound: 1,
      id: () => "amistoso",
    });
    const view = resolveCompetition(s, four, [...league, asMatch(friendly)]);
    const rounds = roundOptions(view.matches.map((m) => toAppMatch("c1", m)));
    expect(rounds.find((r) => r.id === "c1:J1")?.matches).toBe(2);
    expect(rounds.find((r) => r.id === "c1:A1")).toMatchObject({ short: "Amist. 1", matches: 1 });
    // In a custom tournament its own matches are the rounds.
    const custom = resolveCompetition({ format: "custom" }, four, [asMatch(friendly)]);
    expect(roundOptions(custom.matches.map((m) => toAppMatch("c1", m)))[0]).toMatchObject({ id: "c1:J1", short: "J1" });
  });
});

it("las fechas se editan en la hora local de la competición", () => {
  const instant = zonedInstant("2026-10-31", 600, "Europe/Madrid");
  expect(localParts(instant, "Europe/Madrid")).toEqual({ date: "2026-10-31", time: "10:00" });
  expect(localParts(instant, "America/Mexico_City").time).toBe("03:00");
});

it("en un torneo personalizado la tabla sale de sus propios partidos", () => {
  const two = people(2);
  const [first] = recurringFixtures({
    homeId: "p1",
    awayId: "p2",
    start: "2026-11-07",
    time: "18:30",
    everyDays: 7,
    count: 1,
    location: "",
    timeZone: "Europe/Madrid",
    firstRound: 1,
    id: () => "m1",
  });
  const view = resolveCompetition({ format: "custom" }, two, [finished(first, 0, 2)]);
  expect(view.tables[0].rows.map((r) => [r.name, r.points])).toEqual([
    ["Equipo 2", 3],
    ["Equipo 1", 0],
  ]);
});

describe("búsqueda de ligas públicas", () => {
  it("se encuentran por el principio de cualquier palabra, sin tildes ni mayúsculas", () => {
    const terms = searchTerms("Liga de Pádel", "Pádel");
    for (const t of ["l", "lig", "liga", "de", "pa", "padel"]) expect(terms).toContain(t);
    expect(terms).not.toContain("adel");
    expect(new Set(terms).size).toBe(terms.length);
    expect(searchTerms("Supercalifragilisticoespialidoso")).toHaveLength(15);
    expect(searchTerms("a ".repeat(50) + "b".repeat(200)).length).toBeLessThanOrEqual(120);
  });
  it("pide a la base la palabra más larga y filtra por todas", () => {
    expect(searchQueryTerm("  liga PÁDEL ")).toBe("padel");
    expect(searchQueryTerm("")).toBe("");
    expect(matchesSearch("pad lig", "Liga de Pádel")).toBe(true);
    expect(matchesSearch("tenis", "Liga de Pádel", "Pádel")).toBe(false);
    expect(matchesSearch("fut", "Los sábados", "Fútbol 7")).toBe(true);
    expect(matchesSearch("", "Cualquiera")).toBe(true);
  });
});
