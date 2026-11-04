import { expect, it } from "vitest";
import {
  buildRanking,
  rankingRounds,
  type SeasonRanking,
} from "../src/lib/rankings";
import type { Match } from "../src/lib/domain";

const participants = [
  { id: "ana", name: "Ana", avatar: null },
  { id: "bea", name: "Bea", avatar: "avatar.png" },
  { id: "carlos", name: "Carlos", avatar: null },
];
it("excluye puntos históricos de Copa del total global sin borrar los registros", () => {
  const archived: SeasonRanking = {
    id: "CDR-2026",
    competition: "CDR",
    standings: [{ id: "ana", points: 100, hits: 30, rounds: {} }],
  };
  expect(
    buildRanking(participants, [archived], "global").every(
      (row) => row.points === 0,
    ),
  ).toBe(true);
  expect(archived.standings[0].points).toBe(100);
  expect(rankingRounds([archived], [], "global")).toEqual([]);
});
const r1 = "PD-2026-REGULAR_SEASON-1";
const r2 = "PD-2026-REGULAR_SEASON-2";
const clRound = "CL-2026-LEAGUE_STAGE-1";
const seasons: SeasonRanking[] = [
  {
    id: "PD-2026",
    competition: "PD",
    standings: [
      {
        id: "ana",
        points: 4,
        hits: 4,
        rounds: { [r1]: { points: 1, hits: 1 }, [r2]: { points: 3, hits: 3 } },
      },
      {
        id: "bea",
        points: 1,
        hits: 1,
        rounds: { [r1]: { points: 1, hits: 1 } },
      },
      { id: "former", points: 99, hits: 99, rounds: {} },
    ],
  },
  {
    id: "CL-2026",
    competition: "CL",
    standings: [
      {
        id: "bea",
        points: 3,
        hits: 1,
        rounds: { [clRound]: { points: 3, hits: 1 } },
      },
    ],
  },
];

it("muestra todos los participantes con cero antes de la primera sincronización", () => {
  expect(buildRanking(participants, [], "global")).toEqual(
    participants.map((p) => ({ ...p, points: 0, hits: 0, position: 1 })),
  );
});
it("suma los totales de backend y excluye antiguos miembros, conservando nombres y avatares", () => {
  expect(buildRanking(participants, seasons, "global")).toEqual([
    { ...participants[0], points: 4, hits: 4, position: 1 },
    { ...participants[1], points: 4, hits: 2, position: 1 },
    { ...participants[2], points: 0, hits: 0, position: 3 },
  ]);
});
it("distingue el acumulado por competición y las jornadas individuales sin arrastrar puntos", () => {
  expect(
    buildRanking(participants, seasons, "PD").map((r) => r.points),
  ).toEqual([4, 1, 0]);
  expect(
    buildRanking(participants, seasons, "PD", r2).map((r) => r.points),
  ).toEqual([3, 0, 0]);
  expect(
    buildRanking(participants, seasons, "global", clRound).map((r) => [
      r.id,
      r.points,
    ]),
  ).toEqual([
    ["bea", 3],
    ["ana", 0],
    ["carlos", 0],
  ]);
  expect(
    buildRanking(participants, seasons, "CL", r1).every((r) => r.points === 0),
  ).toBe(true);
});
it("una jornada futura tiene todos los miembros a cero y mantiene los empates", () => {
  expect(
    buildRanking(
      participants,
      seasons,
      "PD",
      "PD-2026-REGULAR_SEASON-10",
    ).every((r) => r.points === 0 && r.hits === 0 && r.position === 1),
  ).toBe(true);
});
it("incluye jornadas sin resultados del calendario activo y conserva el historial puntuado", () => {
  const fixture = (roundId: string, utcDate: string): Match => ({
    id: roundId,
    roundId,
    competition: "PD",
    seasonId: "PD-2026",
    utcDate,
    stage: "REGULAR_SEASON",
    matchday: 10,
    status: "TIMED",
    home: "A",
    away: "B",
    homeScore: null,
    awayScore: null,
  });
  const r10 = "PD-2026-REGULAR_SEASON-10";
  const calendar = [
    fixture(r10, "2026-11-01T16:00:00Z"),
    fixture(r2, "2026-09-01T16:00:00Z"),
    fixture(r10, "2026-11-01T12:00:00Z"),
    {
      ...fixture("PD-2025-REGULAR_SEASON-1", "2025-09-01T12:00:00Z"),
      seasonId: "PD-2025",
    },
  ];
  const rounds = rankingRounds(seasons, calendar, "PD");
  expect(rounds.map((r) => r.id)).toEqual([r2, r10, r1]);
  expect(rounds[1]).toMatchObject({
    kickoff: "2026-11-01T12:00:00Z",
    label: "LaLiga · Jornada 10 · 2026/27",
  });
  expect(rankingRounds(seasons, calendar, "CL").map((r) => r.id)).toEqual([
    clRound,
  ]);
  expect(rankingRounds([], calendar, "global")).toEqual([]);
});

