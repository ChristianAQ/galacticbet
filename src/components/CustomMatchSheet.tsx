import { Lock, LockOpen, Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  localParts,
  roundKey,
  STATUS_LABELS,
  timeToMinutes,
  zonedInstant,
  type Competition,
  type CompetitionView,
  type CustomMatch,
  type MatchStatus,
  type Participant,
  type ResolvedMatch,
} from "../lib/customCompetition";
import {
  deleteMatch,
  loadMyPicks,
  saveMatch,
  settled,
  useCompetitionRounds,
  useMyEntry,
  usePeople,
  useRoundEntries,
} from "../lib/customCompetitionData";
import { encodePick, pickHit, pickLabel, pickPoints } from "../lib/customPicks";
import { haptic } from "../lib/motion";
import { go } from "../lib/navigation";
import Modal from "./Modal";
import { readableError } from "./ui";
import "../styles/quiniela.css";
import "../styles/customCompetition.css";
import "../styles/customMatch.css";

const STAGE_NAMES: Record<string, string> = {
  LAST_32: "Dieciseisavos",
  LAST_16: "Octavos de final",
  QUARTER_FINALS: "Cuartos de final",
  SEMI_FINALS: "Semifinal",
  THIRD_PLACE: "Tercer puesto",
  FINAL: "Final",
};
export function matchTitle(m: Pick<ResolvedMatch, "phase" | "stage" | "round" | "group" | "leg" | "friendly">) {
  if (m.friendly) return `Amistoso · Jornada ${m.round}`;
  if (m.phase === "knockout")
    return `${STAGE_NAMES[m.stage] || "Eliminatoria"}${m.leg ? ` · ${m.leg === 1 ? "ida" : "vuelta"}` : ""}`;
  return `${m.group ? `Grupo ${m.group} · ` : ""}Jornada ${m.round}`;
}

/** Only what the rules accept: the stored fields of a match. */
export function stored(m: ResolvedMatch): CustomMatch {
  return {
    id: m.id,
    phase: m.phase,
    round: m.round,
    stage: m.stage,
    group: m.group,
    tie: m.tie,
    leg: m.leg,
    homeId: m.homeId,
    awayId: m.awayId,
    homeSlot: m.homeSlot,
    awaySlot: m.awaySlot,
    startAt: m.startAt,
    location: m.location,
    status: m.status,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    homePenalties: m.homePenalties,
    awayPenalties: m.awayPenalties,
    locked: m.locked,
    events: m.events || [],
    lineups: m.lineups || null,
  };
}
const goals = (value: string) => {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : NaN;
};
const STATUSES = Object.keys(STATUS_LABELS) as MatchStatus[];

