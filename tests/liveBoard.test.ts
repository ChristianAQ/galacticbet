import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { encodeCalendar } from "../src/lib/calendar";
import type { Match } from "../src/lib/domain";
import {
  applyLiveBoard,
  decodeLiveBoard,
  liveEvents,
  liveMinuteLabel,
  needsLiveWatch,
  type LiveBoard,
} from "../src/lib/liveBoard";
import type { MatchInsight } from "../src/lib/matchInsightsData";
import { buildLiveBoard, runLiveLoop } from "../scripts/liveLoop";
import type { EspnClient } from "../scripts/espn";

const now = Date.parse("2026-11-05T20:30:00Z");
const MINUTE = 60_000;
const fixture = (
  id: string,
  offset: number,
  extra: Partial<Match> = {},
): Match => ({
  id,
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "PD-2026-REGULAR_SEASON-12",
  matchday: 12,
  stage: "REGULAR_SEASON",
  utcDate: new Date(now + offset).toISOString(),
  status: "TIMED",
  home: `Local ${id}`,
  away: `Visitante ${id}`,
  homeScore: null,
  awayScore: null,
  ...extra,
});
const board = (matches: LiveBoard["matches"]): LiveBoard => ({
  formatVersion: 1,
  updatedAt: now,
  matches,
});

describe("marcador en directo", () => {
  it("adelanta marcador y estado sin sustituir un resultado oficial", () => {
    const live = fixture("1", -30 * MINUTE);
    const official = fixture("2", -3 * 60 * MINUTE, {
      status: "FINISHED",
      homeScore: 1,
      awayScore: 0,
      winner: "1",
    });
    const result = applyLiveBoard(
      [live, official],
      board([
        { id: "1", status: "IN_PLAY", homeScore: 2, awayScore: 1, events: [] },
        { id: "2", status: "FINISHED", homeScore: 3, awayScore: 3, events: [] },
      ]),
    );
    expect(result[0]).toMatchObject({
      status: "IN_PLAY",
      homeScore: 2,
      awayScore: 1,
      winner: null,
    });
    expect(result[1]).toBe(official);
  });

  it("nunca reabre un partido finalizado y conserva la referencia sin cambios", () => {
    const finished = fixture("1", -2 * 60 * MINUTE, {
      status: "FINISHED",
      resultProvider: "SportAPI",
      homeScore: 1,
      awayScore: 1,
      winner: "X",
    });
    const list = [finished];
    expect(
      applyLiveBoard(
        list,
        board([
          {
            id: "1",
            status: "IN_PLAY",
            homeScore: 1,
            awayScore: 0,
            events: [],
          },
        ]),
      ),
    ).toBe(list);
    expect(applyLiveBoard(list, null)).toBe(list);
  });

  it("escucha solo durante la ventana de partidos sin resultado publicado", () => {
    expect(needsLiveWatch([fixture("1", 15 * MINUTE)], now)).toBe(true);
    expect(needsLiveWatch([fixture("1", 2 * 60 * MINUTE)], now)).toBe(false);
    expect(
      needsLiveWatch(
        [
          fixture("1", -100 * MINUTE, {
            status: "FINISHED",
            homeScore: 0,
            awayScore: 0,
          }),
        ],
        now,
      ),
    ).toBe(false);
    expect(
      needsLiveWatch(
        [fixture("1", -10 * MINUTE, { status: "POSTPONED" })],
        now,
      ),
    ).toBe(false);
  });

  it("extrapola el minuto con topes por parte y descanso", () => {
    const base = {
      id: "1",
      status: "IN_PLAY",
      homeScore: 0,
      awayScore: 0,
      events: [],
    };
    expect(
      liveMinuteLabel(
        { ...base, minute: "30", minuteAt: now },
        now + 3 * MINUTE,
      ),
    ).toBe("33'");
    expect(
      liveMinuteLabel(
        { ...base, minute: "44", minuteAt: now },
        now + 5 * MINUTE,
      ),
    ).toBe("45+'");
    expect(
      liveMinuteLabel({ ...base, minute: "90+2", minuteAt: now }, now + MINUTE),
    ).toBe("90+3'");
    expect(liveMinuteLabel({ ...base, status: "PAUSED" }, now)).toBe(
      "Descanso",
    );
    expect(liveMinuteLabel(base, now)).toBe("En juego");
  });

  it("descarta entradas públicas inválidas", () => {
    const decoded = decodeLiveBoard({
      formatVersion: 1,
      updatedAt: now,
      matches: [
        {
          id: "1",
          status: "IN_PLAY",
          homeScore: 1,
          awayScore: 0,
          minute: "12'",
          minuteAt: now,
          events: [
            { minute: "10'", side: "home", kind: "goal", player: "Ana" },
            { minute: "11'", side: "fuera", kind: "goal", player: "X" },
          ],
        },
        { id: "2", status: "IN_PLAY", homeScore: -1, awayScore: 0, events: [] },
      ],
    });
    expect(decoded?.matches).toEqual([
      {
        id: "1",
        status: "IN_PLAY",
        homeScore: 1,
        awayScore: 0,
        minute: "12",
        minuteAt: now,
        events: [{ minute: "10'", side: "home", kind: "goal", player: "Ana" }],
      },
    ]);
    expect(
      decodeLiveBoard({ formatVersion: 2, updatedAt: 1, matches: [] }),
    ).toBe(null);
  });

  it("ordena goles y tarjetas e ignora los cambios", () => {
    const insight = {
      goals: [{ minute: "70'", side: "away", kind: "goal", scorer: "B" }],
      incidents: [
        { minute: "12'", side: "home", kind: "yellow-card", player: "A" },
        { minute: "60'", side: "home", kind: "substitution", player: "C" },
      ],
    } as unknown as MatchInsight;
    expect(liveEvents(insight)).toEqual([
      { minute: "12'", side: "home", kind: "yellow-card", player: "A" },
      { minute: "70'", side: "away", kind: "goal", player: "B" },
    ]);
  });

  it("publica el minuto solo en partidos en juego", () => {
    const list = [
      fixture("1", -20 * MINUTE, {
        status: "IN_PLAY",
        homeScore: 0,
        awayScore: 0,
      }),
      fixture("2", -20 * MINUTE, {
        status: "PAUSED",
        homeScore: 0,
        awayScore: 0,
      }),
      fixture("3", 3 * 60 * MINUTE),
    ];
    const minutes = new Map([
      ["1", { minute: "20", at: now }],
      ["2", { minute: "HT", at: now }],
    ]);
    const result = buildLiveBoard(list, now, minutes, new Map());
    expect(result.map((m) => m.id)).toEqual(["1", "2"]);
    expect(result[0]).toMatchObject({ minute: "20", minuteAt: now });
    expect(result[1].minute).toBeUndefined();
  });
});

