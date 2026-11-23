import { Copy, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatCode, type Competition } from "../lib/customCompetition";
import { competitionLink, ensureCompetitionCode } from "../lib/customCompetitionData";
import { shareOrCopy } from "../lib/matchActions";
import { haptic } from "../lib/motion";
import "../styles/profile.css";
import "../styles/customCompetition.css";

/**
 * A QR code drawn as one SVG path. The encoder is loaded only when a QR is
 * shown, so the rest of the app doesn't carry it.
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const [qr, setQr] = useState<{ d: string; size: number } | null>(null);
  useEffect(() => {
    let live = true;
    void import("uqr").then(({ encode }) => {
      const { data, size } = encode(text, { ecc: "M", border: 0 });
      let d = "";
      data.forEach((row, y) => {
        // Runs of dark modules become one rectangle: a lighter path.
        for (let x = 0; x < size; x++) {
          if (!row[x]) continue;
          let end = x;
          while (end + 1 < size && row[end + 1]) end++;
          d += `M${x} ${y}h${end - x + 1}v1h${-(end - x + 1)}z`;
          x = end;
        }
      });
      if (live) setQr({ d, size });
    });
    return () => {
      live = false;
    };
  }, [text]);
  return (
    <figure className="invite-qr">
      {qr ? (
        <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
          <path d={qr.d} />
        </svg>
      ) : (
        <span className="invite-qr-placeholder" aria-hidden="true" />
      )}
    </figure>
  );
}

/** Code, QR and link to follow a competition: on the masthead and in Gestión. */
export default function InviteCard({ competition: c, owner }: { competition: Competition; owner: boolean }) {
  const link = competitionLink(c.id);
  const [failed, setFailed] = useState(false);
  const [notice, onNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => onNotice(""), 3000);
    return () => window.clearTimeout(t);
  }, [notice]);
  // Competitions from before short codes get one the first time their owner looks.
  useEffect(() => {
    if (c.code || !owner) return;
    ensureCompetitionCode(c.id).catch(() => setFailed(true));
  }, [c.code, c.id, owner]);
  const text = c.code
    ? `Sigue «${c.name}» en GalacticBet con el código ${c.code}`
    : `Sigue «${c.name}» en GalacticBet`;
  return (
    <div className="invite-card">
      <QrCode text={link} label={`Código QR para seguir ${c.name}`} />
      {c.code ? (
        <div className="invite-code invite-short">
          <code aria-label={`Código ${c.code.split("").join(" ")}`}>{formatCode(c.code)}</code>
          <button
            type="button"
            className="icon-button"
            aria-label="Copiar código"
            onClick={() =>
              void navigator.clipboard.writeText(c.code!).then(
                () => {
                  haptic("success");
                  onNotice("Código copiado.");
                },
                () => onNotice("No se pudo copiar. Mantén pulsado el código para copiarlo."),
              )
            }
          >
            <Copy size={18} />
          </button>
        </div>
      ) : (
        <p className="invite-pending muted">
          {owner && !failed
            ? "Preparando el código…"
            : "Escanea el QR o comparte el enlace. El código corto aparecerá cuando la abra quien la creó."}
        </p>
      )}
      <button
        type="button"
        className="button secondary full"
        onClick={() => void shareOrCopy({ title: c.name, text, url: link }).then((m) => m && onNotice(m))}
      >
        <Share2 size={17} aria-hidden="true" /> Compartir enlace
      </button>
      <p className="invite-notice" role="status">
        {notice}
      </p>
    </div>
  );
}
