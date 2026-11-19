import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Copy, Share2 } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { fromServer } from "../lib/firestoreOnline";
import { db } from "../lib/firebase";
import {
  currentArticles,
  newsPhoto,
  type FootballArticle,
  type FootballNews,
  type NewsImage,
} from "../lib/footballNews";
import { createNewsLoader } from "../lib/newsCache";
import { competitionName } from "../lib/competitions";
import { REFRESH_EVENT } from "../lib/chrome";
import { copyLink, shareOrCopy } from "../lib/matchActions";
import { haptic } from "../lib/motion";
import { menuTarget } from "./ContextMenu";
import { SkeletonRows } from "./Skeleton";
import { Empty } from "./ui";
import "../styles/home.css";

const load = createNewsLoader(
  import.meta.env.VITE_FIREBASE_PROJECT_ID || "unconfigured",
  () => localStorage,
  async () =>
    db ? fromServer(await getDoc(doc(db, "news", "football"))).data() : null,
);
const articleDate = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
});
const editionDate = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** «Hace 20 min», «Hace 3 h», «Ayer», then the date. */
function published(iso: string, now: number) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  if (hours < 48) return "Ayer";
  return articleDate.format(new Date(iso));
}

/**
 * The story's photo: a light copy resized by ESPN first, the original if that
 * fails, nothing if both fail (the card simply goes text-only).
 */
function NewsPhoto({ image, lead }: { image: NewsImage; lead: boolean }) {
  const [attempt, setAttempt] = useState(0);
  if (attempt > 1) return null;
  const src =
    attempt === 0
      ? newsPhoto(image.url, lead ? 800 : 240, lead ? 450 : 240)
      : image.url;
  return (
    <span className="news-photo">
      <img
        src={src}
        alt={image.alt || ""}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setAttempt((n) => n + 1)}
      />
    </span>
  );
}

/** Headlines as a front page: the lead story big, the rest as a ruled column. */
export default function NewsSection({
  demo = false,
  competition,
  seasonId,
}: {
  demo?: boolean;
  competition?: string;
  seasonId?: string;
}) {
  const titleId = useId();
  const [news, setNews] = useState<FootballNews | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  // Effects re-run when a kept-alive page is shown again: never blank headlines
  // that are already on screen; the loader's cache answers instantly.
  const shown = useRef(false);
  useEffect(() => {
    let active = true;
    if (demo) {
      shown.current = false;
      setNews(null);
      setError(false);
      setLoading(false);
      return;
    }
    if (!shown.current) {
      setError(false);
      setLoading(true);
    }
    void load().then(
      (n) => {
        if (!active) return;
        shown.current = true;
        setNews(n);
        setError(false);
        setLoading(false);
      },
      () => {
        if (!active) return;
        if (!shown.current) setError(true);
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [demo, attempt]);
  // Pull to refresh asks every open section to read again (the cache decides).
  useEffect(() => {
    const again = () => setAttempt((n) => n + 1);
    window.addEventListener(REFRESH_EVENT, again);
    return () => window.removeEventListener(REFRESH_EVENT, again);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const articles =
    news && !demo
      ? currentArticles(news, Date.now(), competition, seasonId)
      : [];
  return (
    <section
      className="news-section"
      aria-labelledby={titleId}
      aria-busy={loading}
    >
      <div className="section-heading">
        <h2 id={titleId}>
          {competition
            ? `Noticias · ${competitionName(competition, true)}`
            : "Actualidad"}
        </h2>
        {!loading && articles.length > 0 && (
          <span className="news-count">{articles.length} titulares</span>
        )}
      </div>
      <div className="news-feed">
        {loading ? (
          <SkeletonRows rows={4} variant="card" label="Cargando titulares" />
        ) : error ? (
          <Empty
            art="paper"
            title="La rotativa se ha atascado"
            action={
              <button
                className="button secondary"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Reintentar
              </button>
            }
          >
            No hemos podido traer los titulares. Prueba otra vez en un momento.
          </Empty>
        ) : !articles.length ? (
          <Empty art="paper" title="Hoy no hay portada">
            {demo
              ? "Las noticias reales llegan fuera del modo demo."
              : competition
                ? "Ningún titular reciente para esta competición y temporada."
                : "Ningún titular reciente. La redacción está en el descanso."}
          </Empty>
        ) : (
          <>
            <ul className="news-list">
              {articles.map((a, index) => (
                <NewsCard
                  key={a.url}
                  article={a}
                  lead={index === 0}
                  onNotice={setNotice}
                />
              ))}
            </ul>
            <p className="news-edition">
              Fuente: ESPN · Edición de las{" "}
              <time dateTime={news!.fetchedAt}>
                {editionDate.format(new Date(news!.fetchedAt))}
              </time>
              {" · "}Mantén pulsado un titular para compartirlo.
            </p>
          </>
        )}
        {notice && (
          <p className="news-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}

function NewsCard({
  article: a,
  lead,
  onNotice,
}: {
  article: FootballArticle;
  lead: boolean;
  onNotice: (message: string) => void;
}) {
  const photo = a.image && <NewsPhoto image={a.image} lead={lead} />;
  return (
    <li className={`news-item${lead ? " is-lead" : ""}${a.image ? " has-photo" : ""}`}>
      <article
        className="news-card"
        ref={menuTarget(() => ({
          title: a.title,
          items: [
            {
              label: "Leer en ESPN",
              icon: <ArrowUpRight size={18} aria-hidden="true" />,
              onSelect: () => window.open(a.url, "_blank", "noopener,noreferrer"),
            },
            {
              label: "Compartir",
              icon: <Share2 size={18} aria-hidden="true" />,
              onSelect: () =>
                void shareOrCopy({ title: a.title, url: a.url }).then(
                  (message) => message && onNotice(message),
                ),
            },
            {
              label: "Copiar enlace",
              icon: <Copy size={18} aria-hidden="true" />,
              onSelect: () =>
                void copyLink(a.url).then((message) => {
                  haptic("success");
                  onNotice(message);
                }),
            },
          ],
        }))}
      >
        {photo}
        <div className="news-body">
          <p className="news-meta">
            <span className="news-competition">
              {competitionName(a.competition, true)}
            </span>
            <time
              dateTime={a.publishedAt}
              title={editionDate.format(new Date(a.publishedAt))}
            >
              {published(a.publishedAt, Date.now())}
            </time>
            {a.byline && <span className="news-byline">{a.byline}</span>}
          </p>
          <h3 className="news-title">
            {/* The headline's link covers the whole card. */}
            <a
              className="news-link"
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {a.title}
            </a>
          </h3>
          {a.description && <p className="news-description">{a.description}</p>}
          {a.tags && a.tags.length > 0 && (
            <ul className="news-tags" aria-label="Protagonistas">
              {a.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}
          <a
            className="news-read"
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Leer en ESPN: ${a.title}`}
          >
            Leer en ESPN
            <ArrowUpRight size={lead ? 16 : 14} aria-hidden="true" />
          </a>
        </div>
      </article>
    </li>
  );
}
