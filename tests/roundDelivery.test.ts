import { expect, it } from "vitest";
import {
  roundRequirements,
  requiresDelivery,
  validDeliveredPicks,
  encodeDelivery,
  decodeDelivery,
} from "../src/lib/roundDelivery";
import type { Match } from "../src/lib/domain";
const match = (id: string, utcDate: string, status = "TIMED"): Match => ({
  id,
  utcDate,
  status,
  competition: "CL",
  seasonId: "CL-2026",
  roundId: "r",
  matchday: 1,
  stage: "LEAGUE_STAGE",
  home: "A",
  away: "B",
  homeScore: null,
  awayScore: null,
});
it("la entrega cierra al primer inicio aunque ese partido ya esté jugándose o finalizado", () => {
  const first = match("a", "2026-10-23T19:00:00Z", "FINISHED");
  expect(
    roundRequirements([match("b", "2026-10-24T19:00:00Z"), first]),
  ).toEqual({ matchIds: ["a", "b"], deadline: Date.parse(first.utcDate) });
});
it("los cancelados y aplazados no exigen elección ni fijan una fecha antigua como cierre", () => {
  const a = match("a", "2026-10-20T19:00:00Z", "POSTPONED"),
    b = match("b", "2026-10-21T19:00:00Z", "CANCELLED");
  expect(roundRequirements([a, b])).toEqual({ matchIds: [], deadline: null });
  expect(
    roundRequirements([a, b, match("c", "2026-10-25T19:00:00Z")]).matchIds,
  ).toEqual(["c"]);
});
it("la completitud exige exactamente los partidos oficiales y el tipo de modalidad", () => {
  expect(validDeliveredPicks("classic", ["a", "b"], { a: "1" })).toBe(false);
  expect(validDeliveredPicks("classic", ["a"], { a: "1", extra: "X" })).toBe(
    false,
  );
  expect(
    validDeliveredPicks("classic", ["a"], { a: { home: 1, away: 0 } }),
  ).toBe(false);
  expect(validDeliveredPicks("classic", ["a", "b"], { a: "1", b: "X" })).toBe(
    true,
  );
});
it("valida también todos los marcadores de una jornada de Champions sin aceptar campos añadidos", () => {
  const ids = Array.from({ length: 18 }, (_, i) => String(i));
  const picks = Object.fromEntries(ids.map((id) => [id, { home: 2, away: 1 }]));
  expect(validDeliveredPicks("exact", ids, picks)).toBe(true);
  expect(
    validDeliveredPicks("exact", ["a"], { a: { home: 1, away: 0, points: 3 } }),
  ).toBe(false);
  expect(
    validDeliveredPicks("exact", ["a"], { a: { home: -1, away: 0 } }),
  ).toBe(false);
  expect(validDeliveredPicks("classic", [], {})).toBe(false);
});
it("la nueva puntuación exige entrega en las rondas posteriores al cambio sin alterar las ya iniciadas", () => {
  const games = [match("a", "2026-10-23T19:00:00Z")];
  expect(requiresDelivery(games, "2026-10-23T19:00:00Z")).toBe(true);
  expect(requiresDelivery(games, "2026-10-23T19:00:01Z")).toBe(false);
  expect(requiresDelivery(games)).toBe(false);
});
it("codifica una jornada completa sin perder identidades ni marcadores y permite ambos modos", () => {
  const ids = Array.from({ length: 64 }, (_, i) => String(i));
  const exact = Object.fromEntries(
    ids.map((id) => [id, { home: 99, away: 0 }]),
  );
  expect(decodeDelivery(encodeDelivery("exact", ids, exact))).toEqual(exact);
  expect(
    decodeDelivery(encodeDelivery("classic", ["a", "b"], { a: "1", b: "X" })),
  ).toEqual({ a: "1", b: "X" });
});
it("rechaza entradas codificadas truncadas, duplicadas o con resultados inválidos", () => {
  for (const data of [
    { mode: "classic", matchIds: ["a", "b"], selections: "1" },
    { mode: "exact", matchIds: ["a"], selections: "100:0" },
    { mode: "classic", matchIds: ["a", "a"], selections: "1X" },
    { mode: "classic", matchIds: ["a"], selections: "3" },
  ])
    expect(() => decodeDelivery(data)).toThrow();
});
it("un partido adelantado semanas no cierra la jornada ni entra en su boleto", () => {
  // LaLiga J23: nine games on 7–8 Feb, one brought forward to 2 Dec.
  const games = [
    match("early", "2026-12-02T19:00:00Z"),
    ...Array.from({ length: 9 }, (_, i) => match(`g${i}`, `2027-02-0${7 + (i % 2)}T1${i}:00:00Z`)),
  ];
  const { matchIds, deadline } = roundRequirements(games);
  expect(matchIds).not.toContain("early");
  expect(matchIds).toHaveLength(9);
  expect(deadline).toBe(Date.parse("2027-02-07T10:00:00Z"));
  // Which scoring contract applies is still decided by the very first kick-off.
  expect(requiresDelivery(games, "2026-12-01T00:00:00Z")).toBe(true);
  expect(requiresDelivery(games, "2026-12-03T00:00:00Z")).toBe(false);
});
it("ida y vuelta de una eliminatoria (mitad y mitad) siguen siendo una sola jornada", () => {
  const legs = [
    ...Array.from({ length: 4 }, (_, i) => match(`ida${i}`, `2027-02-1${7 + (i % 2)}T20:00:00Z`)),
    ...Array.from({ length: 4 }, (_, i) => match(`vuelta${i}`, `2027-03-1${0 + (i % 2)}T20:00:00Z`)),
  ];
  expect(roundRequirements(legs).matchIds).toHaveLength(8);
  expect(roundRequirements(legs).deadline).toBe(Date.parse("2027-02-17T20:00:00Z"));
});
