import { Plus, Trophy } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  resolveCompetition,
  roundKey,
  toAppMatch,
  type ResolvedMatch,
} from "../lib/customCompetition";
import { followCompetition, savePick, useCompetition } from "../lib/customCompetitionData";
import { canPick, decodePick, encodePick, pickHit, pickPoints } from "../lib/customPicks";
import { preferredRound, type Match, type PredictionValue } from "../lib/domain";
import { haptic } from "../lib/motion";
import { go } from "../lib/navigation";
import { roundOptions } from "../lib/roundOptions";
import type { AppUser } from "../lib/session";
import { useClock, useMyPicks, useStartedPicks } from "../lib/useCompetitionPicks";
import { useStuck } from "../lib/useStuck";
import PredictionCard from "./PredictionCard";
import RoundSelector from "./RoundSelector";
import { SkeletonRows } from "./Skeleton";
import { Empty, readableError } from "./ui";
import "../styles/quiniela.css";
import "../styles/customCompetition.css";

const MatchSheet = lazy(() => import("./CustomMatchSheet"));

/** Why a match of the round takes no pick, when it isn't simply under way. */
function closedReason(m: ResolvedMatch, now: number): string | null {
  if (m.status === "cancelled") return "Cancelado";
  if (m.status === "postponed") return "Aplazado";
  if (m.home.pending || m.away.pending || !m.home.id || !m.away.id) return "Rivales por decidir";
  if (m.status === "finished") return "Finalizado";
  if (m.status === "live") return "En juego";
  if (m.startAt <= now) return "Ya ha empezado";
  return null;
}

/** Under a played match: what your pick scored. */
function PickOutcome({ raw, match }: { raw?: string; match: ResolvedMatch }) {
  if (match.status !== "finished") return null;
  if (!raw)
    return (
      <p className="custom-slip-result">
        <span>Sin pronóstico</span>
        <strong>0 puntos</strong>
      </p>
    );
  const points = pickPoints(raw, match) ?? 0;
  const hit = pickHit(raw, match);
  const label =
    hit === "exact" ? "Pleno" : hit === "outcome" ? (typeof decodePick(raw) === "string" ? "Acierto" : "Signo acertado") : "Fallo";
  return (
    <p className={`custom-slip-result is-${hit}`}>
      <span>{label}</span>
      <strong>
        {points > 0 ? "+" : ""}
        {points} {points === 1 ? "punto" : "puntos"}
      </strong>
    </p>
  );
}

/**
 * The quiniela of a friends' competition: the same slip as LaLiga's, round by
 * round. Each pick is saved at once and closes when its match starts; points
 * come from the results the organisers enter.
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
  const started = useMemo(() => list.filter((m) => m.startAt <= now && m.status !== "cancelled"), [list, now]);
  const [mine, setMine] = useMyPicks(cid, open.map((m) => m.id), uid);
  const revealed = useStartedPicks(cid, started, uid);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [joining, setJoining] = useState(false);
  const [sheet, setSheet] = useState("");
  const { sentinel, stuck } = useStuck();
  const following = Boolean(c?.memberIds.includes(uid));
  const valueOf = (mid: string) => mine?.[mid] ?? revealed?.[mid]?.[uid];

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
  const playable = list.filter((m) => m.status !== "cancelled" && m.home.id && m.away.id && !m.home.pending && !m.away.pending);
  const completed = playable.filter((m) => valueOf(m.id)).length;
  const total = playable.length;
  const savingCount = Object.keys(saving).length;
  const status =
    savingCount > 0
      ? "Anotando…"
      : !open.length
        ? "Jornada cerrada"
        : open.every((m) => mine?.[m.id])
          ? "Todo anotado"
          : "Se guarda al momento";
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
      <div ref={sentinel} className="sticky-sentinel" />
      <section
        className={`round-save-panel${stuck ? " is-stuck" : ""}${total && completed === total ? " is-ready" : ""}`}
        aria-label="Estado de tu boleto"
        aria-busy={savingCount > 0}
      >
        <div className="round-save-progress">
          <strong className="round-save-count" aria-hidden="true">
            {completed}
            <small>/{total}</small>
          </strong>
          <div className="round-progress-row">
            <span>{status}</span>
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
          type="button"
          className="button secondary"
          onClick={() => go(`/clasificacion?liga=${encodeURIComponent(cid)}`)}
        >
          <Trophy size={17} aria-hidden="true" />
          <span>Tabla</span>
        </button>
      </section>
      <div role="region" aria-label="Mi quiniela" className="prediction-list slip">
        {list.map((m, index) => {
          const reason = closedReason(m, now);
          const raw = valueOf(m.id);
          return (
            <PredictionCard
              key={m.id}
              number={index + 1}
              match={toAppMatch(c.id, m)}
              history={[]}
              value={raw ? decodePick(raw) ?? undefined : undefined}
              mode={mode}
              lock={reason ? "kickoff" : null}
              lockLabel={reason ?? undefined}
              disabled={!following}
              saving={Boolean(saving[m.id])}
              demo={false}
              onChoose={onChoose}
              onDetails={onDetails}
              detailsLabel="Ficha del partido"
              footer={<PickOutcome raw={raw} match={m} />}
              plainResult
            />
          );
        })}
      </div>
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
