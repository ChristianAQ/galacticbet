import { describe, expect, it, vi } from "vitest";
import type { Match } from "../src/lib/domain";
import {
  canonicalTeamName,
  createEspnClient,
  EspnRequestError,
  findEspnEvent,
  normalizeEspnSummary,
  parseEspnScoreboard,
} from "../scripts/espn";
import { validMatchInsight } from "../src/lib/matchInsightsData";

// Synthetic schema examples: no real match data is bundled into production.
const match: Match = {
  id: "123",
  competition: "PD",
  seasonId: "PD-2026",
  roundId: "r1",
  matchday: 10,
  stage: "REGULAR_SEASON",
  utcDate: "2026-10-28T20:00:00Z",
  status: "FINISHED",
  home: "FC Barcelona",
  away: "Real Madrid CF",
  homeScore: 2,
  awayScore: 1,
};
const competition = {
  id: "777",
  date: match.utcDate,
  competitors: [
    { homeAway: "home", team: { id: "83", displayName: "Barcelona" } },
    { homeAway: "away", team: { id: "86", displayName: "Real Madrid" } },
  ],
};
const scoreboard = { events: [{ id: "777", competitions: [competition] }] };
const event = parseEspnScoreboard(scoreboard, "PD")[0];
const athlete = (name: string) => ({ athlete: { displayName: name } });
const goal = (
  id: string,
  type = "Goal",
  more: Record<string, unknown> = {},
) => ({
  id,
  type: { text: type },
  clock: { displayValue: "90'+2'" },
  team: { id: "83" },
  scoringPlay: true,
  participants: [athlete("Jugador local")],
  ...more,
});
function summary(extra: Record<string, unknown> = {}) {
  return {
    header: {
      id: "777",
      league: { slug: "esp.1" },
      competitions: [competition],
    },
    ...extra,
  };
}

