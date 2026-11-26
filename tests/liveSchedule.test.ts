import { describe, expect, it } from "vitest";
import type { Match } from "../src/lib/domain";
import { nextLiveWake } from "../scripts/liveSchedule";

const now = Date.parse("2026-11-28T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const fixture = (id: string, offset: number, extra: Partial<Match> = {}): Match => ({
  id,
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "PD-2026-REGULAR_SEASON-14",
  matchday: 14,
  stage: "REGULAR_SEASON",
  utcDate: new Date(now + offset).toISOString(),
  status: "TIMED",
  home: `Local ${id}`,
  away: `Visitante ${id}`,
  homeScore: null,
  awayScore: null,
  ...extra,
});

describe("cuándo tiene trabajo el directo", () => {
  it("ahora mismo, si hay un partido en juego o empieza en menos de 20 minutos", () => {
    expect(nextLiveWake([fixture("a", -30 * MINUTE, { status: "IN_PLAY" })], [], now)).toEqual({ at: now, kind: "live" });
    expect(nextLiveWake([fixture("a", 15 * MINUTE)], [], now)).toEqual({ at: now, kind: "live" });
  });

  it("20 minutos antes del próximo partido, aunque haya otros más tarde", () => {
    const wake = nextLiveWake([fixture("b", 6 * HOUR), fixture("a", 2 * HOUR)], [], now);
    expect(wake).toEqual({ at: now + 2 * HOUR - 20 * MINUTE, kind: "live" });
  });

  it("no espera a partidos terminados, aplazados ni pasados", () => {
    const matches = [
      fixture("fin", -4 * HOUR, { status: "FINISHED", homeScore: 1, awayScore: 0, winner: "1" }),
      fixture("apl", 3 * HOUR, { status: "POSTPONED" }),
      fixture("old", -5 * HOUR),
    ];
    expect(nextLiveWake(matches, [], now)).toBeUndefined();
  });

  it("el recordatorio, dos horas antes del cierre de una jornada", () => {
    const deadline = now + 5 * HOUR;
    expect(nextLiveWake([fixture("a", 5 * HOUR)], [deadline], now)).toEqual({
      at: deadline - 2 * HOUR,
      kind: "remind",
      deadline,
    });
    // Ya dentro de las dos horas: ahora; a menos de diez minutos ya no sirve.
    expect(nextLiveWake([], [now + HOUR], now)).toMatchObject({ at: now, kind: "remind" });
    expect(nextLiveWake([], [now + 5 * MINUTE], now)).toBeUndefined();
  });

  it("si coinciden, primero el partido (que también recuerda al empezar)", () => {
    // Kick-off at 3 h (followed from 2 h 40 min) and a round closing at 4 h 40 min (reminded at 2 h 40 min).
    const deadline = now + 4 * HOUR + 40 * MINUTE;
    expect(nextLiveWake([fixture("a", 3 * HOUR)], [deadline], now)).toEqual({ at: now + 2 * HOUR + 40 * MINUTE, kind: "live" });
  });
});
