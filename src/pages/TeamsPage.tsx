import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw, Search } from "lucide-react";
import { Empty, PageTitle } from "../components/ui";
import LineupPitch from "../components/LineupPitch";
import Segmented from "../components/Segmented";
import { SkeletonRows } from "../components/Skeleton";
import { useMatchInsight } from "../lib/useMatchInsight";
import { haptic } from "../lib/motion";
import {
  FEATURED_TEAMS,
  playerAge,
  positionName,
  type SquadPlayer,
  type TeamDirectory,
} from "../lib/teamExplorer";
import { loadTeamDirectory } from "../lib/teamDirectoryCache";
import type { Match } from "../lib/domain";
import "../styles/matchExtras.css";
import "../styles/teams.css";

type Tab = "squad" | "lineup";

/** Broad lines of the squad, in the order a team sheet is read. */
const LINES = [
  { id: "gk", label: "Porteros", match: /goalkeeper/i },
  { id: "df", label: "Defensas", match: /defen|back/i },
  { id: "mf", label: "Centrocampistas", match: /midfield/i },
  { id: "fw", label: "Delanteros", match: /offen|forward|winger|striker/i },
] as const;
function lineOf(player: SquadPlayer) {
  return LINES.find((l) => l.match.test(player.position))?.id || "other";
}

const fixtureDate = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
});
const stamp = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

function Lineup({ match, club }: { match: Match; club: number }) {
  const { insight, loading, error, onRetry } = useMatchInsight(match, false);
  return (
    <section className="teams-lineup" aria-label="Alineación del partido">
      {loading ? (
        <SkeletonRows rows={4} variant="line" label="Cargando alineaciones" />
      ) : error ? (
        <Empty
          art="whistle"
          title="La alineación no ha llegado"
          action={
            <button type="button" className="button secondary" onClick={onRetry}>
              <RotateCw size={16} aria-hidden="true" /> Reintentar
            </button>
          }
        >
          No se ha podido cargar el once de este partido.
        </Empty>
      ) : insight?.lineups.some((l) => l.players.some((p) => p.starter)) ? (
        <>
          <LineupPitch
            match={match}
            lineups={insight.lineups}
            initialSide={match.homeTeamId === club ? "home" : "away"}
          />
          <p className="match-extra-note">
            Fuente: ESPN · Actualizado {stamp.format(new Date(insight.fetchedAt))}
          </p>
        </>
      ) : (
        <Empty art="bench" title="Banquillo vacío">
          El once de este partido todavía no se ha publicado.
        </Empty>
      )}
    </section>
  );
}

