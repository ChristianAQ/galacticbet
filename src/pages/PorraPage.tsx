import { competitionName } from "../lib/competitions";
import { COMPETITION_CODES } from "../lib/competitions";
import {
  Download,
  Camera,
  FilePenLine,
  Plus,
  Share2,
  Trash2,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Modal from "../components/Modal";
import PorraTicket from "../components/PorraTicket";
import { PageTitle } from "../components/ui";
import { canPredict, type Match } from "../lib/domain";
import { kickoffLabel } from "../lib/matchInsights";
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
  useEffect(() => {
    let active = true;
    setImage(null);
    setImageError("");
    if (preview)
      void porraImage(preview)
        .then((blob) => {
          if (active) setImage(blob);
        })
        .catch(() => {
          if (active)
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
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      if (preview)
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
      setError(
        "Completa todos los nombres y marcadores con goles enteros entre 0 y 99.",
      );
      return;
    }
    try {
      setItems(savePorra(localStorage, storageKey, p));
      setStored(true);
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
  async function share() {
    if (!preview) return;
    setSharing(true);
    setMessage("");
    try {
      const file = image
        ? new File([image], `porra-${preview.id}.png`, { type: "image/png" })
        : null;
      if (file && navigator.share && navigator.canShare?.({ files: [file] }))
        await navigator.share({ title: preview.title, files: [file] });
      else if (navigator.share)
        await navigator.share({
          title: preview.title,
          text: porraText(preview),
        });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(porraText(preview));
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
  const selectedUpcoming = upcoming.some((m) => m.id === draft.fixture?.id);
  const amount = parseContribution(draft.contribution);
  return (
    <>
      <PageTitle
        eyebrow="HERRAMIENTAS · ENTRE AMIGOS"
        title="Porra rápida"
        description="Un partido, vuestros marcadores y una tarjeta lista para compartir."
      />
      <section className="porra-tool" aria-label="Herramienta de porras">
        <div className="porra-tool-heading">
          <div>
            <span className="porra-kicker">
              VUESTRO PARTIDO. VUESTRA PORRA.
            </span>
            <h2 ref={heading} tabIndex={-1}>
              {preview
                ? "Lista para compartir"
                : editing
                  ? "Editar la porra"
                  : "Prepara vuestra porra"}
            </h2>
          </div>
          {preview && (
            <button className="porra-button secondary" onClick={start}>
              <Plus size={16} /> Nueva porra
            </button>
          )}
        </div>
        <p className="porra-local-note">
          Tus porras se guardan en este dispositivo · Siempre editables
        </p>
        {error && (
          <p className="porra-message error-note" role="alert">
            {error}
          </p>
        )}
        {preview ? (
          <>
            <div className="porra-preview-actions">
              <button
                className="porra-button secondary"
                onClick={() => {
                  setPreview(null);
                  setMessage("");
                }}
              >
                <FilePenLine size={16} /> Editar porra
              </button>
              <button
                className="porra-button secondary"
                disabled={!imageUrl}
                onClick={() => setCapture(true)}
              >
                <Camera size={16} /> Vista para captura
              </button>
              <button
                className="porra-button secondary"
                disabled={!image}
                onClick={download}
              >
                <Download size={16} /> Descargar imagen
              </button>
              <button
                className="porra-button"
                disabled={sharing || (!image && !imageError)}
                onClick={() => void share()}
              >
                <Share2 size={16} />
                {sharing ? "Compartiendo…" : "Compartir porra"}
              </button>
            </div>
            <p className="porra-preview-status" role="status">
              {stored
                ? "Porra guardada. Puedes compartir la imagen o hacer una captura."
                : "Vista sin guardar en este dispositivo. Puedes descargarla o volver a editarla."}
            </p>
            {message && (
              <p className="porra-message" role="status">
                {message}
              </p>
            )}
            {imageError && (
              <p className="porra-message" role="status">
                {imageError}
              </p>
            )}
            <PorraTicket porra={preview} />
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
              <p className="porra-message">
                No hay próximos partidos disponibles en el calendario.{" "}
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
                  onChange={(e) =>
                    setDraft((value) => ({ ...value, title: e.target.value }))
                  }
                />
              </label>
              <label>
                Aportación por persona
                <div className="porra-money-input">
                  <input
                    aria-label="Aportación por persona"
                    type="text"
                    inputMode="decimal"
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
                  <span>€</span>
                </div>
              </label>
            </div>
            <div className="porra-editor-heading">
              <h3>Participantes</h3>
              <span>
                {draft.players.length}/{MAX_PORRA_PLAYERS}
              </span>
            </div>
            <div className="porra-player-labels" aria-hidden="true">
              <span>Nombre</span>
              <span>Local</span>
              <span>Visitante</span>
              <span />
            </div>
            <div className="porra-player-fields">
              {draft.players.map((row, index) => (
                <div className="porra-player-field" key={row.id}>
                  <input
                    aria-label={`Nombre de participante ${index + 1}`}
                    value={row.name}
                    placeholder={index === 0 ? "Juan" : "Nombre"}
                    required
                    maxLength={40}
                    onChange={(e) =>
                      updatePlayer(row.id, "name", e.target.value)
                    }
                  />
                  <input
                    aria-label={`Goles local de participante ${index + 1}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={99}
                    step={1}
                    required
                    placeholder="—"
                    value={row.home}
                    onChange={(e) =>
                      updatePlayer(row.id, "home", e.target.value)
                    }
                  />
                  <input
                    aria-label={`Goles visitante de participante ${index + 1}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={99}
                    step={1}
                    required
                    placeholder="—"
                    value={row.away}
                    onChange={(e) =>
                      updatePlayer(row.id, "away", e.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="porra-remove"
                    aria-label={`Eliminar participante ${index + 1}`}
                    disabled={draft.players.length === 1}
                    onClick={() =>
                      setDraft((value) => ({
                        ...value,
                        players: value.players.filter((p) => p.id !== row.id),
                      }))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="porra-add"
              disabled={draft.players.length >= MAX_PORRA_PLAYERS}
              onClick={() => {
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
              <Plus size={16} /> Añadir participante
            </button>
            <div className="porra-editor-total">
              <Wallet size={20} />
              <div>
                <span>Bote previsto</span>
                <strong>
                  {amount === null ? "—" : euro(draft.players.length * amount)}
                </strong>
              </div>
              <small>{draft.players.length} personas</small>
            </div>
            <div className="porra-editor-actions">
              {editing && (
                <button
                  type="button"
                  className="porra-button secondary"
                  onClick={() => setPreview(editing)}
                >
                  Volver a la tarjeta
                </button>
              )}
              <button className="porra-button" disabled={!draft.fixture}>
                Guardar y ver porra
              </button>
            </div>
          </form>
        )}
        <details className="porra-saved">
          <summary>
            <span>Mis porras</span>
            <span>{items.length} guardadas</span>
          </summary>
          {items.length ? (
            <ul>
              {items.map((p) => (
                <li key={p.id}>
                  <button onClick={() => show(p)}>
                    <strong>
                      {p.title}
                      {p.demo ? " · Demo" : ""}
                    </strong>
                    <span>
                      {p.fixture.home} – {p.fixture.away}
                    </span>
                    <small>
                      {p.players.length} personas · {euro(porraTotal(p))}
                    </small>
                  </button>
                  <button
                    className="porra-remove"
                    aria-label={`Eliminar porra ${p.title}`}
                    onClick={() => {
                      setError("");
                      setDeleting(p);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>Aquí aparecerán las porras que guardes en este dispositivo.</p>
          )}
        </details>
      </section>
      {capture && imageUrl && preview && (
        <Modal
          title="Vista para captura"
          className="porra-capture-modal"
          onClose={() => setCapture(false)}
        >
          <img
            src={imageUrl}
            alt={`Porra ${preview.title}, con todos sus marcadores y el bote total`}
          />
        </Modal>
      )}
      {deleting && (
        <Modal title="Eliminar porra" onClose={() => setDeleting(null)}>
          <p>Se eliminará «{deleting.title}» de este dispositivo.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm-buttons">
            <button
              className="button secondary"
              onClick={() => setDeleting(null)}
            >
              Cancelar
            </button>
            <button
              className="button primary"
              onClick={() => {
                try {
                  const next = removePorra(
                    localStorage,
                    storageKey,
                    deleting.id,
                  );
                  setItems(next);
                  if (
                    preview?.id === deleting.id ||
                    editing?.id === deleting.id
                  )
                    start();
                  setDeleting(null);
                } catch {
                  setError(
                    "No se ha podido eliminar la porra. Inténtalo de nuevo.",
                  );
                }
              }}
            >
              Eliminar porra
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