describe("ESPN: asociación y datos complementarios", () => {
  it("incorpora probabilidades solo antes del inicio y con identidad validada", () => {
    const before = "2026-10-28T19:00:00Z";
    const predictor = {
      homeTeam: { id: "83", gameProjection: "40" },
      awayTeam: { id: "86", gameProjection: "35" },
      drawChance: "25",
    };
    const next = { ...match, status: "TIMED" as const };
    expect(
      normalizeEspnSummary(summary({ predictor }), next, event, before)
        ?.probability?.home,
    ).toBe(40);
    expect(
      normalizeEspnSummary(summary({ predictor }), match, event, before)
        ?.probability,
    ).toBeUndefined();
    expect(
      normalizeEspnSummary(summary({ predictor }), next, event, match.utcDate)
        ?.probability,
    ).toBeUndefined();
    expect(
      normalizeEspnSummary(
        summary({ predictor: { ...predictor, drawChance: undefined } }),
        next,
        event,
        before,
      )?.probability,
    ).toBeUndefined();
  });

  it("asocia alias explícitos, mismo torneo, localía y hora, sin coincidencias difusas", () => {
    expect(findEspnEvent(match, [event])).toEqual(event);
    expect(canonicalTeamName(" Atlético Madrid ")).toBe(
      canonicalTeamName("Club Atlético de Madrid"),
    );
    expect(
      findEspnEvent({ ...match, home: "Barcelona B" }, [event]),
    ).toBeNull();
    expect(findEspnEvent({ ...match, competition: "CL" }, [event])).toBeNull();
    expect(
      findEspnEvent({ ...match, home: match.away, away: match.home }, [event]),
    ).toBeNull();
    expect(
      findEspnEvent({ ...match, utcDate: "2026-10-28T20:16:00Z" }, [event]),
    ).toBeNull();
    expect(
      findEspnEvent({ ...match, utcDate: "2026-10-28T20:15:00Z" }, [event]),
    ).toEqual(event);
  });
  it("reconoce shortName de Football-Data mediante alias explícitos", () => {
    for (const [short, full] of [
      ["Barça", "Barcelona"],
      ["Atleti", "Atlético Madrid"],
      ["PSG", "Paris Saint-Germain"],
      ["FC Bayern", "Bayern Munich"],
    ]) {
      expect(canonicalTeamName(short)).toBe(canonicalTeamName(full));
    }
    expect(canonicalTeamName("Barcelona B")).not.toBe(
      canonicalTeamName("Barça"),
    );
  });
  it("deduplica el mismo gol con asistencia parcial y formatos de minuto equivalentes", () => {
    for (const assistedFirst of [false, true]) {
      const assisted = goal("1", "Goal", {
        clock: { displayValue: "90 + 02" },
        assist: athlete("Asistente"),
      });
      const plain = goal("1");
      const data = normalizeEspnSummary(
        summary({
          keyEvents: [assistedFirst ? assisted : plain],
          scoringPlays: [assistedFirst ? plain : assisted],
        }),
        match,
        event,
      )!;
      expect(data.goals).toHaveLength(1);
      expect(data.goals[0].assist).toBe("Asistente");
    }
  });
  it("no confunde goles diferentes que reutilicen ID ni dos goles con ID propio en un minuto", () => {
    const data = normalizeEspnSummary(
      summary({
        keyEvents: [
          goal("1", "Goal", { clock: { displayValue: "20'" } }),
          goal("1", "Goal", { clock: { displayValue: "21'" } }),
          goal("2", "Goal", { clock: { displayValue: "21'" } }),
        ],
        scoringPlays: [
          goal("1", "Goal", {
            clock: { displayValue: "20" },
            assist: athlete("Asistente"),
          }),
        ],
      }),
      match,
      event,
    )!;
    expect(data.goals).toHaveLength(3);
    expect(data.goals[0].assist).toBe("Asistente");
  });

  it("rechaza candidatos ambiguos, calendarios inválidos y equipos sin identificar", () => {
    expect(findEspnEvent(match, [event, { ...event, id: "778" }])).toBeNull();
    expect(() => parseEspnScoreboard({ error: "unavailable" }, "PD")).toThrow();
    expect(
      parseEspnScoreboard(
        {
          events: [
            {
              competitions: [
                { ...competition, competitors: [{ homeAway: "home" }] },
              ],
            },
          ],
        },
        "PD",
      ),
    ).toEqual([]);
  });
  it("revalida la cabecera de summary y no acepta otro partido ni competición", () => {
    expect(normalizeEspnSummary(summary(), match, event)).not.toBeNull();
    expect(
      normalizeEspnSummary(
        { header: { competitions: [{ ...competition, id: "778" }] } },
        match,
        event,
      ),
    ).toBeNull();
    expect(
      normalizeEspnSummary(
        {
          header: {
            competitions: [{ ...competition, date: "2026-11-01T20:00:00Z" }],
          },
        },
        match,
        event,
      ),
    ).toBeNull();
    expect(
      normalizeEspnSummary(
        summary({
          header: {
            league: { slug: "uefa.champions" },
            competitions: [competition],
          },
        }),
        match,
        event,
      ),
    ).toBeNull();
  });
  it("normaliza goles, penaltis, autogoles y asistencias sin incluir la tanda ni goles anulados", () => {
    const data = normalizeEspnSummary(
      summary({
        keyEvents: [
          goal("1", "Goal", {
            participants: [
              { ...athlete("Goleador"), type: "scorer" },
              { ...athlete("Asistente"), type: "assist" },
            ],
          }),
          goal("2", "Penalty - Scored", { clock: { displayValue: "42'" } }),
          goal("3", "Own Goal", {
            clock: { displayValue: "60'" },
            team: { id: "83" },
            scoringTeam: { id: "86" },
          }),
          goal("4", "Penalty Shootout"),
          goal("5", "Goal", { period: { number: 5 } }),
          goal("6", "Disallowed Goal"),
          goal("7", "Goal", { scoringPlay: false }),
          goal("8", "Penalty missed"),
          goal("9", "Goal", { team: { id: "999" } }),
          goal("10", "Goal", { clock: {} }),
          goal("11", "Own Goal"),
        ],
      }),
      match,
      event,
    )!;
    expect(data.goals).toEqual([
      {
        side: "home",
        minute: "90'+2'",
        scorer: "Goleador",
        assist: "Asistente",
        kind: "goal",
      },
      { side: "home", minute: "42'", scorer: "Jugador local", kind: "penalty" },
      {
        side: "away",
        minute: "60'",
        scorer: "Jugador local",
        kind: "own-goal",
      },
    ]);
    expect(validMatchInsight(data)).toBe(true);
  });
  it("deduplica eventos repetidos entre las dos listas y acepta scoringPlays sin keyEvents", () => {
    const single = goal("1");
    const normalized = normalizeEspnSummary(
      summary({ keyEvents: [single], scoringPlays: [{ ...single, id: "2" }] }),
      match,
      event,
    )!;
    expect(normalized.goals).toHaveLength(1);
    expect(
      normalizeEspnSummary(summary({ scoringPlays: [single] }), match, event)
        ?.goals,
    ).toHaveLength(1);
  });
  it("solo publica jugadores con titularidad explícita y conserva dorsales y posición", () => {
    const data = normalizeEspnSummary(
      summary({
        rosters: [
          {
            team: { id: "83" },
            formation: "4-3-3",
            roster: [
              {
                ...athlete("Portero"),
                starter: true,
                jersey: "1",
                position: { abbreviation: "GK" },
              },
              { ...athlete("Suplente"), starter: false, jersey: 12 },
              { ...athlete("Plantilla sin confirmar") },
            ],
          },
          {
            team: { id: "999" },
            roster: [{ ...athlete("Equipo incorrecto"), starter: true }],
          },
        ],
      }),
      match,
      event,
    )!;
    expect(data.lineups).toEqual([
      {
        side: "home",
        formation: "4-3-3",
        players: [
          { name: "Portero", starter: true, number: "1", position: "GK" },
          { name: "Suplente", starter: false, number: "12" },
        ],
      },
    ]);
  });
  it("guarda los números de quien ha jugado y el minuto de sus cambios, nunca de un suplente sin jugar", () => {
    const stat = (name: string, value: number | string) =>
      typeof value === "number"
        ? { name, value, displayValue: String(value) }
        : { name, displayValue: value };
    const change = (minute: string) => ({
      clock: { displayValue: minute },
      substitution: true,
    });
    const data = normalizeEspnSummary(
      summary({
        rosters: [
          {
            team: { id: "83" },
            roster: [
              {
                ...athlete("Extremo"),
                starter: true,
                subbedOut: true,
                plays: [
                  { clock: { displayValue: "7'" }, scoringPlay: true },
                  change("70'"),
                ],
                stats: [
                  stat("appearances", 1),
                  stat("totalShots", 6),
                  stat("shotsOnTarget", "3"),
                  stat("totalGoals", 1),
                  stat("yellowCards", 1),
                  stat("ownGoals", 0),
                  stat("foulsCommitted", "--"),
                ],
              },
              {
                ...athlete("Revulsivo"),
                starter: false,
                subbedIn: true,
                plays: [change("70'")],
                stats: [stat("appearances", 1), stat("totalShots", 0)],
              },
              {
                ...athlete("Sin jugar"),
                starter: false,
                stats: [stat("appearances", 0), stat("totalShots", 0)],
              },
              {
                ...athlete("Portero"),
                starter: true,
                stats: [stat("appearances", 1), stat("saves", 5)],
              },
            ],
          },
        ],
      }),
      match,
      event,
    )!;
    expect(data.lineups[0].players).toEqual([
      {
        name: "Extremo",
        starter: true,
        subOut: "70'",
        stats: { shots: 6, shotsOnTarget: 3, goals: 1, yellowCards: 1 },
      },
      { name: "Revulsivo", starter: false, subIn: "70'", stats: { shots: 0 } },
      { name: "Sin jugar", starter: false },
      { name: "Portero", starter: true, stats: { saves: 5 } },
    ]);
    expect(validMatchInsight(data)).toBe(true);
    const player = (extra: Record<string, unknown>) => ({
      ...data,
      lineups: [
        { side: "home", players: [{ name: "A", starter: true, ...extra }] },
      ],
    });
    expect(validMatchInsight(player({ stats: { shots: -1 } }))).toBe(false);
    expect(validMatchInsight(player({ stats: { shots: 1.5 } }))).toBe(false);
    expect(validMatchInsight(player({ stats: { rating: 7 } }))).toBe(false);
    expect(validMatchInsight(player({ subIn: "" }))).toBe(false);
  });
  it("lee córners y la precisión de pase reales, y ordena las estadísticas", () => {
    const team = (id: string, stats: Record<string, string>) => ({
      team: { id },
      statistics: Object.entries(stats).map(([name, displayValue]) => ({
        name,
        displayValue,
      })),
    });
    const data = normalizeEspnSummary(
      summary({
        boxscore: {
          teams: [
            team("83", {
              foulsCommitted: "14",
              wonCorners: "4",
              possessionPct: "64.8",
              accuratePasses: "552",
              totalPasses: "603",
              passPct: "0.9",
              totalCrosses: "10",
              totalTackles: "18",
              totalClearance: "23",
            }),
            team("86", {
              foulsCommitted: "9",
              wonCorners: "8",
              possessionPct: "35.2",
              passPct: "0.8",
              totalCrosses: "11",
              totalTackles: "18",
              totalClearance: "12",
            }),
          ],
        },
      }),
      match,
      event,
    )!;
    // With the pass counts the figure is exact; without them, the ratio as a percentage.
    expect(data.statistics).toEqual([
      { label: "Posesión", home: "64.8%", away: "35.2%" },
      { label: "Córners", home: "4", away: "8" },
      { label: "Precisión de pase", home: "92%", away: "80%" },
      { label: "Centros", home: "10", away: "11" },
      { label: "Entradas", home: "18", away: "18" },
      { label: "Despejes", home: "23", away: "12" },
      { label: "Faltas", home: "14", away: "9" },
    ]);
  });
  it("publica solo estadísticas numéricas presentes en ambos equipos y no inventa ceros", () => {
    const data = normalizeEspnSummary(
      summary({
        boxscore: {
          players: [
            {
              team: { id: "83" },
              statistics: [
                { name: "possessionPct", displayValue: "62.5" },
                { name: "shotsOnTarget", displayValue: "0" },
                { name: "cornerKicks", displayValue: "3" },
              ],
            },
            {
              team: { id: "86" },
              statistics: [
                { name: "possessionPct", displayValue: "37.5%" },
                { name: "shotsOnTarget", displayValue: "2" },
                { name: "cornerKicks", displayValue: "--" },
              ],
            },
          ],
        },
        gameInfo: {
          venue: { fullName: "Estadio" },
          attendance: 45000,
          officials: [{ type: "Referee", displayName: "Árbitro" }],
        },
      }),
      match,
      event,
    )!;
    expect(data.statistics).toEqual([
      { label: "Posesión", home: "62.5%", away: "37.5%" },
      { label: "Remates a puerta", home: "0", away: "2" },
    ]);
    expect(data).toMatchObject({
      venue: "Estadio",
      attendance: 45000,
      referee: "Árbitro",
    });
    expect(normalizeEspnSummary(summary(), match, event)).toMatchObject({
      goals: [],
      lineups: [],
      statistics: [],
    });
  });
  it("usa hosts y rutas fijos, no envía claves y detiene HTTP 429 sin reintento masivo", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(scoreboard), { status: 200 }),
      );
    const client = createEspnClient(request);
    await client.scoreboard("PD", "20261028", "20261029");
    expect(request.mock.calls[0][0]).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=20261028-20261029&limit=100",
    );
    expect(request.mock.calls[0][1]?.headers).toEqual({
      Accept: "application/json",
    });
    await expect(client.summary("PD", "../../secret")).rejects.toThrow();
    request.mockResolvedValue(
      new Response("provider details", { status: 429 }),
    );
    await expect(client.summary("CL", "777")).rejects.toBeInstanceOf(
      EspnRequestError,
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("recupera un rango 400 por días, deduplica y no reintenta 429", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 400 }))
      .mockImplementation(async () => new Response(JSON.stringify(scoreboard)));
    const client = createEspnClient(request);
    expect(await client.scoreboard("PD", "20261028", "20261029")).toHaveLength(
      1,
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(String(request.mock.calls[1][0])).toContain("dates=20261028&");
    expect(String(request.mock.calls[2][0])).toContain("dates=20261029&");
    request.mockClear().mockResolvedValue(new Response("", { status: 429 }));
    await expect(
      client.scoreboard("PD", "20261028", "20261029"),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("limita recuperación a cinco días y consultas de cuotas a rutas fijas", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("", { status: 400 }));
    const client = createEspnClient(request);
    await expect(
      client.scoreboard("PD", "20260101", "20260201"),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation(async () => new Response('{"items":[]}'));
    await client.odds!("PL", "777");
    expect(String(request.mock.calls[1][0])).toBe(
      "https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/events/777/competitions/777/odds?limit=10",
    );
    await expect(client.odds!("PL", "../../secret")).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("normaliza tarjetas y cambios solo con jugadores, roles y equipos explícitos", () => {
    const yellow = {
      type: { text: "Yellow Card" },
      team: { id: "83" },
      clock: { displayValue: "35'" },
      participants: [athlete("Jugador amonestado")],
    };
    const sub = {
      type: { text: "Substitution" },
      team: { id: "86" },
      clock: { displayValue: "60'" },
      participants: [
        { ...athlete("Entra"), type: "substitution-on" },
        { ...athlete("Sale"), type: "substitution-off" },
      ],
    };
    const result = normalizeEspnSummary(
      summary({
        keyEvents: [
          yellow,
          yellow,
          sub,
          { ...yellow, team: { id: "invalid" } },
          { ...sub, participants: [athlete("Desconocido")] },
        ],
      }),
      match,
      event,
    )!;
    expect(result.incidents).toHaveLength(2);
    expect(result.incidents![0]).toMatchObject({
      kind: "yellow-card",
      side: "home",
      player: "Jugador amonestado",
    });
    expect(result.incidents![1]).toMatchObject({
      kind: "substitution",
      side: "away",
      player: "Entra",
      playerOut: "Sale",
    });
  });
  it("aplica un presupuesto de 50 peticiones sin enviar la siguiente", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("{}"));
    const client = createEspnClient(request);
    for (let i = 0; i < 50; i++) await client.summary("PD", "777");
    await expect(client.summary("PD", "777")).rejects.toThrow("límite interno");
    expect(request).toHaveBeenCalledTimes(50);
  });
  it("convierte timeout y JSON inválido en errores seguros", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("arbitrary provider detail"));
    await expect(
      createEspnClient(request).summary("PD", "777"),
    ).rejects.toThrow("ESPN no respondió");
    request.mockResolvedValue(new Response("<html>unavailable</html>"));
    await expect(
      createEspnClient(request).summary("PD", "777"),
    ).rejects.toThrow("ESPN no respondió");
  });
});