it("elige la jornada en juego antes que la siguiente, incluso sin partidos futuros en esa jornada", async () => {
  const { currentRankingRound } = await import("../src/lib/rankings");
  const now = Date.parse("2026-10-23T20:00:00Z");
  const base: Match = {
    id: "1",
    competition: "PD",
    seasonId: "PD-2026",
    roundId: r1,
    matchday: 1,
    stage: "REGULAR_SEASON",
    utcDate: "2026-10-23T19:00:00Z",
    status: "IN_PLAY",
    home: "A",
    away: "B",
    homeScore: null,
    awayScore: null,
  };
  const next = {
    ...base,
    id: "2",
    roundId: r2,
    utcDate: "2026-10-30T19:00:00Z",
    status: "TIMED",
  };
  expect(currentRankingRound([next, base], [r1, r2], now)).toBe(r1);
  expect(
    currentRankingRound(
      [next, { ...base, status: "FINISHED", homeScore: 1, awayScore: 0 }],
      [r1, r2],
      now,
    ),
  ).toBe(r2);
  expect(
    currentRankingRound([{ ...base, status: "TIMED" }, next], [r1, r2], now),
  ).toBe(r1);
});
it("usa el último resultado cuando acaba el calendario y omite rondas fuera de la competición", async () => {
  const { currentRankingRound } = await import("../src/lib/rankings");
  const base: Match = {
    id: "1",
    competition: "PD",
    seasonId: "PD-2026",
    roundId: r1,
    matchday: 1,
    stage: "REGULAR_SEASON",
    utcDate: "2026-10-01T19:00:00Z",
    status: "FINISHED",
    home: "A",
    away: "B",
    homeScore: 1,
    awayScore: 0,
  };
  const newer = {
    ...base,
    id: "2",
    roundId: r2,
    utcDate: "2026-10-08T19:00:00Z",
  };
  const cl = {
    ...base,
    id: "3",
    roundId: clRound,
    status: "IN_PLAY",
    utcDate: "2026-10-09T19:00:00Z",
  };
  expect(
    currentRankingRound(
      [base, newer, cl],
      [r1, r2],
      Date.parse("2026-10-10T19:00:00Z"),
    ),
  ).toBe(r2);
  expect(
    currentRankingRound(
      [base, { ...newer, status: "POSTPONED" }],
      [r1, r2],
      Date.parse("2026-10-10T19:00:00Z"),
    ),
  ).toBe(r1);
  expect(currentRankingRound([], [])).toBe("");
});

it("oculta aciertos solo cuando todas las temporadas de la vista son clásicas", async () => {
  const { isClassicRanking } = await import("../src/lib/rankings");
  const configs: SeasonRanking[] = [
    { id: "PD-2026", competition: "PD", mode: "classic", standings: [] },
    { id: "CL-2026", competition: "CL", mode: "exact", standings: [] },
    { id: "CDR-2026", competition: "CDR", mode: "exact", standings: [] },
  ];
  expect(isClassicRanking(configs, "PD")).toBe(true);
  expect(isClassicRanking(configs, "PD", r1)).toBe(true);
  expect(isClassicRanking(configs, "CL")).toBe(false);
  expect(isClassicRanking(configs, "global")).toBe(false);
  expect(
    isClassicRanking(
      configs.map((s) => ({ ...s, mode: "classic" })),
      "global",
    ),
  ).toBe(true);
  expect(isClassicRanking([configs[0], configs[2]], "global")).toBe(true);
  expect(isClassicRanking([], "PD")).toBe(false);
  expect(isClassicRanking([{ ...configs[0], mode: undefined }], "PD")).toBe(
    false,
  );
});
it("determina la modalidad de la jornada sin confundir temporadas históricas", async () => {
  const { isClassicRanking } = await import("../src/lib/rankings");
  const configs: SeasonRanking[] = [
    { id: "PD-2025", competition: "PD", mode: "exact", standings: [] },
    { id: "PD-2026", competition: "PD", mode: "classic", standings: [] },
  ];
  expect(isClassicRanking(configs, "PD", r1)).toBe(true);
  expect(isClassicRanking(configs, "PD")).toBe(false);
  expect(isClassicRanking(configs, "PD", "PD-2027-REGULAR_SEASON-1")).toBe(
    false,
  );
});
