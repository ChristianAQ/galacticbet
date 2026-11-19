import { Download, LoaderCircle, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import Modal from "./Modal";
import { haptic } from "../lib/motion";
import { Skeleton } from "./Skeleton";
import "../styles/share.css";

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
    haptic("success");
    setMessage("Imagen descargada. Ya la tienes en tus archivos.");
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
    <Modal
      title={title}
      onClose={onClose}
      className="share-dialog"
      detents={["medium", "large"]}
      footer={
        <div className="share-actions">
          <button
            type="button"
            className="button primary"
            onClick={() => void share()}
            disabled={sharing || (!url && !error)}
          >
            {sharing ? (
              <LoaderCircle size={17} className="spin" aria-hidden="true" />
            ) : (
              <Share2 size={17} aria-hidden="true" />
            )}
            Compartir
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={download}
            disabled={!url}
          >
            <Download size={17} aria-hidden="true" /> Descargar
          </button>
        </div>
      }
    >
      <figure className="share-preview" aria-busy={!url && !error}>
        {url ? (
          <img src={url} alt={`Vista previa: ${title}`} />
        ) : error ? (
          <p className="share-preview-error" role="status">
            {error}
          </p>
        ) : (
          <div className="share-preview-loading" role="status" aria-label="Preparando la imagen">
            <Skeleton width="45%" height={12} />
            <Skeleton width="80%" height={30} radius={6} />
            <Skeleton width="100%" height={14} />
            <Skeleton width="100%" height={14} />
            <Skeleton width="92%" height={14} />
            <Skeleton width="70%" height={14} />
          </div>
        )}
        <figcaption>Se genera en tu móvil · No se sube a ningún sitio</figcaption>
      </figure>
      {message && (
        <p className="form-message share-message" role="status">
          {message}
        </p>
      )}
    </Modal>
  );
}
