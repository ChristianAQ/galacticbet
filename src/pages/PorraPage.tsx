import { competitionName } from "../lib/competitions";
import { COMPETITION_CODES } from "../lib/competitions";
import {
  Camera,
  Download,
  Eye,
  FilePenLine,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Modal from "../components/Modal";
import PorraTicket from "../components/PorraTicket";
import SwipeRow from "../components/SwipeRow";
import { menuTarget } from "../components/ContextMenu";
import { Empty, PageTitle } from "../components/ui";
import { canPredict, type Match } from "../lib/domain";
import { kickoffLabel } from "../lib/matchInsights";
import { haptic } from "../lib/motion";
import {
  euro,
  fixtureSnapshot,
  MAX_PORRA_PLAYERS,
  parseContribution,
  porraStorageKey,
  porraText,
  porraTotal,
  readPorras,
  removePorra,
  savePorra,
  validPorra,
  type Porra,
  type PorraFixture,
} from "../lib/porra";
import { porraImage } from "../lib/porraImage";
import { upcomingMatches } from "../lib/schedule";
import "../styles/porra.css";

interface DraftPlayer {
  id: string;
  name: string;
  home: string;
  away: string;
}
interface Draft {
  title: string;
  fixture: PorraFixture | null;
  contribution: string;
  players: DraftPlayer[];
}
const player = (): DraftPlayer => ({
  id: crypto.randomUUID(),
  name: "",
  home: "",
  away: "",
});
const blank = (fixture: PorraFixture | null): Draft => ({
  title: "Porra entre amigos",
  fixture,
  contribution: "",
  players: [player(), player()],
});
function toDraft(p: Porra): Draft {
  return {
    title: p.title,
    fixture: p.fixture,
    contribution: (p.contributionCents / 100).toFixed(2).replace(".", ","),
    players: p.players.map((row) => ({
      ...row,
      home: String(row.home),
      away: String(row.away),
    })),
  };
}

export default function PorraPage({
  matches,
  owner,
  demo,
  loading,
}: {
  matches: Match[];
  owner: string;
  demo: boolean;
  loading: boolean;
}) {
  const storageKey = porraStorageKey(owner);
  const [initial] = useState(() => {
    try {
      return { items: readPorras(localStorage, storageKey), error: "" };
    } catch {
      return {
        items: [] as Porra[],
        error:
          "No se pudieron recuperar las porras de este dispositivo. Los datos guardados se conservan.",
      };
    }
  });
  const [items, setItems] = useState(initial.items);
  const [error, setError] = useState(initial.error);
  const [now, setNow] = useState(Date.now());
  const upcoming = upcomingMatches(matches, now);
  const firstId = upcoming[0]?.id;
  const [draft, setDraft] = useState<Draft>(() =>
    initial.items[0]
      ? toDraft(initial.items[0])
      : blank(upcoming[0] ? fixtureSnapshot(upcoming[0]) : null),
  );
  const [editing, setEditing] = useState<Porra | null>(
    initial.items[0] || null,
  );
  const [preview, setPreview] = useState<Porra | null>(
    initial.items[0] || null,
  );
  const [stored, setStored] = useState(true);
  const [image, setImage] = useState<Blob | null>(null);
  const [imageError, setImageError] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [capture, setCapture] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState<Porra | null>(null);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const interval = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    const first = matches.find((m) => m.id === firstId);
    if (first)
      setDraft((value) =>
        value.fixture ? value : { ...value, fixture: fixtureSnapshot(first) },
      );
  }, [firstId, matches]);
  // This page lives in a hidden <Activity> while you browse deeper; effects run
  // again when it reappears, so the image is only drawn once per porra version.
  const drawn = useRef<Porra | null | undefined>(undefined);
  useEffect(() => {
    if (drawn.current === preview) return;
    let active = true;
    setImage(null);
    setImageError("");
    if (!preview) {
      drawn.current = preview;
      return;
    }
    void porraImage(preview)
      .then((blob) => {
        if (!active) return;
        drawn.current = preview;
        setImage(blob);
      })
      .catch(() => {
        if (!active) return;
        drawn.current = preview;
        setImageError(
          "No se ha podido preparar la imagen. Puedes hacer una captura de la tarjeta.",
        );
      });
    return () => {
      active = false;
    };
  }, [preview]);
  useEffect(() => {
    if (!image) {
      setImageUrl("");
      return;
    }
    const url = URL.createObjectURL(image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  // Focus the heading when the porra on screen changes, not on every return.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    const key = `${preview?.id}|${preview?.updatedAt}`;
    if (focused.current === key) return;
    const first = focused.current === null;
    focused.current = key;
    const frame = requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      if (preview && !first)
        heading.current
          ?.closest(".porra-tool")
          ?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [preview?.id, preview?.updatedAt]);
  function start() {
    setDraft(blank(upcoming[0] ? fixtureSnapshot(upcoming[0]) : null));
    setEditing(null);
    setPreview(null);
    setError("");
    setMessage("");
  }
  function show(p: Porra) {
    setDraft(toDraft(p));
    setEditing(p);
    setPreview(p);
    setStored(true);
    setError("");
    setMessage("");
  }
  function edit(p: Porra) {
    show(p);
    setPreview(null);
  }
  function updatePlayer(
    id: string,
    field: "name" | "home" | "away",
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      players: current.players.map((row) =>
        row.id === id ? { ...row, [field]: value } : row,
      ),
    }));
  }
  function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    const contributionCents = parseContribution(draft.contribution);
    if (!draft.fixture) {
      setError("Elige un partido para preparar la porra.");
      return;
    }
    if (contributionCents === null) {
      setError(
        "Indica una aportación entre 0 y 10.000 €, con un máximo de dos decimales.",
      );
      return;
    }
    const current = matches.find((m) => m.id === draft.fixture?.id);
    if (
      editing?.fixture.id !== draft.fixture.id &&
      (!current || !canPredict(current.utcDate, Date.now(), current.status))
    ) {
      setError(
        "Este partido ya no está disponible como próximo encuentro. Elige otro partido.",
      );
      return;
    }
    const stamp = Date.now();
    const p: Porra = {
      id: editing?.id || crypto.randomUUID(),
      title: draft.title.trim(),
      fixture: current ? fixtureSnapshot(current) : draft.fixture,
      contributionCents,
      players: draft.players.map((row) => ({
        id: row.id,
        name: row.name.trim(),
        home: Number(row.home),
        away: Number(row.away),
      })),
      demo: editing?.fixture.id === draft.fixture.id ? editing.demo : demo,
      createdAt: editing?.createdAt || stamp,
      updatedAt: Math.max(stamp, editing?.createdAt || 0),
    };
    if (
      !validPorra(p) ||
      draft.players.some((row) => row.home === "" || row.away === "")
    ) {
      haptic("warning");
      setError(
        "Completa todos los nombres y marcadores con goles enteros entre 0 y 99.",
      );
      return;
    }
    try {
      setItems(savePorra(localStorage, storageKey, p));
      setStored(true);
      haptic("success");
    } catch (e) {
      setStored(false);
      setError(
        e instanceof Error &&
          !["QuotaExceededError", "SecurityError"].includes(e.name)
          ? e.message
          : "No se ha podido guardar en este dispositivo. Puedes compartir la vista y seguir editándola.",
      );
    }
    setEditing(p);
    setPreview(p);
  }
  function download() {
    if (!image || !preview) return;
    const url = URL.createObjectURL(image);
    const link = document.createElement("a");
    link.href = url;
    link.download = `porra-${preview.id}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  /** Image of the porra on screen when ready; text for any other porra. */
  async function share(target: Porra | null = preview) {
    if (!target) return;
    setSharing(true);
    setMessage("");
    try {
      const file =
        image && target === preview
          ? new File([image], `porra-${target.id}.png`, { type: "image/png" })
          : null;
      if (file && navigator.share && navigator.canShare?.({ files: [file] }))
        await navigator.share({ title: target.title, files: [file] });
      else if (navigator.share)
        await navigator.share({
          title: target.title,
          text: porraText(target),
        });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(porraText(target));
        haptic("success");
        setMessage("Porra copiada. Ya puedes pegarla en el chat que quieras.");
      } else
        setMessage(
          "Descarga la imagen para compartirla o haz una captura de la tarjeta.",
        );
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError"))
        setMessage("No se ha podido compartir. Puedes usar Descargar imagen.");
    } finally {
      setSharing(false);
    }
  }
  function remove(target: Porra) {
    try {
      const next = removePorra(localStorage, storageKey, target.id);
      setItems(next);
      haptic("success");
      if (preview?.id === target.id || editing?.id === target.id) start();
      setDeleting(null);
    } catch {
      setError("No se ha podido eliminar la porra. Inténtalo de nuevo.");
    }
  }
  const selectedUpcoming = upcoming.some((m) => m.id === draft.fixture?.id);
  const amount = parseContribution(draft.contribution);
  const savedPreview = Boolean(preview && items.some((p) => p.id === preview.id));
  return (
    <>
      <PageTitle
        eyebrow="Herramientas · entre amigos"
        title="Porra rápida"
        description="Un partido, vuestros marcadores y una tarjeta lista para el chat."
      />
      <section className="porra-tool" aria-label="Herramienta de porras">
        <header className="porra-tool-heading">
          <div>
            <span className="eyebrow">Vuestro partido. Vuestra porra.</span>
            <h2 ref={heading} tabIndex={-1}>
              {preview
                ? "Lista para el chat"
                : editing
                  ? "Retoca la porra"
                  : "Monta vuestra porra"}
            </h2>
          </div>
          {preview && (
            <button type="button" className="button secondary porra-new" onClick={start}>
              <Plus size={16} aria-hidden="true" /> Nueva
            </button>
          )}
        </header>
        <p className="porra-local-note">
          Se guardan en este dispositivo · Siempre editables
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {preview ? (
          <>
            <PorraTicket porra={preview} />
            <p className="porra-preview-status" role="status">
              {stored
                ? "Porra guardada. Compártela tal cual o haz una captura."
                : "Vista sin guardar en este dispositivo. Puedes descargarla o volver a editarla."}
            </p>
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}
            {imageError && (
              <p className="setup-notice" role="status">
                {imageError}
              </p>
            )}
            <div className="porra-preview-actions">
              <button
                type="button"
                className="button primary porra-share"
                disabled={sharing || (!image && !imageError)}
                onClick={() => void share()}
              >
                <Share2 size={17} aria-hidden="true" />
                {sharing ? "Compartiendo…" : "Compartir porra"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={!image}
                onClick={download}
              >
                <Download size={16} aria-hidden="true" /> Descargar
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={!imageUrl}
                onClick={() => setCapture(true)}
              >
                <Camera size={16} aria-hidden="true" /> Para captura
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setPreview(null);
                  setMessage("");
                }}
              >
                <FilePenLine size={16} aria-hidden="true" /> Editar
              </button>
              {savedPreview && (
                <button
                  type="button"
                  className="button secondary porra-delete"
                  onClick={() => {
                    setError("");
                    setDeleting(preview);
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" /> Eliminar
                </button>
              )}
            </div>
          </>
        ) : (
          <form className="porra-editor" onSubmit={save}>
            <label>
              Partido
              <select
                aria-label="Partido de la porra"
                value={draft.fixture?.id || ""}
                required
                disabled={loading && !draft.fixture}
                onChange={(e) => {
                  const m = matches.find((m) => m.id === e.target.value);
                  if (m)
                    setDraft((value) => ({
                      ...value,
                      fixture: fixtureSnapshot(m),
                    }));
                }}
              >
                {!draft.fixture && (
                  <option value="">
                    {loading
                      ? "Cargando calendario…"
                      : "Selecciona un próximo partido"}
                  </option>
                )}
                {draft.fixture && !selectedUpcoming && (
                  <option value={draft.fixture.id}>
                    {draft.fixture.home} – {draft.fixture.away} · Partido de
                    esta porra
                  </option>
                )}
                {COMPETITION_CODES.map((code) => (
                  <optgroup key={code} label={competitionName(code)}>
                    {upcoming
                      .filter((m) => m.competition === code)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.home} – {m.away} · {kickoffLabel(m.utcDate, now)}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {!upcoming.length && !editing && !loading && (
              <p className="setup-notice">
                No hay próximos partidos en el calendario.{" "}
                <Link to="/ligas">Consultar partidos</Link>
              </p>
            )}
            <div className="porra-fields">
              <label>
                Nombre de la porra
                <input
                  aria-label="Nombre de la porra"
                  value={draft.title}
                  required
                  maxLength={60}
                  autoComplete="off"
                  autoCapitalize="sentences"
                  enterKeyHint="next"
                  onChange={(e) =>
                    setDraft((value) => ({ ...value, title: e.target.value }))
                  }
                />
              </label>
              <label>
                Aportación por persona
                <span className="porra-money-input">
                  <input
                    aria-label="Aportación por persona"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    enterKeyHint="next"
                    placeholder="2,00"
                    value={draft.contribution}
                    required
                    maxLength={8}
                    onChange={(e) =>
                      setDraft((value) => ({
                        ...value,
                        contribution: e.target.value,
                      }))
                    }
                  />
                  <span aria-hidden="true">€</span>
                </span>
              </label>
            </div>
            <div className="porra-editor-heading">
              <h3>Participantes</h3>
              <span>
                {draft.players.length}/{MAX_PORRA_PLAYERS}
              </span>
            </div>
            <div className="porra-player-labels" aria-hidden="true">
              <span />
              <span>Nombre</span>
              <span>Local</span>
              <span />
              <span>Visit.</span>
              <span />
            </div>
            <ol className="porra-player-fields">
              {draft.players.map((row, index) => (
                <li className="porra-player-field" key={row.id}>
                  <span className="porra-player-number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <input
                    aria-label={`Nombre de participante ${index + 1}`}
                    value={row.name}
                    placeholder={index === 0 ? "Juan" : "Nombre"}
                    required
                    maxLength={40}
                    autoComplete="off"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    onChange={(e) =>
                      updatePlayer(row.id, "name", e.target.value)
                    }
                  />
                  <input
                    aria-label={`Goles local de participante ${index + 1}`}
                    type="number"
                    inputMode="numeric"
                    enterKeyHint="next"
                    min={0}
                    max={99}
                    step={1}
                    required
                    placeholder="–"
                    value={row.home}
                    onChange={(e) =>
                      updatePlayer(row.id, "home", e.target.value)
                    }
                  />
                  <span className="porra-dash" aria-hidden="true">
                    –
                  </span>
                  <input
                    aria-label={`Goles visitante de participante ${index + 1}`}
                    type="number"
                    inputMode="numeric"
                    enterKeyHint={index === draft.players.length - 1 ? "done" : "next"}
                    min={0}
                    max={99}
                    step={1}
                    required
                    placeholder="–"
                    value={row.away}
                    onChange={(e) =>
                      updatePlayer(row.id, "away", e.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="icon-button porra-remove"
                    aria-label={`Eliminar participante ${index + 1}`}
                    disabled={draft.players.length === 1}
                    onClick={() => {
                      haptic();
                      setDraft((value) => ({
                        ...value,
                        players: value.players.filter((p) => p.id !== row.id),
                      }));
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="porra-add"
              disabled={draft.players.length >= MAX_PORRA_PLAYERS}
              onClick={() => {
                haptic();
                const id = crypto.randomUUID();
                setDraft((value) => ({
                  ...value,
                  players: [...value.players, { ...player(), id }],
                }));
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLInputElement>(
                      `[aria-label="Nombre de participante ${draft.players.length + 1}"]`,
                    )
                    ?.focus(),
                );
              }}
            >
              <Plus size={17} aria-hidden="true" /> Añadir participante
            </button>
            <div className="porra-editor-total" aria-live="polite">
              <span className="eyebrow">Bote previsto</span>
              <strong className="numeral">
                {amount === null ? "—" : euro(draft.players.length * amount)}
              </strong>
              <small>
                {draft.players.length}{" "}
                {draft.players.length === 1 ? "persona" : "personas"}
                {amount ? ` × ${euro(amount)}` : ""}
              </small>
            </div>
            <div className="porra-editor-actions">
              {editing && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setPreview(editing)}
                >
                  Volver a la tarjeta
                </button>
              )}
              <button className="button primary" disabled={!draft.fixture}>
                Guardar y ver porra
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="porra-saved" aria-labelledby="porra-saved-title">
        <div className="section-heading">
          <h2 id="porra-saved-title">Mis porras</h2>
          <span className="porra-saved-count">
            {items.length} {items.length === 1 ? "guardada" : "guardadas"}
          </span>
        </div>
        {items.length ? (
          <>
            <p className="porra-saved-hint">
              Desliza para editar o borrar; mantén pulsado para compartir.
            </p>
            <ul className="porra-saved-list">
              {items.map((p) => (
                <li key={p.id}>
                  <SwipeRow
                    actions={[
                      {
                        label: "Eliminar",
                        tone: "destructive",
                        icon: <Trash2 size={20} aria-hidden="true" />,
                        onAction: () => {
                          setError("");
                          setDeleting(p);
                        },
                      },
                      {
                        label: "Editar",
                        icon: <FilePenLine size={20} aria-hidden="true" />,
                        onAction: () => edit(p),
                      },
                    ]}
                  >
                    <button
                      type="button"
                      className={`porra-saved-row${preview?.id === p.id ? " is-current" : ""}`}
                      aria-current={preview?.id === p.id || undefined}
                      ref={menuTarget(() => ({
                        title: p.title,
                        items: [
                          {
                            label: "Ver tarjeta",
                            icon: <Eye size={18} aria-hidden="true" />,
                            onSelect: () => show(p),
                          },
                          {
                            label: "Editar",
                            icon: <FilePenLine size={18} aria-hidden="true" />,
                            onSelect: () => edit(p),
                          },
                          {
                            label: "Compartir",
                            icon: <Share2 size={18} aria-hidden="true" />,
                            onSelect: () => void share(p),
                          },
                          {
                            label: "Eliminar",
                            icon: <Trash2 size={18} aria-hidden="true" />,
                            destructive: true,
                            onSelect: () => {
                              setError("");
                              setDeleting(p);
                            },
                          },
                        ],
                      }))}
                      onClick={() => show(p)}
                    >
                      <span className="porra-saved-main">
                        <strong>
                          {p.title}
                          {p.demo && <small className="badge">Demo</small>}
                        </strong>
                        <span>
                          {p.fixture.home} – {p.fixture.away}
                        </span>
                      </span>
                      <span className="porra-saved-total">
                        <b className="numeral">{euro(porraTotal(p))}</b>
                        <small>
                          {p.players.length}{" "}
                          {p.players.length === 1 ? "persona" : "personas"}
                        </small>
                      </span>
                    </button>
                  </SwipeRow>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Empty art="slip" title="Ninguna porra en el cajón">
            Aquí aparecerán las porras que guardes en este dispositivo.
          </Empty>
        )}
      </section>

      {capture && imageUrl && preview && (
        <Modal
          title="Vista para captura"
          className="porra-capture-modal"
          detents={["large"]}
          onClose={() => setCapture(false)}
        >
          <img
            src={imageUrl}
            alt={`Porra ${preview.title}, con todos sus marcadores y el bote total`}
          />
          <p className="muted">
            Haz una captura de pantalla o mantén pulsada la imagen para
            guardarla.
          </p>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="¿Borramos la porra?"
          role="alertdialog"
          onClose={() => setDeleting(null)}
          initialFocus="[data-cancel]"
        >
          <p>
            Se eliminará «{deleting.title}» de este dispositivo. No hay
            papelera: no se puede deshacer.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm-buttons">
            <button
              type="button"
              className="button secondary"
              data-cancel
              onClick={() => setDeleting(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() => remove(deleting)}
            >
              Eliminar
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
