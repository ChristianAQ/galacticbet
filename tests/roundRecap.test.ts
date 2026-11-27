import { describe, expect, it } from "vitest";
import type { Match } from "../src/lib/domain";
import { rarestHit, recapHighlights, recapText, roundRecap } from "../src/lib/roundRecap";
import type { SeasonRanking } from "../src/lib/rankings";

const R = (n: number) => `PD-2026-REGULAR_SEASON-${n}`;
const people = [
  { id: "ana", name: "Ana", avatar: null },
  { id: "bruno", name: "Bruno", avatar: null },
  { id: "carla", name: "Carla", avatar: null },
  { id: "dani", name: "Dani", avatar: null },
];
// Points per round for each player (rounds 1..4).
const table: Record<string, number[]> = {
  ana: [3, 2, 1, 2],
  bruno: [0, 1, 0, 5],
  carla: [4, 4, 4, 0],
  dani: [1, 0, 2, 2],
};
const seasons: SeasonRanking[] = [
  {
    id: "PD-2026",
    competition: "PD",
    mode: "classic",
    standings: Object.entries(table).map(([id, points]) => ({
      id,
      points: points.reduce((a, b) => a + b, 0),
      hits: points.reduce((a, b) => a + b, 0),
      rounds: Object.fromEntries(points.map((p, i) => [R(i + 1), { points: p, hits: p }])),
    })),
  },
];
const fixture = (id: string, home: number, away: number): Match => ({
  id,
  competition: "PD",
  seasonId: "PD-2026",
  roundId: R(4),
  matchday: 4,
  stage: "REGULAR_SEASON",
  utcDate: "2026-11-01T18:00:00Z",
  status: "FINISHED",
  home: `Local ${id}`,
  away: `Visitante ${id}`,
  homeScore: home,
  awayScore: away,
});
const fixtures = [1, 2, 3, 4, 5].map((n) => fixture(String(n), n % 2, 0));
const recap = (roundId: string, userId = "ana") =>
  roundRecap({
    participants: people,
    seasons,
    scope: "PD",
    roundIds: [1, 2, 3, 4].map(R),
    roundId,
    userId,
    fixtures,
  });

