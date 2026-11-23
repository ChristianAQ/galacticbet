import { Plus, Stamp, Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  resolveCompetition,
  roundKey,
  toAppMatch,
  type ResolvedMatch,
} from "../lib/customCompetition";
import {
  followCompetition,
  savePick,
  sealCustomRound,
  useCompetition,
  useCompetitionRounds,
  useMyEntry,
  usePeople,
  useRoundAttendance,
  useRoundEntries,
  useRoundsSync,
} from "../lib/customCompetitionData";
import { canPick, decodePick, encodePick } from "../lib/customPicks";
import { hasMatchStarted, preferredRound, type Match, type PredictionValue } from "../lib/domain";
import { haptic } from "../lib/motion";
import { customMatchPath, go } from "../lib/navigation";
import { roundBoard, roundHasStarted } from "../lib/roundBoard";
import { roundOptions } from "../lib/roundOptions";
import type { AppUser } from "../lib/session";
import { useClock, useMyPicks } from "../lib/useCompetitionPicks";
import { useStuck } from "../lib/useStuck";
import ConfirmQuiniela from "./ConfirmQuiniela";
import { GroupMatchCard, PickRow, RoundBoardPanel } from "./GroupPredictions";
import PredictionCard from "./PredictionCard";
import RoundDeliveryStatus from "./RoundDeliveryStatus";
import RoundSelector from "./RoundSelector";
import { SkeletonRows } from "./Skeleton";
import { Empty, readableError } from "./ui";
import "../styles/quiniela.css";
import "../styles/customCompetition.css";

/** A draft in the competition's current mode (one of the other kind, from before a mode change, is to be made again). */
function currentPick(raw: string | undefined, mode: "classic" | "exact") {
  const value = raw ? decodePick(raw) : null;
  return value && (typeof value === "string") === (mode === "classic") ? value : undefined;
}

/** Why a match of the round takes no pick. */
function closedNote(m: ResolvedMatch, now: number) {
  if (m.status === "cancelled") return "Cancelado: no cuenta para la quiniela.";
  if (m.status === "postponed") return "Aplazado: no cuenta mientras no tenga nueva fecha.";
  if (m.home.pending || m.away.pending || !m.home.id || !m.away.id)
    return "Se podrá pronosticar cuando se sepan los rivales.";
  if (m.status !== "scheduled" || m.startAt <= now) return "Ya ha empezado: no admite pronósticos.";
  return "";
}

/** Under a match of the board that has no picks to show. */
function boardNote(m: ResolvedMatch, waiting: boolean) {
  if (m.status === "cancelled") return "Cancelado: no cuenta para la quiniela.";
  if (m.status === "postponed") return "Aplazado: no cuenta mientras no se juegue.";
  return waiting ? "Nadie más ha sellado todavía." : "Nadie más selló un boleto con este partido.";
}

/**
 * The quiniela of a friends' competition, exactly like LaLiga's: picks are a
 * draft until you seal the slip; the round closes at its first kick-off; once
 * you have sealed (or the round has closed) the board shows everyone's sealed
 * slips and the points they are getting. Only sealed slips count.
 */