/** Goals of one side with big steppers: a thumb is enough at the side of the pitch. */
function ScoreField({
  team,
  value,
  onChange,
  disabled,
  label = "Goles",
}: {
  team: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  label?: string;
}) {
  const n = goals(value);
  const step = (by: number) => {
    haptic();
    onChange(String(Math.min(99, Math.max(0, (Number.isNaN(n) || n === null ? 0 : n) + by))));
  };
  return (
    <label className="custom-score-side">
      <span>{team}</span>
      <span className="exact-side">
        <button
          type="button"
          className="exact-step"
          aria-label={`${label}: uno menos para ${team}`}
          disabled={disabled || !n}
          onClick={() => step(-1)}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min={0}
          max={99}
          value={value}
          disabled={disabled}
          placeholder="–"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} de ${team}`}
        />
        <button
          type="button"
          className="exact-step"
          aria-label={`${label}: uno más para ${team}`}
          disabled={disabled || n === 99}
          onClick={() => step(1)}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </span>
    </label>
  );
}

/**
 * Organisers: state, result, sides, date and place of a match, plus
 * confirming, unlocking or deleting it. The match page opens it.
 */
export default function MatchEditSheet({
  competition,
  view,
  match,
  participants,
  uid,
  onClose,
  onDeleted,
}: {
  competition: Competition;
  view: CompetitionView;
  match: ResolvedMatch;
  participants: Participant[];
  uid: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const owner = uid === competition.ownerId;
  const tz = competition.schedule.timeZone;
  const local = localParts(match.startAt, tz);
  const [status, setStatus] = useState<MatchStatus>(match.status);
  const [home, setHome] = useState(match.homeScore?.toString() ?? "");
  const [away, setAway] = useState(match.awayScore?.toString() ?? "");
  const [homePens, setHomePens] = useState(match.homePenalties?.toString() ?? "");
  const [awayPens, setAwayPens] = useState(match.awayPenalties?.toString() ?? "");
  const [date, setDate] = useState(local.date);
  const [time, setTime] = useState(local.time);
  const [location, setLocation] = useState(match.location);
  // Custom matches choose their sides; a knockout side can be set by hand while undecided.
  const pickSides = match.phase === "custom" || (match.phase === "knockout" && (match.home.pending || match.away.pending || match.homeId !== null));
  // Only stored sides: an untouched «Según el cuadro» keeps following the bracket.
  const [homeId, setHomeId] = useState(match.phase === "custom" ? match.homeId || match.home.id || "" : match.homeId || "");
  const [awayId, setAwayId] = useState(match.phase === "custom" ? match.awayId || match.away.id || "" : match.awayId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"lock" | "delete" | null>(null);
  const scored = status === "live" || status === "finished";
  // Starting it: the score begins at 0–0, ready for the steppers.
  useEffect(() => {
    if (!scored) return;
    setHome((v) => (v === "" ? "0" : v));
    setAway((v) => (v === "" ? "0" : v));
  }, [scored]);

  // Penalties only when they decide something: a drawn single match, or a
  // second leg that leaves the tie level on aggregate.
  const needsPenalties = useMemo(() => {
    if (match.phase !== "knockout" || status !== "finished") return false;
    const h = goals(home);
    const a = goals(away);
    if (h === null || a === null || Number.isNaN(h) || Number.isNaN(a)) return false;
    if (!match.leg) return h === a;
    if (match.leg !== 2) return false;
    const first = view.matches.find((m) => m.tie === match.tie && m.leg === 1);
    if (!first || first.status !== "finished" || first.homeScore === null || first.awayScore === null) return false;
    // In the return leg the sides are swapped.
    return first.homeScore + a === first.awayScore + h;
  }, [match, status, home, away, view]);

  async function write(next: CustomMatch) {
    setBusy(true);
    setError("");
    try {
      await settled(saveMatch(competition.id, next, uid));
      haptic("success");
      onClose();
    } catch (e) {
      haptic("warning");
      setError(readableError(e));
      setBusy(false);
    }
  }

  function build(): CustomMatch | null {
    const h = scored ? goals(home) : null;
    const a = scored ? goals(away) : null;
    if (scored && (Number.isNaN(h) || Number.isNaN(a))) return fail("El marcador va de 0 a 99.");
    if (status === "finished" && (h === null || a === null)) return fail("Para finalizarlo, indica el marcador.");
    if (status === "live" && (h === null) !== (a === null)) return fail("Completa el marcador o déjalo vacío.");
    let hp: number | null = null;
    let ap: number | null = null;
    if (needsPenalties) {
      hp = goals(homePens);
      ap = goals(awayPens);
      if (hp === null || ap === null || Number.isNaN(hp) || Number.isNaN(ap) || hp === ap)
        return fail("Hay empate: indica los penaltis con un ganador.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return fail("Indica fecha y hora.");
    if (location.trim().length > 120) return fail("El lugar admite hasta 120 caracteres.");
    const sides = pickSides
      ? { homeId: homeId || null, awayId: awayId || null }
      : { homeId: match.homeId, awayId: match.awayId };
    if (sides.homeId && sides.homeId === sides.awayId) return fail("Elige dos participantes distintos.");
    if (match.phase === "custom" && (!sides.homeId || !sides.awayId)) return fail("Elige los dos participantes.");
    return {
      ...stored(match),
      ...sides,
      status,
      homeScore: h,
      awayScore: a,
      homePenalties: hp,
      awayPenalties: ap,
      startAt: zonedInstant(date, timeToMinutes(time), tz),
      location: location.trim(),
      // Only a final result stays confirmed (the owner may reopen it as anything else).
      locked: match.locked && (status === "finished" || status === "cancelled"),
    };
  }
  function fail(message: string) {
    setError(message);
    haptic("warning");
    return null;
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const next = build();
    if (next) void write(next);
  }

  return (
    <Modal title="Editar partido" busy={busy} onClose={onClose} className="custom-match-sheet" detents={["large"]}>
      {confirm === null ? (
        <form onSubmit={submit} className="custom-match-form">
          <fieldset className="custom-status-choices">
            <legend>Estado</legend>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                disabled={busy}
                onClick={() => {
                  if (s !== status) haptic();
                  setStatus(s);
                }}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </fieldset>
          {pickSides && (
            <div className="custom-two">
              {(
                [
                  ["Local", homeId, setHomeId],
                  ["Visitante", awayId, setAwayId],
                ] as const
              ).map(([label, value, set]) => (
                <label key={label}>
                  {label}
                  <select value={value} disabled={busy} onChange={(e) => set(e.target.value)}>
                    <option value="">{match.phase === "custom" ? "Elige…" : "Según el cuadro"}</option>
                    {participants.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          {scored && (
            <fieldset className="custom-score">
              <legend>Marcador</legend>
              <ScoreField team={match.home.name} value={home} onChange={setHome} disabled={busy} />
              <ScoreField team={match.away.name} value={away} onChange={setAway} disabled={busy} />
            </fieldset>
          )}
          {needsPenalties && (
            <fieldset className="custom-score is-penalties">
              <legend>Penaltis</legend>
              <ScoreField team={match.home.name} value={homePens} onChange={setHomePens} disabled={busy} label="Penaltis" />
              <ScoreField team={match.away.name} value={awayPens} onChange={setAwayPens} disabled={busy} label="Penaltis" />
            </fieldset>
          )}
          <div className="custom-two">
            <label>
              Fecha
              <input type="date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Hora
              <input type="time" value={time} disabled={busy} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <label>
            Lugar
            <input value={location} maxLength={120} disabled={busy} placeholder="Campo, pista o dirección" onChange={(e) => setLocation(e.target.value)} />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
          <div className="custom-match-secondary">
            {!match.locked && ["finished", "cancelled"].includes(match.status) && (
              <button type="button" className="text-button" disabled={busy} onClick={() => setConfirm("lock")}>
                <Lock size={15} aria-hidden="true" /> Confirmar resultado
              </button>
            )}
            {match.locked && owner && (
              <button type="button" className="text-button" disabled={busy} onClick={() => void write({ ...stored(match), locked: false })}>
                <LockOpen size={15} aria-hidden="true" /> Desbloquear resultado
              </button>
            )}
            {match.phase === "custom" && (owner || (!match.locked && match.status !== "finished")) && (
              <button type="button" className="text-button is-destructive" disabled={busy} onClick={() => setConfirm("delete")}>
                <Trash2 size={15} aria-hidden="true" /> Eliminar partido
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="custom-confirm" role="alertdialog" aria-label={confirm === "lock" ? "Confirmar resultado" : "Eliminar partido"}>
          <p>
            {confirm === "lock"
              ? "Al confirmarlo, el resultado queda bloqueado: solo el propietario podrá cambiarlo."
              : "Se eliminará el partido del calendario. No se puede deshacer."}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm-buttons">
            <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirm(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className={`button ${confirm === "delete" ? "danger" : "primary"}`}
              disabled={busy}
              onClick={() => {
                if (confirm === "lock") void write({ ...stored(match), locked: true });
                else {
                  setBusy(true);
                  deleteMatch(competition.id, match.id).then(onDeleted, (e) => {
                    setError(readableError(e));
                    setBusy(false);
                  });
                }
              }}
            >
              {confirm === "lock" ? "Confirmar" : "Eliminar"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * As in LaLiga's quiniela: until you seal your slip (or the round closes)
 * only your own pick shows; then every sealed slip, with its points.
 */
export function MatchPicks({
  competition,
  match,
  uid,
}: {
  competition: Competition;
  match: ResolvedMatch;
  uid: string;
}) {
  const rk = roundKey(match);
  const rounds = useCompetitionRounds(competition.id);
  const round = rounds?.[rk];
  const mine = useMyEntry(competition.id, rk, uid);
  const closed = Boolean(round && round.deadline <= Date.now());
  const readable = closed || Boolean(mine.picks);
  const entries = useRoundEntries(competition.id, rk, readable);
  const [draft, setDraft] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (readable) return;
    let live = true;
    loadMyPicks(competition.id, [match.id], uid).then(
      (r) => live && setDraft(r[match.id] ?? null),
      () => live && setDraft(null),
    );
    return () => {
      live = false;
    };
  }, [competition.id, match.id, uid, readable]);
  const picks = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(entries || {}).flatMap(([id, p]) => (p[match.id] ? [[id, encodePick(p[match.id])]] : [])),
      ) as Record<string, string>,
    [entries, match.id],
  );
  const people = usePeople(Object.keys(picks));
  const loading = rounds === null || mine.loading || (readable ? entries === null : draft === undefined);
  if (loading)
    return (
      <p className="gm-picks-loading" role="status">
        <span className="sr-only">Cargando pronósticos</span>
        <span className="skeleton" aria-hidden="true" />
      </p>
    );
  const rows = Object.entries(picks)
    .map(([id, raw]) => ({ id, raw, points: pickPoints(raw, match), hit: pickHit(raw, match) }))
    .sort(
      (a, b) =>
        (b.points ?? -1) - (a.points ?? -1) ||
        (people[a.id]?.name || "").localeCompare(people[b.id]?.name || "", "es"),
    );
  const canSeal = Boolean(round && !closed && round.matchIds.includes(match.id)) && competition.memberIds.includes(uid);
  return (
    <section className="match-block custom-match-picks-section" aria-labelledby="match-picks-title">
      <h3 id="match-picks-title" className="match-block-title">
        Pronósticos{readable && rows.length > 0 ? ` · ${rows.length}` : ""}
      </h3>
      {!readable ? (
        <p className="muted">
          {draft ? (
            <>
              Tu pronóstico: <strong>{pickLabel(draft)}</strong>, aún sin sellar.{" "}
            </>
          ) : (
            "Aún no has pronosticado este partido. "
          )}
          Los boletos de los demás se ven al sellar el tuyo o cuando se cierra la jornada.
          {canSeal && (
            <>
              {" "}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  go(`/quiniela?liga=${encodeURIComponent(competition.id)}&round=${encodeURIComponent(`${competition.id}:${rk}`)}`)
                }
              >
                {draft ? "Sellar en la Quiniela" : "Pronosticar en la Quiniela"}
              </button>
            </>
          )}
        </p>
      ) : rows.length ? (
        <ul className="custom-match-picks">
          {rows.map((r) => (
            <li key={r.id} className={`${r.id === uid ? "is-me" : ""}${r.points ? " is-hit" : ""}`}>
              <span className="pick-name">
                {people[r.id]?.name || "Jugador"}
                {r.id === uid && " · Tú"}
              </span>
              <span className="pick-value">{pickLabel(r.raw)}</span>
              <span className="pick-points">
                {r.points === null ? "—" : r.hit === "exact" ? `+${r.points} pleno` : `${r.points ? "+" : ""}${r.points}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nadie selló un boleto con este partido.</p>
      )}
    </section>
  );
}
