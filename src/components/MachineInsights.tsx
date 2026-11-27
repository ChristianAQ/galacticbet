import { Bot, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { isCompetition } from "../lib/competitions";
import type { Match, Mode, Outcome } from "../lib/domain";
import { ghostSlips, machineDuel } from "../lib/machinePicks";
import { predictorProfile, type PredictorProfile } from "../lib/predictorProfile";
import Segmented from "./Segmented";
import type { SeasonRanking } from "../lib/rankings";
import { useMachinePicks } from "../lib/useMachinePicks";
import { useOwnSlips } from "../lib/useOwnSlips";
import "../styles/chances.css";

const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)} %`;
const list = (items: string[]) => new Intl.ListFormat("es", { type: "conjunction" }).format(items);

/**
 * The season in Clasificación, seen two more ways: against «IA» and
 * «Favorito» (their slips frozen before each round, as yours), and what
 * your own slips say about you, or the AI's about it. Only finished rounds;
 * nothing shows until there is something to say.
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
  const modes = Object.fromEntries(inScope.map((s) => [s.id, (s.mode ?? "classic") as Mode]));
  const profile = useMemo(
    () => (ready ? predictorProfile({ slips, matches, modes, machines }) : null),
    [ready, slips, matches, seasons, scope, machines],
  );
  // The AI's slips of the season, scored the group's way: its own profile.
  const aiProfile = useMemo(
    () => predictorProfile({ slips: ghostSlips(machines, modes, "ai"), matches, modes, machines }),
    [matches, seasons, scope, machines],
  );
  const [chosen, setChosen] = useState<"you" | "ai">("you");
  const who = profile && aiProfile ? chosen : profile ? "you" : "ai";
  const shown = who === "you" ? profile : aiProfile;
  if (!duel && !shown) return null;
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
      {shown && (
        <section className="panel insight-card" aria-labelledby="profile-title">
          <header className="insight-heading">
            <Target size={18} aria-hidden="true" />
            <h2 id="profile-title">{who === "you" ? "Tu perfil de pronosticador" : "El perfil de la IA"}</h2>
            <small>
              {shown.matches} {shown.matches === 1 ? "partido" : "partidos"}
            </small>
          </header>
          {profile && aiProfile && (
            <Segmented<"you" | "ai">
              label="De quién es el perfil"
              size="sm"
              value={who}
              onChange={setChosen}
              options={[
                { value: "you", label: "Tú" },
                { value: "ai", label: "IA" },
              ]}
            />
          )}
          <ProfileFacts profile={shown} who={who} />
          {who === "ai" && (
            <p className="insight-note">
              La quiniela que la IA hace en cada jornada antes del cierre, sin ver las cuotas, puntuada como juega este
              grupo.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/** What a profile says, in the second person for you and the third for the AI. */
function ProfileFacts({ profile, who }: { profile: PredictorProfile; who: "you" | "ai" }) {
  const you = who === "you";
  const signs = { "1": you ? "tus 1" : "sus 1", X: you ? "tus X" : "sus X", "2": you ? "tus 2" : "sus 2" } as const;
  return (
    <>
      <dl className="insight-scores">
        <div className={you ? "is-me" : undefined}>
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
          {you ? "Aciertas" : "Acierta"}{" "}
          {list(
            (["1", "X", "2"] as Outcome[])
              .filter((s) => profile.bySign[s].picked > 0)
              .map((s) => `el ${pct(profile.bySign[s].hits, profile.bySign[s].picked)} de ${signs[s]}`),
          )}
          .
        </li>
        {profile.upsets.picked > 0 && (
          <li>
            {you ? "Fuiste" : "Fue"} contra el favorito {profile.upsets.picked}{" "}
            {profile.upsets.picked === 1 ? "vez" : "veces"} y {you ? "acertaste" : "acertó"} {profile.upsets.hits}.
          </li>
        )}
        {profile.market.matches >= 5 && (
          <li>
            {profile.market.you > profile.market.favorite
              ? you
                ? "Le ganas al mercado"
                : "Le gana al mercado"
              : profile.market.you < profile.market.favorite
                ? you
                  ? "El mercado te gana"
                  : "El mercado le gana"
                : you
                  ? "Vas igualado con el mercado"
                  : "Va igualada con el mercado"}
            : {you ? "aciertas" : "acierta"} el {pct(profile.market.you, profile.market.matches)} de los signos y el
            favorito, el {pct(profile.market.favorite, profile.market.matches)}.
          </li>
        )}
        {profile.best && (
          <li>
            {you ? "Tu equipo" : "Su equipo"}: con el <b>{profile.best.team}</b> {you ? "sumas" : "suma"}{" "}
            {profile.best.points} de {profile.best.points + profile.best.lost} puntos.
          </li>
        )}
        {profile.costliest && profile.costliest.lost > 0 && (
          <li>
            {you ? "Tu bestia negra" : "Su bestia negra"}: el <b>{profile.costliest.team}</b>{" "}
            {you ? "te ha costado" : "le ha costado"} {profile.costliest.lost}{" "}
            {profile.costliest.lost === 1 ? "punto" : "puntos"}.
          </li>
        )}
      </ul>
    </>
  );
}
