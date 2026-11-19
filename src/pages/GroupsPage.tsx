import { competitionName } from "../lib/competitions";
import { COMPETITION_CODES } from "../lib/competitions";
import type { AppUser as User } from "../lib/session";
import {
  ArrowRight,
  Coins,
  Copy,
  LockKeyhole,
  Share2,
  Trophy,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import CompetitionLogo from "../components/CompetitionLogo";
import GroupList, { copyInvite, shareInvite } from "../components/GroupList";
import GroupActions from "../components/GroupActions";
import Modal from "../components/Modal";
import Segmented from "../components/Segmented";
import { Empty, PageTitle, PrivateGate, readableError } from "../components/ui";
import {
  createGroup,
  joinGroup,
  leaveGroup,
  loadGameSeasons,
  renameGroup,
  setGroupPot,
  gameSeasonId,
  type Group,
  type Participant,
} from "../lib/data";
import { preferenceStore } from "../lib/preferences";
import type { Mode } from "../lib/domain";
import { PotField, PotIntro } from "../components/PotSettings";
import { groupPotCents, parsePotInput, potInputValue } from "../lib/pot";
import { euro } from "../lib/porra";
import { haptic } from "../lib/motion";
import "../styles/profile.css";

/** Short-lived confirmation above the tab bar: «copiado», «guardado»… */
function useNotice() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3600);
    return () => window.clearTimeout(timer);
  }, [message]);
  return [message, setMessage] as const;
}

