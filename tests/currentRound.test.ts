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
    it("conserva J4 con todos los horarios ya iniciados; acabada, sigue dos días y luego avanza", () => {
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
      // Just finished: still the current one, to see results and the table.
      expect(preferredRound(finished, now)).toBe(current);
      expect(currentRankingRound(finished, [current, next], now)).toBe(current);
      expect(
        roundOptions(finished, now).find((r) => r.id === current)?.state,
      ).toBe("finished");
      // Two days after its last kick-off, the next round takes over.
      const later = Date.parse("2026-11-06T20:01:00Z");
      expect(preferredRound(finished, Date.parse("2026-11-06T19:59:00Z"))).toBe(current);
      expect(preferredRound(finished, later)).toBe(next);
      expect(currentRankingRound(finished, [current, next], later)).toBe(next);
      // A next round starting within a day takes over at once: there is a slip to seal.
      const soon = finished.map((m) =>
        m.id === "next" ? { ...m, utcDate: "2026-11-05T19:00:00Z" } : m,
      );
      expect(preferredRound(soon, now)).toBe(next);
      // …and one starting in 36 hours, a day before it.
      const midweek = finished.map((m) =>
        m.id === "next" ? { ...m, utcDate: "2026-11-06T08:30:00Z" } : m,
      );
      expect(preferredRound(midweek, now)).toBe(current);
      expect(preferredRound(midweek, Date.parse("2026-11-05T08:30:00Z"))).toBe(next);
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
it("un aplazado deja de retener su jornada cuando la siguiente empieza o está a punto", () => {
  const make = (id: string, matchday: number, utcDate: string, extra: Partial<Match> = {}): Match => ({
    id,
    competition: "PD",
    seasonId: "PD-2026",
    roundId: `PD-2026-REGULAR_SEASON-${matchday}`,
    stage: "REGULAR_SEASON",
    matchday,
    utcDate,
    status: "TIMED",
    home: "Local",
    away: "Visitante",
    homeScore: null,
    awayScore: null,
    ...extra,
  });
  const played = { status: "FINISHED", homeScore: 1, awayScore: 0 };
  const j4 = [
    make("a1", 4, "2026-11-01T15:00:00Z", played),
    make("a2", 4, "2026-11-01T18:00:00Z", played),
    make("a3", 4, "2026-11-02T18:00:00Z", { status: "POSTPONED" }),
  ];
  const j5 = ["2026-11-08T15:00:00Z", "2026-11-08T18:00:00Z", "2026-11-09T18:00:00Z"].map((d, i) =>
    make(`b${i}`, 5, d),
  );
  const j6 = ["2026-11-15T15:00:00Z", "2026-11-15T18:00:00Z", "2026-11-16T18:00:00Z"].map((d, i) =>
    make(`c${i}`, 6, d),
  );
  // Days before J5: the postponed match still holds J4.
  expect(preferredRound([...j4, ...j5, ...j6], Date.parse("2026-11-05T12:00:00Z"))).toBe(j4[0].roundId);
  // J5 starts within a day, is in play, then is over: J4 no longer holds.
  expect(preferredRound([...j4, ...j5, ...j6], Date.parse("2026-11-07T20:00:00Z"))).toBe(j5[0].roundId);
  const live = j5.map((m, i) => (i === 0 ? { ...m, ...played } : i === 1 ? { ...m, status: "IN_PLAY", homeScore: 0, awayScore: 0 } : m));
  expect(preferredRound([...j4, ...live, ...j6], Date.parse("2026-11-08T19:00:00Z"))).toBe(j5[0].roundId);
  const over = j5.map((m) => ({ ...m, ...played }));
  expect(preferredRound([...j4, ...over, ...j6], Date.parse("2026-11-14T12:00:00Z"))).toBe(j6[0].roundId);
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
