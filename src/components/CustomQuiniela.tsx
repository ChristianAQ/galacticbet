import { Plus, Trophy } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  resolveCompetition,
  roundKey,
  toAppMatch,
  type ResolvedMatch,
} from "../lib/customCompetition";
import { followCompetition, savePick, useCompetition, usePeople } from "../lib/customCompetitionData";
import { canPick, decodePick, encodePick } from "../lib/customPicks";
import { hasMatchStarted, preferredRound, type Match, type PredictionValue } from "../lib/domain";
import { haptic } from "../lib/motion";
import { go } from "../lib/navigation";
import { roundBoard, roundHasStarted } from "../lib/roundBoard";
import { roundOptions } from "../lib/roundOptions";
import type { AppUser } from "../lib/session";
import { useClock, useMyPicks, useStartedPicks } from "../lib/useCompetitionPicks";
import { useStuck } from "../lib/useStuck";
import { GroupMatchCard, PickRow, RoundBoardPanel } from "./GroupPredictions";
import PredictionCard from "./PredictionCard";
import RoundSelector from "./RoundSelector";
import { SkeletonRows } from "./Skeleton";
import { Empty, readableError } from "./ui";
import "../styles/quiniela.css";
import "../styles/customCompetition.css";

const MatchSheet = lazy(() => import("./CustomMatchSheet"));

/** An open match's pick, unless it is of the other kind (the mode changed since): then it's to be made again. */
function currentPick(raw: string | undefined, mode: "classic" | "exact") {
  const value = raw ? decodePick(raw) : null;
  return value && (typeof value === "string") === (mode === "classic") ? value : undefined;
}

/** Under a closed match that hasn't started: why nobody else's pick shows yet. */
function waitingNote(m: ResolvedMatch) {
  if (m.status === "cancelled") return "Cancelado: no cuenta para la quiniela.";
  if (m.status === "postponed") return "Aplazado: se podrá pronosticar cuando tenga nueva fecha.";
  if (m.home.pending || m.away.pending || !m.home.id || !m.away.id)
    return "Se podrá pronosticar cuando se sepan los rivales.";
  return "Los pronósticos de los demás se verán a la hora del partido.";
}

/**
 * The quiniela of a friends' competition: the same slip as LaLiga's, round by
 * round. Each pick is saved at once and closes when its match starts; from
 * then on the match moves to the board, with everyone's picks and the points
 * that come from the results the organisers enter.
 */
