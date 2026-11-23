import { CalendarClock, Lock, LockOpen, MapPin, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import {
  localParts,
  STATUS_LABELS,
  timeToMinutes,
  toAppMatch,
  zonedInstant,
  type Competition,
  type CompetitionView,
  type CustomMatch,
  type MatchStatus,
  type Participant,
  type ResolvedMatch,
} from "../lib/customCompetition";
import { deleteMatch, saveMatch } from "../lib/customCompetitionData";
import { haptic } from "../lib/motion";
import type { AppUser } from "../lib/session";
import Modal from "./Modal";
import { MatchRow, readableError } from "./ui";

const when = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});
const STAGE_NAMES: Record<string, string> = {
  LAST_32: "Dieciseisavos",
  LAST_16: "Octavos de final",
  QUARTER_FINALS: "Cuartos de final",
  SEMI_FINALS: "Semifinal",
  THIRD_PLACE: "Tercer puesto",
  FINAL: "Final",
};
export function matchTitle(m: Pick<CustomMatch, "phase" | "stage" | "round" | "group" | "leg">) {
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
  };
}
const goals = (value: string) => {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : NaN;
};

export default function CustomMatchSheet({
  competition,
  view,
  match,
  participants,
  user,
  onClose,
}: {
  competition: Competition;
  view: CompetitionView;
  match: ResolvedMatch;
  participants: Participant[];
  user: AppUser | null;
  onClose: () => void;
}) {
  const uid = user?.uid || "";
  const owner = uid === competition.ownerId;
  const runs = owner || competition.adminIds.includes(uid);
  const editable = runs && (!match.locked || owner);
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
  const [homeId, setHomeId] = useState(match.homeId || match.home.id || "");
  const [awayId, setAwayId] = useState(match.awayId || match.away.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"lock" | "delete" | null>(null);
  const scored = status === "live" || status === "finished";

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
      await saveMatch(competition.id, next, uid);
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

  const app = toAppMatch(competition.id, match);
  return (
    <Modal title={matchTitle(match)} busy={busy} onClose={onClose} className="custom-match-sheet">
      <div className="custom-match-preview">
        <MatchRow match={app} plainResult />
      </div>
      <ul className="custom-match-facts">
        <li>
          <CalendarClock size={16} aria-hidden="true" />
          {when.format(match.startAt)}
        </li>
        {match.location && (
          <li>
            <MapPin size={16} aria-hidden="true" />
            {match.location}
          </li>
        )}
        <li>
          <span className={`custom-status is-${match.status}`}>{STATUS_LABELS[match.status]}</span>
          {match.locked && (
            <span className="custom-locked">
              <Lock size={14} aria-hidden="true" /> Resultado confirmado
            </span>
          )}
        </li>
      </ul>
      {runs && match.locked && !owner && (
        <p className="footnote">
          <Lock size={13} aria-hidden="true" />
          Resultado confirmado: solo el propietario puede cambiarlo.
        </p>
      )}
      {editable && confirm === null && (
        <form onSubmit={submit} className="custom-match-form">
          <label>
            Estado
            <select value={status} disabled={busy} onChange={(e) => setStatus(e.target.value as MatchStatus)}>
              {(Object.keys(STATUS_LABELS) as MatchStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
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
              <label>
                <span>{match.home.name}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  value={home}
                  disabled={busy}
                  onChange={(e) => setHome(e.target.value)}
                  aria-label={`Goles de ${match.home.name}`}
                />
              </label>
              <span aria-hidden="true">–</span>
              <label>
                <span>{match.away.name}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  value={away}
                  disabled={busy}
                  onChange={(e) => setAway(e.target.value)}
                  aria-label={`Goles de ${match.away.name}`}
                />
              </label>
            </fieldset>
          )}
          {needsPenalties && (
            <fieldset className="custom-score is-penalties">
              <legend>Penaltis</legend>
              <label>
                <span>{match.home.name}</span>
                <input type="number" inputMode="numeric" min={0} max={99} value={homePens} disabled={busy} onChange={(e) => setHomePens(e.target.value)} aria-label={`Penaltis de ${match.home.name}`} />
              </label>
              <span aria-hidden="true">–</span>
              <label>
                <span>{match.away.name}</span>
                <input type="number" inputMode="numeric" min={0} max={99} value={awayPens} disabled={busy} onChange={(e) => setAwayPens(e.target.value)} aria-label={`Penaltis de ${match.away.name}`} />
              </label>
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
      )}
      {confirm && (
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
                  deleteMatch(competition.id, match.id).then(onClose, (e) => {
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
