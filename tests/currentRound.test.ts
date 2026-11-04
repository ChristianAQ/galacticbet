import { describe, expect, it } from "vitest";
import { preferredRound, isRoundComplete, type Match } from "../src/lib/domain";
import { roundOptions } from "../src/lib/roundOptions";
import { currentRankingRound } from "../src/lib/rankings";

const now = Date.parse("2026-11-04T20:30:00Z");
function calendar(competition: "PD" | "CL" | "PL") {
  const stage = competition === "CL" ? "LEAGUE_STAGE" : "REGULAR_SEASON";
  const make = (
    id: string,
    matchday: number,
    utcDate: string,
    extra: Partial<Match> = {},
  ): Match => ({
    id,
    competition,
    seasonId: `${competition}-2026`,
    roundId: `${competition}-2026-${stage}-${matchday}`,
    stage,
    matchday,
    utcDate,
    status: "TIMED",
    home: "Local",
    away: "Visitante",
    homeScore: null,
    awayScore: null,
    ...extra,
  });
  return [
    make("next", 5, "2026-11-25T20:00:00Z"),
    make("last", 4, "2026-11-04T20:00:00Z", {
      status: "IN_PLAY",
      homeScore: 1,
      awayScore: 0,
    }),
    make("tuesday", 4, "2026-11-03T20:00:00Z", {
      status: "FINISHED",
      homeScore: 2,
      awayScore: 1,
    }),
    make("early", 4, "2026-11-04T17:45:00Z", {
      status: "FINISHED",
      homeScore: 0,
      awayScore: 0,
    }),
  ];
}

describe.each(["PD", "CL", "PL"] as const)(
  "jornada actual de %s",
  (competition) => {
    it("conserva J4 con todos los horarios ya iniciados y avanza solo al publicar el último marcador", () => {
      const matches = calendar(competition);
      const current = matches[1].roundId;
      const next = matches[0].roundId;
      expect(preferredRound(matches, now)).toBe(current);
      expect(currentRankingRound(matches, [current, next], now)).toBe(current);
      expect(
        roundOptions(matches, now).find((r) => r.id === current)?.state,
      ).toBe("live");
      const finished = matches.map((m) =>
        m.id === "last"
          ? { ...m, status: "FINISHED", homeScore: 0, awayScore: 0 }
          : m,
      );
      expect(preferredRound(finished, now)).toBe(next);
      expect(currentRankingRound(finished, [current, next], now)).toBe(next);
      expect(
        roundOptions(finished, now).find((r) => r.id === current)?.state,
      ).toBe("finished");
    });
    it("mantiene J4 entre el martes y el miércoles, aunque no haya encuentros en directo", () => {
      const matches = calendar(competition).map((m) =>
        m.id === "last"
          ? { ...m, status: "TIMED", homeScore: null, awayScore: null }
          : m,
      );
      const between = Date.parse("2026-11-04T10:00:00Z");
      expect(preferredRound(matches, between)).toBe(matches[1].roundId);
      expect(
        currentRankingRound(
          matches,
          matches.map((m) => m.roundId),
          between,
        ),
      ).toBe(matches[1].roundId);
    });
    it("espera resultados incompletos o retrasados sin caducar a las tres horas", () => {
      const matches = calendar(competition);
      const current = matches[1].roundId;
      for (const extra of [
        { status: "FINISHED", homeScore: null, awayScore: null },
        { status: "FINISHED", homeScore: 1, awayScore: null },
        { status: "FINISHED", homeScore: NaN, awayScore: 0 },
        { status: "TIMED" },
        { status: "SCHEDULED" },
        { status: "PAUSED" },
        { status: "SUSPENDED" },
      ]) {
        const waiting = matches.map((m) =>
          m.id === "last" ? { ...m, ...extra } : m,
        );
        const later = now + 24 * 3600000;
        expect(preferredRound(waiting, later)).toBe(current);
        expect(
          currentRankingRound(waiting, [current, matches[0].roundId], later),
        ).toBe(current);
        expect(
          roundOptions(waiting, later).find((r) => r.id === current)?.state,
        ).not.toBe("finished");
      }
    });
    it("no cambia al alcanzar el inicio del último partido ni depende del orden del calendario", () => {
      const matches = calendar(competition).map((m) =>
        m.id === "last" ? { ...m, status: "TIMED" } : m,
      );
      const kickoff = Date.parse(matches[1].utcDate);
      const original = JSON.stringify(matches);
      for (const time of [kickoff - 1, kickoff, kickoff + 1]) {
        expect(preferredRound(matches, time)).toBe(matches[1].roundId);
        expect(preferredRound([...matches].reverse(), time)).toBe(
          matches[1].roundId,
        );
      }
      expect(JSON.stringify(matches)).toBe(original);
    });
  },
);

it("no confunde temporadas históricas ni eliminatorias con la fase liga", () => {
  const matches = calendar("CL");
  const old = {
    ...matches[1],
    id: "old",
    seasonId: "CL-2025",
    roundId: "CL-2025-LEAGUE_STAGE-1",
    utcDate: "2025-09-01T19:00:00Z",
  };
  expect(preferredRound([old, ...matches], now)).toBe(matches[1].roundId);
  const knockout = matches.map((m) => ({
    ...m,
    stage: "LAST_16",
    roundId: m.id === "next" ? "CL-2026-QUARTER_FINALS-1" : "CL-2026-LAST_16-1",
    matchday: 1,
  }));
  expect(preferredRound(knockout, now)).toBe("CL-2026-LAST_16-1");
});
it("un aplazado sigue pendiente dentro de una jornada iniciada; cancelaciones y adjudicaciones no exigen resultado jugado", () => {
  const matches = calendar("CL").filter((m) => m.matchday === 4);
  const postponed = matches.map((m) =>
    m.id === "last" ? { ...m, status: "POSTPONED" } : m,
  );
  expect(isRoundComplete(postponed)).toBe(false);
  expect(
    preferredRound(
      [...calendar("CL").filter((m) => m.matchday === 5), ...postponed],
      now,
    ),
  ).toBe(matches[0].roundId);
  for (const status of ["CANCELLED", "AWARDED"])
    expect(
      isRoundComplete(
        matches.map((m) => (m.id === "last" ? { ...m, status } : m)),
      ),
    ).toBe(true);
  expect(isRoundComplete([])).toBe(false);
});
it("mantiene la última jornada al acabar la temporada y elige la primera futura antes del inicio", () => {
  const matches = calendar("PD");
  const finished = matches
    .filter((m) => m.matchday === 4)
    .map((m) => ({ ...m, status: "FINISHED", homeScore: 1, awayScore: 1 }));
  expect(preferredRound(finished, now)).toBe(finished[0].roundId);
  expect(
    preferredRound(
      matches.map((m) => ({
        ...m,
        status: "TIMED",
        homeScore: null,
        awayScore: null,
      })),
      Date.parse("2026-11-01T12:00:00Z"),
    ),
  ).toBe(matches[1].roundId);
  expect(preferredRound([], now)).toBe("");
});
