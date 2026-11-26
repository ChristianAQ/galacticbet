import type { AnalysisBoard } from "./bettingAnalysis";
import { demoMatches } from "./demo";

/**
 * Demo only: what an analysis looks like, on the demo fixtures. Clearly an
 * example; the real one needs real prices and is never invented.
 */
export function demoAnalysisBoard(): AnalysisBoard {
  const [clasico, atleti, derbi] = demoMatches;
  const game = (m: (typeof demoMatches)[number], preview: string) => ({
    matchId: m.id,
    home: m.home,
    away: m.away,
    utcDate: m.utcDate,
    ...(m.homeCrest ? { homeCrest: m.homeCrest } : {}),
    ...(m.awayCrest ? { awayCrest: m.awayCrest } : {}),
    preview,
  });
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
        summary:
          "Así se ve un análisis en la demo. Con datos reales, la IA compara cada cuota de bet365 con la probabilidad justa de Pinnacle y con la temporada de cada equipo, y solo señala las que pagan de más.",
        matches: [
          game(clasico, "Los dos llegan con la defensa adelantada y marcan en casi todos sus partidos: todo apunta a un partido abierto."),
          game(atleti, "El Atleti es muy fiable en casa; el Betis viene de rotar y suma bajas en el centro del campo."),
          game(derbi, "Derbi vasco igualado y de pocos goles: el mercado lo ve parejo y no hay valor claro."),
        ],
        picks: [
          {
            matchId: clasico.id,
            market: "BTTS",
            selection: "yes",
            price: 1.62,
            probability: 0.68,
            fair: 0.6,
            confidence: "media",
            reason: "Ambos marcan en el 75 % de sus partidos y los dos han recibido gol en sus cuatro últimos encuentros.",
            risk: "Un gol tempranero puede llevar a uno de los dos a cerrarse atrás.",
          },
          {
            matchId: atleti.id,
            market: "1X2",
            selection: "1",
            price: 1.95,
            probability: 0.55,
            fair: 0.5,
            confidence: "baja",
            reason: "Siete victorias en ocho partidos en casa y un Betis con tres bajas en el centro del campo.",
            risk: "El Betis ya sorprendió en este estadio la temporada pasada.",
          },
        ],
      },
    ],
  };
}
