import { describe, expect, it } from "vitest";
import {
  collectReminders,
  reminderMessage,
  resultMessages,
  type CompletedRound,
} from "../scripts/notifications";
import { validPushEndpoint } from "../scripts/push";

const round = {
  id: "PD-2026-REGULAR_SEASON-13",
  competition: "PD",
  deadline: Date.parse("2026-11-21T20:00:00Z"),
};
const standing = (points: number, roundPoints: number) => ({
  points,
  hits: points,
  rounds: { "PD-2026-REGULAR_SEASON-13": { points: roundPoints, hits: roundPoints } },
});
const completed = (rows: [string, number, number][]): CompletedRound => ({
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
});

describe("Avisos: a quién y con qué texto", () => {
  it("un recordatorio por jugador y jornada, con todos sus grupos pendientes", () => {
    const reminders = collectReminders([
      {
        round,
        groups: [
          { id: "g1", name: "Los del barrio", pending: ["ana", "bruno"] },
          { id: "g2", name: "Oficina", pending: ["ana"] },
        ],
      },
    ]);
    expect(reminders).toHaveLength(2);
    const ana = reminders.find((r) => r.uid === "ana")!;
    expect(ana.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    const message = reminderMessage(ana);
    expect(message.title).toBe("LaLiga · Jornada 13");
    expect(message.body).toBe(
      "Cierra a las 21:00 y aún no has sellado tu quiniela en 2 grupos.",
    );
    expect(message.url).toBe(
      "./#/quiniela?group=g1&round=PD-2026-REGULAR_SEASON-13",
    );
    expect(reminderMessage(reminders.find((r) => r.uid === "bruno")!).body).toMatch(
      /en Los del barrio\.$/,
    );
  });

  it("al cerrar la jornada cuenta los puntos, quién ganó y el puesto en la general", () => {
    const messages = resultMessages(
      completed([
        ["ana", 30, 9],
        ["bruno", 32, 4],
        ["carla", 12, 0],
      ]),
    );
    expect(messages.get("ana")!.body).toBe(
      "¡Has ganado la jornada en Los del barrio con 9 puntos! Vas 2.º en la general.",
    );
    expect(messages.get("bruno")!.body).toBe(
      "Has sumado 4 puntos en Los del barrio. Ganó Ana con 9. Vas 1.º en la general.",
    );
    expect(messages.get("carla")!.title).toBe("LaLiga · Jornada 13 cerrada");
    expect(messages.get("carla")!.url).toBe(
      "./#/quiniela?vista=clasificacion&group=g1&round=PD-2026-REGULAR_SEASON-13",
    );
  });

  it("empates en la jornada y en la general, y jornadas sin puntos", () => {
    const tie = resultMessages(
      completed([
        ["ana", 10, 5],
        ["bruno", 10, 5],
        ["carla", 3, 1],
      ]),
    );
    expect(tie.get("ana")!.body).toBe(
      "Has ganado la jornada en Los del barrio (empate a 5 puntos). Vas 1.º en la general.",
    );
    expect(tie.get("carla")!.body).toMatch(/2 jugadores empataron a 5\. Vas 3\.º/);
    const blank = resultMessages(completed([["ana", 0, 0], ["bruno", 0, 0]]));
    expect(blank.get("ana")!.body).toBe(
      "Nadie ha puntuado en Los del barrio. Vas 1.º en la general.",
    );
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