export default function TeamsPage({
  matches,
  demo = false,
}: {
  matches: Match[];
  demo?: boolean;
}) {
  const [directory, setDirectory] = useState<TeamDirectory | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [club, setClub] = useState<number>(81);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("squad");
  const [fixture, setFixture] = useState("");
  // A stacked page shown again re-runs its effects: keep what is already loaded.
  const loadedKey = useRef("");
  useEffect(() => {
    const key = `${attempt}:${demo}`;
    if (loadedKey.current === key) return;
    let active = true;
    setLoading(!demo);
    setError(false);
    setDirectory(null);
    if (!demo)
      void loadTeamDirectory().then(
        (d) => {
          if (active) {
            loadedKey.current = key;
            setDirectory(d);
            setLoading(false);
          }
        },
        () => {
          if (active) {
            setError(true);
            setLoading(false);
          }
        },
      );
    else loadedKey.current = key;
    return () => {
      active = false;
    };
  }, [attempt, demo]);
  const squad = directory?.teams.find((t) => t.id === club);
  const clubName = FEATURED_TEAMS.find((t) => t.id === club)?.name || "";
  const clubMatches = demo
    ? []
    : matches.filter((m) => m.homeTeamId === club || m.awayTeamId === club);
  const now = Date.now();
  const next = clubMatches
    .filter(
      (m) =>
        Date.parse(m.utcDate) >= now &&
        ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"].includes(m.status),
    )
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate))
    .slice(0, 1);
  const recent = clubMatches
    .filter(
      (m) =>
        Date.parse(m.utcDate) < now &&
        ["FINISHED", "IN_PLAY", "PAUSED"].includes(m.status),
    )
    .sort((a, b) => b.utcDate.localeCompare(a.utcDate))
    .slice(0, 5);
  const fixtures = [...next, ...recent];
  const match = fixtures.find((m) => m.id === fixture) || recent[0] || next[0];
  const query = search.trim().toLocaleLowerCase("es");
  const players = useMemo(
    () =>
      squad?.players.filter((p) =>
        p.name.toLocaleLowerCase("es").includes(query),
      ) || [],
    [squad, query],
  );
  const lines = useMemo(() => {
    const groups = [
      ...LINES.map((l) => ({ id: l.id as string, label: l.label as string })),
      { id: "other", label: "Otros" },
    ];
    return groups
      .map((g) => ({ ...g, players: players.filter((p) => lineOf(p) === g.id) }))
      .filter((g) => g.players.length);
  }, [players]);
  const crest = (id: number) => {
    const m = matches.find((m) => m.homeTeamId === id || m.awayTeamId === id);
    return m?.homeTeamId === id ? m.homeCrest : m?.awayCrest;
  };
  const clubsRef = useRef<HTMLDivElement>(null);
  function chooseClub(id: number, button: HTMLElement) {
    if (id === club) return;
    haptic();
    setClub(id);
    setSearch("");
    setFixture("");
    button.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }
  return (
    <div className="teams-page">
      <PageTitle
        eyebrow="Herramientas · Vestuario"
        title="Equipos y jugadores"
        navTitle="Equipos"
        description="Plantillas al día y el once de cada partido de los clubes grandes."
      >
        <div
          ref={clubsRef}
          className="teams-clubs"
          role="radiogroup"
          aria-label="Elegir equipo"
        >
          {FEATURED_TEAMS.map((t) => {
            const src = crest(t.id);
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={club === t.id}
                onClick={(event) => chooseClub(t.id, event.currentTarget)}
              >
                <span className="teams-club-crest" aria-hidden="true">
                  {src ? (
                    <img src={src} alt="" loading="lazy" decoding="async" />
                  ) : (
                    t.name.slice(0, 2).toUpperCase()
                  )}
                </span>
                <span>{t.name}</span>
              </button>
            );
          })}
        </div>
      </PageTitle>
      <Segmented<Tab>
        label="Información del equipo"
        className="teams-tabs"
        value={tab}
        options={[
          { value: "squad", label: "Plantilla" },
          { value: "lineup", label: "Alineaciones" },
        ]}
        onChange={setTab}
      />
      {demo ? (
        <Empty art="whistle" title="Vestuario cerrado en la demo">
          Esta herramienta consulta plantillas y onces reales fuera del modo
          demo.
        </Empty>
      ) : tab === "lineup" ? (
        fixtures.length ? (
          <>
            <label className="teams-fixture">
              Partido
              <select
                value={match?.id || ""}
                onChange={(e) => setFixture(e.target.value)}
              >
                {fixtures.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.home} – {m.away} · {fixtureDate.format(new Date(m.utcDate))}
                  </option>
                ))}
              </select>
            </label>
            {match && (
              <Lineup key={`${club}-${match.id}`} match={match} club={club} />
            )}
          </>
        ) : (
          <Empty art="bench" title={`${clubName} no tiene partidos a la vista`}>
            No hay encuentros de este equipo en el calendario sincronizado.
          </Empty>
        )
      ) : (
        <section className="teams-squad" aria-labelledby="teams-squad-title">
          <header className="teams-squad-heading">
            <h2 id="teams-squad-title">{clubName}</h2>
            <small>
              {squad
                ? `${squad.players.length} jugadores · Football-Data.org`
                : "Plantilla del equipo"}
            </small>
          </header>
          <label className="teams-search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Buscar jugador</span>
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Buscar jugador"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {loading ? (
            <SkeletonRows rows={6} variant="line" label="Cargando plantilla" />
          ) : error ? (
            <Empty
              art="whistle"
              title="La plantilla no ha bajado al campo"
              action={
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  <RotateCw size={16} aria-hidden="true" /> Reintentar
                </button>
              }
            >
              No se ha podido cargar la plantilla. Comprueba la conexión.
            </Empty>
          ) : !squad ? (
            <Empty art="bench" title="Plantilla en camino">
              Pendiente de sincronización o sin cobertura del proveedor. Los
              clubes se actualizan por turnos.
            </Empty>
          ) : (
            <>
              {lines.map((line) => (
                <section key={line.id} className="teams-line" aria-label={line.label}>
                  <h3 className="teams-line-title">
                    {line.label}
                    <small>{line.players.length}</small>
                  </h3>
                  <ul className="teams-players">
                    {line.players.map((p) => {
                      const age = playerAge(p.birthDate);
                      return (
                        <li key={p.id}>
                          <span className="teams-player-icon" aria-hidden="true">
                            {p.name.charAt(0)}
                          </span>
                          <div>
                            <strong>{p.name}</strong>
                            <small>
                              {positionName(p.position)}
                              {p.nationality && ` · ${p.nationality}`}
                            </small>
                          </div>
                          <span
                            className="teams-age"
                            aria-label={age === null ? "Edad no disponible" : `${age} años`}
                          >
                            {age ?? "—"}
                            <small aria-hidden="true">años</small>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {!players.length && (
                <Empty art="bench" title="Nadie con ese nombre">
                  Prueba con el apellido o borra la búsqueda.
                </Empty>
              )}
              <p className="match-extra-note">
                Actualizado {stamp.format(new Date(squad.fetchedAt))} · La
                plantilla no representa un once confirmado.
              </p>
            </>
          )}
        </section>
      )}
      <details className="teams-coverage">
        <summary>Qué datos hay y cuáles no</summary>
        <p>
          <strong>Nota de rendimiento:</strong> no disponible en las fuentes
          integradas. No se calcula a partir de goles ni de minutos.
        </p>
        <p>
          <strong>Valor de mercado:</strong> no disponible. Es una estimación
          distinta al importe pagado por un traspaso; requiere un proveedor que
          publique ese dato y permita utilizarlo.
        </p>
        <p>
          Las alineaciones corresponden al partido seleccionado. Las fechas de
          nacimiento y plantillas dependen de la cobertura de Football-Data.org;
          los onces, de ESPN.
        </p>
      </details>
    </div>
  );
}
