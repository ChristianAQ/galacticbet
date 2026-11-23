import { Check, Lock, MapPin, Plus, Share2, Trophy } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useId } from "react";
import {
  FORMATS,
  resolveCompetition,
  roundKey,
  tieName,
  toAppMatch,
  type Competition,
  type CompetitionView,
  type ResolvedMatch,
  type Stage,
} from "../lib/customCompetition";
import {
  followCompetition,
  unfollowCompetition,
  type CompetitionChip,
  type CompetitionData,
} from "../lib/customCompetitionData";
import { preferredRound } from "../lib/domain";
import { roundOptions } from "../lib/roundOptions";
import { shareOrCopy } from "../lib/matchActions";
import { haptic } from "../lib/motion";
import { go } from "../lib/navigation";
import type { AppUser } from "../lib/session";
import DayTitle from "./DayTitle";
import LeagueNavigation from "./LeagueNavigation";
import LeagueTable, { type Zone } from "./LeagueTable";
import Modal from "./Modal";
import RoundSelector from "./RoundSelector";
import { SkeletonRows } from "./Skeleton";
import { Empty, MatchRow, readableError } from "./ui";
import "../styles/leagues.css";
import "../styles/customCompetition.css";

const MatchSheet = lazy(() => import("./CustomMatchSheet"));
const ManagePanel = lazy(() => import("./CustomManage"));

const dayLabel = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** The competition's picture, or its initials, in the same badge as official ones. */
export function CompetitionBadge({ icon, name, small = true }: { icon: string | null; name: string; small?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className={`competition-logo competition-badge custom-badge${small ? " small" : ""}`} aria-hidden="true">
      {icon ? <img src={icon} alt="" /> : <span className="competition-fallback">{initials || "★"}</span>}
    </span>
  );
}

/** Your competitions after LaLiga, Champions and Premier, and the «＋» to add one. */
export function CustomChips({
  list,
  current,
  onSelect,
  onAdd,
}: {
  list: CompetitionChip[];
  current: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  // The chosen competition sits after the official ones: bring it into view.
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [current, list.length]);
  return (
    <>
      {list.map((c) => (
        <button
          key={c.id}
          ref={current === c.id ? active : undefined}
          type="button"
          aria-pressed={current === c.id}
          onClick={() => onSelect(c.id)}
        >
          <CompetitionBadge icon={c.icon} name={c.name} />
          <span>{c.name}</span>
        </button>
      ))}
      <button type="button" className="competition-tabs-new" onClick={onAdd} aria-label="Crear o unirse a una competición">
        <span className="competition-tabs-all" aria-hidden="true">
          <Plus size={16} />
        </span>
        <span>{list.length ? "Nueva" : "Tu competición"}</span>
      </button>
    </>
  );
}

export function competitionEyebrow(c: Competition | null) {
  if (!c) return "Competición entre amigos";
  return [c.sport, FORMATS[c.format]?.label].filter(Boolean).join(" · ");
}

