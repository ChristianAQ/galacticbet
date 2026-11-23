import {
  CalendarPlus,
  CalendarRange,
  ChevronRight,
  ImagePlus,
  Settings2,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  addDays,
  FORMATS,
  localParts,
  MAX_PARTICIPANT_ICON_CHARS,
  recurringFixtures,
  roundKey,
  timeToMinutes,
  zonedInstant,
  type Competition,
  type CompetitionView,
  type Participant,
  type PredictionMode,
  type ResolvedMatch,
} from "../lib/customCompetition";
import {
  addFixtures,
  deleteCompetition,
  deleteParticipant,
  newMatchId,
  newParticipantId,
  saveMatch,
  saveParticipant,
  shrinkImage,
  updateCompetition,
  usePeople,
  type CompetitionData,
} from "../lib/customCompetitionData";
import { haptic } from "../lib/motion";
import { go } from "../lib/navigation";
import type { AppUser } from "../lib/session";
import InviteCard from "./CompetitionInvite";
import { CompetitionBadge } from "./CustomCompetition";
import { matchTitle, stored } from "./CustomMatchSheet";
import { SquadEditor } from "./CustomMatchReport";
import Modal from "./Modal";
import { readableError } from "./ui";
import "../styles/profile.css";

type Sheet =
  | { kind: "match" }
  | { kind: "move" }
  | { kind: "participant"; participant: Participant | null }
  | { kind: "settings" }
  | { kind: "delete" };

const PREDICTION_LABELS: Record<PredictionMode, string> = {
  exact: "Marcador exacto",
  classic: "1X2",
  off: "Sin pronósticos",
};

function Row({
  icon,
  label,
  detail,
  onClick,
  tone,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  onClick: () => void;
  tone?: "destructive";
}) {
  return (
    <li>
      <button type="button" className={`more-row${tone ? " is-destructive" : ""}`} onClick={onClick}>
        <span className="more-icon">{icon}</span>
        <span className="more-label">
          {label}
          {detail && <small>{detail}</small>}
        </span>
        <ChevronRight className="more-chevron" size={18} aria-hidden="true" />
      </button>
    </li>
  );
}

