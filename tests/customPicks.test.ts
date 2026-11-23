import { describe, expect, it } from "vitest";
import {
  formatCode,
  isCode,
  parseInvite,
  randomCode,
  resolveCompetition,
  type Competition,
  type CustomMatch,
  type Participant,
} from "../src/lib/customCompetition";
import {
  canPick,
  decodePick,
  encodePick,
  pickHit,
  pickLabel,
  pickPoints,
  pickRanking,
} from "../src/lib/customPicks";
import type { Match } from "../src/lib/domain";
import { pickState, roundBoard } from "../src/lib/roundBoard";

describe("código corto de invitación", () => {
  it("son 6 caracteres sin 0/O, 1/I/L y todos salen", () => {
    const seen = new Set<string>();
    let i = 0;
    for (let n = 0; n < 200; n++) {
      const code = randomCode();
      expect(isCode(code)).toBe(true);
      expect(code).toMatch(/^[^01OIL]{6}$/);
      for (const ch of code) seen.add(ch);
    }
    expect(seen.size).toBe(31);
    // Deterministic source: each position takes the requested index.
    expect(randomCode(() => i++ % 31)).toBe("ABCDEF");
    expect(formatCode("K7M2QX")).toBe("K7M 2QX");
  });

  it("entiende el código escrito de cualquier forma, el enlace y el identificador antiguo", () => {
    expect(parseInvite("k7m 2qx")).toEqual({ code: "K7M2QX" });
    expect(parseInvite(" K7M-2QX ")).toEqual({ code: "K7M2QX" });
    expect(parseInvite("https://galacticbet.app/#/ligas?liga=AbCdEfGhIjKlMnOpQrSt")).toEqual({ id: "AbCdEfGhIjKlMnOpQrSt" });
    expect(parseInvite("Sigue «Liga» https://x.app/#/ligas?codigo=k7m2qx")).toEqual({ code: "K7M2QX" });
    expect(parseInvite("AbCdEfGhIjKlMnOpQrSt")).toEqual({ id: "AbCdEfGhIjKlMnOpQrSt" });
    for (const bad of ["", "K0M2QX", "K7M2Q", "hola", "K7M2QXX"]) expect(parseInvite(bad)).toBeNull();
  });
});

const comp = (mode: Competition["predictionMode"] = "exact") =>
  ({
    id: "c1",
    name: "Liga",
    sport: "",
    icon: null,
    participantType: "team",
    format: "custom",
    legs: 1,
    knockoutLegs: 1,
    qualifiers: 0,
    groups: 0,
    thirdPlace: false,
    predictionMode: mode,
    schedule: { start: "2026-11-28", time: "10:00", everyDays: 7, slotMinutes: 60, location: "", timeZone: "Europe/Madrid" },
    ownerId: "alice",
    adminIds: [],
    memberIds: ["alice", "bob", "carol"],
  }) as Competition;
const teams: Participant[] = ["A", "B", "C", "D"].map((name, seed) => ({
  id: name.toLowerCase(),
  name,
  kind: "team",
  userId: null,
  icon: null,
  seed,
}));
const game = (id: string, over: Partial<CustomMatch> = {}): CustomMatch => ({
  id,
  phase: "custom",
  round: 1,
  stage: "REGULAR_SEASON",
  group: null,
  tie: null,
  leg: null,
  homeId: "a",
  awayId: "b",
  homeSlot: null,
  awaySlot: null,
  startAt: Date.parse("2026-11-28T09:00:00Z"),
  location: "",
  status: "scheduled",
  homeScore: null,
  awayScore: null,
  homePenalties: null,
  awayPenalties: null,
  locked: false,
  ...over,
});
const finished = (id: string, home: number, away: number) => game(id, { status: "finished", homeScore: home, awayScore: away });