function database(matches: Match[]) {
  const docs = new Map<string, Record<string, unknown>>([
    [
      "calendars/PD-2026",
      {
        formatVersion: 1,
        seasonId: "PD-2026",
        payload: encodeCalendar(matches),
      },
    ],
  ]);
  const reads: string[] = [];
  const writes: string[] = [];
  const ref = (path: string) => ({
    path,
    id: path.split("/").at(-1)!,
    async set(data: Record<string, unknown>) {
      docs.set(path, data);
      writes.push(path);
    },
  });
  const mock = {
    doc: ref,
    async getAll(...refs: { path: string; id: string }[]) {
      reads.push(...refs.map((r) => r.path));
      return refs.map((r) => ({
        id: r.id,
        exists: docs.has(r.path),
        data: () => docs.get(r.path),
      }));
    },
    batch() {
      const pending: [string, Record<string, unknown>][] = [];
      return {
        set(target: { path: string }, data: Record<string, unknown>) {
          pending.push([target.path, data]);
        },
        async commit() {
          for (const [path, data] of pending) {
            docs.set(path, data);
            writes.push(path);
          }
        },
      };
    },
  };
  return { db: mock as unknown as Firestore, docs, reads, writes };
}

function espnFor(match: Match) {
  const event = {
    id: "77",
    homeId: "8",
    awayId: "9",
    competition: match.competition,
    kickoff: match.utcDate,
    home: match.home,
    away: match.away,
  };
  return {
    scoreboard: vi.fn<EspnClient["scoreboard"]>(async () => [event]),
    summary: vi.fn<EspnClient["summary"]>(async () => ({
      header: {
        competitions: [
          {
            id: event.id,
            date: event.kickoff,
            competitors: [
              { homeAway: "home", team: { id: "8", displayName: event.home } },
              { homeAway: "away", team: { id: "9", displayName: event.away } },
            ],
          },
        ],
      },
      gameInfo: { venue: { fullName: "Estadio" } },
    })),
  };
}

describe("bucle en directo", () => {
  it("sin partidos cercanos solo lee los calendarios y termina", async () => {
    const { db, reads, writes } = database([fixture("1", 5 * 60 * MINUTE)]);
    const sleep = vi.fn(async () => {});
    const result = await runLiveLoop(db, {
      durationMs: 25 * MINUTE,
      clock: () => now,
      sleep,
      log: () => {},
    });
    expect(result.iterations).toBe(1);
    expect(reads.every((path) => path.startsWith("calendars/"))).toBe(true);
    expect(writes).toEqual([]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("repite cada minuto durante el partido, reutiliza la identidad ESPN y no reescribe sin cambios", async () => {
    const match = fixture("1", -30 * MINUTE, {
      status: "IN_PLAY",
      homeScore: 1,
      awayScore: 0,
    });
    const { db, docs, writes } = database([match]);
    let clock = now;
    const espn = espnFor(match);
    const officialSync = vi.fn(async () => {});
    const result = await runLiveLoop(db, {
      durationMs: 3 * MINUTE,
      clock: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      log: () => {},
      espnClient: () => espn,
      officialSync,
    });
    expect(result.iterations).toBe(4);
    expect(officialSync).toHaveBeenCalledTimes(1);
    // ESPN every two minutes, with the scoreboard only on the first pass.
    expect(espn.scoreboard).toHaveBeenCalledTimes(1);
    expect(espn.summary).toHaveBeenCalledTimes(2);
    expect(writes.filter((path) => path === "live/football")).toHaveLength(1);
    expect(docs.get("live/football")).toMatchObject({
      formatVersion: 1,
      matches: [{ id: "1", status: "IN_PLAY", homeScore: 1, awayScore: 0 }],
    });
    expect(docs.get("syncStatus/football")).toBeUndefined();
  });
});
