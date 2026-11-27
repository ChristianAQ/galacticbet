import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Match } from "../src/lib/domain";
import {
  EspnRequestError,
  type EspnClient,
  type EspnEvent,
} from "../scripts/espn";
import {
  insightCandidates,
  insightCalendarWindows,
  insightRefreshInterval,
  syncMatchInsights,
  type StoredMatchInsight,
} from "../scripts/syncMatchInsights";
import type { MatchInsight } from "../src/lib/matchInsightsData";

const now = Date.parse("2026-10-28T18:00:00Z");
const HOUR = 3_600_000;
const makeMatch = (id = "1", offset = 0): Match => ({
  id,
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "r1",
  stage: "REGULAR_SEASON",
  matchday: 10,
  utcDate: new Date(now + offset).toISOString(),
  status: "TIMED",
  home: `Local ${id}`,
  away: `Visitante ${id}`,
  homeScore: null,
  awayScore: null,
});
function makeEvent(match: Match): EspnEvent {
  return {
    id: `7${match.id}`,
    homeId: `8${match.id}`,
    awayId: `9${match.id}`,
    competition: match.competition,
    kickoff: match.utcDate,
    home: match.home,
    away: match.away,
  };
}
function makeSummary(event: EspnEvent) {
  return {
    header: {
      competitions: [
        {
          id: event.id,
          date: event.kickoff,
          competitors: [
            {
              homeAway: "home",
              team: { id: event.homeId, displayName: event.home },
            },
            {
              homeAway: "away",
              team: { id: event.awayId, displayName: event.away },
            },
          ],
        },
      ],
    },
    gameInfo: { venue: { fullName: "Estadio del partido" } },
  };
}
function stored(match: Match, age = 0, goals = false): StoredMatchInsight {
  const fetchedAt = new Date(now - age).toISOString();
  const insight: MatchInsight = {
    version: 1,
    matchId: match.id,
    competition: match.competition,
    kickoff: match.utcDate,
    provider: "ESPN",
    eventId: `7${match.id}`,
    fetchedAt,
    venue: "Estadio anterior",
    lineups: [],
    statistics: [],
    goals: goals
      ? [{ side: "home", scorer: "Goleador", minute: "20'", kind: "goal" }]
      : [],
  };
  return {
    insight,
    checkedAt: fetchedAt,
    kickoff: match.utcDate,
    status: match.status,
  };
}
function database(seed: Record<string, StoredMatchInsight> = {}) {
  const docs = new Map(Object.entries(seed));
  const writes: string[] = [];
  const getAll = vi.fn(async (...refs: { path: string; id: string }[]) =>
    refs.map((ref) => ({ id: ref.id, data: () => docs.get(ref.id) })),
  );
  const mock = {
    doc(path: string) {
      if (!path.startsWith("matchInsights/"))
        throw new Error("unexpected collection");
      return { path, id: path.split("/")[1] };
    },
    getAll,
    batch() {
      const pending: [string, StoredMatchInsight][] = [];
      return {
        set(ref: { id: string }, data: StoredMatchInsight) {
          pending.push([ref.id, data]);
        },
        async commit() {
          for (const [id, data] of pending) {
            docs.set(id, data);
            writes.push(id);
          }
        },
      };
    },
  };
  return { db: mock as unknown as Firestore, docs, writes, getAll };
}
function clientFor(matches: Match[]) {
  const events = matches.map(makeEvent);
  return {
    scoreboard: vi.fn<EspnClient["scoreboard"]>(async (code) =>
      events.filter((event) => event.competition === code),
    ),
    summary: vi.fn<EspnClient["summary"]>(async (_code, id) =>
      makeSummary(events.find((event) => event.id === id)!),
    ),
  };
}
const log = vi.fn<(message: string) => void>();

