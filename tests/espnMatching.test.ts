import { describe, expect, it } from "vitest";
import type { Match } from "../src/lib/domain";
import { findEspnEvent, sameTeam, type EspnEvent } from "../scripts/espn";

// Champions, 24 and 25 November 2026: our names (Football-Data) and ESPN's.
const week: [string, string, string, string, string][] = [
  ["2026-11-24T17:45:00Z", "Galatasaray", "Aston Villa", "Galatasaray", "Aston Villa"],
  ["2026-11-24T17:45:00Z", "Bodø/Glimt", "LASK", "Bodo/Glimt", "LASK Linz"],
  ["2026-11-24T20:00:00Z", "Real Madrid", "PSV", "Real Madrid", "PSV Eindhoven"],
  ["2026-11-24T20:00:00Z", "Man City", "Napoli", "Manchester City", "Napoli"],
  ["2026-11-24T20:00:00Z", "Arsenal", "Dortmund", "Arsenal", "Borussia Dortmund"],
  ["2026-11-24T20:00:00Z", "Feyenoord", "Porto", "Feyenoord Rotterdam", "FC Porto"],
  ["2026-11-24T20:00:00Z", "Sl. Bratislava", "Real Betis", "Slovan Bratislava", "Real Betis"],
  ["2026-11-24T20:00:00Z", "RB Leipzig", "RC Lens", "RB Leipzig", "Lens"],
  ["2026-11-24T20:00:00Z", "Como 1907", "PAE AEK", "Como", "AEK Athens"],
  ["2026-11-25T17:45:00Z", "Sabah FK", "Barça", "Sabah FK", "Barcelona"],
  ["2026-11-25T17:45:00Z", "Slavia Praha", "Villarreal", "Slavia Prague", "Villarreal"],
  ["2026-11-25T20:00:00Z", "Inter", "Stuttgart", "Internazionale", "VfB Stuttgart"],
  ["2026-11-25T20:00:00Z", "Atleti", "Viking", "Atlético Madrid", "Viking FK"],
  ["2026-11-25T20:00:00Z", "PSG", "Roma", "Paris Saint-Germain", "AS Roma"],
  ["2026-11-25T20:00:00Z", "Club Brugge", "Liverpool", "Club Brugge", "Liverpool"],
  ["2026-11-25T20:00:00Z", "Lille", "Bayern", "Lille", "Bayern Munich"],
  ["2026-11-25T20:00:00Z", "Sporting CP", "Man United", "Sporting CP", "Manchester United"],
  ["2026-11-25T20:00:00Z", "Shaktar", "Fenerbahçe", "Shakhtar Donetsk", "Fenerbahce"],
];
const match = (i: number, [utcDate, home, away]: (typeof week)[number]): Match => ({
  id: `m${i}`,
  competition: "CL",
  seasonId: "CL-2026",
  roundId: "CL-2026-LEAGUE_STAGE-5",
  matchday: 5,
  stage: "LEAGUE_STAGE",
  utcDate,
  status: "FINISHED",
  home,
  away,
  homeScore: 1,
  awayScore: 0,
});
const event = (i: number, [kickoff, , , home, away]: (typeof week)[number]): EspnEvent => ({
  id: `e${i}`,
  competition: "CL",
  kickoff,
  home,
  away,
  homeId: `${i}1`,
  awayId: `${i}2`,
});
const events = week.map((w, i) => event(i, w));

describe("emparejar los partidos con ESPN", () => {
  it("encuentra los 18 partidos de Champions de esta semana, cada uno el suyo", () => {
    week.forEach((w, i) => expect(findEspnEvent(match(i, w), events)?.id, `${w[1]} – ${w[2]}`).toBe(`e${i}`));
  });

  it("reconoce el mismo club escrito de otra forma, sin confundir clubes distintos", () => {
    expect(sameTeam("Man City", "Manchester City")).toBe(true);
    // Whichever provider writes the short form, in either order.
    expect(sameTeam("Manchester City FC", "Man City")).toBe(true);
    expect(sameTeam("Slovan Bratislava", "SL Bratislava")).toBe(true);
    expect(sameTeam("SL Bratislava", "Slovan Bratislava")).toBe(true);
    expect(sameTeam("Manchester United FC", "Man City")).toBe(false);
    expect(sameTeam("Viking", "Viking FK")).toBe(true);
    expect(sameTeam("Como 1907", "Como")).toBe(true);
    expect(sameTeam("Dortmund", "Borussia Dortmund")).toBe(true);
    expect(sameTeam("Man City", "Manchester United")).toBe(false);
    expect(sameTeam("Real Madrid", "Real Sociedad")).toBe(false);
    expect(sameTeam("Sporting CP", "Sporting Braga")).toBe(false);
    expect(sameTeam("AC Milan", "AS Roma")).toBe(false);
  });

  it("con un solo club en común, solo si no hay duda: otra hora o dos opciones, ninguno", () => {
    const shaktar = match(0, ["2026-11-25T20:00:00Z", "Shaktar", "Fenerbahçe", "", ""]);
    const late = { ...event(0, ["2026-11-25T21:00:00Z", "", "", "Shakhtar Donetsk", "Fenerbahce"]) };
    expect(findEspnEvent(shaktar, [late])).toBeNull();
    const two = [
      event(1, ["2026-11-25T20:00:00Z", "", "", "Shakhtar Donetsk", "Fenerbahce"]),
      event(2, ["2026-11-25T20:00:00Z", "", "", "Otro", "Fenerbahce"]),
    ];
    expect(findEspnEvent(shaktar, two)).toBeNull();
  });
});