export default function GroupsPage({
  user,
  groups,
  refresh,
  onLogin,
}: {
  user: User | null;
  groups: Group[];
  refresh: () => Promise<void>;
  onLogin: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const [collapsed, setCollapsed] = useState(!params.get("group"));
  const [message, setMessage] = useNotice();
  const modal =
    params.has("join") || params.get("action") === "join"
      ? "join"
      : params.get("action") === "create"
        ? "create"
        : null;
  const requested = params.get("group");
  const selected = collapsed
    ? ""
    : groups.find((g) => g.id === requested)?.id || "";
  useEffect(() => {
    if (user && selected)
      preferenceStore.update(user.uid, { groupId: selected });
  }, [user?.uid, selected]);
  function open(action: string) {
    const next = new URLSearchParams(params);
    next.set("action", action);
    next.delete("join");
    next.delete("code");
    setParams(next);
  }
  function close() {
    const next = new URLSearchParams(params);
    next.delete("action");
    next.delete("join");
    next.delete("code");
    setParams(next, { replace: true });
  }
  return (
    <>
      <PageTitle
        eyebrow="Tu gente, tu liga"
        title="Mis grupos"
        description="Tus amigos, vuestras quinielas. Toda la rivalidad en un mismo sitio."
      />
      {!user ? (
        <PrivateGate onLogin={onLogin} />
      ) : (
        <div className="groups-page">
          {groups.length ? (
            <>
              <p className="groups-hint">
                Desliza un grupo para invitar o ver la tabla; mantén pulsado
                para más opciones.
              </p>
              <GroupList
                groups={groups}
                uid={user.uid}
                selected={selected}
                onNotify={setMessage}
                onSelect={(id) => {
                  setCollapsed(!id);
                  if (id) preferenceStore.update(user.uid, { groupId: id });
                  const next = new URLSearchParams(params);
                  if (id) next.set("group", id);
                  else next.delete("group");
                  setParams(next, { replace: true });
                }}
                details={(group, people) => (
                  <GroupDetails
                    group={group}
                    people={people}
                    user={user}
                    refresh={refresh}
                    notify={setMessage}
                  />
                )}
              />
            </>
          ) : (
            <Empty art="bench" title="Aquí empieza vuestro vestuario">
              Todavía no perteneces a ningún grupo. Crea uno o únete con una
              invitación.
            </Empty>
          )}
          <GroupActions
            onCreate={() => open("create")}
            onJoin={() => open("join")}
          />
          {modal && (
            <GroupForm
              key={modal}
              kind={modal}
              initialCode={params.get("code") || ""}
              user={user}
              onClose={close}
              onComplete={async (id) => {
                await refresh();
                preferenceStore.update(user.uid, { groupId: id });
                setCollapsed(false);
                setParams({ group: id }, { replace: true });
                setMessage(
                  modal === "create"
                    ? "¡Grupo creado! Ya podéis jugar a LaLiga, Champions y Premier League."
                    : "¡Ya estás dentro del grupo!",
                );
              }}
            />
          )}
        </div>
      )}
      {message && (
        <p className="group-toast" role="status" key={message}>
          {message}
        </p>
      )}
    </>
  );
}

function GroupForm({
  kind,
  initialCode,
  user,
  onClose,
  onComplete,
}: {
  kind: "create" | "join";
  initialCode: string;
  user: User;
  onClose: () => void;
  onComplete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode);
  const [mode, setMode] = useState<Mode>("classic");
  const [pot, setPot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const potCents = parsePotInput(pot);
    if (kind === "create" && potCents === null) return;
    setBusy(true);
    setError("");
    try {
      const id =
        kind === "create"
          ? await createGroup(user.uid, name, mode, potCents || 0)
          : await joinGroup(user.uid, code);
      haptic("success");
      await onComplete(id);
    } catch (e) {
      haptic("warning");
      setError(readableError(e));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={kind === "create" ? "Crea vuestro grupo" : "Únete a tus amigos"}
      busy={busy}
      onClose={onClose}
      className="group-form-sheet"
    >
      <form onSubmit={submit}>
        {kind === "create" ? (
          <>
            <p className="muted">
              Un grupo privado para jugar juntos a las tres competiciones.
            </p>
            <ul className="included-competitions" aria-label="Competiciones incluidas">
              {COMPETITION_CODES.map((code) => (
                <li key={code}>
                  <CompetitionLogo code={code} small />
                  {competitionName(code, true)}
                </li>
              ))}
            </ul>
            <label>
              Nombre del grupo
              <input
                required
                minLength={3}
                maxLength={60}
                autoComplete="off"
                autoCapitalize="sentences"
                enterKeyHint="next"
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                placeholder="Los del tercer tiempo"
              />
            </label>
            <div className="form-field">
              <span className="form-field-label" id="group-mode-label">
                Modalidad de juego
              </span>
              <Segmented<Mode>
                label="Modalidad de juego"
                value={mode}
                options={[
                  { value: "classic", label: "Clásica · 1X2" },
                  { value: "exact", label: "Marcador exacto" },
                ]}
                onChange={(value) => {
                  if (!busy) setMode(value);
                }}
              />
            </div>
            <p className="footnote">
              <LockKeyhole size={13} aria-hidden="true" />
              La modalidad se aplica a las tres competiciones y queda fija
              durante la temporada.
            </p>
            <fieldset className="pot-settings">
              <legend className="sr-only">Bote por jornada (opcional)</legend>
              <strong>
                <Coins size={14} aria-hidden="true" /> Bote por jornada{" "}
                <small className="muted">· opcional</small>
              </strong>
              <PotIntro />
              <PotField value={pot} onChange={setPot} disabled={busy} />
            </fieldset>
          </>
        ) : (
          <>
            <p className="muted">
              Pide el código de invitación al administrador de tu grupo, o abre
              directamente el enlace que te haya pasado.
            </p>
            <label>
              Código de invitación
              <input
                required
                maxLength={128}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
                className="code-input"
                value={code}
                disabled={busy}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Pega aquí el código"
              />
            </label>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary full"
          disabled={busy || (kind === "create" && parsePotInput(pot) === null)}
        >
          {busy
            ? "Guardando…"
            : kind === "create"
              ? "Crear grupo"
              : "Unirme al grupo"}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </form>
    </Modal>
  );
}

function GroupDetails({
  group,
  people,
  user,
  refresh,
  notify,
}: {
  group: Group;
  people: Participant[];
  user: User;
  refresh: () => Promise<void>;
  notify: (value: string) => void;
}) {
  const [seasons, setSeasons] = useState<
    Awaited<ReturnType<typeof loadGameSeasons>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [name, setName] = useState(group.name);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Effects re-run when a hidden page is revealed (<Activity>): keep what is
  // already loaded and the name being edited unless the inputs changed.
  const savedName = useRef(group.name);
  useEffect(() => {
    if (savedName.current === group.name) return;
    savedName.current = group.name;
    setName(group.name);
  }, [group.name]);
  const loadedSeasons = useRef("");
  useEffect(() => {
    const token = `${group.id}|${retry}`;
    if (loadedSeasons.current === token) return;
    let active = true;
    setLoading(true);
    setError("");
    loadGameSeasons(group.id)
      .then((s) => {
        if (!active) return;
        setSeasons(s);
        loadedSeasons.current = token;
      })
      .catch((e) => {
        if (active) setError(readableError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [group.id, retry]);
  async function rename(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await renameGroup(group.id, name);
      await refresh();
      haptic("success");
      notify("Nombre del grupo actualizado.");
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    setBusy(true);
    setError("");
    try {
      await leaveGroup(user.uid, group);
      await refresh();
      notify("Has salido del grupo. La puerta queda abierta con el código.");
    } catch (e) {
      setError(readableError(e));
      setBusy(false);
    }
  }
  return (
    <div className="group-detail-content">
      <div className="group-detail-links">
        <Link
          className="button primary"
          to={`/quiniela?group=${encodeURIComponent(group.id)}`}
        >
          Hacer quiniela
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link
          className="button secondary"
          to={`/clasificacion?group=${encodeURIComponent(group.id)}`}
        >
          <Trophy size={16} aria-hidden="true" />
          Clasificación
        </Link>
      </div>

      <section className="group-section" aria-labelledby={`people-${group.id}`}>
        <h3 id={`people-${group.id}`}>
          Plantilla <small>{people.length || group.memberIds.length}</small>
        </h3>
        <ul className="members-list">
          {people.map((p) => (
            <li key={p.id}>
              <span className="rival-avatar">
                {p.avatar ? (
                  <img src={p.avatar} alt="" referrerPolicy="no-referrer" />
                ) : (
                  p.name.charAt(0).toUpperCase()
                )}
              </span>
              <span className="member-name">
                {p.name}
                {p.id === user.uid ? " (tú)" : ""}
              </span>
              {p.id === group.ownerId && (
                <small className="member-role">Administrador</small>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="group-section" aria-labelledby={`rules-${group.id}`}>
        <h3 id={`rules-${group.id}`}>Competiciones de esta temporada</h3>
        {loading ? (
          <p className="muted" role="status">
            Leyendo el reglamento…
          </p>
        ) : (
          <ul className="group-competition-rules">
            {[...COMPETITION_CODES].map((code) => {
              const season = seasons.find((s) => s.id === gameSeasonId(code));
              return (
                <li key={code}>
                  <CompetitionLogo code={code} small />
                  <span>
                    <strong>{competitionName(code)}</strong>
                    <small>
                      {season
                        ? season.mode === "classic"
                          ? "Clásica · 1X2"
                          : "Marcador exacto"
                        : "Pendiente de preparar por el administrador"}
                    </small>
                  </span>
                  <LockKeyhole size={14} aria-label="Modalidad fija" />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <GroupPot
        group={group}
        owner={group.ownerId === user.uid}
        refresh={refresh}
        notify={notify}
      />

      <section className="group-section" aria-labelledby={`invite-${group.id}`}>
        <h3 id={`invite-${group.id}`}>Invita a tus amigos</h3>
        <div className="invite-code">
          <code aria-label="Código de invitación">{group.id}</code>
          <button
            type="button"
            className="icon-button"
            aria-label="Copiar enlace de invitación"
            onClick={() => void copyInvite(group.id).then(notify)}
          >
            <Copy size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Compartir invitación"
            onClick={() =>
              void shareInvite(group).then((value) => value && notify(value))
            }
          >
            <Share2 size={18} />
          </button>
        </div>
        <p className="footnote">
          Quien abra el enlace entra directo al formulario con el código puesto.
        </p>
      </section>

      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Reintentar
          </button>
        </div>
      )}
      {group.ownerId === user.uid ? (
        <form className="group-rename-form" onSubmit={rename}>
          <label>
            Nombre del grupo
            <input
              required
              minLength={3}
              maxLength={60}
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="done"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="button secondary"
            disabled={busy || name.trim() === group.name}
          >
            {busy ? "Guardando…" : "Guardar nombre"}
          </button>
          <p className="footnote">
            Las modalidades no cambian durante la temporada.
          </p>
        </form>
      ) : leaving ? (
        <div className="group-leave-confirm" role="alertdialog" aria-label="Abandonar grupo">
          <p>
            ¿Quieres abandonar {group.name}? Necesitarás el código para volver a
            entrar.
          </p>
          <div className="confirm-buttons">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setLeaving(false)}
            >
              Quedarme
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void leave()}
            >
              {busy ? "Saliendo…" : "Sí, abandonar"}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="text-button group-leave"
          onClick={() => {
            haptic("warning");
            setLeaving(true);
          }}
        >
          Abandonar grupo
        </button>
      )}
    </div>
  );
}

function GroupPot({
  group,
  owner,
  refresh,
  notify,
}: {
  group: Group;
  owner: boolean;
  refresh: () => Promise<void>;
  notify: (value: string) => void;
}) {
  const current = groupPotCents(group);
  const [value, setValue] = useState(potInputValue(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const section = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  const savedPot = useRef(current);
  useEffect(() => {
    if (savedPot.current === current) return;
    savedPot.current = current;
    setValue(potInputValue(current));
  }, [current]);
  // Scroll to the pot once per visit to #bote, not every time the page reappears.
  const scrolledTo = useRef("");
  useEffect(() => {
    if (hash !== "#bote") {
      scrolledTo.current = "";
      return;
    }
    if (scrolledTo.current === hash) return;
    scrolledTo.current = hash;
    const frame = requestAnimationFrame(() =>
      section.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [hash]);
  const cents = parsePotInput(value);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (cents === null || busy) return;
    setBusy(true);
    setError("");
    try {
      await setGroupPot(group.id, cents);
      await refresh();
      haptic("success");
      notify(
        cents
          ? `Bote activado: ${euro(cents)} por jugador y jornada.`
          : "Bote desactivado para este grupo.",
      );
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      ref={section}
      id="bote"
      className="group-section"
      aria-labelledby={`pot-${group.id}`}
    >
      <h3 id={`pot-${group.id}`}>Bote por jornada</h3>
      {owner ? (
        <form className="pot-settings" onSubmit={save}>
          <PotIntro />
          <PotField
            value={value}
            onChange={setValue}
            disabled={busy}
            members={group.memberIds.length}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="pot-settings-actions">
            <button
              className="button secondary"
              disabled={busy || cents === null || cents === current}
            >
              {busy ? "Guardando…" : "Guardar bote"}
            </button>
            <span className="muted footnote">
              Se aplica a todas las jornadas que se muestren a partir de ahora.
            </span>
          </div>
        </form>
      ) : (
        <div className="pot-settings">
          <p>
            {current ? (
              <>
                Cada jugador que entrega la jornada pone{" "}
                <strong className="group-pot-badge">{euro(current)}</strong>.
                Quien más puntúe se lleva el bote; los empates se reparten.
              </>
            ) : (
              "Este grupo no tiene bote. Solo el administrador puede activarlo."
            )}
          </p>
          <PotIntro />
        </div>
      )}
    </section>
  );
}
