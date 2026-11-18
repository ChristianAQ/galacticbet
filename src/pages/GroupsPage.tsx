import { competitionName } from "../lib/competitions";
import { COMPETITION_CODES } from "../lib/competitions";
import type { User } from "firebase/auth";
import { ArrowRight, Coins, Copy, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import CompetitionLogo from "../components/CompetitionLogo";
import GroupList from "../components/GroupList";
import GroupActions from "../components/GroupActions";
import Modal from "../components/Modal";
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
  const [message, setMessage] = useState("");
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
        eyebrow="TU GENTE, TU LIGA"
        title="Mis grupos"
        description="Tus amigos, vuestras quinielas. Toda la rivalidad en un mismo sitio."
      />
      {!user ? (
        <PrivateGate onLogin={onLogin} />
      ) : (
        <>
          {message && (
            <p className="form-message" role="status">
              {message}
            </p>
          )}
          {groups.length ? (
            <GroupList
              groups={groups}
              uid={user.uid}
              selected={selected}
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
          ) : (
            <div className="panel">
              <Empty title="Aquí empieza vuestro grupo">
                Todavía no perteneces a ningún grupo. Crea uno o únete con una
                invitación.
              </Empty>
            </div>
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
        </>
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
      haptic();
      await onComplete(id);
    } catch (e) {
      setError(readableError(e));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={kind === "create" ? "Crea vuestro grupo" : "Únete a tus amigos"}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {kind === "create" ? (
          <>
            <p className="muted">
              Un grupo privado para jugar juntos a las tres competiciones.
            </p>
            <div className="included-competitions">
              {COMPETITION_CODES.map((code) => (
                <span key={code}>
                  <CompetitionLogo code={code} small />
                  {competitionName(code, true)}
                </span>
              ))}
            </div>
            <label>
              Nombre del grupo
              <input
                required
                minLength={3}
                maxLength={60}
                autoComplete="off"
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                placeholder="Los del tercer tiempo"
              />
            </label>
            <label>
              Modalidad de juego
              <select
                value={mode}
                disabled={busy}
                onChange={(e) => setMode(e.target.value as Mode)}
              >
                <option value="classic">Clásica · 1X2</option>
                <option value="exact">Marcador exacto</option>
              </select>
            </label>
            <p className="footnote muted">
              <LockKeyhole size={13} />
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
              Pide el código de invitación al administrador de tu grupo.
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
          <ArrowRight size={17} />
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
  useEffect(() => {
    setName(group.name);
  }, [group.name]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loadGameSeasons(group.id)
      .then((s) => {
        if (active) setSeasons(s);
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
      notify("Has salido del grupo.");
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
          <ArrowRight size={16} />
        </Link>
        <Link
          className="button secondary"
          to={`/clasificacion?group=${encodeURIComponent(group.id)}`}
        >
          Ver clasificación
        </Link>
      </div>
      <h3>Participantes</h3>
      <ul className="members-list">
        {people.map((p) => (
          <li key={p.id}>
            <span className="rival-avatar">
              {p.avatar ? <img src={p.avatar} alt="" /> : p.name.charAt(0)}
            </span>
            <span>
              {p.name}
              {p.id === user.uid ? " (tú)" : ""}
            </span>
            {p.id === group.ownerId && <small>Administrador</small>}
          </li>
        ))}
      </ul>
      <h3>Competiciones de esta temporada</h3>
      {loading ? (
        <p className="muted">Cargando modalidades…</p>
      ) : (
        <div className="group-competition-rules">
          {[...COMPETITION_CODES].map((code) => {
            const season = seasons.find((s) => s.id === gameSeasonId(code));
            return (
              <div key={code}>
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
                <LockKeyhole size={14} />
              </div>
            );
          })}
        </div>
      )}
      <GroupPot
        group={group}
        owner={group.ownerId === user.uid}
        refresh={refresh}
        notify={notify}
      />
      <h3>Invita a tus amigos</h3>
      <div className="invite-code">
        <code>{group.id}</code>
        <button
          className="icon-button"
          aria-label="Copiar enlace de invitación"
          onClick={() => {
            void navigator.clipboard
              .writeText(
                `${location.origin}${location.pathname}#/grupos?join=1&code=${encodeURIComponent(group.id)}`,
              )
              .then(() => notify("Enlace de invitación copiado."))
              .catch(() =>
                notify(
                  "No se pudo copiar. Comparte el código que aparece en el grupo.",
                ),
              );
          }}
        >
          <Copy size={16} />
        </button>
      </div>
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
          <p className="muted footnote">
            Las modalidades no cambian durante la temporada.
          </p>
        </form>
      ) : leaving ? (
        <div className="group-leave-confirm">
          <p>
            ¿Quieres abandonar {group.name}? Necesitarás el código para volver a
            entrar.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setLeaving(false)}
          >
            Quedarme
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void leave()}
          >
            {busy ? "Saliendo…" : "Sí, abandonar grupo"}
          </button>
        </div>
      ) : (
        <button
          className="text-button group-leave"
          onClick={() => setLeaving(true)}
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
  useEffect(() => setValue(potInputValue(current)), [current]);
  useEffect(() => {
    if (hash !== "#bote") return;
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
      haptic();
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
    <section ref={section} id="bote" aria-labelledby={`pot-${group.id}`}>
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