describe("pronósticos de una competición entre amigos", () => {
  it("guarda 1X2 y marcadores como texto y los vuelve a leer", () => {
    expect(encodePick("X")).toBe("X");
    expect(encodePick({ home: 2, away: 1 })).toBe("2-1");
    expect(decodePick("2-1")).toEqual({ home: 2, away: 1 });
    expect(decodePick("1")).toBe("1");
    for (const bad of ["", "3", "2-", "a-b", "100-0", null, 2]) expect(decodePick(bad)).toBeNull();
    expect(pickLabel("2-1")).toBe("2 – 1");
  });

  it("puntúa como la quiniela: exacto 3, signo 1, 1X2 1; nada si no ha terminado o se canceló", () => {
    const m = finished("m", 2, 1);
    expect(pickPoints("2-1", m)).toBe(3);
    expect(pickPoints("1-0", m)).toBe(1);
    expect(pickPoints("1-1", m)).toBe(0);
    expect(pickPoints("1", m)).toBe(1);
    expect(pickPoints("X", m)).toBe(0);
    expect(pickHit("2-1", m)).toBe("exact");
    expect(pickHit("3-0", m)).toBe("outcome");
    expect(pickHit("2", m)).toBe("miss");
    expect(pickPoints("2-1", game("s"))).toBeNull();
    expect(pickPoints("2-1", game("x", { status: "cancelled" }))).toBeNull();
    expect(pickPoints("1", game("l", { status: "live", homeScore: 1, awayScore: 0 }))).toBeNull();
  });

  it("solo se puede pronosticar antes de empezar, programado y con los dos rivales conocidos", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    const view = resolveCompetition(comp(), teams, [
      game("open"),
      game("started", { startAt: now - 1 }),
      game("postponed", { status: "postponed" }),
      game("ko", { phase: "knockout", stage: "FINAL", tie: "F", homeId: null, awayId: null, homeSlot: "winner:S1", awaySlot: "winner:S2" }),
    ]);
    const open = (id: string, mode: Competition["predictionMode"] = "exact") =>
      canPick(comp(mode), view.matches.find((m) => m.id === id)!, now);
    expect(open("open")).toBe(true);
    expect(open("open", "off")).toBe(false);
    expect(open("started")).toBe(false);
    expect(open("postponed")).toBe(false);
    expect(open("ko")).toBe(false);
  });

  it("la clasificación suma sin duplicar, desempata por plenos y aciertos e incluye a quien no ha jugado", () => {
    const matches = [finished("m1", 2, 1), finished("m2", 0, 0), game("m3"), game("m4", { status: "cancelled" })];
    const picks = {
      m1: { alice: "2-1", bob: "1-0", carol: "0-1" },
      m2: { alice: "1-1", bob: "0-0", dave: "0-0" },
      m3: { alice: "5-0" }, // not played yet
      m4: { bob: "1-0" }, // cancelled
    };
    const people = [
      { id: "alice", name: "Alicia", avatar: null },
      { id: "bob", name: "Bea", avatar: null },
      { id: "carol", name: "Carla", avatar: null },
      { id: "erin", name: "Erin", avatar: null },
    ];
    const rows = pickRanking(matches, picks, people);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.alice).toMatchObject({ points: 4, exact: 1, hits: 2, played: 2 });
    expect(by.bob).toMatchObject({ points: 4, exact: 1, hits: 2, played: 2 });
    expect(by.dave).toMatchObject({ points: 3, exact: 1, name: "Jugador" });
    expect(by.carol).toMatchObject({ points: 0, played: 1 });
    expect(by.erin).toMatchObject({ points: 0, played: 0 });
    // Tied on everything: same position, name decides the order.
    expect(rows.map((r) => [r.id, r.position])).toEqual([
      ["alice", 1],
      ["bob", 1],
      ["dave", 3],
      ["carol", 4],
      ["erin", 4],
    ]);
    // Computing it again gives the same numbers: nothing accumulates.
    expect(pickRanking(matches, picks, people)).toEqual(rows);
  });

  it("si el organizador cambia el modo, cada pronóstico conserva su forma de puntuar", () => {
    const rows = pickRanking([finished("m1", 1, 0), finished("m2", 2, 2)], { m1: { ana: "1" }, m2: { ana: "2-2" } }, [
      { id: "ana", name: "Ana", avatar: null },
    ]);
    expect(rows[0]).toMatchObject({ points: 4, hits: 2, exact: 1 });
  });

  it("los puntos de la jornada en la Quiniela cuentan igual que la tabla", () => {
    const played = (id: string, home: number, away: number): Match => ({
      id,
      competition: "PD",
      seasonId: "c1",
      roundId: "c1:J1",
      matchday: 1,
      stage: "REGULAR_SEASON",
      utcDate: "2026-11-07T10:00:00Z",
      status: "FINISHED",
      home: "Local",
      away: "Rival",
      homeScore: home,
      awayScore: away,
    });
    const [row] = roundBoard([played("m1", 1, 0), played("m2", 2, 2)], "own", [
      { id: "ana", name: "Ana", picks: { m1: "1", m2: { home: 2, away: 2 } } },
    ]);
    expect(row).toMatchObject({ points: 4, hits: 2 });
    expect(pickState("own", { home: 1, away: 1 }, played("m3", 0, 0))).toBe("hit");
    expect(pickState("own", "2", played("m4", 0, 0))).toBe("miss");
  });
});