describe("ESPN Last 5 matchups", () => {
  const previous = (id: string, date = "2026-10-01T19:00:00Z") => ({
    id,
    date,
    competitors: [
      {
        homeAway: "home",
        team: { id: "86", displayName: "Real Madrid" },
        score: "2",
      },
      {
        homeAway: "away",
        team: { id: "83", displayName: "Barcelona" },
        score: { value: 1 },
      },
    ],
    status: { type: { completed: true, state: "post" } },
  });
  it("conserva la localía histórica, ordena, deduplica y limita a cinco", () => {
    const games = Array.from({ length: 7 }, (_, i) =>
      previous(
        String(100 + i),
        `2026-10-${String(i + 1).padStart(2, "0")}T19:00:00Z`,
      ),
    );
    const result = normalizeEspnSummary(
      summary({ headToHeadGames: [{ events: [...games, games[0]] }] }),
      match,
      event,
      "2026-10-28T19:00:00Z",
    )!;
    expect(result.matchups).toHaveLength(5);
    expect(result.matchups?.[0]).toMatchObject({
      id: "106",
      home: "Real Madrid",
      away: "Barcelona",
      homeScore: 2,
      awayScore: 1,
    });
    expect(validMatchInsight(result)).toBe(true);
  });
  it("descarta otros equipos, resultados ausentes, futuros y partidos sin terminar", () => {
    const game = previous("1");
    const games = [
      { ...game, id: "777" },
      previous("2", match.utcDate),
      { ...game, competitors: [game.competitors[0]] },
      { ...game, status: { type: { completed: false } } },
      {
        ...game,
        competitors: [
          game.competitors[0],
          { ...game.competitors[1], score: null },
        ],
      },
      {
        ...game,
        competitors: [
          game.competitors[0],
          { ...game.competitors[1], team: { id: "999", displayName: "Otro" } },
        ],
      },
    ];
    expect(
      normalizeEspnSummary(
        summary({ headToHeadGames: games }),
        match,
        event,
        "2026-10-28T19:00:00Z",
      )?.matchups,
    ).toEqual([]);
  });
  it("admite equipos explícitos, sin confundir lastFiveGames con enfrentamientos", () => {
    const compact = {
      id: "3",
      date: "2026-09-01T19:00:00Z",
      homeTeam: { id: "83", displayName: "Barcelona" },
      awayTeam: { id: "86", displayName: "Real Madrid" },
      homeTeamScore: 0,
      awayTeamScore: 0,
    };
    expect(
      normalizeEspnSummary(
        summary({ headToHeadGames: [compact] }),
        match,
        event,
      )?.matchups?.[0],
    ).toMatchObject({ homeScore: 0, awayScore: 0 });
    expect(
      normalizeEspnSummary(
        summary({ lastFiveGames: [previous("1")] }),
        match,
        event,
      )?.matchups,
    ).toEqual([]);
  });
});