export default function CustomManage({
  competition: c,
  data,
  view,
  user,
  onOpenMatch,
}: {
  competition: Competition;
  data: CompetitionData;
  view: CompetitionView;
  user: AppUser;
  onOpenMatch: (id: string) => void;
}) {
  const owner = user.uid === c.ownerId;
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [notice, setNotice] = useState("");
  const people = usePeople(owner ? c.memberIds : []);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);
  const toggleAdmin = async (uid: string, on: boolean) => {
    try {
      await updateCompetition(c.id, {
        adminIds: on ? [...new Set([...c.adminIds, uid])] : c.adminIds.filter((id) => id !== uid),
      });
      haptic("success");
    } catch (e) {
      setNotice(readableError(e));
    }
  };
  const pending = view.matches.filter((m) => m.status === "scheduled" && m.startAt < Date.now());
  return (
    <div className="custom-manage">
      {notice && (
        <p className="league-toast" role="status">
          {notice}
        </p>
      )}
      {pending.length > 0 && (
        <section className="custom-manage-section">
          <div className="section-heading">
            <h2>Resultados pendientes</h2>
          </div>
          <ul className="more-list">
            {pending.slice(0, 6).map((m) => (
              <Row
                key={m.id}
                icon={<CalendarRange size={20} aria-hidden="true" />}
                label={`${m.home.name} – ${m.away.name}`}
                detail={`${matchTitle(m)} · ya se ha jugado`}
                onClick={() => onOpenMatch(m.id)}
              />
            ))}
          </ul>
        </section>
      )}
      <section className="custom-manage-section">
        <div className="section-heading">
          <h2>Invitar</h2>
        </div>
        <p className="muted">
          Con el código o el QR cualquiera puede ver partidos, resultados y tabla. Para seguirla y pronosticar hay que
          entrar con una cuenta.
        </p>
        <InviteCard competition={c} owner={owner} />
      </section>
      <section className="custom-manage-section">
        <div className="section-heading">
          <h2>Calendario</h2>
        </div>
        <ul className="more-list">
          <Row
            icon={<CalendarPlus size={20} aria-hidden="true" />}
            label="Añadir partidos"
            detail="Uno o repetido cada semana"
            onClick={() => setSheet({ kind: "match" })}
          />
          {view.matches.length > 0 && (
            <Row
              icon={<CalendarRange size={20} aria-hidden="true" />}
              label="Mover una jornada"
              detail="Cambia el día y la hora de todos sus partidos"
              onClick={() => setSheet({ kind: "move" })}
            />
          )}
        </ul>
      </section>
      <section className="custom-manage-section">
        <div className="section-heading">
          <h2>Participantes</h2>
          <span className="cc-count">{data.participants.length}</span>
        </div>
        <ul className="more-list">
          {data.participants.map((p) => (
            <li key={p.id}>
              <button type="button" className="more-row" onClick={() => setSheet({ kind: "participant", participant: p })}>
                <span className="more-icon custom-participant-icon">
                  <CompetitionBadge icon={p.icon} name={p.name} />
                </span>
                <span className="more-label">
                  {p.name}
                  <small>
                    {p.kind === "person"
                      ? "Persona"
                      : p.players?.length
                        ? `Equipo · ${p.players.length} ${p.players.length === 1 ? "jugador" : "jugadores"}`
                        : "Equipo · sin plantilla"}
                  </small>
                </span>
                <ChevronRight className="more-chevron" size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
          {c.format === "custom" && (
            <Row
              icon={<UserPlus size={20} aria-hidden="true" />}
              label="Añadir participante"
              onClick={() => setSheet({ kind: "participant", participant: null })}
            />
          )}
        </ul>
        {c.format !== "custom" && (
          <p className="footnote">
            En {FORMATS[c.format].label.toLowerCase()} el calendario se creó con estos participantes: puedes cambiar sus
            nombres e iconos.
          </p>
        )}
      </section>
      {owner && (
        <section className="custom-manage-section">
          <div className="section-heading">
            <h2>Administradores</h2>
          </div>
          <p className="muted">Gestionan participantes, calendario y resultados. Elígelos entre quienes siguen la competición.</p>
          <ul className="more-list">
            {c.memberIds.map((uid) => (
              <li key={uid}>
                <div className="more-row">
                  <span className="more-icon">
                    <CompetitionBadge icon={null} name={people[uid]?.name || "?"} />
                  </span>
                  <span className="more-label" id={`admin-${uid}`}>
                    {people[uid]?.name || "Jugador"}
                    <small>{uid === c.ownerId ? "Propietario" : c.adminIds.includes(uid) ? "Administrador" : "Seguidor"}</small>
                  </span>
                  {uid !== c.ownerId && (
                    <button
                      type="button"
                      role="switch"
                      className="switch"
                      aria-checked={c.adminIds.includes(uid)}
                      aria-labelledby={`admin-${uid}`}
                      onClick={() => void toggleAdmin(uid, !c.adminIds.includes(uid))}
                    >
                      <span aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {owner && (
        <section className="custom-manage-section">
          <div className="section-heading">
            <h2>Ajustes</h2>
          </div>
          <ul className="more-list">
            <Row
              icon={<Settings2 size={20} aria-hidden="true" />}
              label="Nombre, deporte e icono"
              detail={`Pronósticos: ${PREDICTION_LABELS[c.predictionMode]}`}
              onClick={() => setSheet({ kind: "settings" })}
            />
            <Row
              icon={<Trash2 size={20} aria-hidden="true" />}
              label="Eliminar competición"
              tone="destructive"
              onClick={() => setSheet({ kind: "delete" })}
            />
          </ul>
        </section>
      )}
      {sheet?.kind === "match" && <AddMatchesSheet competition={c} data={data} user={user} onClose={() => setSheet(null)} onDone={setNotice} />}
      {sheet?.kind === "move" && <MoveRoundSheet competition={c} view={view} user={user} onClose={() => setSheet(null)} onDone={setNotice} />}
      {sheet?.kind === "participant" && (
        <ParticipantSheet competition={c} data={data} participant={sheet.participant} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === "settings" && <SettingsSheet competition={c} onClose={() => setSheet(null)} />}
      {sheet?.kind === "delete" && <DeleteSheet competition={c} data={data} onClose={() => setSheet(null)} />}
    </div>
  );
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      haptic("success");
    } catch (e) {
      haptic("warning");
      setError(readableError(e));
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/** One match, or the same one every week (recurring), as custom matches. */
function AddMatchesSheet({
  competition: c,
  data,
  user,
  onClose,
  onDone,
}: {
  competition: Competition;
  data: CompetitionData;
  user: AppUser;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const last = data.matches.at(-1);
  const tz = c.schedule.timeZone;
  const suggested = last ? addDays(localParts(last.startAt, tz).date, c.schedule.everyDays) : c.schedule.start;
  const nextRound = Math.max(0, ...data.matches.filter((m) => m.phase === "custom").map((m) => m.round)) + 1;
  const [homeId, setHomeId] = useState("");
  const [awayId, setAwayId] = useState("");
  const [date, setDate] = useState(suggested);
  const [time, setTime] = useState(c.schedule.time);
  const [location, setLocation] = useState(c.schedule.location);
  const [round, setRound] = useState(String(nextRound));
  const [every, setEvery] = useState(0);
  const [count, setCount] = useState("4");
  const { busy, error, setError, run } = useBusy();
  function submit(e: FormEvent) {
    e.preventDefault();
    const times = every ? Number(count) : 1;
    const first = Number(round);
    if (!homeId || !awayId || homeId === awayId) return setError("Elige dos participantes distintos.");
    if (!Number.isInteger(times) || times < 1 || times > 52) return setError("Repite entre 1 y 52 veces.");
    if (!Number.isInteger(first) || first < 1 || first + times - 1 > 300) return setError("La jornada va de 1 a 300.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return setError("Indica fecha y hora.");
    const fixtures = recurringFixtures({
      homeId,
      awayId,
      start: date,
      time,
      everyDays: every || 7,
      count: times,
      location: location.trim(),
      timeZone: tz,
      firstRound: first,
      id: () => newMatchId(c.id),
    });
    void run(async () => {
      await addFixtures(c.id, fixtures, user.uid);
      onDone(times === 1 ? "Partido añadido al calendario." : `${times} partidos añadidos al calendario.`);
      onClose();
    });
  }
  return (
    <Modal title="Añadir partidos" busy={busy} onClose={onClose}>
      <form onSubmit={submit}>
        {c.format !== "custom" && (
          <p className="footnote">Estos partidos se suman al calendario como amistosos: no cuentan para la tabla ni el cuadro.</p>
        )}
        <div className="custom-two">
          <label>
            Local
            <select value={homeId} onChange={(e) => setHomeId(e.target.value)} disabled={busy} required>
              <option value="">Elige…</option>
              {data.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Visitante
            <select value={awayId} onChange={(e) => setAwayId(e.target.value)} disabled={busy} required>
              <option value="">Elige…</option>
              {data.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="custom-two">
          <label>
            Fecha
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} required />
          </label>
          <label>
            Hora
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} required />
          </label>
        </div>
        <label>
          Lugar
          <input value={location} maxLength={120} onChange={(e) => setLocation(e.target.value)} disabled={busy} placeholder="Campo, pista o dirección" />
        </label>
        <div className="custom-two">
          <label>
            Repetir
            <select value={every} onChange={(e) => setEvery(Number(e.target.value))} disabled={busy}>
              <option value={0}>Solo una vez</option>
              <option value={7}>Cada semana</option>
              <option value={14}>Cada 2 semanas</option>
              <option value={1}>Cada día</option>
            </select>
          </label>
          {every ? (
            <label>
              Veces
              <input type="number" inputMode="numeric" min={2} max={52} value={count} onChange={(e) => setCount(e.target.value)} disabled={busy} />
            </label>
          ) : (
            <label>
              Jornada
              <input type="number" inputMode="numeric" min={1} max={300} value={round} onChange={(e) => setRound(e.target.value)} disabled={busy} />
            </label>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? "Guardando…" : every ? `Añadir ${count || 0} ${Number(count) === 1 ? "partido" : "partidos"}` : "Añadir partido"}
        </button>
      </form>
    </Modal>
  );
}

/** A rained-off Saturday: every pending match of a round to a new day and time. */
function MoveRoundSheet({
  competition: c,
  view,
  user,
  onClose,
  onDone,
}: {
  competition: Competition;
  view: CompetitionView;
  user: AppUser;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const tz = c.schedule.timeZone;
  const rounds = useMemo(() => {
    const byKey = new Map<string, ResolvedMatch[]>();
    for (const m of view.matches) byKey.set(roundKey(m), [...(byKey.get(roundKey(m)) || []), m]);
    return [...byKey.entries()].map(([key, list]) => ({ key, list, title: matchTitle(list[0]).replace(/ · (ida|vuelta)$/, "") }));
  }, [view]);
  const firstOpen = rounds.find((r) => r.list.some((m) => !m.locked && m.status !== "finished")) || rounds[0];
  const [key, setKey] = useState(firstOpen?.key || "");
  const chosen = rounds.find((r) => r.key === key);
  const start = chosen ? Math.min(...chosen.list.map((m) => m.startAt)) : Date.now();
  const [date, setDate] = useState(localParts(start, tz).date);
  const [time, setTime] = useState(localParts(start, tz).time);
  const { busy, error, setError, run } = useBusy();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    const movable = chosen.list.filter((m) => !m.locked && m.status !== "finished");
    if (!movable.length) return setError("Todos los partidos de esta jornada están jugados.");
    const target = zonedInstant(date, timeToMinutes(time), tz);
    const shift = target - start;
    void run(async () => {
      for (const m of movable)
        await saveMatch(
          c.id,
          { ...stored(m), startAt: m.startAt + shift, status: m.status === "postponed" ? "scheduled" : m.status },
          user.uid,
        );
      onDone(`${chosen.title}: ${movable.length} ${movable.length === 1 ? "partido movido" : "partidos movidos"}.`);
      onClose();
    });
  }
  return (
    <Modal title="Mover una jornada" busy={busy} onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Jornada
          <select
            value={key}
            disabled={busy}
            onChange={(e) => {
              setKey(e.target.value);
              const r = rounds.find((x) => x.key === e.target.value);
              if (r) {
                const s = localParts(Math.min(...r.list.map((m) => m.startAt)), tz);
                setDate(s.date);
                setTime(s.time);
              }
            }}
          >
            {rounds.map((r) => (
              <option key={r.key} value={r.key}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <div className="custom-two">
          <label>
            Nuevo día
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} required />
          </label>
          <label>
            Primera hora
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} required />
          </label>
        </div>
        <p className="footnote">Los partidos mantienen la separación entre ellos. Los ya jugados no se mueven.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy || !chosen}>
          {busy ? "Moviendo…" : "Mover jornada"}
        </button>
      </form>
    </Modal>
  );
}

function IconPicker({
  value,
  onChange,
  disabled,
  max,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  /** Longest data URL the rules accept for this picture. */
  max?: number;
}) {
  const [error, setError] = useState("");
  return (
    <div className="custom-icon-picker">
      <CompetitionBadge icon={value} name="?" small={false} />
      <label className="button secondary custom-icon-button">
        <ImagePlus size={17} aria-hidden="true" />
        {value ? "Cambiar imagen" : "Subir imagen"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setError("");
            shrinkImage(file, undefined, max).then(onChange, (err) => setError(readableError(err)));
          }}
        />
      </label>
      {value && (
        <button type="button" className="text-button" disabled={disabled} onClick={() => onChange(null)}>
          Quitar
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export { IconPicker };

function ParticipantSheet({
  competition: c,
  data,
  participant,
  onClose,
}: {
  competition: Competition;
  data: CompetitionData;
  participant: Participant | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(participant?.name || "");
  const [icon, setIcon] = useState<string | null>(participant?.icon || null);
  const [players, setPlayers] = useState(participant?.players || []);
  const team = (participant?.kind || c.participantType) === "team";
  const [confirm, setConfirm] = useState(false);
  const { busy, error, setError, run } = useBusy();
  const used = participant ? data.matches.some((m) => m.homeId === participant.id || m.awayId === participant.id) : false;
  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || clean.length > 40) return setError("El nombre va de 1 a 40 caracteres.");
    if (data.participants.some((p) => p.id !== participant?.id && p.name.toLocaleLowerCase("es") === clean.toLocaleLowerCase("es")))
      return setError("Ya hay un participante con ese nombre.");
    void run(async () => {
      await saveParticipant(c.id, {
        id: participant?.id || newParticipantId(c.id),
        name: clean,
        kind: participant?.kind || c.participantType,
        userId: participant?.userId || null,
        icon,
        seed: participant?.seed ?? Math.min(63, data.participants.length),
        players: team
          ? players.flatMap((p) => (p.name.trim() ? [{ ...p, name: p.name.trim() }] : []))
          : participant?.players,
      });
      onClose();
    });
  }
  return (
    <Modal
      title={participant ? participant.name : "Nuevo participante"}
      busy={busy}
      onClose={onClose}
      detents={team ? ["large"] : ["fit"]}
    >
      {confirm ? (
        <div role="alertdialog" aria-label="Eliminar participante" className="custom-confirm">
          <p>Se eliminará {participant?.name}. No se puede deshacer.</p>
          <div className="confirm-buttons">
            <button type="button" className="button secondary" onClick={() => setConfirm(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => void run(async () => {
                await deleteParticipant(c.id, participant!.id);
                onClose();
              })}
            >
              Eliminar
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <label>
            Nombre
            <input value={name} maxLength={40} required disabled={busy} onChange={(e) => setName(e.target.value)} />
          </label>
          <IconPicker value={icon} onChange={setIcon} disabled={busy} max={MAX_PARTICIPANT_ICON_CHARS} />
          {team && <SquadEditor players={players} onChange={setPlayers} disabled={busy} />}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
          {participant && c.format === "custom" && (
            <button type="button" className="text-button is-destructive" disabled={busy || used} onClick={() => setConfirm(true)}>
              <Trash2 size={15} aria-hidden="true" />
              {used ? "Tiene partidos: no se puede eliminar" : "Eliminar participante"}
            </button>
          )}
        </form>
      )}
    </Modal>
  );
}

function SettingsSheet({ competition: c, onClose }: { competition: Competition; onClose: () => void }) {
  const [name, setName] = useState(c.name);
  const [sport, setSport] = useState(c.sport);
  const [icon, setIcon] = useState<string | null>(c.icon);
  const [mode, setMode] = useState<PredictionMode>(c.predictionMode);
  const { busy, error, setError, run } = useBusy();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 3 || name.trim().length > 60) return setError("El nombre va de 3 a 60 caracteres.");
    if (sport.trim().length > 40) return setError("El deporte admite hasta 40 caracteres.");
    void run(async () => {
      await updateCompetition(c.id, { name: name.trim(), sport: sport.trim(), icon, predictionMode: mode });
      onClose();
    });
  }
  return (
    <Modal title="Ajustes" busy={busy} onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Nombre
          <input value={name} minLength={3} maxLength={60} required disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Deporte o actividad
          <input value={sport} maxLength={40} disabled={busy} onChange={(e) => setSport(e.target.value)} />
        </label>
        <IconPicker value={icon} onChange={setIcon} disabled={busy} />
        <label>
          Pronósticos
          <select value={mode} disabled={busy} onChange={(e) => setMode(e.target.value as PredictionMode)}>
            {(Object.keys(PREDICTION_LABELS) as PredictionMode[]).map((m) => (
              <option key={m} value={m}>
                {PREDICTION_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </form>
    </Modal>
  );
}

function DeleteSheet({ competition: c, data, onClose }: { competition: Competition; data: CompetitionData; onClose: () => void }) {
  const { busy, error, run } = useBusy();
  return (
    <Modal title="¿Eliminar la competición?" role="alertdialog" busy={busy} onClose={onClose} initialFocus="[data-cancel]">
      <p>
        Se borrarán «{c.name}», sus {data.matches.length} {data.matches.length === 1 ? "partido" : "partidos"} y{" "}
        {data.participants.length} {data.participants.length === 1 ? "participante" : "participantes"} para todos.
        No se puede deshacer.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-buttons">
        <button type="button" className="button secondary" data-cancel disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await deleteCompetition(
                c.id,
                data.participants.map((p) => p.id),
                data.matches.map((m) => m.id),
                c.code,
              );
              go("/ligas", { reset: true });
            })
          }
        >
          {busy ? "Eliminando…" : "Eliminar"}
        </button>
      </div>
    </Modal>
  );
}
