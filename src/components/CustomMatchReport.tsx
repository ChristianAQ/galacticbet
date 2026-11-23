import { ArrowLeftRight, ClipboardPaste, Goal, Plus, Trash2, UserPlus } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  POSITIONS,
  POSITION_NAMES,
  MAX_SQUAD,
  type Competition,
  type EventKind,
  type LineupPlayer,
  type MatchEvent,
  type MatchLineups,
  type Participant,
  type PlayerPosition,
  type ResolvedMatch,
  type SquadPlayer,
} from "../lib/customCompetition";
import { saveMatchReport, saveParticipant, settled } from "../lib/customCompetitionData";
import {
  applyEvents,
  EVENT_LABELS,
  isGoal,
  MAX_EXTRA,
  MAX_MINUTE,
  minuteLabel,
  newReportId,
  other,
  parseSquadList,
  sortSquad,
  suggestedMinute,
  type Side,
} from "../lib/matchReport";
import { haptic } from "../lib/motion";
import Modal from "./Modal";
import Segmented from "./Segmented";
import { readableError } from "./ui";
import "../styles/customCompetition.css";
import "../styles/customMatch.css";

type Group = "goal" | "card" | "substitution";
const groupOf = (kind: EventKind): Group =>
  isGoal({ kind }) ? "goal" : kind === "substitution" ? "substitution" : "card";
const GOAL_KINDS = [
  { value: "goal", label: "Gol" },
  { value: "penalty", label: "Penalti" },
  { value: "own-goal", label: "En propia" },
] as const;
const CARD_KINDS = [
  { value: "yellow-card", label: "Amarilla" },
  { value: "second-yellow", label: "2ª amarilla" },
  { value: "red-card", label: "Roja" },
] as const;
interface Pick {
  id: string | null;
  name: string;
}
const sideName = (m: ResolvedMatch, side: Side) => (side === "home" ? m.home.name : m.away.name);

/** Who can be chosen for a side: its lineup when there is one, else its squad. */
function candidates(match: ResolvedMatch, participants: Participant[], side: Side): SquadPlayer[] {
  const lineup = match.lineups?.[side];
  if (lineup?.length) return [...lineup].sort((a, b) => Number(b.starter) - Number(a.starter));
  const team = participants.find((p) => p.id === (side === "home" ? match.home.id : match.away.id));
  return sortSquad(team?.players || []);
}

/** A grid of players to tap, and «Otro» to type a name that isn't there. */
function PlayerPicker({
  label,
  players,
  value,
  onChange,
  optional = false,
  disabled,
}: {
  label: string;
  players: SquadPlayer[];
  value: Pick | null;
  onChange: (value: Pick | null) => void;
  optional?: boolean;
  disabled: boolean;
}) {
  const typed = value !== null && value.id === null;
  const [writing, setWriting] = useState(typed || players.length === 0);
  return (
    <fieldset className="report-picker">
      <legend>
        {label}
        {optional && <small> · opcional</small>}
      </legend>
      {players.length > 0 && (
        <div className="report-players">
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={value?.id === p.id}
              disabled={disabled}
              onClick={() => {
                haptic();
                setWriting(false);
                onChange(value?.id === p.id ? null : { id: p.id, name: p.name });
              }}
            >
              <b>{p.number ?? "–"}</b>
              <span>{p.name}</span>
            </button>
          ))}
          <button
            type="button"
            aria-pressed={writing}
            disabled={disabled}
            onClick={() => {
              setWriting(true);
              onChange(null);
            }}
          >
            <b>
              <Plus size={13} aria-hidden="true" />
            </b>
            <span>Otro</span>
          </button>
        </div>
      )}
      {writing && (
        <input
          className="report-name"
          value={typed ? value.name : ""}
          maxLength={40}
          disabled={disabled}
          placeholder="Nombre del jugador"
          autoComplete="off"
          enterKeyHint="done"
          aria-label={label}
          onChange={(e) => onChange(e.target.value.trim() ? { id: null, name: e.target.value } : null)}
        />
      )}
    </fieldset>
  );
}

