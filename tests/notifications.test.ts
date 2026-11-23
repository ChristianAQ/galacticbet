import { describe, expect, it } from "vitest";
import { resultMessages, type CompletedRound } from "../scripts/notifications";
import { validPushEndpoint } from "../scripts/push";

const standing = (points: number, roundPoints: number) => ({
  points,
  hits: points,
  rounds: { "PD-2026-REGULAR_SEASON-13": { points: roundPoints, hits: roundPoints } },
});
const completed = (rows: [string, number, number][], sealed = rows.map(([uid]) => uid)): CompletedRound => ({
  groupId: "g1",
  groupName: "Los del barrio",
  competition: "PD",
  roundId: "PD-2026-REGULAR_SEASON-13",
  lastKickoff: Date.now(),
  standings: new Map(rows.map(([uid, total, r]) => [uid, standing(total, r)])),
  names: new Map([
    ["ana", "Ana"],
    ["bruno", "Bruno"],
    ["carla", "Carla"],
  ]),
  sealed,
});

describe("Avisos: a quién y con qué texto", () => {
  it("al acabar la jornada dice tu puesto entre quienes sellaron, y solo a ellos", () => {
    const messages = resultMessages(
      completed(
        [
          ["ana", 30, 9],
          ["bruno", 32, 4],
          ["carla", 12, 0],
          ["dani", 20, 0],
        ],
        ["ana", "bruno", "carla"],
      ),
    );
    // Dani didn't seal: no aviso.
    expect([...messages.keys()].sort()).toEqual(["ana", "bruno", "carla"]);
    expect(messages.get("ana")!.body).toBe("¡Has ganado la jornada en Los del barrio con 9 puntos! 1.º de 3.");
    expect(messages.get("bruno")!.body).toBe("Has quedado 2.º de 3 en Los del barrio con 4 puntos.");
    expect(messages.get("carla")!.body).toBe("Has quedado 3.º de 3 en Los del barrio con 0 puntos.");
    expect(messages.get("carla")!.title).toBe("LaLiga · Jornada 13 terminada");
    expect(messages.get("carla")!.url).toBe(
      "./#/quiniela?vista=clasificacion&group=g1&round=PD-2026-REGULAR_SEASON-13",
    );
    expect(messages.get("carla")!.tag).toBe("result-g1-PD-2026-REGULAR_SEASON-13");
  });

  it("empates, nadie puntúa, un solo boleto y nadie selló", () => {
    const tie = resultMessages(
      completed([
        ["ana", 10, 5],
        ["bruno", 10, 5],
        ["carla", 3, 1],
      ]),
    );
    expect(tie.get("ana")!.body).toBe("Has ganado la jornada en Los del barrio (empate a 5 puntos). 1.º de 3.");
    expect(tie.get("carla")!.body).toBe("Has quedado 3.º de 3 en Los del barrio con 1 punto.");
    const blank = resultMessages(completed([["ana", 0, 0], ["bruno", 0, 0]]));
    expect(blank.get("ana")!.body).toBe("Has quedado 1.º de 2 (empate) en Los del barrio con 0 puntos.");
    const alone = resultMessages(completed([["ana", 7, 7], ["bruno", 3, 0]], ["ana"]));
    expect([...alone.keys()]).toEqual(["ana"]);
    expect(alone.get("ana")!.body).toBe("Has sumado 7 puntos en Los del barrio: eras el único que selló el boleto.");
    expect(resultMessages(completed([["ana", 0, 0]], [])).size).toBe(0);
  });

  it("solo envía a servicios de avisos de navegadores", () => {
    expect(validPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(validPushEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(validPushEndpoint("https://db5.notify.windows.com/w/?token=x")).toBe(true);
    for (const bad of [
      "http://web.push.apple.com/a",
      "https://web.push.apple.com.evil.test/a",
      "https://127.0.0.1/a",
      "https://user:pw@fcm.googleapis.com/a",
      "https://fcm.googleapis.com:8443/a",
      42,
    ])
      expect(validPushEndpoint(bad)).toBe(false);
  });
});