export default function CustomQuiniela({ cid, user }: { cid: string; user: AppUser }) {
  const data = useCompetition(cid);
  const c = data.competition;
  const view = useMemo(
    () => (c ? resolveCompetition(c, data.participants, data.matches) : null),
    [c, data.participants, data.matches],
  );
  const now = useClock(15_000);
  const uid = user.uid;
  const [params, setParams] = useSearchParams();
  const app = useMemo(() => (c && view ? view.matches.map((m) => toAppMatch(c.id, m)) : []), [c, view]);
  const appById = useMemo(() => new Map(app.map((m) => [m.id, m])), [app]);
  const rounds = useMemo(() => roundOptions(app), [app]);
  const current = useMemo(() => preferredRound(app), [app]);
  const requested = params.get("round") || "";
  const selected = rounds.some((r) => r.id === requested) ? requested : current;
  const rk = selected.startsWith(`${cid}:`) ? selected.slice(cid.length + 1) : "";
  const list = useMemo(
    () => (view?.matches || []).filter((m) => roundKey(m) === rk).sort((a, b) => a.startAt - b.startAt),
    [view, rk],
  );
  // The round as the server sees it: its deadline and the matches its slip asks for.
  const roundDocs = useCompetitionRounds(cid);
  useRoundsSync(c, view, roundDocs, uid);
  const round = roundDocs?.[rk];
  const deadline = round?.deadline ?? null;
  const deadlineClosed = deadline !== null && now >= deadline;
  const required = useMemo(() => list.filter((m) => round?.matchIds.includes(m.id)), [list, round]);
  const open = useMemo(() => (c ? list.filter((m) => canPick(c, m, now)) : []), [c, list, now]);
  const mine = useMyEntry(cid, rk, uid);
  const isSealed = Boolean(mine.picks);
  const roundClosed = deadlineClosed || (list.length > 0 && !open.length);
  const showBoard = isSealed || roundClosed;
  const missed = roundClosed && !mine.loading && !isSealed;
  const entries = useRoundEntries(cid, rk, isSealed || deadlineClosed);
  const [drafts, setDrafts] = useMyPicks(cid, isSealed ? [] : list.map((m) => m.id), uid);
  const attendance = useRoundAttendance(cid, rk);
  const peopleIds = useMemo(
    () => [...new Set([...(c?.memberIds || []), ...Object.keys(entries || {})])],
    [c, entries],
  );
  const people = usePeople(peopleIds);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [joining, setJoining] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const { sentinel, stuck } = useStuck();
  const following = Boolean(c?.memberIds.includes(uid));
  const mode = c?.predictionMode === "exact" ? "exact" : "classic";
  const values = useMemo(() => {
    const out: Record<string, PredictionValue> = {};
    for (const m of list) {
      const v = currentPick(drafts?.[m.id], mode);
      if (v) out[m.id] = v;
    }
    return out;
  }, [list, drafts, mode]);
  const nameOf = useCallback(
    (id: string) => people[id]?.name || (id === uid ? user.displayName || "Tú" : "Jugador"),
    [people, uid, user.displayName],
  );

  // Points of the round so far, from the sealed slips.
  const board = useMemo(() => {
    if (!entries) return null;
    const matches = list.flatMap((m) => appById.get(m.id) ?? []);
    if (!roundHasStarted(matches)) return null;
    const players = Object.entries(entries).map(([id, picks]) => ({ id, name: nameOf(id), picks }));
    return players.length ? roundBoard(matches, "own", players) : null;
  }, [entries, list, appById, nameOf]);

  const onChoose = useCallback(
    async (match: Match, value: PredictionValue) => {
      const mid = match.id;
      const raw = encodePick(value);
      if (!following || isSealed || drafts?.[mid] === raw) return;
      const before = drafts?.[mid];
      setDrafts((m) => ({ ...(m || {}), [mid]: raw }));
      setSaving((s) => ({ ...s, [mid]: true }));
      try {
        await savePick(cid, mid, uid, raw);
      } catch (e) {
        haptic("warning");
        setDrafts((m) => {
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
    [cid, uid, following, isSealed, drafts, setDrafts],
  );
  const onDetails = useCallback(
    (id: string, from: Element | null) => go(customMatchPath(cid, id), { sharedFrom: from }),
    [cid],
  );
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  async function finalize() {
    setSubmitting(true);
    setSubmitError("");
    try {
      await sealCustomRound(cid, rk, uid, mode, values);
      haptic("success");
      setConfirm(false);
    } catch (e) {
      haptic("warning");
      setSubmitError(readableError(e));
    } finally {
      setSubmitting(false);
    }
  }

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

  const savingCount = Object.keys(saving).length;
  const pending = roundDocs === null || mine.loading || drafts === null;
  const total = required.length;
  const completed = required.filter((m) => values[m.id]).length;
  const missingOpen = total - completed;
  const saveStatus = deadlineClosed
    ? "Plazo cerrado"
    : pending
      ? "Comprobando…"
      : savingCount > 0
        ? "Anotando…"
        : !round
          ? "Aún sin abrir"
          : missingOpen > 0
            ? null
            : completed > 0
              ? "Listo para sellar"
              : "Boleto en blanco";
  const canSubmit =
    following &&
    total > 0 &&
    !deadlineClosed &&
    missingOpen === 0 &&
    !pending &&
    savingCount === 0 &&
    !submitting &&
    !isSealed;
  // «Tabla»: the same tab's table, same league and round.
  const table = () =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("vista", "clasificacion");
        return next;
      },
      { replace: true },
    );
  const followers = c.memberIds.map((id) => people[id] || { id, name: "Jugador", avatar: null });
  return (
    <>
      <RoundSelector
        rounds={rounds}
        value={selected}
        current={current}
        disabled={savingCount > 0 || submitting}
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
      {!showBoard && !pending && !round && (
        <p className="setup-notice">Esta jornada todavía no admite boletos. Vuelve en un rato.</p>
      )}
      {!showBoard && (
        <>
          <RoundDeliveryStatus
            key={`${cid}:${rk}`}
            memberIds={c.memberIds}
            participants={followers}
            completedIds={attendance.ids}
            ready={attendance.ready && Boolean(round)}
            deadline={deadline}
            clock={now}
            userId={uid}
          />
          <div ref={sentinel} className="sticky-sentinel" />
          <section
            className={`round-save-panel${stuck ? " is-stuck" : ""}${canSubmit ? " is-ready" : ""}`}
            aria-label="Estado de tu boleto"
            aria-busy={pending || submitting || savingCount > 0}
          >
            <div className="round-save-progress">
              <strong className="round-save-count" aria-hidden="true">
                {completed}
                <small>/{total}</small>
              </strong>
              <div className="round-progress-row">
                {saveStatus && <span>{saveStatus}</span>}
                <div
                  className="round-progress-track"
                  role="progressbar"
                  aria-label="Pronósticos completados"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={completed}
                >
                  <span style={{ transform: `scaleX(${total ? completed / total : 0})` }} />
                </div>
              </div>
            </div>
            <button
              className="button primary"
              disabled={!canSubmit}
              onClick={() => {
                haptic();
                setSubmitError("");
                setConfirm(true);
              }}
            >
              <Stamp size={17} aria-hidden="true" />
              <span>
                Sellar<span className="round-save-long"> boleto</span>
              </span>
            </button>
          </section>
          <div
            id="mine-predictions"
            role="region"
            aria-label="Mi quiniela"
            aria-busy={pending}
            className="prediction-list slip"
          >
            {open.map((m, index) => (
              <PredictionCard
                key={m.id}
                number={index + 1}
                match={appById.get(m.id) ?? toAppMatch(c.id, m)}
                history={app}
                value={values[m.id]}
                mode={mode}
                lock={null}
                disabled={!following || pending || submitting}
                saving={Boolean(saving[m.id])}
                onChoose={onChoose}
                onDetails={onDetails}
                detailsLabel="Ficha del partido"
                plainResult
              />
            ))}
          </div>
          {/* The rest of the round: no pick to make (yet), and why. */}
          {list
            .filter((m) => !open.includes(m))
            .map((m) => {
              const appMatch = appById.get(m.id) ?? toAppMatch(c.id, m);
              return (
                <GroupMatchCard
                  key={m.id}
                  match={appMatch}
                  history={app}
                  started={hasMatchStarted(appMatch, now)}
                  to={customMatchPath(c.id, m.id)}
                  plainResult
                >
                  <p className="gm-picks-note">{closedNote(m, now)}</p>
                </GroupMatchCard>
              );
            })}
        </>
      )}
      {showBoard && (
        <section className="group-predictions" aria-label="Boletos de los seguidores">
          <div className="group-view-heading">
            <div className="group-view-title">
              <span className="eyebrow">{missed ? "Jornada cerrada sin tu boleto" : "Tu boleto y el de los demás"}</span>
              <h2 tabIndex={-1}>Los seguidores</h2>
            </div>
            <span className="group-view-actions">
              <button type="button" className="share-trigger" onClick={table}>
                <Trophy size={14} aria-hidden="true" /> Tabla
              </button>
            </span>
          </div>
          {missed && (
            <p className="group-view-note">
              {deadline === null
                ? "Esta jornada no llegó a abrirse para boletos: no suma puntos."
                : "No sellaste esta jornada: no suma puntos."}
            </p>
          )}
          {isSealed && !deadlineClosed && (
            <p className="group-view-note">
              Boleto sellado. Verás el de cada seguidor en cuanto selle el suyo; al empezar el primer partido, todos.
            </p>
          )}
          {board && <RoundBoardPanel rows={board} userId={uid} live={list.some((m) => m.status === "live")} />}
          {list.map((m) => {
            const appMatch = appById.get(m.id) ?? toAppMatch(c.id, m);
            const own = mine.picks?.[m.id];
            const others = Object.entries(entries || {})
              .filter(([id, picks]) => id !== uid && picks[m.id])
              .sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b), "es") || a.localeCompare(b));
            const loadingOthers = entries === null && (isSealed || deadlineClosed);
            return (
              <GroupMatchCard
                key={m.id}
                match={appMatch}
                history={app}
                started={hasMatchStarted(appMatch, now)}
                to={customMatchPath(c.id, m.id)}
                plainResult
              >
                <section className="gm-picks" aria-label="Boletos de los seguidores">
                  <ul className="gm-pick-list">
                    <PickRow name="Tú" me match={appMatch} mode="own" value={own} loading={mine.loading} />
                    {others.map(([id, picks]) => (
                      <PickRow key={id} name={nameOf(id)} match={appMatch} mode="own" value={picks[m.id]} />
                    ))}
                  </ul>
                  {loadingOthers ? (
                    <p className="gm-picks-loading" role="status">
                      <span className="sr-only">Cargando boletos</span>
                      <span className="skeleton" aria-hidden="true" />
                    </p>
                  ) : (
                    !others.length && <p className="gm-picks-note">{boardNote(m, isSealed && !deadlineClosed)}</p>
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
        Sella el boleto antes del primer partido de la jornada: solo cuentan los boletos sellados.
      </p>
      {confirm && (
        <ConfirmQuiniela
          matches={required.map((m) => appById.get(m.id) ?? toAppMatch(c.id, m))}
          values={values}
          busy={submitting}
          demo={false}
          error={submitError}
          onCancel={() => {
            if (!submitting) setConfirm(false);
          }}
          onConfirm={() => void finalize()}
        />
      )}
    </>
  );
}
