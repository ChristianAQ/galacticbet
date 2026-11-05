import { ArrowRight, Flag, Target } from "lucide-react";
import type { ReactNode } from "react";
import { matchStatusLabel, type Match } from "../lib/domain";
import { finishedMatchResult } from "../lib/matchResult";
import { kickoffLabel } from "../lib/matchInsights";
import TeamForm from "./TeamForm";
import { LiveMinute } from "./LiveStatus";
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <Target size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}
export const readableError = (e: unknown) => {
  const code = typeof e === "object" && e && "code" in e ? String(e.code) : "";
  const messages: Record<string, string> = {
    "auth/invalid-credential": "Revisa tu correo y contraseña.",
    "auth/email-already-in-use":
      "Este correo ya tiene una cuenta. Inicia sesión.",
    "auth/weak-password": "Usa una contraseña de al menos 6 caracteres.",
    "auth/popup-closed-by-user":
      "Se cerró la ventana de Google. Puedes volver a intentarlo.",
    "auth/unauthorized-domain":
      "Este dominio aún no está autorizado en Firebase Authentication.",
    "permission-denied":
      "No tienes permiso para esta operación o el partido ya está cerrado.",
    unavailable: "No hay conexión con Firestore. Tu cambio no se ha guardado.",
  };
  return (
    messages[code] ||
    (e instanceof Error
      ? e.message
      : "No se pudo completar la operación. Inténtalo otra vez.")
  );
};
export function PageTitle({
  eyebrow,
  title,
  description,
  titleControl,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  titleControl?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <div className="page-title-row">
          <h1>{title}</h1>
          {titleControl}
        </div>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}
export function Crest({ src }: { src?: string }) {
  return src ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  ) : (
    <span className="crest-placeholder" aria-hidden="true" />
  );
}
export function Team({ name, crest }: { name: string; crest?: string }) {
  return (
    <span className="team">
      {crest ? (
        <img
          src={crest}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <Flag size={20} />
      )}
      <span>{name}</span>
    </span>
  );
}
export function MatchRow({
  match: m,
  history,
  as: Container = "div",
}: {
  match: Match;
  history?: Match[];
  as?: "div" | "span";
}) {
  const result = finishedMatchResult(m);
  return (
    <Container className={`match-row ${history ? "with-form" : ""}`}>
      <span className="match-date">{kickoffLabel(m.utcDate)}</span>
      {history ? (
        <span className="match-team-block home-team">
          <Team name={m.home} crest={m.homeCrest} />
          <TeamForm match={m} side="home" matches={history} />
        </span>
      ) : (
        <Team name={m.home} crest={m.homeCrest} />
      )}
      <span className="match-score">
        {m.homeScore !== null && m.awayScore !== null
          ? `${m.homeScore} : ${m.awayScore}`
          : m.status === "FINISHED"
            ? "—"
            : "vs"}
      </span>
      {history ? (
        <span className="match-team-block away-team">
          <Team name={m.away} crest={m.awayCrest} />
          <TeamForm match={m} side="away" matches={history} />
        </span>
      ) : (
        <Team name={m.away} crest={m.awayCrest} />
      )}
      <span
        className={`match-status ${result?.winnerName ? "match-status-winner" : ""}`}
      >
        {result ? (
          <>
            <span>
              {result.winnerName
                ? `Ganó ${result.winnerName}`
                : result.winner === "X"
                  ? "Empate"
                  : "Finalizado · Ganador pendiente"}
            </span>
            <small>{result.decision}</small>
          </>
        ) : ["IN_PLAY", "PAUSED"].includes(m.status) ? (
          <LiveMinute match={m} />
        ) : (
          matchStatusLabel[m.status] || m.status
        )}
      </span>
    </Container>
  );
}
export function PrivateGate({
  onLogin,
  onDemo,
}: {
  onLogin: () => void;
  onDemo?: () => void;
}) {
  return (
    <Empty title="Tu quiniela te espera">
      <span className="private-gate-text">
        Inicia sesión para jugar con tus amigos y conservar tus pronósticos en
        todos tus dispositivos.
      </span>
      <button className="button primary" onClick={onLogin}>
        Iniciar sesión <ArrowRight size={16} />
      </button>
      {onDemo && (
        <button className="button secondary" onClick={onDemo}>
          Probar en modo demo
        </button>
      )}
    </Empty>
  );
}
