import { Bot, Target } from "lucide-react";
import { useMemo } from "react";
import { isCompetition } from "../lib/competitions";
import type { Match, Mode, Outcome } from "../lib/domain";
import { machineDuel } from "../lib/machinePicks";
import { predictorProfile } from "../lib/predictorProfile";
import type { SeasonRanking } from "../lib/rankings";
import { useMachinePicks } from "../lib/useMachinePicks";
import { useOwnSlips } from "../lib/useOwnSlips";
import "../styles/chances.css";

const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)} %`;
const signWord: Record<Outcome, string> = { "1": "tus 1", X: "tus X", "2": "tus 2" };
const list = (items: string[]) => new Intl.ListFormat("es", { type: "conjunction" }).format(items);

/**
 * The season in Clasificación, seen two more ways: against «IA» and
 * «Favorito» (their slips frozen before each round, as yours), and what
 * your own slips say about you. Only finished rounds; nothing shows until
 * there is something to say.
 */
export default function MachineInsights({
  groupId,
  seasons,
  matches,
  userId,
  scope,
}: {
  groupId: string;
  seasons: SeasonRanking[];
  matches: Match[];
  userId: string;
  /** A competition, or «global». */
  scope: string;
}) {
  const inScope = seasons.filter((s) => isCompetition(s.competition) && (scope === "global" || scope === s.competition));
  const machines = useMachinePicks(inScope.map((s) => s.id));
  const duel = useMemo(
    () => machineDuel({ machines, seasons: inScope, matches, userId, scope }),
    [machines, seasons, matches, userId, scope],
  );
  // Your scored rounds: the ones with a delivered slip to read.
  const roundIds = inScope.flatMap((s) => Object.keys(s.standings.find((r) => r.id === userId)?.rounds ?? {}));
  const { slips, ready } = useOwnSlips(userId, groupId, roundIds, roundIds.length > 0);
  const profile = useMemo(
    () =>
      ready
        ? predictorProfile({
            slips,
            matches,
            modes: Object.fromEntries(inScope.map((s) => [s.id, (s.mode ?? "classic") as Mode])),
            machines,
          })
        : null,
    [ready, slips, matches, seasons, scope, machines],
  );
  if (!duel && !profile) return null;
  return (
    <div className="machine-insights">
      {duel && (
        <section className="panel insight-card" aria-labelledby="duel-title">
          <header className="insight-heading">
            <Bot size={18} aria-hidden="true" />
            <h2 id="duel-title">Contra la máquina</h2>
            <small>
              {duel.rounds} {duel.rounds === 1 ? "jornada" : "jornadas"}
            </small>
          </header>
          <dl className="insight-scores">
            <div className="is-me">
              <dt>Tú</dt>
              <dd>{duel.you}</dd>
            </div>
            <div>
              <dt>IA</dt>
              <dd>{duel.ai}</dd>
            </div>
            <div>
              <dt>Favorito</dt>
              <dd>{duel.favorite}</dd>
            </div>
          </dl>
          <p>
            Has batido a la IA en <b>{duel.beatAi}</b> de {duel.rounds} {duel.rounds === 1 ? "jornada" : "jornadas"} y al
            favorito en <b>{duel.beatFavorite}</b>.
            {duel.players > 1 &&
              ` En el grupo, ${duel.aheadOfAi} de ${duel.players} van por delante de la IA en esas jornadas.`}
          </p>
          <p className="insight-note">
            La IA hace su propia quiniela con los datos de la temporada y las noticias, sin cuotas; el favorito elige
            siempre lo que dan más probable las casas. Las dos se cierran antes que la tuya y no cuentan en la tabla.
          </p>
        </section>
      )}
      {profile && (
        <section className="panel insight-card" aria-labelledby="profile-title">
          <header className="insight-heading">
            <Target size={18} aria-hidden="true" />
            <h2 id="profile-title">Tu perfil de pronosticador</h2>
            <small>
              {profile.matches} {profile.matches === 1 ? "partido" : "partidos"}
            </small>
          </header>
          <dl className="insight-scores">
            <div className="is-me">
              <dt>Signos</dt>
              <dd>{pct(profile.hits, profile.matches)}</dd>
            </div>
            <div>
              <dt>Puntos</dt>
              <dd>
                {profile.points}
                <small>/{profile.maxPoints}</small>
              </dd>
            </div>
            {profile.exact > 0 && (
              <div>
                <dt>Exactos</dt>
                <dd>{profile.exact}</dd>
              </div>
            )}
          </dl>
          <ul className="insight-facts">
            <li>
              Aciertas{" "}
              {list(
                (["1", "X", "2"] as Outcome[])
                  .filter((s) => profile.bySign[s].picked > 0)
                  .map((s) => `el ${pct(profile.bySign[s].hits, profile.bySign[s].picked)} de ${signWord[s]}`),
              )}
              .
            </li>
            {profile.upsets.picked > 0 && (
              <li>
                Fuiste contra el favorito {profile.upsets.picked} {profile.upsets.picked === 1 ? "vez" : "veces"} y
                acertaste {profile.upsets.hits}.
              </li>
            )}
            {profile.market.matches >= 5 && (
              <li>
                {profile.market.you > profile.market.favorite
                  ? "Le ganas al mercado"
                  : profile.market.you < profile.market.favorite
                    ? "El mercado te gana"
                    : "Vas igualado con el mercado"}
                : aciertas el {pct(profile.market.you, profile.market.matches)} de los signos y el favorito, el{" "}
                {pct(profile.market.favorite, profile.market.matches)}.
              </li>
            )}
            {profile.best && (
              <li>
                Tu equipo: con el <b>{profile.best.team}</b> sumas {profile.best.points} de{" "}
                {profile.best.points + profile.best.lost} puntos.
              </li>
            )}
            {profile.costliest && profile.costliest.lost > 0 && (
              <li>
                Tu bestia negra: el <b>{profile.costliest.team}</b> te ha costado {profile.costliest.lost}{" "}
                {profile.costliest.lost === 1 ? "punto" : "puntos"}.
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