describe("sincronización acotada de información complementaria", () => {
  it("una ficha 404 no impide actualizar el siguiente partido", async () => {
    const fixtures = [makeMatch("1", HOUR), makeMatch("2", HOUR)];
    const { db, docs } = database();
    const client = clientFor(fixtures);
    client.summary.mockRejectedValueOnce(new EspnRequestError(404));
    const report = await syncMatchInsights(db, fixtures, { now, client, log });
    expect(report.stopped).toBe(false);
    expect(report.missingSummaries).toBe(1);
    expect(docs.get("2")?.insight?.venue).toBe("Estadio del partido");
  });
  it("reutiliza la ficha y limita a ocho consultas extra de cuotas", async () => {
    const fixtures = Array.from({ length: 12 }, (_, i) =>
      makeMatch(String(i + 1), HOUR),
    );
    const { db, docs } = database();
    const odds = vi.fn().mockResolvedValue({
      items: [
        {
          provider: { name: "Proveedor" },
          lastUpdated: new Date(now).toISOString(),
          homeTeamOdds: { moneyLine: -110 },
          drawOdds: { moneyLine: 250 },
          awayTeamOdds: { moneyLine: 300 },
        },
      ],
    });
    const report = await syncMatchInsights(db, fixtures, {
      now,
      client: { ...clientFor(fixtures), odds },
      log,
    });
    expect(report.odds).toBe(8);
    expect(odds).toHaveBeenCalledTimes(8);
    expect(docs.get("1")?.insight?.probability?.model).toBe("ESPN_ODDS");
  });
  it("conserva la ficha descargada si cuotas devuelve 429 y detiene el resto", async () => {
    const fixtures = [makeMatch("1", HOUR), makeMatch("2", HOUR)];
    const { db, docs } = database();
    const client = {
      ...clientFor(fixtures),
      odds: vi.fn().mockRejectedValue(new EspnRequestError(429)),
    };
    const report = await syncMatchInsights(db, fixtures, { now, client, log });
    expect(report.stopped).toBe(true);
    expect(docs.get("1")?.insight?.venue).toBe("Estadio del partido");
    expect(client.summary).toHaveBeenCalledTimes(1);
  });
  it("recupera la jornada anterior fuera de 48 h y no confunde un aplazado con la última ronda", () => {
    const finished = (
      id: string,
      day: number,
      roundId: string,
      matchday: number,
    ) => ({
      ...makeMatch(id, -day * 24 * HOUR),
      status: "FINISHED",
      roundId,
      matchday,
    });
    const fixtures = [
      finished("old", 30, "r8", 8),
      finished("postponed", 1, "r8", 8),
      finished("previous", 10, "r9", 9),
      finished("current", 3, "r10", 10),
    ];
    const ids = insightCandidates(fixtures, now).map((m) => m.id);
    expect(ids).toContain("previous");
    expect(ids).toContain("current");
    expect(ids).toContain("postponed"); // still in the recent 48-hour window
    expect(ids).not.toContain("old");
  });
  it("reserva lecturas para el histórico y rota jornadas grandes sin superar 80", () => {
    const history = Array.from({ length: 110 }, (_, i) => ({
      ...makeMatch(String(i + 1), -7 * 24 * HOUR),
      status: "FINISHED",
      roundId: "previous",
    }));
    const upcoming = Array.from({ length: 50 }, (_, i) => ({
      ...makeMatch(String(i + 200), HOUR),
      roundId: "future",
    }));
    const seen = new Set<string>();
    for (let cycle = 0; cycle < 4; cycle++) {
      const candidates = insightCandidates(
        [...upcoming, ...history],
        now + cycle * 2 * HOUR,
      );
      expect(candidates.length).toBeLessThanOrEqual(80);
      for (const m of candidates.filter((m) => m.status === "FINISHED"))
        seen.add(m.id);
    }
    expect(seen.size).toBe(110);
  });
  it("divide los calendarios antiguos en ventanas de hasta cinco días", () => {
    const fixtures = [
      makeMatch("1", -21 * 24 * HOUR),
      makeMatch("2", -20 * 24 * HOUR),
      makeMatch("3", -7 * 24 * HOUR),
      makeMatch("4", HOUR),
    ];
    const windows = insightCalendarWindows(fixtures);
    expect(windows).toHaveLength(3);
    expect(windows[0].matchIds).toEqual(["1", "2"]);
    for (const window of windows) {
      const date = (s: string) =>
        Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}T00:00:00Z`);
      expect(date(window.to) - date(window.from)).toBeLessThanOrEqual(
        4 * 24 * HOUR,
      );
    }
  });
  it("carga estadísticas de la jornada pasada y después conserva la caché siete días", async () => {
    const match = { ...makeMatch("1", -7 * 24 * HOUR), status: "FINISHED" };
    const { db, docs } = database();
    const client = clientFor([match]);
    client.summary.mockResolvedValue({
      ...makeSummary(makeEvent(match)),
      boxscore: {
        teams: [
          {
            team: { id: "81" },
            statistics: [{ name: "possessionPct", displayValue: "63%" }],
          },
          {
            team: { id: "91" },
            statistics: [{ name: "possessionPct", displayValue: "37%" }],
          },
        ],
      },
    });
    expect(
      (await syncMatchInsights(db, [match], { now, client, log })).summaries,
    ).toBe(1);
    expect(docs.get("1")?.insight?.statistics).toEqual([
      { label: "Posesión", home: "63%", away: "37%" },
    ]);
    expect(
      (
        await syncMatchInsights(db, [match], {
          now: now + 2 * 24 * HOUR,
          client,
          log,
        })
      ).summaries,
    ).toBe(0);
    expect(insightRefreshInterval(match, now, docs.get("1")?.insight)).toBe(
      7 * 24 * HOUR,
    );
    // A week later, still without a report: daily.
    expect(insightRefreshInterval(match, now, null)).toBe(24 * HOUR);
  });
  it("limita candidatos a 48 h anteriores/24 h futuras, 80 lecturas y excluye cancelados", () => {
    const fixtures = Array.from({ length: 90 }, (_, index) =>
      makeMatch(String(index + 1), index * 60_000),
    );
    const candidates = insightCandidates(
      [
        ...fixtures,
        makeMatch("past", -49 * HOUR),
        makeMatch("future", 25 * HOUR),
        { ...makeMatch("cancel"), status: "CANCELLED" },
      ],
      now,
    );
    expect(candidates).toHaveLength(80);
    expect(
      candidates.some((match) =>
        ["past", "future", "cancel"].includes(match.id),
      ),
    ).toBe(false);
    expect(insightRefreshInterval(makeMatch("1", 3 * HOUR), now)).toBe(
      12 * HOUR,
    );
    expect(insightRefreshInterval(makeMatch(), now)).toBe(2 * HOUR);
    // Just finished and not found at ESPN yet: again in 2 h for three days, then daily.
    expect(
      insightRefreshInterval({ ...makeMatch(), status: "FINISHED" }, now),
    ).toBe(2 * HOUR);
    expect(
      insightRefreshInterval({ ...makeMatch("1", -4 * 24 * HOUR), status: "FINISHED" }, now),
    ).toBe(24 * HOUR);
  });
  it("carga documentos en un getAll, como máximo dos calendarios y 24 fichas; continúa pendientes después", async () => {
    const fixtures = Array.from({ length: 90 }, (_, index) => ({
      ...makeMatch(String(index + 1), index * 60_000),
      competition: index % 2 ? ("CL" as const) : ("PD" as const),
    }));
    const { db, getAll, docs } = database();
    const client = clientFor(fixtures);
    const first = await syncMatchInsights(db, fixtures, { now, client, log });
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(getAll.mock.calls[0]).toHaveLength(80);
    expect(first).toMatchObject({
      reads: 80,
      scoreboards: 2,
      summaries: 24,
      updated: 24,
      stopped: false,
    });
    expect(docs.size).toBe(24);
    const second = await syncMatchInsights(db, fixtures, { now, client, log });
    expect(second).toMatchObject({ summaries: 24, updated: 24, skipped: 24 });
    expect(docs.size).toBe(48);
  });
  it("la caché vigente no llama al proveedor ni escribe; una consulta ausente también se cachea", async () => {
    const match = makeMatch();
    const { db, writes, docs } = database({
      "1": { ...stored(match), insight: null },
    });
    const client = clientFor([match]);
    expect(
      await syncMatchInsights(db, [match], { now, client, log }),
    ).toMatchObject({ summaries: 0, scoreboards: 0, skipped: 1 });
    expect(client.scoreboard).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(docs.get("1")?.insight).toBeNull();
  });
  it("un cambio de estado obliga a actualizar aunque la caché no haya caducado", async () => {
    const match = makeMatch();
    const { db } = database({ "1": stored(match) });
    const finished = { ...match, status: "FINISHED" };
    const client = clientFor([finished]);
    expect(
      await syncMatchInsights(db, [finished], { now, client, log }),
    ).toMatchObject({ summaries: 1, updated: 1 });
  });
  it("invalida una asociación de horario antiguo y no adjunta sus datos al nuevo partido", async () => {
    const match = makeMatch();
    const { db, docs } = database({
      "1": stored({ ...match, utcDate: new Date(now - HOUR).toISOString() }),
    });
    const client = clientFor([]);
    await syncMatchInsights(db, [match], { now, client, log });
    expect(docs.get("1")).toMatchObject({
      insight: null,
      kickoff: match.utcDate,
    });
  });
  it("preserva goles y antigüedad si el proveedor devuelve únicamente el estadio", async () => {
    const match = makeMatch();
    const previous = stored(match, 3 * HOUR, true);
    const { db, docs } = database({ "1": previous });
    await syncMatchInsights(db, [match], {
      now,
      client: clientFor([match]),
      log,
    });
    expect(docs.get("1")?.insight).toMatchObject({
      venue: "Estadio del partido",
      goals: previous.insight!.goals,
      fetchedAt: previous.insight!.fetchedAt,
    });
    expect(docs.get("1")?.checkedAt).toBe(new Date(now).toISOString());
  });
  it("permite corregir a cero goles si el resultado oficial confirma un 0–0 reglamentario final", async () => {
    const match = {
      ...makeMatch(),
      status: "FINISHED",
      scoreDuration: "REGULAR",
      homeScore: 0,
      awayScore: 0,
    };
    const previous = stored(match, 25 * HOUR, true);
    const { db, docs } = database({ "1": previous });
    await syncMatchInsights(db, [match], {
      now,
      client: clientFor([match]),
      log,
    });
    expect(docs.get("1")?.insight?.goals).toEqual([]);
  });
  it("conserva la alineación visitante y estadísticas ausentes al recibir solo datos del local", async () => {
    const match = makeMatch(),
      previous = stored(match, 3 * HOUR);
    previous.insight!.lineups = [
      { side: "home", players: [{ name: "Local anterior", starter: true }] },
      {
        side: "away",
        players: [{ name: "Visitante confirmado", starter: true }],
      },
    ];
    previous.insight!.statistics = [
      { label: "Córners", home: "3", away: "1" },
      { label: "Remates", home: "5", away: "6" },
    ];
    const { db, docs } = database({ "1": previous });
    const client = clientFor([match]);
    client.summary.mockResolvedValue({
      ...makeSummary(makeEvent(match)),
      rosters: [
        {
          team: { id: "81" },
          roster: [
            { athlete: { displayName: "Local corregido" }, starter: true },
          ],
        },
      ],
      boxscore: {
        players: [
          {
            team: { id: "81" },
            statistics: [{ name: "cornerKicks", displayValue: "4" }],
          },
          {
            team: { id: "91" },
            statistics: [{ name: "cornerKicks", displayValue: "2" }],
          },
        ],
      },
    });
    await syncMatchInsights(db, [match], { now, client, log });
    expect(docs.get("1")?.insight).toMatchObject({
      lineups: [
        { side: "home", players: [{ name: "Local corregido", starter: true }] },
        previous.insight!.lineups[1],
      ],
      statistics: [
        { label: "Córners", home: "4", away: "2" },
        previous.insight!.statistics[1],
      ],
      fetchedAt: previous.insight!.fetchedAt,
    });
  });
  it("conserva la antigüedad si solo se retiene la asistencia al estadio", async () => {
    const match = makeMatch(),
      previous = stored(match, 3 * HOUR);
    previous.insight!.attendance = 45000;
    const { db, docs } = database({ "1": previous });
    await syncMatchInsights(db, [match], {
      now,
      client: clientFor([match]),
      log,
    });
    expect(docs.get("1")?.insight).toMatchObject({
      attendance: 45000,
      fetchedAt: previous.insight!.fetchedAt,
    });
  });
  it("no mezcla secciones antiguas si se asocia un eventId distinto", async () => {
    const match = makeMatch(),
      previous = stored(match, 3 * HOUR, true);
    previous.insight!.eventId = "999";
    previous.insight!.attendance = 45000;
    const { db, docs } = database({ "1": previous });
    await syncMatchInsights(db, [match], {
      now,
      client: clientFor([match]),
      log,
    });
    expect(docs.get("1")?.insight).toMatchObject({
      eventId: "71",
      goals: [],
      fetchedAt: new Date(now).toISOString(),
    });
    expect(docs.get("1")?.insight?.attendance).toBeUndefined();
  });
  it("corrige a cero goles con una respuesta válida sin estadio ni otras secciones", async () => {
    const match = {
      ...makeMatch(),
      status: "FINISHED",
      scoreDuration: "REGULAR",
      homeScore: 0,
      awayScore: 0,
    };
    const previous = stored(match, 25 * HOUR, true);
    const { db, docs } = database({ "1": previous });
    const client = clientFor([match]);
    client.summary.mockResolvedValue({
      header: makeSummary(makeEvent(match)).header,
    });
    await syncMatchInsights(db, [match], { now, client, log });
    expect(docs.get("1")?.insight?.goals).toEqual([]);
  });
  it("descarta goles contradictorios en la primera ficha si el resultado oficial final es 0–0", async () => {
    const match = {
      ...makeMatch(),
      status: "FINISHED",
      scoreDuration: "REGULAR",
      homeScore: 0,
      awayScore: 0,
    };
    const { db, docs } = database();
    const client = clientFor([match]);
    client.summary.mockResolvedValue({
      ...makeSummary(makeEvent(match)),
      keyEvents: [
        {
          type: { text: "Goal" },
          scoringPlay: true,
          team: { id: "81" },
          clock: { displayValue: "20'" },
          participants: [{ athlete: { displayName: "Goleador" } }],
        },
      ],
    });
    await syncMatchInsights(db, [match], { now, client, log });
    expect(docs.get("1")?.insight?.goals).toEqual([]);
  });
  it("informa asociaciones ausentes y respuestas rechazadas sin confundir documentos con fichas útiles", async () => {
    const fixtures = [makeMatch("1"), makeMatch("2"), makeMatch("3")];
    const { db } = database();
    const client = clientFor(fixtures.slice(0, 2));
    client.summary.mockImplementation(async (_code, id) =>
      id === "71" ? makeSummary(makeEvent(fixtures[0])) : {},
    );
    expect(
      await syncMatchInsights(db, fixtures, { now, client, log }),
    ).toMatchObject({
      updated: 3,
      available: 1,
      unmatched: 1,
      rejectedSummaries: 1,
    });
  });

  it("prioriza las fichas no consultadas y luego las más antiguas", async () => {
    const fixtures = [makeMatch("1"), makeMatch("2"), makeMatch("3")];
    const { db } = database({
      "1": stored(fixtures[0], 3 * HOUR),
      "2": stored(fixtures[1], 4 * HOUR),
    });
    const client = clientFor(fixtures);
    await syncMatchInsights(db, fixtures, { now, client, log });
    expect(client.summary.mock.calls.map((call) => call[1])).toEqual([
      "73",
      "72",
      "71",
    ]);
  });
  it("detiene el proveedor en 403/429/timeout conservando lo guardado y sin marcarlo como actualizado", async () => {
    for (const error of [
      new EspnRequestError(403),
      new EspnRequestError(429),
      new EspnRequestError(),
    ]) {
      const match = makeMatch(),
        previous = stored(match, 3 * HOUR, true);
      const { db, docs, writes } = database({ "1": previous });
      const client = clientFor([match]);
      client.summary.mockRejectedValue(error);
      expect(
        await syncMatchInsights(db, [match], { now, client, log }),
      ).toMatchObject({ summaries: 1, updated: 0, stopped: true });
      expect(docs.get("1")).toEqual(previous);
      expect(writes).toEqual([]);
    }
  });
  it("publica la ficha válida anterior a una interrupción y retoma solo las pendientes", async () => {
    const fixtures = [makeMatch("1"), makeMatch("2"), makeMatch("3")];
    const { db, docs } = database();
    const client = clientFor(fixtures);
    client.summary.mockImplementation(async (_code, id) => {
      if (id === "72") throw new EspnRequestError(429);
      return makeSummary(
        makeEvent(fixtures.find((match) => `7${match.id}` === id)!),
      );
    });
    expect(
      await syncMatchInsights(db, fixtures, { now, client, log }),
    ).toMatchObject({ updated: 1, stopped: true });
    expect([...docs.keys()]).toEqual(["1"]);
    const recovered = clientFor(fixtures);
    expect(
      await syncMatchInsights(db, fixtures, { now, client: recovered, log }),
    ).toMatchObject({ updated: 2, skipped: 1, stopped: false });
    expect(recovered.summary.mock.calls.map((call) => call[1])).toEqual([
      "72",
      "73",
    ]);
  });

  it("conserva datos si no hay asociación o summary tiene una cabecera equivocada", async () => {
    for (const noEvent of [true, false]) {
      const match = makeMatch(),
        previous = stored(match, 3 * HOUR, true);
      const { db, docs } = database({ "1": previous });
      const client = clientFor(noEvent ? [] : [match]);
      client.summary.mockResolvedValue({ header: { competitions: [] } });
      await syncMatchInsights(db, [match], { now, client, log });
      expect(docs.get("1")?.insight).toEqual(previous.insight);
    }
  });
});

it("guarda enfrentamientos aunque sean la única información y los conserva ante respuestas parciales", async () => {
  const match = makeMatch("1", HOUR),
    event = makeEvent(match);
  const { db, docs } = database();
  const client = clientFor([match]);
  client.summary.mockResolvedValueOnce({
    header: makeSummary(event).header,
    headToHeadGames: [
      {
        id: "1234",
        date: new Date(now - 86400000).toISOString(),
        homeTeam: { id: event.homeId, displayName: event.home },
        awayTeam: { id: event.awayId, displayName: event.away },
        homeTeamScore: 1,
        awayTeamScore: 0,
      },
    ],
  });
  await syncMatchInsights(db, [match], { now, client, log });
  expect(docs.get(match.id)?.insight?.matchups).toHaveLength(1);
  await syncMatchInsights(db, [match], { now: now + 3 * HOUR, client, log });
  expect(docs.get(match.id)?.insight?.matchups).toHaveLength(1);
});

it("recupera historial de calendarios con una ficha ausente y conserva lo descargado ante un 429", async () => {
  const match = makeMatch("1", HOUR),
    event = makeEvent(match);
  const { db, docs } = database();
  const schedule = vi.fn().mockResolvedValue({
    team: { id: event.homeId },
    events: [
      {
        id: "999",
        date: new Date(now - 86400000).toISOString(),
        competitions: [
          {
            status: { type: { completed: true, state: "post" } },
            competitors: [
              {
                homeAway: "home",
                team: { id: event.homeId, displayName: event.home },
                score: "1",
              },
              {
                homeAway: "away",
                team: { id: event.awayId, displayName: event.away },
                score: "0",
              },
            ],
          },
        ],
      },
    ],
  });
  const client = { ...clientFor([match]), schedule };
  client.summary.mockRejectedValueOnce(new EspnRequestError(404));
  await syncMatchInsights(db, [match], { now, client, log });
  expect(docs.get(match.id)?.insight?.matchups).toHaveLength(1);
  expect(docs.get(match.id)?.matchupsCheckedAt).toBe(
    new Date(now).toISOString(),
  );
  const { db: blockedDb, docs: blockedDocs } = database();
  schedule.mockRejectedValue(new EspnRequestError(429));
  const report = await syncMatchInsights(blockedDb, [match], {
    now,
    client,
    log,
  });
  expect(report.stopped).toBe(true);
  expect(blockedDocs.get(match.id)?.insight?.venue).toBe("Estadio del partido");
});
it("no repite la búsqueda de calendarios vacíos al renovar otra ficha", async () => {
  const match = makeMatch("1", HOUR);
  const prior = stored(match, 13 * HOUR);
  prior.matchupsCheckedAt = new Date(now - HOUR).toISOString();
  const { db } = database({ "1": prior });
  const schedule = vi.fn();
  await syncMatchInsights(db, [match], {
    now,
    client: { ...clientFor([match]), schedule },
    log,
  });
  expect(schedule).not.toHaveBeenCalled();
});
