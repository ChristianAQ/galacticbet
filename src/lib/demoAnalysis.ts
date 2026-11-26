import {
  matchOptions,
  pickKey,
  type AnalysisBoard,
  type AnalysisPick,
  type BetMarket,
  type MarketPrice,
  type MatchMarket,
} from "./bettingAnalysis";

/** Example prices of a match: [market, selection, line, price, chance without margin]. */
function demoOptions(rows: [BetMarket, string, number | null, number, number][]) {
  const prices: MarketPrice[] = rows.map(([market, selection, line, price, fair]) => ({
    market,
    selection,
    ...(line !== null ? { line } : {}),
    price,
    sharp: Math.round(price * 103) / 100,
    fair,
  }));
  return matchOptions(prices);
}
import { demoMatches } from "./demo";

/**
 * Demo only: what an analysis looks like, on the demo fixtures. Clearly an
 * example; the real one needs real prices and is never invented.
 */
export function demoAnalysisBoard(): AnalysisBoard {
  const [clasico, atleti, derbi] = demoMatches;
  const game = (
    m: (typeof demoMatches)[number],
    preview: string,
    pick: AnalysisPick,
    market: MatchMarket,
    sources: string[],
    options: ReturnType<typeof demoOptions>,
  ) => ({
    matchId: m.id,
    home: m.home,
    away: m.away,
    utcDate: m.utcDate,
    ...(m.homeCrest ? { homeCrest: m.homeCrest } : {}),
    ...(m.awayCrest ? { awayCrest: m.awayCrest } : {}),
    preview,
    pick,
    market,
    sources,
    options,
  });
  const btts: AnalysisPick = {
    matchId: clasico.id,
    market: "BTTS",
    selection: "yes",
    price: 1.62,
    probability: 0.68,
    fair: 0.6,
    confidence: "media",
    reason: "Ambos marcan en el 75 % de sus partidos y los dos han recibido gol en sus cuatro últimos encuentros.",
    risk: "Un gol tempranero puede llevar a uno de los dos a cerrarse atrás.",
  };
  const atletiWin: AnalysisPick = {
    matchId: atleti.id,
    market: "1X2",
    selection: "1",
    price: 1.95,
    probability: 0.55,
    fair: 0.5,
    confidence: "baja",
    reason: "Siete victorias en ocho partidos en casa y un Betis con tres bajas en el centro del campo.",
    risk: "El Betis ya sorprendió en este estadio la temporada pasada.",
  };
  // A player's bet: no Pinnacle price for these, only the bookmaker's.
  const scorer: AnalysisPick = {
    matchId: derbi.id,
    market: "SCORER",
    selection: "yes",
    player: "Mikel Oyarzabal",
    price: 3.6,
    probability: 0.31,
    confidence: "baja",
    reason: "Lanza los penaltis y ha marcado en cuatro de sus seis últimos derbis; llega descansado tras no jugar entre semana.",
    risk: "Si el partido se cierra, apenas le llegarán balones.",
  };
  const at = new Date(Date.now() - 18 * 60_000).toISOString();
  return {
    formatVersion: 1,
    updatedAt: at,
    analyses: [
      {
        id: `PD-${clasico.utcDate.slice(0, 10)}`,
        competition: "PD",
        date: clasico.utcDate.slice(0, 10),
        generatedAt: at,
        oddsAt: at,
        bookmaker: "bet365",
        headline: "Ejemplo: goles en el Clásico y un Atleti algo infravalorado",
        summary: "El Clásico apunta a goles y el Atleti llega fuerte en casa; el derbi vasco, sin valor claro.",
        matches: [
          game(
            clasico,
            "Los dos llegan con la defensa adelantada y marcan en casi todos sus partidos: todo apunta a un partido abierto.",
            btts,
            { home: 0.45, draw: 0.25, away: 0.3, over25: 0.62, btts: 0.6, source: "Pinnacle" },
            ["marca.com", "as.com"],
            demoOptions([
              ["1X2", "1", null, 2.1, 0.45], ["1X2", "X", null, 3.8, 0.25], ["1X2", "2", null, 3.2, 0.3],
              ["DC", "1X", null, 1.36, 0.7], ["DC", "12", null, 1.27, 0.75], ["DC", "X2", null, 1.73, 0.55],
              ["BTTS", "yes", null, 1.62, 0.6], ["BTTS", "no", null, 2.35, 0.4],
              ["OU", "over", 2.5, 1.55, 0.62], ["OU", "under", 2.5, 2.45, 0.38],
            ]),
          ),
          game(
            atleti,
            "El Atleti es muy fiable en casa; el Betis viene de rotar y suma bajas en el centro del campo.",
            atletiWin,
            { home: 0.5, draw: 0.27, away: 0.23, over25: 0.44, btts: 0.45, source: "Pinnacle" },
            ["mundodeportivo.com"],
            demoOptions([
              ["1X2", "1", null, 1.95, 0.5], ["1X2", "X", null, 3.5, 0.27], ["1X2", "2", null, 4.1, 0.23],
              ["DC", "1X", null, 1.27, 0.77], ["DC", "12", null, 1.32, 0.73], ["DC", "X2", null, 1.97, 0.5],
              ["BTTS", "yes", null, 2.1, 0.45], ["BTTS", "no", null, 1.7, 0.55],
              ["OU", "over", 2.5, 2.15, 0.44], ["OU", "under", 2.5, 1.7, 0.56],
            ]),
          ),
          game(derbi, "Derbi vasco igualado y de pocos goles: el mercado lo ve parejo y no hay valor claro.", {
            matchId: derbi.id,
            market: "OU",
            selection: "under",
            line: 2.5,
            price: 1.7,
            probability: 0.57,
            fair: 0.58,
            confidence: "media",
            reason: "Siete de los últimos ocho derbis acabaron con menos de tres goles y los dos llegan con bajas en ataque.",
            risk: "Si hay un gol pronto, el partido puede abrirse.",
          }, { home: 0.38, draw: 0.32, away: 0.3, over25: 0.42, btts: 0.47, source: "Pinnacle" }, [], demoOptions([
            ["1X2", "1", null, 2.5, 0.38], ["1X2", "X", null, 3, 0.32], ["1X2", "2", null, 3.2, 0.3],
            ["DC", "1X", null, 1.4, 0.7], ["DC", "12", null, 1.47, 0.68], ["DC", "X2", null, 1.55, 0.62],
            ["BTTS", "yes", null, 2, 0.47], ["BTTS", "no", null, 1.75, 0.53],
            ["OU", "over", 2.5, 2.3, 0.42], ["OU", "under", 2.5, 1.7, 0.58],
          ])),
        ],
        picks: [btts, atletiWin, scorer],
        // Two value bets of different matches: the day's combinada.
        combo: [pickKey(btts), pickKey(atletiWin)],
      },
    ],
  };
}
