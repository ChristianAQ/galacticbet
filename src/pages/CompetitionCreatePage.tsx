import { ArrowRight, Plus, Shuffle, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import Segmented from "../components/Segmented";
import { IconPicker } from "../components/CustomManage";
import { PageTitle, PrivateGate, readableError } from "../components/ui";
import {
  addDays,
  fixturePlan,
  FORMATS,
  formatAvailability,
  groupPlans,
  leagueQualifierOptions,
  recommendedFormat,
  validateSetup,
  type CompetitionSetup,
  type Format,
  type ParticipantKind,
  type PredictionMode,
} from "../lib/customCompetition";
import {
  createCompetition,
  loadCompetitionParticipants,
  useMyCompetitions,
  type NewParticipant,
} from "../lib/customCompetitionData";
import { loadParticipants, type Group } from "../lib/data";
import { haptic } from "../lib/motion";
import { go } from "../lib/navigation";
import type { AppUser } from "../lib/session";
import "../styles/customCompetition.css";
import "../styles/profile.css";

const SPORTS = ["Fútbol", "Fútbol 7", "Fútbol sala", "Pádel", "Tenis", "Baloncesto", "Ping-pong", "Dardos", "Futbolín", "FIFA"];
const STAGE_FOR: Record<number, string> = { 2: "final", 4: "semifinales", 8: "cuartos", 16: "octavos" };
const shortDate = new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short" });

/** Next Saturday (a week later if today is Saturday), as a local date. */
function nextSaturday() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return addDays(today, ((6 - now.getDay() + 7) % 7) || 7);
}
let nextKey = 0;
type Entry = NewParticipant & { key: number };

/**
 * New competition: every field of the tournament is decided here, the
 * calendar is generated from it, and the organiser can edit it later.
 */
