import { Download, LoaderCircle, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import Modal from "./Modal";
import "../styles/live.css";

/**
 * Previews a locally generated PNG with native sharing and download. Nothing is uploaded.
 */
export default function ShareDialog({
  title,
  filename,
  text,
  render,
  onClose,
}: {
  title: string;
  filename: string;
  text: string;
  render: () => Promise<Blob>;
  onClose: () => void;
}) {
  const [image, setImage] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    render().then(
      (blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setImage(blob);
        setUrl(objectUrl);
      },
      (e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "No se pudo crear la imagen.",
          );
      },
    );
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);
  function download() {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setMessage("Imagen descargada.");
  }
  async function share() {
    setSharing(true);
    setMessage("");
    try {
      const file = image
        ? new File([image], filename, { type: "image/png" })
        : null;
      if (file && navigator.share && navigator.canShare?.({ files: [file] }))
        await navigator.share({ title, text, files: [file] });
      else if (navigator.share) await navigator.share({ title, text });
      else setMessage("Descarga la imagen para compartirla.");
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError"))
        setMessage("No se ha podido compartir. Puedes descargar la imagen.");
    } finally {
      setSharing(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} className="share-dialog">
      <div className="share-preview" aria-busy={!url && !error}>
        {url ? (
          <img src={url} alt={`Vista previa: ${title}`} />
        ) : (
          <div className="share-preview-loading" role="status">
            {error || "Preparando la imagen…"}
          </div>
        )}
      </div>
      <div className="share-actions">
        <button
          type="button"
          className="button primary"
          onClick={() => void share()}
          disabled={sharing}
        >
          {sharing ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Share2 size={16} />
          )}
          Compartir
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={download}
          disabled={!url}
        >
          <Download size={16} /> Descargar
        </button>
      </div>
      {message && (
        <p className="share-message" role="status">
          {message}
        </p>
      )}
    </Modal>
  );
}