describe("Resumen de la jornada", () => {
  it("ganador, tu jornada y tu puesto en la general antes y después", () => {
    const r = recap(R(4))!;
    expect(r.winners.map((w) => w.name)).toEqual(["Bruno"]);
    expect(r.best).toBe(5);
    // Ana: 2 pts (2.º de la jornada, empatada con Dani), 1.º→... general.
    expect(r.me).toEqual({ points: 2, roundPosition: 2, seasonPosition: 2, moved: 0 });
    expect(r.season.map((s) => [s.name, s.points])).toEqual([
      ["Carla", 12],
      ["Ana", 8],
      ["Bruno", 6],
      ["Dani", 5],
    ]);
    // Bruno 4.º→3.º: one place only, not a headline climb.
    expect(r.climber).toBeNull();
    expect(r.perfect.map((p) => p.name)).toEqual(["Bruno"]);
    expect(r.blank.map((b) => b.name)).toEqual(["Carla"]);
  });

  it("un partido adelantado semanas no está en el boleto: no impide el pleno", () => {
    const early = { ...fixture("6", 2, 2), utcDate: "2026-09-20T18:00:00Z" };
    const r = roundRecap({
      participants: people,
      seasons,
      scope: "PD",
      roundIds: [1, 2, 3, 4].map(R),
      roundId: R(4),
      userId: "ana",
      fixtures: [...fixtures, early],
    })!;
    expect(r.perfect.map((p) => p.name)).toEqual(["Bruno"]);
  });

  it("rachas vivas de 3 o más jornadas y jornadas sin puntos", () => {
    // Ana and Carla both have three in a row by round 3.
    expect(recap(R(3))!.streak).toMatchObject({ rounds: 3 });
    // Carla broke hers in round 4; Ana has 4 in a row.
    expect(recap(R(4))!.streak).toEqual({ name: "Ana", id: "ana", rounds: 4 });
    const empty = roundRecap({
      participants: people,
      seasons: [{ ...seasons[0], standings: seasons[0].standings.map((s) => ({ ...s, rounds: {} })) }],
      scope: "PD",
      roundIds: [R(1)],
      roundId: R(1),
      userId: "ana",
      fixtures: [],
    });
    expect(empty).toBeNull();
  });

  it("el acierto más raro sale de los boletos sellados", () => {
    const entries = {
      ana: { "1": "1", "2": "X" },
      bruno: { "1": "1", "2": "2" },
      carla: { "1": "1", "2": "2" },
      dani: { "1": "X", "2": "1" },
    } as const;
    const names = new Map(people.map((p) => [p.id, p.name]));
    const two = [fixture("1", 1, 0), fixture("2", 0, 0)];
    const rare = rarestHit("classic", two, entries, names)!;
    expect(rare.names).toEqual(["Ana"]);
    expect(rare.pick).toBe("X");
    const lines = recapHighlights(recap(R(4))!, rare);
    expect(lines.map((l) => l.kind)).toEqual(["rare", "perfect", "streak", "blank"]);
    expect(lines[0].text).toBe("Solo Ana acertó el X del Local 2–Visitante 2.");
    const text = recapText({
      groupName: "Los del barrio",
      title: "LaLiga · Jornada 4",
      recap: recap(R(4))!,
      highlights: lines,
    });
    expect(text).toContain("🏆 LaLiga · Jornada 4 · Los del barrio");
    expect(text).toContain("Ganó Bruno con 5 puntos.");
    expect(text).toContain("📊 La jornada\n1. Bruno · 5 pts");
    // Nobody alone: no rare hit.
    expect(rarestHit("classic", [fixture("1", 1, 0)], entries, names)).toBeNull();
  });

  it("subidas grandes en la general", () => {
    const climb: SeasonRanking[] = [
      {
        ...seasons[0],
        standings: [
          ...seasons[0].standings.filter((s) => s.id !== "bruno"),
          { id: "bruno", points: 13, hits: 13, rounds: { [R(1)]: { points: 0, hits: 0 }, [R(2)]: { points: 1, hits: 1 }, [R(3)]: { points: 0, hits: 0 }, [R(4)]: { points: 12, hits: 12 } } },
        ],
      },
    ];
    const r = roundRecap({ participants: people, seasons: climb, scope: "PD", roundIds: [1, 2, 3, 4].map(R), roundId: R(4), userId: "bruno", fixtures })!;
    expect(r.climber).toEqual({ name: "Bruno", id: "bruno", places: 3 });
    expect(r.me?.moved).toBe(3);
  });
});

it("en la tarjeta te habla a ti; el texto compartido nombra a todos", () => {
  const r = roundRecap({
    participants: people,
    seasons,
    scope: "PD",
    roundIds: [1, 2, 3, 4].map(R),
    roundId: R(4),
    userId: "ana",
    fixtures,
  })!;
  const rare = { match: fixture("2", 0, 0), pick: "X", ids: ["ana"], names: ["Ana"] };
  const mine = recapHighlights(r, rare, "ana").map((l) => l.text);
  expect(mine).toContain("Solo tú acertaste el X del Local 2–Visitante 2.");
  expect(mine).toContain("Llevas 4 jornadas seguidas puntuando.");
  const shared = recapHighlights(r, rare).map((l) => l.text);
  expect(shared).toContain("Solo Ana acertó el X del Local 2–Visitante 2.");
  expect(shared).toContain("Ana lleva 4 jornadas seguidas puntuando.");
  expect(recapHighlights(r, null, "bruno").map((l) => l.text)).toContain(
    "¡Pleno! Acertaste todos los partidos.",
  );
  expect(recapHighlights(r, null, "carla").map((l) => l.text)).toContain(
    "Te quedaste en blanco esta vez.",
  );
});