export default function CustomQuiniela({ cid, user }: { cid: string; user: AppUser }) {
  const data = useCompetition(cid);
  const c = data.competition;
  const view = useMemo(
    () => (c ? resolveCompetition(c, data.participants, data.matches) : null),
    [c, data.participants, data.matches],
  );
  const now = useClock();
  const uid = user.uid;
  const [params, setParams] = useSearchParams();
  const app = useMemo(() => (c && view ? view.matches.map((m) => toAppMatch(c.id, m)) : []), [c, view]);
  const appById = useMemo(() => new Map(app.map((m) => [m.id, m])), [app]);
  const rounds = useMemo(() => roundOptions(app), [app]);
  const current = useMemo(() => preferredRound(app), [app]);
  const requested = params.get("round") || "";
  const selected = rounds.some((r) => r.id === requested) ? requested : current;
  const list = useMemo(
    () =>
      (view?.matches || [])
        .filter((m) => `${cid}:${roundKey(m)}` === selected)
        .sort((a, b) => a.startAt - b.startAt),
    [view, cid, selected],
  );
  const open = useMemo(() => (c ? list.filter((m) => canPick(c, m, now)) : []), [c, list, now]);
  const closed = useMemo(() => list.filter((m) => !open.includes(m)), [list, open]);
  const started = useMemo(() => list.filter((m) => m.startAt <= now && m.status !== "cancelled"), [list, now]);
  // Your own pick can be read until kick-off; after that it comes with everyone's.
  const [mine, setMine] = useMyPicks(
    cid,
    list.filter((m) => !started.includes(m)).map((m) => m.id),
    uid,
  );
  const revealed = useStartedPicks(cid, started, uid, { enabled: Boolean(view) });
  const pickers = useMemo(() => {
    const ids = new Set([uid]);
    for (const m of started) for (const id of Object.keys(revealed?.[m.id] || {})) ids.add(id);
    return [...ids];
  }, [started, revealed, uid]);
  const people = usePeople(pickers);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [joining, setJoining] = useState(false);
  const [sheet, setSheet] = useState("");
  const { sentinel, stuck } = useStuck();
  const following = Boolean(c?.memberIds.includes(uid));
  const valueOf = (mid: string) => mine?.[mid] ?? revealed?.[mid]?.[uid];
  const nameOf = (id: string) => people[id]?.name || "Jugador";

  // Points of the round so far, for everyone who predicted a match that started.
  const board = useMemo(() => {
    if (!revealed) return null;
    const matches = started.flatMap((m) => appById.get(m.id) ?? []);
    if (!roundHasStarted(matches)) return null;
    const players = pickers
      .filter((id) => started.some((m) => revealed[m.id]?.[id]))
      .map((id) => ({
        id,
        name: people[id]?.name || (id === uid ? user.displayName || "Tú" : "Jugador"),
        picks: Object.fromEntries(started.map((m) => [m.id, decodePick(revealed[m.id]?.[id]) ?? undefined])),
      }));
    return players.length ? roundBoard(matches, "own", players) : null;
  }, [revealed, started, appById, pickers, people, uid]);

  const onChoose = useCallback(
    async (match: Match, value: PredictionValue) => {
      const mid = match.id;
      const raw = encodePick(value);
      if (!following || mine?.[mid] === raw) return;
      const before = mine?.[mid];
      setMine((m) => ({ ...(m || {}), [mid]: raw }));
      setSaving((s) => ({ ...s, [mid]: true }));
      try {
        await savePick(cid, mid, uid, raw);
      } catch (e) {
        haptic("warning");
        setMine((m) => {
          const next = { ...(m || {}) };
          if (before) next[mid] = before;
          else delete next[mid];
          return next;
        });
        setNotice(
          (e as { code?: string })?.code === "permission-denied"
            ? "No se guardó: el partido ya ha empezado o ha cambiado. Revisa el calendario."
            : readableError(e),
        );
      } finally {
        setSaving((s) => {
          const next = { ...s };
          delete next[mid];
          return next;
        });
      }
    },
    [cid, uid, following, mine, setMine],
  );
  const onDetails = useCallback((id: string) => setSheet(id), []);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (data.loading) return <SkeletonRows rows={5} label="Preparando tu boleto" />;
  if (data.missing || !c || !view)
    return (
      <Empty art="flag" title="No encontramos esta liga">
        {data.error || "Puede que la hayan borrado o que ya no la sigas."}
      </Empty>
    );
  if (c.predictionMode === "off")
    return (
      <Empty art="slip" title="Esta liga no tiene quiniela">
        Quien la creó puede activarla en Ligas › {c.name} › Gestión › Ajustes.
      </Empty>
    );
  if (!view.matches.length)
    return (
      <Empty art="slip" title="Boleto sin partidos">
        Cuando los organizadores añadan partidos, aparecerán aquí.
      </Empty>
    );

  const mode = c.predictionMode;
  const completed = open.filter((m) => currentPick(mine?.[m.id], mode)).length;
  const total = open.length;
  const savingCount = Object.keys(saving).length;
  const table = () => go(`/clasificacion?liga=${encodeURIComponent(cid)}`);
  const match = view.matches.find((m) => m.id === sheet);
  return (
    <>
      <RoundSelector
        rounds={rounds}
        value={selected}
        current={current}
        onChange={(id) =>
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              next.set("round", id);
              return next;
            },
            { replace: true },
          )
        }
      />
      {notice && (
        <p className="error" role="alert">
          {notice}
        </p>
      )}
      {!following && (
        <section className="custom-picks-join">
          <p>Para jugar esta quiniela, primero sigue la liga.</p>
          <button
            type="button"
            className="button primary"
            disabled={joining}
            onClick={async () => {
              setJoining(true);
              try {
                await followCompetition(uid, c.id);
                haptic("success");
              } catch (e) {
                setNotice(readableError(e));
              } finally {
                setJoining(false);
              }
            }}
          >
            <Plus size={17} aria-hidden="true" /> Seguir
          </button>
        </section>
      )}
      {open.length > 0 && (
        <>
          <div ref={sentinel} className="sticky-sentinel" />
          <section
            className={`round-save-panel${stuck ? " is-stuck" : ""}${completed === total ? " is-ready" : ""}`}
            aria-label="Estado de tu boleto"
            aria-busy={savingCount > 0}
          >
            <div className="round-save-progress">
              <strong className="round-save-count" aria-hidden="true">
                {completed}
                <small>/{total}</small>
              </strong>
              <div className="round-progress-row">
                <span>
                  {savingCount > 0 ? "Anotando…" : completed === total ? "Todo anotado" : "Se guarda al momento"}
                </span>
                <div
                  className="round-progress-track"
                  role="progressbar"
                  aria-label="Pronósticos completados"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={completed}
                >
                  <span style={{ transform: `scaleX(${completed / total})` }} />
                </div>
              </div>
            </div>
            <button type="button" className="button secondary" onClick={table}>
              <Trophy size={17} aria-hidden="true" />
              <span>Tabla</span>
            </button>
          </section>
          <div role="region" aria-label="Mi quiniela" className="prediction-list slip">
            {open.map((m, index) => (
              <PredictionCard
                key={m.id}
                number={index + 1}
                match={appById.get(m.id) ?? toAppMatch(c.id, m)}
                history={app}
                value={currentPick(mine?.[m.id], mode)}
                mode={mode}
                lock={null}
                disabled={!following}
                saving={Boolean(saving[m.id])}
                onChoose={onChoose}
                onDetails={onDetails}
                detailsLabel="Ficha del partido"
                plainResult
              />
            ))}
          </div>
        </>
      )}
      {closed.length > 0 && (
        <section className="group-predictions" aria-label="Pronósticos de los seguidores">
          <div className="group-view-heading">
            <div className="group-view-title">
              <span className="eyebrow">Tu pronóstico y el de los demás</span>
              <h2>Los seguidores</h2>
            </div>
            {!open.length && (
              <span className="group-view-actions">
                <button type="button" className="share-trigger" onClick={table}>
                  <Trophy size={14} aria-hidden="true" /> Tabla
                </button>
              </span>
            )}
          </div>
          {board && (
            <RoundBoardPanel
              rows={board}
              userId={uid}
              live={started.some((m) => m.status === "live")}
            />
          )}
          {closed.map((m) => {
            const appMatch = appById.get(m.id) ?? toAppMatch(c.id, m);
            const isStarted = started.includes(m);
            const raw = valueOf(m.id);
            const others = isStarted
              ? Object.entries(revealed?.[m.id] || {})
                  .filter(([id]) => id !== uid)
                  .sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b), "es") || a.localeCompare(b))
              : [];
            return (
              <GroupMatchCard
                key={m.id}
                match={appMatch}
                history={app}
                started={hasMatchStarted(appMatch, now)}
                onOpen={onDetails}
                plainResult
              >
                <section className="gm-picks" aria-label="Pronósticos de los seguidores">
                  <ul className="gm-pick-list">
                    <PickRow
                      name="Tú"
                      me
                      match={appMatch}
                      mode="own"
                      value={raw ? decodePick(raw) ?? undefined : undefined}
                      loading={!raw && (isStarted ? revealed === null : mine === null)}
                    />
                    {others.map(([id, pick]) => (
                      <PickRow
                        key={id}
                        name={nameOf(id)}
                        match={appMatch}
                        mode="own"
                        value={decodePick(pick) ?? undefined}
                      />
                    ))}
                  </ul>
                  {isStarted ? (
                    revealed === null ? (
                      <p className="gm-picks-loading" role="status">
                        <span className="sr-only">Cargando pronósticos</span>
                        <span className="skeleton" aria-hidden="true" />
                      </p>
                    ) : (
                      !others.length && <p className="gm-picks-note">Nadie más pronosticó este partido.</p>
                    )
                  ) : (
                    <p className="gm-picks-note">{waitingNote(m)}</p>
                  )}
                </section>
              </GroupMatchCard>
            );
          })}
        </section>
      )}
      <p className="league-hint">
        {mode === "exact"
          ? "Marcador exacto: 3 puntos; solo quién gana o el empate: 1."
          : "1X2: 1 punto por acierto."}{" "}
        Cada partido se cierra al empezar y nadie ve los pronósticos de los demás hasta entonces.
      </p>
      {match && (
        <Suspense fallback={null}>
          <MatchSheet
            competition={c}
            view={view}
            match={match}
            participants={data.participants}
            user={user}
            onClose={() => setSheet("")}
            inQuiniela
          />
        </Suspense>
      )}
    </>
  );
}
