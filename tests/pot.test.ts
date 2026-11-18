import { describe, expect, it } from "vitest";
import {
  groupPotCents,
  parsePotInput,
  potInputValue,
  potText,
  roundPot,
} from "../src/lib/pot";
import type { RankingRow } from "../src/lib/rankings";

const plain = (text: string) => text.replace(/\u00a0/g, " ");
const row = (id: string, points: number, position = 1): RankingRow => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  avatar: null,
  points,
  hits: points,
  position,
});

describe("bote informativo por jornada", () => {
  const rows = [row("ana", 7, 1), row("beto", 5, 2), row("carla", 3, 3)];

  it("solo suman al bote quienes entregaron la jornada y sin comisión", () => {
    const pot = roundPot({
      contributionCents: 500,
      rows,
      participantIds: ["ana", "beto", "carla"],
      started: true,
      complete: true,
    });
    expect(pot.totalCents).toBe(1500);
    expect(pot.state).toBe("settled");
    expect(pot.leaders.map((r) => r.id)).toEqual(["ana"]);
    expect(pot.shareCents).toBe(1500);
    expect(plain(potText(pot))).toBe(
      "Bote: 15,00 € (3 × 5,00 €) · Ganador: Ana · 15,00 €",
    );
  });

  it("el líder se calcula entre participantes, no entre todo el grupo", () => {
    const pot = roundPot({
      contributionCents: 500,
      rows,
      participantIds: ["beto", "carla", "exmiembro"],
      started: true,
      complete: false,
    });
    expect(pot.state).toBe("live");
    expect(pot.players.map((r) => r.id)).toEqual(["beto", "carla"]);
    expect(pot.totalCents).toBe(1000);
    expect(pot.leaders.map((r) => r.id)).toEqual(["beto"]);
  });

  it("reparte empates y conserva los céntimos que no se pueden dividir", () => {
    const pot = roundPot({
      contributionCents: 500,
      rows: [row("ana", 4), row("beto", 4), row("carla", 4)],
      participantIds: ["ana", "beto", "carla"],
      started: true,
      complete: true,
    });
    expect(pot.leaders).toHaveLength(3);
    expect(pot.shareCents).toBe(500);
    const odd = roundPot({
      contributionCents: 100,
      rows: [row("ana", 2), row("beto", 2), row("carla", 1)],
      participantIds: ["ana", "beto", "carla"],
      started: true,
      complete: true,
    });
    expect(odd.shareCents).toBe(150);
    expect(odd.remainderCents).toBe(0);
    const uneven = roundPot({
      contributionCents: 100,
      rows: [row("ana", 2), row("beto", 2), row("carla", 2), row("dani", 0)],
      participantIds: ["ana", "beto", "carla", "dani"],
      started: true,
      complete: true,
    });
    expect(uneven.shareCents).toBe(133);
    expect(uneven.remainderCents).toBe(1);
  });

  it("distingue bote desactivado, sin entregas y jornada abierta", () => {
    const base = { rows, started: false, complete: false };
    expect(
      roundPot({ ...base, contributionCents: 0, participantIds: ["ana"] })
        .state,
    ).toBe("off");
    expect(
      roundPot({ ...base, contributionCents: 500, participantIds: [] }).state,
    ).toBe("empty");
    const open = roundPot({
      ...base,
      contributionCents: 500,
      participantIds: ["ana", "beto"],
    });
    expect(open.state).toBe("open");
    expect(open.leaders).toEqual([]);
    expect(plain(potText(open))).toBe("Bote: 10,00 € (2 × 5,00 €)");
  });

  it("ignora valores de bote no válidos guardados en el grupo", () => {
    expect(groupPotCents({ potCents: 500 })).toBe(500);
    expect(groupPotCents({ potCents: -5 })).toBe(0);
    expect(groupPotCents({ potCents: "500" })).toBe(0);
    expect(groupPotCents({})).toBe(0);
    expect(groupPotCents(null)).toBe(0);
  });

  it("interpreta la aportación escrita en euros", () => {
    expect(parsePotInput("5")).toBe(500);
    expect(parsePotInput("2,5")).toBe(250);
    expect(parsePotInput("0.75")).toBe(75);
    expect(parsePotInput("")).toBe(0);
    expect(parsePotInput("1001")).toBeNull();
    expect(parsePotInput("-1")).toBeNull();
    expect(parsePotInput("abc")).toBeNull();
    expect(potInputValue(500)).toBe("5");
    expect(potInputValue(250)).toBe("2,50");
    expect(potInputValue(0)).toBe("");
  });
});
