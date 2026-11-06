import { useEffect, useState, useId } from "react";
import { ArrowUpRight, Newspaper } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { currentArticles, type FootballNews } from "../lib/footballNews";
import { createNewsLoader } from "../lib/newsCache";
import { competitionName } from "../lib/competitions";
const load = createNewsLoader(
  import.meta.env.VITE_FIREBASE_PROJECT_ID || "unconfigured",
  () => localStorage,
  async () => (db ? (await getDoc(doc(db, "news", "football"))).data() : null),
);
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
  useEffect(() => {
    let active = true;
    setNews(null);
    setError(false);
    setLoading(!demo);
    if (!demo)
      void load().then(
        (n) => {
          if (active) {
            setNews(n);
            setLoading(false);
          }
        },
        () => {
          if (active) {
            setError(true);
            setLoading(false);
          }
        },
      );
    return () => {
      active = false;
    };
  }, [demo, attempt]);
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
        <Newspaper size={18} aria-hidden="true" />
      </div>
      <div className="panel news-feed">
        {loading ? (
          <p role="status">Cargando titulares…</p>
        ) : error ? (
          <div role="status">
            <p>No se han podido cargar las noticias.</p>
            <button
              className="text-button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Reintentar
            </button>
          </div>
        ) : !articles.length ? (
          <p>
            {demo
              ? "Las noticias reales están disponibles fuera del modo demo."
              : competition
                ? "No hay titulares recientes disponibles para esta competición y temporada."
                : "No hay titulares recientes disponibles."}
          </p>
        ) : (
          <>
            <ul>
              {articles.map((a) => (
                <li key={a.url}>
                  <a href={a.url} target="_blank" rel="noopener noreferrer">
                    <span className="news-meta">
                      {competitionName(a.competition, true)} · ESPN{" "}
                      <time dateTime={a.publishedAt}>
                        {new Intl.DateTimeFormat("es", {
                          day: "numeric",
                          month: "short",
                        }).format(new Date(a.publishedAt))}
                      </time>
                    </span>
                    <strong>{a.title}</strong>
                    {a.description && (
                      <p className="news-description">{a.description}</p>
                    )}
                    <span className="news-read">
                      Leer en ESPN <ArrowUpRight size={13} aria-hidden="true" />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="news-edition">
              Fuente: ESPN · Edición{" "}
              <time dateTime={news!.fetchedAt}>
                {new Intl.DateTimeFormat("es", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(news!.fetchedAt))}
              </time>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
