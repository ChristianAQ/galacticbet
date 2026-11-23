import { ArrowRight, ChevronDown, Flag } from "lucide-react";
import { useContext, useEffect, useRef, type ReactNode } from "react";
import { matchStatusLabel, type Match } from "../lib/domain";
import { finishedMatchResult } from "../lib/matchResult";
import { kickoffLabel } from "../lib/matchInsights";
import { chrome, EntryContext, useNavTitle } from "../lib/chrome";
import TeamForm from "./TeamForm";
import { LiveMinute } from "./LiveStatus";
import EmptyArt, { type EmptyArtKind } from "./EmptyArt";

/** Empty state: an illustration, a line with some voice and what to do next. */
export function Empty({
  title,
  children,
  art = "net",
  action,
}: {
  title: string;
  children?: ReactNode;
  art?: EmptyArtKind;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <EmptyArt kind={art} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-actions">{action}</div>}
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
    offline: "Sin conexión. Los datos llegarán en cuanto vuelva la red.",
  };
  return (
    messages[code] ||
    (e instanceof Error
      ? e.message
      : "No se pudo completar la operación. Inténtalo otra vez.")
  );
};

/**
 * Reports when an element scrolls under the fixed navigation bar, so the bar
 * can fade in its compact title (iOS large-title behaviour).
 */
export function useCollapsingTitle<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const id = useContext(EntryContext);
  useEffect(() => {
    const node = ref.current;
    if (!node || !id || typeof IntersectionObserver === "undefined") return;
    const bar = document.querySelector<HTMLElement>(".nav-bar");
    const offset = Math.round(bar?.getBoundingClientRect().height || 0);
    const observer = new IntersectionObserver(
      ([entry]) =>
        chrome.set(id, {
          collapsed:
            !entry.isIntersecting && entry.boundingClientRect.top < offset,
        }),
      { rootMargin: `-${offset}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      chrome.set(id, { collapsed: false });
    };
  }, [id]);
  return ref;
}

/**
 * Large title on an ink masthead. It shrinks as it scrolls under the bar (CSS
 * scroll timeline where supported) and hands its name to the compact bar.
 */
export interface TitlePicker {
  /** What the picker chooses («Grupo»), for screen readers. */
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}
export function PageTitle({
  eyebrow,
  title,
  description,
  titleControl,
  children,
  navTitle,
  titlePicker,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  titleControl?: ReactNode;
  children?: ReactNode;
  /** Shorter name for the compact bar, when the large title is long. */
  navTitle?: string;
  /** The title is a choice (the selected group): tapping it opens the system picker. */
  titlePicker?: TitlePicker;
}) {
  useNavTitle(navTitle || title);
  const heading = useCollapsingTitle<HTMLHeadingElement>();
  return (
    <header className="masthead page-heading">
      <div className="large-title">
        <div className="large-title-text">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          {titlePicker ? (
            <div className="title-picker">
              <h1 ref={heading}>
                <span>{title}</span>
                <ChevronDown className="title-picker-chevron" size={22} strokeWidth={2.6} aria-hidden="true" />
              </h1>
              <select
                className="title-picker-select"
                aria-label={titlePicker.label}
                value={titlePicker.value}
                onChange={(e) => titlePicker.onChange(e.target.value)}
              >
                {titlePicker.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <h1 ref={heading}>{title}</h1>
          )}
        </div>
        {titleControl && <div className="large-title-control">{titleControl}</div>}
      </div>
      {description && <p className="masthead-description">{description}</p>}
      {children}
    </header>
  );
}

export function Crest({ src }: { src?: string }) {
  return src ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  ) : (
    <span className="crest-placeholder" aria-hidden="true" />
  );
}
export function Team({
  name,
  crest,
  part,
}: {
  name: string;
  crest?: string;
  /** Shared-element name used when the fixture morphs into the match page. */
  part?: "home-crest" | "away-crest";
}) {
  return (
    <span className="team">
      {crest ? (
        <img
          src={crest}
          alt=""
          loading="lazy"
          decoding="async"
          data-vt-part={part}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <Flag size={20} data-vt-part={part} />
      )}
      <span>{name}</span>
    </span>
  );
}
export function MatchRow({
  match: m,
  history,
  as: Container = "div",
  plainResult = false,
}: {
  match: Match;
  history?: Match[];
  as?: "div" | "span";
  /** Any sport: no «A 90 minutos» under the result (penalties still say so). */
  plainResult?: boolean;
}) {
  const result = finishedMatchResult(m);
  const live = ["IN_PLAY", "PAUSED"].includes(m.status);
  return (
    <Container
      className={`match-row${history ? " with-form" : ""}${live ? " is-live" : ""}`}
      data-vt-match={m.id}
    >
      <span className="match-date">{kickoffLabel(m.utcDate)}</span>
      {history ? (
        <span className="match-team-block home-team">
          <Team name={m.home} crest={m.homeCrest} part="home-crest" />
          <TeamForm match={m} side="home" matches={history} />
        </span>
      ) : (
        <Team name={m.home} crest={m.homeCrest} part="home-crest" />
      )}
      <span className="match-score" data-vt-part="score">
        {m.homeScore !== null && m.awayScore !== null ? (
          <>
            <b>{m.homeScore}</b>
            <i aria-hidden="true">:</i>
            <b>{m.awayScore}</b>
          </>
        ) : m.status === "FINISHED" ? (
          "—"
        ) : (
          <small>vs</small>
        )}
      </span>
      {history ? (
        <span className="match-team-block away-team">
          <Team name={m.away} crest={m.awayCrest} part="away-crest" />
          <TeamForm match={m} side="away" matches={history} />
        </span>
      ) : (
        <Team name={m.away} crest={m.awayCrest} part="away-crest" />
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
            {(!plainResult || m.scoreDuration === "PENALTY_SHOOTOUT") && (
              <small>{result.decision}</small>
            )}
          </>
        ) : live ? (
          <LiveMinute match={m} />
        ) : m.status === "TIMED" ? null : m.status === "SCHEDULED" ? (
          "Horario por confirmar"
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
    <Empty
      art="slip"
      title="Tu boleto está en blanco"
      action={
        <>
          <button className="button primary" onClick={onLogin}>
            Entrar y jugar <ArrowRight size={16} />
          </button>
          {onDemo && (
            <button className="button secondary" onClick={onDemo}>
              Probar sin cuenta
            </button>
          )}
        </>
      }
    >
      Entra para jugar con tus amigos y llevar tus pronósticos en el bolsillo,
      en este y en cualquier dispositivo.
    </Empty>
  );
}