/** On the masthead: who follows it, follow / unfollow and share the code. */
export function CustomSummary({
  data,
  user,
  onLogin,
}: {
  data: CompetitionData;
  user: AppUser | null;
  onLogin: () => void;
}) {
  const c = data.competition;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  if (!c) return null;
  const following = Boolean(user && c.memberIds.includes(user.uid));
  const owner = user?.uid === c.ownerId;
  const toggle = async (follow: boolean) => {
    if (!user) return onLogin();
    setBusy(true);
    setError("");
    try {
      if (follow) await followCompetition(user.uid, c.id);
      else await unfollowCompetition(user.uid, c.id);
      haptic("success");
      setLeaving(false);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="custom-summary">
      <p className="custom-summary-meta">
        {c.memberIds.length} {c.memberIds.length === 1 ? "seguidor" : "seguidores"}
        {owner ? " · Es tuya" : c.adminIds.includes(user?.uid || "") ? " · Administras" : ""}
      </p>
      <div className="custom-summary-actions">
        {!following ? (
          <button type="button" className="button primary" disabled={busy} onClick={() => void toggle(true)}>
            <Plus size={17} aria-hidden="true" />
            {user ? "Seguir" : "Entrar para seguir"}
          </button>
        ) : (
          !owner && (
            <button type="button" className="share-trigger" disabled={busy} onClick={() => setLeaving(true)}>
              <Check size={16} aria-hidden="true" />
              Siguiendo
            </button>
          )
        )}
        <button
          type="button"
          className="share-trigger"
          onClick={() =>
            void shareOrCopy({
              title: c.name,
              text: `Sigue «${c.name}» en GalacticBet. Código: ${c.id}`,
              url: `${location.origin}${location.pathname}#/ligas?liga=${c.id}`,
            }).then((message) => message && setError(message))
          }
        >
          <Share2 size={16} aria-hidden="true" />
          Compartir
        </button>
      </div>
      {error && (
        <p className="custom-summary-note" role="status">
          {error}
        </p>
      )}
      {leaving && (
        <Modal title="¿Dejar de seguirla?" role="alertdialog" onClose={() => setLeaving(false)} initialFocus="[data-cancel]">
          <p>Dejarás de verla en tus competiciones. Con el código puedes volver cuando quieras.</p>
          <div className="confirm-buttons">
            <button type="button" className="button secondary" data-cancel onClick={() => setLeaving(false)}>
              Cancelar
            </button>
            <button type="button" className="button danger" disabled={busy} onClick={() => void toggle(false)}>
              Dejar de seguir
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export type CustomTab = "partidos" | "clasificacion" | "cuadro" | "gestion";

/** A match row that opens its sheet: same row as any league fixture. */
function FixtureButton({
  match,
  competition,
  onOpen,
}: {
  match: ResolvedMatch;
  competition: Competition;
  onOpen: (id: string) => void;
}) {
  const app = toAppMatch(competition.id, match);
  return (
    <li className="fixture-item">
      <button type="button" className="fixture-card-button custom-fixture" onClick={() => onOpen(match.id)}>
        <MatchRow match={app} as="span" plainResult />
        {match.leg ? <span className="fixture-leg">{match.leg === 1 ? "Ida" : "Vuelta"}</span> : null}
        {(match.location || match.locked) && (
          <span className="custom-fixture-meta">
            {match.location && (
              <span>
                <MapPin size={12} aria-hidden="true" />
                {match.location}
              </span>
            )}
            {match.locked && (
              <span>
                <Lock size={12} aria-hidden="true" />
                Resultado confirmado
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

function FixturesPanel({
  competition,
  view,
  round,
  onRound,
  onOpen,
  canRun,
  onManage,
}: {
  competition: Competition;
  view: CompetitionView;
  round: string;
  onRound: (id: string) => void;
  onOpen: (id: string) => void;
  canRun: boolean;
  onManage: () => void;
}) {
  const app = useMemo(() => view.matches.map((m) => toAppMatch(competition.id, m)), [view, competition.id]);
  const rounds = useMemo(() => roundOptions(app), [app]);
  const current = useMemo(() => preferredRound(app), [app]);
  const selected = rounds.some((r) => r.id === round) ? round : current;
  const days = useMemo(() => {
    const byDay = new Map<string, ResolvedMatch[]>();
    for (const m of view.matches.filter((m) => `${competition.id}:${roundKey(m)}` === selected)) {
      const key = new Date(m.startAt).toDateString();
      byDay.set(key, [...(byDay.get(key) || []), m]);
    }
    return [...byDay.values()];
  }, [view, selected, competition.id]);
  if (!view.matches.length)
    return (
      <Empty
        art="whistle"
        title="Todavía no hay partidos"
        action={
          canRun && (
            <button type="button" className="button primary" onClick={onManage}>
              <Plus size={17} aria-hidden="true" /> Añadir partidos
            </button>
          )
        }
      >
        {canRun
          ? "Crea las jornadas y los partidos desde Gestión: uno a uno o repetidos cada semana."
          : "Cuando los organizadores añadan partidos, aparecerán aquí."}
      </Empty>
    );
  return (
    <>
      <RoundSelector rounds={rounds} value={selected} current={current} onChange={onRound} />
      <div className="match-calendar-list">
        {days.map((items) => (
          <section key={items[0].startAt} className="match-day" aria-label={dayLabel.format(items[0].startAt)}>
            <DayTitle date={new Date(items[0].startAt).toISOString()} count={items.length} />
            <ul className="fixture-list">
              {items.map((m) => (
                <FixtureButton key={m.id} match={m} competition={competition} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        ))}
        <p className="league-hint">
          {canRun ? "Toca un partido para cambiar su fecha, lugar, estado o resultado." : "Toca un partido para ver sus detalles."}
        </p>
      </div>
    </>
  );
}

function ChampionBanner({ view }: { view: CompetitionView }) {
  if (!view.champion) return null;
  return (
    <div className="custom-champion" role="status">
      <span className="custom-champion-icon" aria-hidden="true">
        <Trophy size={22} />
      </span>
      <div>
        <small>Campeón</small>
        <strong>{view.champion.name}</strong>
      </div>
    </div>
  );
}

function TablePanel({ competition, view }: { competition: Competition; view: CompetitionView }) {
  const through =
    competition.format === "league_knockout"
      ? competition.qualifiers
      : competition.format === "groups_knockout"
        ? competition.qualifiers
        : 0;
  const zone: Zone[] = through
    ? [{ kind: "top", label: through === 1 ? "Pasa a la fase final" : "Pasan a la fase final", test: (p) => p <= through }]
    : [];
  return (
    <>
      <ChampionBanner view={view} />
      {view.tables.map((table) => (
        <section key={table.id} className="competition-table-panel">
          <header className="standings-heading">
            <h2>{table.title}</h2>
            <p>
              {table.complete ? "Fase terminada" : "En juego"}
              {through ? ` · ${through === 1 ? "pasa el primero" : `pasan ${through}`}` : ""}
            </p>
          </header>
          <div className="competition-table-scroll" role="region" aria-label={`${table.title} completa`}>
            <LeagueTable rows={table.rows} full zones={zone} caption={`${table.title} de ${competition.name}`} />
          </div>
        </section>
      ))}
      <p className="league-source">
        Se recalcula sola con cada resultado: 3 puntos por victoria y 1 por empate; desempate por diferencia y goles a favor.
      </p>
    </>
  );
}

const STAGE_TITLES: Partial<Record<Stage, string>> = {
  LAST_32: "Dieciseisavos",
  LAST_16: "Octavos de final",
  QUARTER_FINALS: "Cuartos de final",
  SEMI_FINALS: "Semifinales",
  THIRD_PLACE: "Tercer puesto",
  FINAL: "Final",
};

function BracketPanel({
  competition,
  view,
  onOpen,
}: {
  competition: Competition;
  view: CompetitionView;
  onOpen: (id: string) => void;
}) {
  const knockout = view.matches.filter((m) => m.phase === "knockout");
  const stages = (Object.keys(STAGE_TITLES) as Stage[]).filter((s) => knockout.some((m) => m.stage === s));
  return (
    <>
      <ChampionBanner view={view} />
      {stages.map((stage) => {
        const ties = [...new Set(knockout.filter((m) => m.stage === stage).map((m) => m.tie!))];
        return (
          <section key={stage} className="custom-bracket-stage">
            <h2 className="custom-bracket-title">{STAGE_TITLES[stage]}</h2>
            {ties.map((tie) => {
              const legs = knockout.filter((m) => m.tie === tie).sort((a, b) => (a.leg || 1) - (b.leg || 1));
              const result = view.ties[tie];
              const winner = result?.winner
                ? legs[0].home.id === result.winner
                  ? legs[0].home.name
                  : legs[0].away.name
                : "";
              return (
                <article key={tie} className="custom-tie">
                  <header>
                    <span>{tieName(tie).replace(/^la |^el /, "").replace(/^./, (c) => c.toUpperCase())}</span>
                    {legs.length > 1 && result?.aggregate && (
                      <small>
                        Global {result.aggregate[0]}–{result.aggregate[1]}
                      </small>
                    )}
                    {winner && <strong>Pasa {winner}</strong>}
                  </header>
                  <ul className="fixture-list">
                    {legs.map((m) => (
                      <FixtureButton key={m.id} match={m} competition={competition} onOpen={onOpen} />
                    ))}
                  </ul>
                </article>
              );
            })}
          </section>
        );
      })}
    </>
  );
}

/**
 * A friends' competition shown like any league: matches by round, its table
 * (and bracket), and — for its organisers — the management tools.
 */
export default function CustomCompetitionView({
  data,
  user,
  tab,
  onTab,
  round,
  onRound,
  onLogin,
}: {
  data: CompetitionData;
  user: AppUser | null;
  tab: string;
  onTab: (tab: CustomTab) => void;
  round: string;
  onRound: (id: string) => void;
  onLogin: () => void;
}) {
  const ids = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState("");
  const c = data.competition;
  const view = useMemo(
    () => (c ? resolveCompetition(c, data.participants, data.matches) : null),
    [c, data.participants, data.matches],
  );
  if (data.loading)
    return (
      <div className="league-content">
        <SkeletonRows rows={6} label="Cargando competición" />
      </div>
    );
  if (data.missing || !c || !view)
    return (
      <Empty art="flag" title="No encontramos esta competición">
        {data.error || "Revisa el código: puede que esté mal copiado o que la hayan borrado."}
      </Empty>
    );
  const uid = user?.uid || "";
  const canRun = Boolean(uid) && (c.ownerId === uid || c.adminIds.includes(uid));
  const tabs: { id: CustomTab; label: string }[] = [
    { id: "partidos", label: "Partidos" },
    ...(view.tables.length ? [{ id: "clasificacion" as const, label: "Tabla" }] : []),
    ...(view.matches.some((m) => m.phase === "knockout") ? [{ id: "cuadro" as const, label: "Cuadro" }] : []),
    ...(canRun ? [{ id: "gestion" as const, label: "Gestión" }] : []),
  ];
  const active = tabs.find((t) => t.id === tab)?.id || "partidos";
  const match = view.matches.find((m) => m.id === open);
  return (
    <>
      <LeagueNavigation<CustomTab>
        tab={active}
        tabs={tabs}
        onChange={onTab}
        panel={panel}
        idPrefix={`${ids}-tab`}
        panelId={`${ids}-panel`}
      />
      <div
        ref={panel}
        id={`${ids}-panel`}
        role="tabpanel"
        aria-labelledby={`${ids}-tab-${active}`}
        className="league-content"
        key={`${c.id}:${active}`}
        tabIndex={-1}
      >
        {data.error && (
          <p className="error" role="alert">
            {data.error}
          </p>
        )}
        {active === "clasificacion" ? (
          <TablePanel competition={c} view={view} />
        ) : active === "cuadro" ? (
          <BracketPanel competition={c} view={view} onOpen={setOpen} />
        ) : active === "gestion" ? (
          <Suspense fallback={<SkeletonRows rows={5} variant="line" label="Cargando gestión" />}>
            <ManagePanel competition={c} data={data} view={view} user={user!} onOpenMatch={setOpen} />
          </Suspense>
        ) : (
          <FixturesPanel
            competition={c}
            view={view}
            round={round}
            onRound={onRound}
            onOpen={setOpen}
            canRun={canRun}
            onManage={() => onTab("gestion")}
          />
        )}
        {!user && (
          <p className="league-more">
            <button type="button" className="text-button" onClick={onLogin}>
              Entra para seguir esta competición
            </button>
          </p>
        )}
      </div>
      {match && (
        <Suspense fallback={null}>
          <MatchSheet
            competition={c}
            view={view}
            match={match}
            participants={data.participants}
            user={user}
            onClose={() => setOpen("")}
          />
        </Suspense>
      )}
    </>
  );
}

/** «＋ Nueva»: create a competition, or open one with the code you were sent. */
export function CompetitionEntrySheet({
  user,
  onLogin,
  onCode,
  onClose,
}: {
  user: AppUser | null;
  onLogin: () => void;
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const clean = code.trim().replace(/^.*[?&]liga=/, "").replace(/[^A-Za-z0-9]/g, "");
  return (
    <Modal title="Competiciones entre amigos" onClose={onClose}>
      <div className="custom-entry">
        <p className="muted">
          Crea una liga o un torneo para cualquier deporte, o sigue uno con el código o el enlace que te hayan pasado.
        </p>
        <button
          type="button"
          className="button primary full"
          onClick={() => {
            onClose();
            if (user) go("/competiciones/nueva");
            else onLogin();
          }}
        >
          <Plus size={17} aria-hidden="true" />
          {user ? "Crear competición" : "Entrar para crear una"}
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (clean.length < 10) return;
            onClose();
            onCode(clean);
          }}
        >
          <label>
            Código o enlace
            <input
              value={code}
              className="code-input"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Pega aquí el código"
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button className="button secondary full" disabled={clean.length < 10}>
            Ver competición
          </button>
        </form>
      </div>
    </Modal>
  );
}