export default function CompetitionCreatePage({
  user,
  groups,
  onLogin,
}: {
  user: AppUser | null;
  groups: Group[];
  onLogin: () => void;
}) {
  const [name, setName] = useState("");
  const [sport, setSport] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [kind, setKind] = useState<ParticipantKind>("team");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [format, setFormat] = useState<Format>("league");
  const [legs, setLegs] = useState<1 | 2>(1);
  const [knockoutLegs, setKnockoutLegs] = useState<1 | 2>(1);
  const [qualifiers, setQualifiers] = useState(4);
  const [groupsPlan, setGroupsPlan] = useState("4:2");
  const [thirdPlace, setThirdPlace] = useState(false);
  const [start, setStart] = useState(nextSaturday);
  const [time, setTime] = useState("10:00");
  const [everyDays, setEveryDays] = useState(7);
  const [slotMinutes, setSlotMinutes] = useState(0);
  const [location, setLocation] = useState("");
  const [prediction, setPrediction] = useState<PredictionMode>("exact");
  const [touchedFormat, setTouchedFormat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const { competitions } = useMyCompetitions(user?.uid || "");
  const count = entries.length;
  const availability = formatAvailability(count);
  const recommended = recommendedFormat(count);

  // Friends from your groups, to add as people in one tap.
  useEffect(() => {
    let active = true;
    Promise.all(groups.map((g) => loadParticipants(g).catch(() => [])))
      .then((lists) => {
        if (!active) return;
        const seen = new Map<string, string>();
        for (const p of lists.flat()) if (!seen.has(p.id)) seen.set(p.id, p.name);
        setPeople([...seen].map(([id, n]) => ({ id, name: n })));
      });
    return () => {
      active = false;
    };
  }, [groups.map((g) => g.id).join()]);

  // Until you choose, follow the recommendation; an impossible format moves to it.
  useEffect(() => {
    if (!touchedFormat || availability[format]) {
      setFormat(recommended.format);
      if (recommended.format === "league_knockout") setQualifiers(recommended.qualifiers);
      if (recommended.format === "groups_knockout") setGroupsPlan(`${recommended.groups}:${recommended.qualifiers}`);
    }
  }, [count]);
  const qualifierChoices = leagueQualifierOptions(count);
  const plans = groupPlans(count);
  const [groupCount, perGroup] = groupsPlan.split(":").map(Number);
  const plan = plans.find((p) => p.groups === groupCount && p.qualifiers === perGroup) || plans[0];
  const bracket =
    format === "knockout"
      ? count
      : format === "league_knockout"
        ? (qualifierChoices.includes(qualifiers) ? qualifiers : qualifierChoices.at(-1) || 2)
        : format === "groups_knockout" && plan
          ? plan.groups * plan.qualifiers
          : 0;

  const setup: CompetitionSetup = {
    name,
    sport,
    icon,
    participantType: kind,
    format,
    legs,
    knockoutLegs,
    qualifiers:
      format === "league_knockout"
        ? (qualifierChoices.includes(qualifiers) ? qualifiers : qualifierChoices.at(-1) || 0)
        : format === "groups_knockout"
          ? plan?.qualifiers || 0
          : 0,
    groups: format === "groups_knockout" ? plan?.groups || 0 : 0,
    thirdPlace: bracket >= 4 && thirdPlace,
    predictionMode: prediction,
    schedule: {
      start,
      time,
      everyDays,
      slotMinutes,
      location,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid",
    },
  };
  const problem = validateSetup(setup, entries.map((e) => e.name));
  const summary = useMemo(
    () => (count >= 2 && format !== "custom" && !availability[format] ? fixturePlan(setup, count) : null),
    [JSON.stringify(setup), count],
  );

  function add(entry: Omit<Entry, "key">) {
    const clean = entry.name.trim().slice(0, 40);
    if (!clean) return;
    if (entries.some((e) => e.name.trim().toLocaleLowerCase("es") === clean.toLocaleLowerCase("es") || (entry.userId && e.userId === entry.userId)))
      return setError(`«${clean}» ya está en la lista.`);
    setError("");
    setEntries((list) => [...list, { ...entry, name: clean, key: nextKey++ }]);
  }
  async function importFrom(cid: string) {
    if (!cid) return;
    try {
      const list = await loadCompetitionParticipants(cid);
      setEntries((current) => {
        const names = new Set(current.map((e) => e.name.trim().toLocaleLowerCase("es")));
        return [
          ...current,
          ...list
            .filter((p) => !names.has(p.name.toLocaleLowerCase("es")))
            .map((p) => ({ name: p.name, kind: p.kind, userId: p.userId, icon: p.icon, key: nextKey++ })),
        ].slice(0, 32);
      });
    } catch (e) {
      setError(readableError(e));
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user || busy) return;
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      const id = await createCompetition(user.uid, setup, entries.map(({ key: _key, ...rest }) => rest));
      haptic("success");
      go(`/ligas?liga=${encodeURIComponent(id)}`, { reset: true });
    } catch (err) {
      haptic("warning");
      setError(readableError(err));
      setBusy(false);
    }
  }

  if (!user)
    return (
      <>
        <PageTitle eyebrow="Competiciones entre amigos" title="Nueva competición" />
        <PrivateGate onLogin={onLogin} />
      </>
    );
  return (
    <>
      <PageTitle
        eyebrow="Competiciones entre amigos"
        title="Nueva competición"
        description="Liga, eliminatoria o las dos: tú decides el formato y la app crea el calendario."
      />
      <form className="competition-create" onSubmit={submit}>
        <section aria-labelledby="cc-basics">
          <div className="section-heading">
            <h2 id="cc-basics">La competición</h2>
          </div>
          <label>
            Nombre
            <input value={name} minLength={3} maxLength={60} required disabled={busy} placeholder="Liga de los sábados" onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Deporte o actividad
            <input value={sport} maxLength={40} list="cc-sports" disabled={busy} placeholder="Fútbol 7, pádel, dardos…" onChange={(e) => setSport(e.target.value)} />
            <datalist id="cc-sports">
              {SPORTS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <div className="form-field">
            <span className="form-field-label">Icono</span>
            <IconPicker value={icon} onChange={setIcon} disabled={busy} />
          </div>
          <div className="form-field">
            <span className="form-field-label">Compiten</span>
            <Segmented<ParticipantKind>
              label="Tipo de participantes"
              value={kind}
              options={[
                { value: "team", label: "Equipos" },
                { value: "person", label: "Personas" },
              ]}
              onChange={(value) => {
                setKind(value);
                setEntries((list) => list.map((e) => (e.userId ? e : { ...e, kind: value })));
              }}
            />
          </div>
        </section>

        <section aria-labelledby="cc-people">
          <div className="section-heading">
            <h2 id="cc-people">Participantes</h2>
            <span className="cc-count">{count} / 32</span>
          </div>
          {entries.length > 0 && (
            <ol className="cc-entries">
              {entries.map((entry, i) => (
                <li key={entry.key}>
                  <span className="cc-seed">{i + 1}</span>
                  <input
                    value={entry.name}
                    maxLength={40}
                    disabled={busy}
                    aria-label={`Participante ${i + 1}`}
                    onChange={(e) =>
                      setEntries((list) => list.map((x) => (x.key === entry.key ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Quitar a ${entry.name}`}
                    disabled={busy}
                    onClick={() => setEntries((list) => list.filter((x) => x.key !== entry.key))}
                  >
                    <X size={18} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="cc-add">
            <input
              value={draft}
              maxLength={40}
              disabled={busy || count >= 32}
              placeholder={kind === "team" ? "Nombre del equipo" : "Nombre de la persona"}
              aria-label="Nuevo participante"
              enterKeyHint="done"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                add({ name: draft, kind, userId: null, icon: null });
                setDraft("");
              }}
            />
            <button
              type="button"
              className="button secondary"
              disabled={busy || !draft.trim() || count >= 32}
              onClick={() => {
                add({ name: draft, kind, userId: null, icon: null });
                setDraft("");
              }}
            >
              <Plus size={17} aria-hidden="true" /> Añadir
            </button>
          </div>
          {kind === "person" && people.some((p) => !entries.some((e) => e.userId === p.id)) && (
            <div className="cc-picks">
              <p className="muted">De tus grupos</p>
              <div className="cc-chips">
                {people
                  .filter((p) => !entries.some((e) => e.userId === p.id))
                  .map((p) => (
                    <button key={p.id} type="button" className="cc-chip" disabled={busy || count >= 32} onClick={() => add({ name: p.name, kind: "person", userId: p.id, icon: null })}>
                      <Plus size={14} aria-hidden="true" /> {p.name}
                    </button>
                  ))}
              </div>
            </div>
          )}
          <div className="cc-tools">
            {competitions.length > 0 && (
              <label className="cc-import">
                <span className="sr-only">Importar participantes</span>
                <select value="" disabled={busy} onChange={(e) => void importFrom(e.target.value)}>
                  <option value="">Importar de otra competición…</option>
                  {competitions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {count > 2 && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  haptic();
                  setEntries((list) => [...list].sort(() => Math.random() - 0.5));
                }}
              >
                <Shuffle size={15} aria-hidden="true" /> Sortear orden
              </button>
            )}
          </div>
          <p className="footnote">El orden cuenta como cabeza de serie en los cruces: el 1 y el 2 solo se ven en la final.</p>
        </section>

        <section aria-labelledby="cc-format">
          <div className="section-heading">
            <h2 id="cc-format">Formato</h2>
          </div>
          <div className="cc-formats" role="radiogroup" aria-labelledby="cc-format">
            {(Object.keys(FORMATS) as Format[]).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={format === f}
                className="cc-format"
                disabled={busy || Boolean(availability[f])}
                onClick={() => {
                  setFormat(f);
                  setTouchedFormat(true);
                }}
              >
                <span className="cc-format-name">
                  {FORMATS[f].label}
                  {count >= 2 && recommended.format === f && (
                    <small className="cc-recommended">
                      <Sparkles size={12} aria-hidden="true" /> Recomendado
                    </small>
                  )}
                </span>
                <small>{availability[f] && count >= 2 ? availability[f] : FORMATS[f].description}</small>
              </button>
            ))}
          </div>
          {["league", "league_knockout", "groups_knockout"].includes(format) && (
            <div className="form-field">
              <span className="form-field-label">{format === "groups_knockout" ? "Fase de grupos" : "Liga"}</span>
              <Segmented<"1" | "2">
                label="Vueltas"
                value={String(legs) as "1" | "2"}
                options={[
                  { value: "1", label: "Solo ida" },
                  { value: "2", label: "Ida y vuelta" },
                ]}
                onChange={(v) => setLegs(Number(v) as 1 | 2)}
              />
            </div>
          )}
          {format === "league_knockout" && qualifierChoices.length > 0 && (
            <label>
              Pasan a la fase final
              <select value={setup.qualifiers} disabled={busy} onChange={(e) => setQualifiers(Number(e.target.value))}>
                {qualifierChoices.map((q) => (
                  <option key={q} value={q}>
                    Los {q} primeros · desde {STAGE_FOR[q]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {format === "groups_knockout" && plans.length > 0 && (
            <label>
              Grupos
              <select value={plan ? `${plan.groups}:${plan.qualifiers}` : ""} disabled={busy} onChange={(e) => setGroupsPlan(e.target.value)}>
                {plans.map((p) => (
                  <option key={`${p.groups}:${p.qualifiers}`} value={`${p.groups}:${p.qualifiers}`}>
                    {p.groups} grupos · pasa{p.qualifiers > 1 ? "n" : ""} {p.qualifiers} por grupo · desde {STAGE_FOR[p.groups * p.qualifiers]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {bracket >= 4 && (
            <>
              <div className="form-field">
                <span className="form-field-label">Eliminatorias</span>
                <Segmented<"1" | "2">
                  label="Partidos por eliminatoria"
                  value={String(knockoutLegs) as "1" | "2"}
                  options={[
                    { value: "1", label: "Partido único" },
                    { value: "2", label: "Ida y vuelta" },
                  ]}
                  onChange={(v) => setKnockoutLegs(Number(v) as 1 | 2)}
                />
              </div>
              <div className="more-row cc-switch-row">
                <span className="more-label" id="cc-third">
                  Partido por el tercer puesto
                  <small>Lo juegan los que pierden las semifinales</small>
                </span>
                <button type="button" role="switch" className="switch" aria-checked={thirdPlace} aria-labelledby="cc-third" onClick={() => setThirdPlace(!thirdPlace)}>
                  <span aria-hidden="true" />
                </button>
              </div>
              <p className="footnote">La final siempre es a partido único. Si hay empate en la eliminatoria, se decide por penaltis.</p>
            </>
          )}
        </section>

        <section aria-labelledby="cc-calendar">
          <div className="section-heading">
            <h2 id="cc-calendar">Calendario</h2>
          </div>
          <div className="custom-two">
            <label>
              {format === "custom" ? "Primer día" : "Primera jornada"}
              <input type="date" value={start} required disabled={busy} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label>
              Hora
              <input type="time" value={time} required disabled={busy} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <div className="custom-two">
            <label>
              Se juega
              <select value={everyDays} disabled={busy} onChange={(e) => setEveryDays(Number(e.target.value))}>
                <option value={7}>Cada semana</option>
                <option value={14}>Cada 2 semanas</option>
                <option value={1}>Cada día</option>
                <option value={3}>Cada 3 días</option>
                <option value={28}>Cada 4 semanas</option>
              </select>
            </label>
            <label>
              Entre partidos
              <select value={slotMinutes} disabled={busy} onChange={(e) => setSlotMinutes(Number(e.target.value))}>
                <option value={0}>A la vez</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>1 hora</option>
                <option value={90}>1 h 30</option>
                <option value={120}>2 horas</option>
              </select>
            </label>
          </div>
          <label>
            Lugar
            <input value={location} maxLength={120} disabled={busy} placeholder="Campo, pista o dirección" onChange={(e) => setLocation(e.target.value)} />
          </label>
          {format === "custom" ? (
            <p className="footnote">Tú añades los partidos desde Gestión. Este día, hora y lugar serán los de por defecto.</p>
          ) : (
            summary && (
              <p className="cc-summary" role="status">
                <strong>
                  {summary.matches} {summary.matches === 1 ? "partido" : "partidos"}
                </strong> en {summary.days} {summary.days === 1 ? "jornada" : "jornadas"} · del{" "}
                {shortDate.format(new Date(`${start}T12:00:00`))} al {shortDate.format(new Date(`${summary.lastDate}T12:00:00`))}
              </p>
            )
          )}
        </section>

        <section aria-labelledby="cc-predictions">
          <div className="section-heading">
            <h2 id="cc-predictions">Pronósticos</h2>
          </div>
          <Segmented<PredictionMode>
            label="Pronósticos"
            value={prediction}
            options={[
              { value: "exact", label: "Marcador" },
              { value: "classic", label: "1X2" },
              { value: "off", label: "Sin ellos" },
            ]}
            onChange={setPrediction}
          />
          <p className="footnote">
            {prediction === "exact"
              ? "Aparece en Quiniela y Clasificación junto a LaLiga, Champions y Premier: los seguidores aciertan el marcador antes de cada partido (3 puntos el exacto, 1 quién gana o el empate)."
              : prediction === "classic"
                ? "Aparece en Quiniela y Clasificación junto a LaLiga, Champions y Premier: los seguidores eligen 1, X o 2 antes de cada partido (1 punto por acierto)."
                : "Solo resultados y tabla en Ligas, sin quiniela."}{" "}
            Puedes cambiarlo en Ajustes.
          </p>
        </section>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy || Boolean(problem)}>
          {busy ? "Creando…" : "Crear competición"}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
        {problem && count > 0 && name.trim().length >= 3 && <p className="footnote">{problem}</p>}
      </form>
    </>
  );
}