/**
 * Organisers: one goal, card or change in a few taps (type, team, minute,
 * player). Goals move the score with them; the sheet shows how.
 */
export function EventSheet({
  competition,
  match,
  participants,
  uid,
  event,
  onClose,
}: {
  competition: Competition;
  match: ResolvedMatch;
  participants: Participant[];
  uid: string;
  /** An event to correct (or delete); none to report a new one. */
  event: MatchEvent | null;
  onClose: () => void;
}) {
  const initialGroup = event ? groupOf(event.kind) : "goal";
  const [group, setGroup] = useState<Group>(initialGroup);
  const [goalKind, setGoalKind] = useState<EventKind>(event && initialGroup === "goal" ? event.kind : "goal");
  const [cardKind, setCardKind] = useState<EventKind>(event && initialGroup === "card" ? event.kind : "yellow-card");
  // The player's own team (an own goal counts for the other side).
  const [team, setTeam] = useState<Side>(event ? (event.kind === "own-goal" ? other(event.side) : event.side) : "home");
  const [minute, setMinute] = useState(String(event?.minute ?? suggestedMinute(match) ?? ""));
  const [extra, setExtra] = useState(event?.extra ? String(event.extra) : "");
  const [player, setPlayer] = useState<Pick | null>(
    event && event.player ? { id: event.playerId, name: event.player } : null,
  );
  const [second, setSecond] = useState<Pick | null>(
    event?.other ? { id: event.otherId, name: event.other } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const minuteRef = useRef<HTMLInputElement>(null);
  const kind: EventKind = group === "goal" ? goalKind : group === "card" ? cardKind : "substitution";
  const side: Side = kind === "own-goal" ? other(team) : team;
  const players = useMemo(() => candidates(match, participants, team), [match, participants, team]);
  const events = match.events || [];

  function draft(): MatchEvent | null {
    const m = Number(minute);
    const x = extra.trim() ? Number(extra) : null;
    if (!Number.isInteger(m) || m < 1 || m > MAX_MINUTE) return fail(`El minuto va de 1 a ${MAX_MINUTE}.`);
    if (x !== null && (!Number.isInteger(x) || x < 1 || x > MAX_EXTRA)) return fail(`El añadido va de 1 a ${MAX_EXTRA}.`);
    const name = player?.name.trim().slice(0, 40) || "";
    if (!name && group !== "goal") return fail(group === "card" ? "Elige quién ve la tarjeta." : "Elige quién entra.");
    const secondName = second?.name.trim().slice(0, 40) || null;
    return {
      id: event?.id || newReportId(),
      kind,
      side,
      minute: m,
      extra: x,
      player: name,
      playerId: name ? player?.id ?? null : null,
      other: kind === "own-goal" || group === "card" ? null : secondName,
      otherId: kind === "own-goal" || group === "card" || !secondName ? null : second?.id ?? null,
    };
  }
  function fail(message: string) {
    setError(message);
    haptic("warning");
    return null;
  }
  const chronological = (list: MatchEvent[]) =>
    [...list].sort((a, b) => a.minute - b.minute || (a.extra ?? 0) - (b.extra ?? 0));
  const next = (e: MatchEvent) => chronological(event ? events.map((x) => (x.id === e.id ? e : x)) : [...events, e]);

  async function commit(list: MatchEvent[], close: boolean, done = "") {
    setBusy(true);
    setError("");
    try {
      await settled(saveMatchReport(competition.id, match.id, applyEvents(match, list), uid));
      haptic("success");
      if (close) return onClose();
      // Ready for the next one: same team and minute, new player.
      setSaved(done);
      setPlayer(null);
      setSecond(null);
      setBusy(false);
      minuteRef.current?.focus();
    } catch (e) {
      haptic("warning");
      setError(readableError(e));
      setBusy(false);
    }
  }
  function submit(e: FormEvent, another = false) {
    e.preventDefault();
    const value = draft();
    if (value) void commit(next(value), !another, `${EVENT_LABELS[value.kind]} · ${minuteLabel(value)} anotado.`);
  }
  // What a goal does to the score, before saving it.
  const preview = useMemo(() => {
    if (group !== "goal" || !Number(minute)) return null;
    const probe: MatchEvent = {
      id: event?.id || "probe",
      kind,
      side,
      minute: Number(minute),
      extra: null,
      player: "",
      playerId: null,
      other: null,
      otherId: null,
    };
    const after = applyEvents(match, event ? events.map((x) => (x.id === probe.id ? probe : x)) : [...events, probe]);
    const now = (h: number | null, a: number | null) => `${h ?? 0}–${a ?? 0}`;
    const before = now(match.homeScore, match.awayScore);
    const result = now(after.homeScore, after.awayScore);
    return before === result ? `El marcador se queda en ${result}: ya contaba este gol.` : `Marcador: ${before} → ${result}`;
  }, [group, kind, side, minute, match, events, event]);

  return (
    <Modal
      title={event ? "Editar evento" : "Nuevo evento"}
      busy={busy}
      onClose={onClose}
      className="report-sheet"
      detents={["large"]}
      footer={
        <div className="report-actions">
          {!event && (
            <button type="button" className="button secondary" disabled={busy} onClick={(e) => submit(e, true)}>
              Guardar y otro
            </button>
          )}
          <button type="submit" form="report-event" className="button primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      }
    >
      <form id="report-event" className="report-form" onSubmit={(e) => submit(e)}>
        <Segmented<Group>
          label="Tipo de evento"
          value={group}
          options={[
            { value: "goal", label: "Gol" },
            { value: "card", label: "Tarjeta" },
            { value: "substitution", label: "Cambio" },
          ]}
          onChange={(g) => {
            setGroup(g);
            setError("");
          }}
        />
        {group !== "substitution" && (
          <div className="report-kinds" role="radiogroup" aria-label={group === "goal" ? "Tipo de gol" : "Tarjeta"}>
            {(group === "goal" ? GOAL_KINDS : CARD_KINDS).map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={kind === k.value}
                className={`report-kind is-${k.value}`}
                disabled={busy}
                onClick={() => {
                  haptic();
                  if (group === "goal") setGoalKind(k.value);
                  else setCardKind(k.value);
                }}
              >
                {group === "goal" ? <Goal size={16} aria-hidden="true" /> : <i className={`incident-card ${k.value}`} aria-hidden="true" />}
                {k.label}
              </button>
            ))}
          </div>
        )}
        <fieldset className="report-teams">
          <legend>{kind === "own-goal" ? "Equipo del jugador que la mete en propia" : "Equipo"}</legend>
          {(["home", "away"] as const).map((s) => {
            const p = s === "home" ? match.home : match.away;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={team === s}
                disabled={busy}
                onClick={() => {
                  if (team === s) return;
                  haptic();
                  setTeam(s);
                  setPlayer(null);
                  setSecond(null);
                }}
              >
                {p.icon ? <img src={p.icon} alt="" /> : <span className="crest-placeholder" aria-hidden="true" />}
                <span>{p.name}</span>
              </button>
            );
          })}
        </fieldset>
        <div className="report-minute">
          <label>
            Minuto
            <input
              ref={minuteRef}
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min={1}
              max={MAX_MINUTE}
              value={minute}
              disabled={busy}
              required
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setMinute(e.target.value)}
            />
          </label>
          <span aria-hidden="true">+</span>
          <label>
            Añadido
            <input
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min={1}
              max={MAX_EXTRA}
              value={extra}
              disabled={busy}
              placeholder="—"
              onChange={(e) => setExtra(e.target.value)}
            />
          </label>
        </div>
        <PlayerPicker
          key={`player-${team}`}
          label={group === "goal" ? (kind === "own-goal" ? "Quién la mete en propia" : "Goleador") : group === "card" ? "Jugador" : "Entra"}
          players={players}
          value={player}
          onChange={setPlayer}
          optional={group === "goal"}
          disabled={busy}
        />
        {(group === "substitution" || (group === "goal" && kind !== "own-goal")) && (
          <PlayerPicker
            key={`second-${team}-${group}`}
            label={group === "goal" ? "Asistencia" : "Sale"}
            players={players.filter((p) => p.id !== player?.id)}
            value={second}
            onChange={setSecond}
            optional
            disabled={busy}
          />
        )}
        {preview && <p className="report-preview">{preview}</p>}
        {saved && !error && (
          <p className="report-saved" role="status">
            {saved} Sigue con el siguiente.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {event && (
          <button
            type="button"
            className="text-button is-destructive"
            disabled={busy}
            onClick={() => void commit(events.filter((e) => e.id !== event.id), true)}
          >
            <Trash2 size={15} aria-hidden="true" /> Eliminar evento
          </button>
        )}
        {/* Enter in a field saves (the footer button sits outside the form on phones). */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** Number, name and position: a new player in one line. */
function QuickPlayer({
  onAdd,
  disabled,
  label = "Añadir",
}: {
  onAdd: (p: Omit<SquadPlayer, "id">) => void;
  disabled: boolean;
  label?: string;
}) {
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [position, setPosition] = useState<PlayerPosition | "">("");
  const numberRef = useRef<HTMLInputElement>(null);
  const add = () => {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    const n = Number(number);
    onAdd({
      name: clean,
      number: number.trim() && Number.isInteger(n) && n >= 0 && n <= 99 ? n : null,
      position: position || null,
    });
    setNumber("");
    setName("");
    numberRef.current?.focus();
  };
  return (
    <div className="squad-add">
      <input
        ref={numberRef}
        className="squad-number"
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        min={0}
        max={99}
        placeholder="Nº"
        aria-label="Dorsal"
        value={number}
        disabled={disabled}
        onChange={(e) => setNumber(e.target.value)}
      />
      <input
        className="squad-name"
        placeholder="Nombre"
        aria-label="Nombre del jugador"
        maxLength={40}
        autoComplete="off"
        enterKeyHint="next"
        value={name}
        disabled={disabled}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          add();
        }}
      />
      <select
        className="squad-position"
        aria-label="Posición"
        value={position}
        disabled={disabled}
        onChange={(e) => setPosition(e.target.value as PlayerPosition | "")}
      >
        <option value="">Pos.</option>
        {POSITIONS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <button type="button" className="button primary squad-add-button" disabled={disabled || !name.trim()} onClick={add}>
        <Plus size={16} aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </button>
    </div>
  );
}

/**
 * A team's squad: add players one line at a time (number, name, position) or
 * paste a whole list; tap the number or position of anyone to change it.
 */
export function SquadEditor({
  players,
  onChange,
  disabled,
}: {
  players: SquadPlayer[];
  onChange: (players: SquadPlayer[]) => void;
  disabled: boolean;
}) {
  const [pasting, setPasting] = useState(false);
  const [list, setList] = useState("");
  const parsed = useMemo(() => parseSquadList(list), [list]);
  const room = MAX_SQUAD - players.length;
  const update = (id: string, patch: Partial<SquadPlayer>) =>
    onChange(players.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return (
    <section className="squad-editor" aria-label="Plantilla">
      <div className="squad-heading">
        <h3>Plantilla</h3>
        <span className="cc-count">{players.length}</span>
      </div>
      {players.length > 0 ? (
        <ul className="squad-list">
          {sortSquad(players).map((p) => (
            <li key={p.id}>
              <input
                className="squad-number"
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                min={0}
                max={99}
                aria-label={`Dorsal de ${p.name}`}
                value={p.number ?? ""}
                placeholder="–"
                disabled={disabled}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  update(p.id, {
                    number: e.target.value.trim() && Number.isInteger(n) && n >= 0 && n <= 99 ? n : null,
                  });
                }}
              />
              <input
                className="squad-name"
                aria-label="Nombre"
                value={p.name}
                maxLength={40}
                disabled={disabled}
                onChange={(e) => update(p.id, { name: e.target.value.slice(0, 40) })}
              />
              <select
                className="squad-position"
                aria-label={`Posición de ${p.name}`}
                value={p.position ?? ""}
                disabled={disabled}
                onChange={(e) => update(p.id, { position: (e.target.value || null) as PlayerPosition | null })}
              >
                <option value="">Pos.</option>
                {POSITIONS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button squad-remove"
                aria-label={`Quitar a ${p.name}`}
                disabled={disabled}
                onClick={() => onChange(players.filter((x) => x.id !== p.id))}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted squad-empty">Sin jugadores todavía. Añádelos para elegirlos en alineaciones, goles y tarjetas.</p>
      )}
      {room > 0 && (
        <QuickPlayer
          disabled={disabled}
          label="Añadir jugador"
          onAdd={(p) => onChange([...players, { ...p, id: newReportId() }])}
        />
      )}
      {pasting ? (
        <div className="squad-paste">
          <label>
            Pega la lista, un jugador por línea
            <textarea
              rows={6}
              value={list}
              disabled={disabled}
              placeholder={"1 Juan García POR\n4 Luis Martín DEF\n10 Pedro Ruiz DEL"}
              onChange={(e) => setList(e.target.value)}
            />
          </label>
          <div className="squad-paste-actions">
            <button type="button" className="button secondary" onClick={() => setPasting(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="button primary"
              disabled={disabled || !parsed.length || room <= 0}
              onClick={() => {
                onChange([...players, ...parsed.slice(0, room).map((p) => ({ ...p, id: newReportId() }))]);
                haptic("success");
                setList("");
                setPasting(false);
              }}
            >
              Añadir {Math.min(parsed.length, room) || ""}{" "}
              {Math.min(parsed.length, room) === 1 ? "jugador" : "jugadores"}
            </button>
          </div>
        </div>
      ) : (
        room > 0 && (
          <button type="button" className="text-button squad-paste-open" disabled={disabled} onClick={() => setPasting(true)}>
            <ClipboardPaste size={15} aria-hidden="true" /> Pegar una lista de jugadores
          </button>
        )
      )}
    </section>
  );
}

/**
 * Organisers: who starts and who is on the bench, per team, from its squad.
 * New players can be added on the spot (they join the squad).
 */
export function LineupSheet({
  competition,
  match,
  matches,
  participants,
  uid,
  onClose,
}: {
  competition: Competition;
  match: ResolvedMatch;
  matches: ResolvedMatch[];
  participants: Participant[];
  uid: string;
  onClose: () => void;
}) {
  const [side, setSide] = useState<Side>("home");
  const [draft, setDraft] = useState<MatchLineups>(match.lineups || { home: [], away: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const teamId = side === "home" ? match.home.id : match.away.id;
  const team = participants.find((p) => p.id === teamId);
  const squad = sortSquad(team?.players || []);
  const chosen = draft[side];
  // Players picked before but no longer in the squad stay visible.
  const rows: SquadPlayer[] = [...squad, ...chosen.filter((c) => !squad.some((p) => p.id === c.id))];
  const starters = chosen.filter((p) => p.starter).length;
  const bench = chosen.length - starters;
  const set = (player: SquadPlayer, role: "starter" | "bench" | null) => {
    haptic();
    setDraft((d) => {
      const rest = d[side].filter((p) => p.id !== player.id);
      const entry: LineupPlayer | null = role ? { ...player, starter: role === "starter" } : null;
      return { ...d, [side]: entry ? [...rest, entry] : rest };
    });
  };
  // The team's lineup in its previous match with one, to start from.
  const previous = useMemo(() => {
    if (!teamId) return null;
    const before = matches
      .filter((m) => m.id !== match.id && m.startAt < match.startAt && m.lineups)
      .sort((a, b) => b.startAt - a.startAt);
    for (const m of before) {
      const s: Side | null = m.home.id === teamId ? "home" : m.away.id === teamId ? "away" : null;
      if (s && m.lineups![s].length) return m.lineups![s];
    }
    return null;
  }, [matches, match, teamId]);

  async function addPlayer(p: Omit<SquadPlayer, "id">) {
    if (!team) return;
    const player = { ...p, id: newReportId() };
    setError("");
    try {
      await settled(saveParticipant(competition.id, { ...team, players: [...(team.players || []), player] }));
      set(player, starters < 11 ? "starter" : "bench");
    } catch (e) {
      setError(readableError(e));
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const empty = !draft.home.length && !draft.away.length;
      await settled(saveMatchReport(competition.id, match.id, { lineups: empty ? null : draft }, uid));
      haptic("success");
      onClose();
    } catch (e) {
      haptic("warning");
      setError(readableError(e));
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Alineaciones"
      busy={busy}
      onClose={onClose}
      className="report-sheet"
      detents={["large"]}
      footer={
        <div className="report-actions">
          <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Guardando…" : "Guardar alineaciones"}
          </button>
        </div>
      }
    >
      <div className="report-form">
        <Segmented<Side>
          label="Equipo"
          value={side}
          options={[
            { value: "home", label: sideName(match, "home") },
            { value: "away", label: sideName(match, "away") },
          ]}
          onChange={setSide}
        />
        <p className="lineup-count" role="status">
          <strong>{starters}</strong> {starters === 1 ? "titular" : "titulares"} · <strong>{bench}</strong>{" "}
          {bench === 1 ? "suplente" : "suplentes"}
          {previous && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                haptic();
                const known = new Map(squad.map((p) => [p.id, p]));
                setDraft((d) => ({
                  ...d,
                  [side]: previous.filter((p) => known.has(p.id)).map((p) => ({ ...known.get(p.id)!, starter: p.starter })),
                }));
              }}
            >
              <ArrowLeftRight size={14} aria-hidden="true" /> Repetir la del último partido
            </button>
          )}
        </p>
        {rows.length > 0 ? (
          <ul className="lineup-pick">
            {rows.map((p) => {
              const entry = chosen.find((c) => c.id === p.id);
              return (
                <li key={p.id} className={entry ? (entry.starter ? "is-starter" : "is-bench") : undefined}>
                  <b className="lineup-dorsal">{p.number ?? "–"}</b>
                  <span className="lineup-name">
                    {p.name}
                    {p.position && <small>{POSITION_NAMES[p.position]}</small>}
                  </span>
                  <span className="lineup-roles">
                    <button
                      type="button"
                      aria-pressed={entry?.starter === true}
                      disabled={busy}
                      onClick={() => set(p, entry?.starter ? null : "starter")}
                    >
                      Titular
                    </button>
                    <button
                      type="button"
                      aria-pressed={entry?.starter === false}
                      disabled={busy}
                      onClick={() => set(p, entry && !entry.starter ? null : "bench")}
                    >
                      Suplente
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">
            {team ? `${team.name} aún no tiene plantilla. Añade sus jugadores aquí o en Gestión.` : "Este equipo aún no está decidido."}
          </p>
        )}
        {team && (team.players?.length || 0) < MAX_SQUAD && (
          <div className="lineup-add">
            <p className="report-label">
              <UserPlus size={15} aria-hidden="true" /> Añadir a la plantilla de {team.name}
            </p>
            <QuickPlayer disabled={busy} onAdd={(p) => void addPlayer(p)} />
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
