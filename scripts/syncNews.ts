import type { Firestore } from "firebase-admin/firestore";
import {
  COMPETITION_CODES,
  COMPETITIONS,
  type CompetitionCode,
} from "../src/lib/competitions";
import {
  NEWS_MAX_AGE,
  newsImageUrl,
  newsUrl,
  validNews,
  type FootballArticle,
  type FootballNews,
  type NewsImage,
} from "../src/lib/footballNews";

/** Bumped when articles gain fields, so a cached edition is refreshed. */
export const NEWS_CONTENT_VERSION = 2;

// Provider text is kept as plain text; provider HTML is never rendered.
function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .slice(0, 10000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|quot|apos|lt|gt|nbsp);/g,
      (entity) =>
        ({
          "&amp;": "&",
          "&quot;": '"',
          "&apos;": "'",
          "&lt;": "<",
          "&gt;": ">",
          "&nbsp;": " ",
        })[entity] ?? entity,
    )
    .replace(/\s+/g, " ")
    .trim();
}
/** Short text, cut at a word boundary with an ellipsis. */
function clip(text: string, max: number) {
  if (text.length <= max) return text;
  const excerpt = text.slice(0, max - 1);
  const boundary = excerpt.lastIndexOf(" ");
  return `${excerpt.slice(0, boundary > max * 0.75 ? boundary : max - 1).trimEnd()}…`;
}
export function newsDescription(
  value: unknown,
  title: string,
): string | undefined {
  const text = plainText(value);
  if (!text || text.toLocaleLowerCase("es") === title.toLocaleLowerCase("es"))
    return undefined;
  return clip(text, 240);
}
/** The story's lead photo (header first), from ESPN's CDN only. */
export function newsImage(value: unknown): NewsImage | undefined {
  if (!Array.isArray(value)) return undefined;
  const photos = value
    .slice(0, 12)
    .filter((image) => image && typeof image === "object" && newsImageUrl(image.url))
    .sort(
      (a, b) =>
        Number(b.type === "header") - Number(a.type === "header") ||
        Number((b.width ?? 0) >= 400) - Number((a.width ?? 0) >= 400),
    );
  const photo = photos[0];
  if (!photo) return undefined;
  const alt = clip(plainText(photo.alt) || plainText(photo.caption), 300);
  return { url: newsImageUrl(photo.url)!, ...(alt ? { alt } : {}) };
}
/** Teams and players named by ESPN's categories, at most three. */
export function newsTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = [
    ...new Set(
      value
        .slice(0, 30)
        .filter((c) => c && ["team", "athlete"].includes(c.type))
        .map((c) => plainText(c.description))
        .filter((name) => name && name.length <= 60),
    ),
  ].slice(0, 3);
  return tags.length ? tags : undefined;
}

export function normalizeNews(
  value: unknown,
  competition: CompetitionCode,
  now: number,
  log?: (message: string) => void,
): FootballArticle[] {
  if (!value || typeof value !== "object") return [];
  const articles = (value as { articles?: unknown }).articles;
  if (!Array.isArray(articles)) {
    log?.(`Noticias ESPN ${competition}: formato sin lista articles.`);
    return [];
  }
  const rejected = { title: 0, link: 0, date: 0, expired: 0, future: 0 };
  const result = articles.slice(0, 20).flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const title = typeof a.headline === "string" ? a.headline.trim() : "";
    const url = newsUrl(a.links?.web?.href);
    const published =
      typeof a.published === "string" ? Date.parse(a.published) : NaN;
    if (!title || title.length > 240) {
      rejected.title++;
      return [];
    }
    if (!url) {
      rejected.link++;
      return [];
    }
    if (!Number.isFinite(published)) {
      rejected.date++;
      return [];
    }
    if (published > now) {
      rejected.future++;
      return [];
    }
    if (now - published > NEWS_MAX_AGE) {
      rejected.expired++;
      return [];
    }
    const description = newsDescription(a.description, title);
    const image = newsImage(a.images);
    const byline = clip(plainText(a.byline), 120);
    const tags = newsTags(a.categories);
    return [
      {
        title,
        ...(description ? { description } : {}),
        url,
        publishedAt: new Date(published).toISOString(),
        competition,
        ...(image ? { image } : {}),
        ...(byline ? { byline } : {}),
        ...(tags ? { tags } : {}),
      },
    ];
  });
  log?.(
    `Noticias ESPN ${competition}: recibidos ${articles.length}, válidos ${result.length}; descartados por título ${rejected.title}, enlace ${rejected.link}, fecha inválida ${rejected.date}, antigüedad ${rejected.expired}, fecha futura ${rejected.future}.`,
  );
  return result;
}
export async function syncNews(
  db: Firestore,
  options: {
    now?: number;
    request?: typeof fetch;
    log?: (message: string) => void;
  } = {},
) {
  const now = options.now ?? Date.now();
  const request = options.request ?? fetch;
  const log = options.log ?? console.log;
  const ref = db.doc("news/football");
  const previous = (await ref.get()).data();
  const fresh =
    validNews(previous) &&
    previous.linkPolicyVersion === 2 &&
    previous.contentVersion === NEWS_CONTENT_VERSION &&
    previous.competitionArticles !== undefined &&
    Date.parse(previous.fetchedAt) <= now &&
    now - Date.parse(previous.fetchedAt) < 6 * 3_600_000;
  if (fresh) return;
  const all: FootballArticle[] = [];
  const competitionArticles: FootballNews["competitionArticles"] = {};
  // A failed/empty response never replaces the last good feed. Fixed provider URLs only.
  for (const code of COMPETITION_CODES) {
    try {
      const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${COMPETITIONS[code].espn}/news`;
      for (const suffix of ["?limit=8&lang=es&region=es", ""]) {
        const response = await request(base + suffix, {
          signal: AbortSignal.timeout(15_000),
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          log(
            `Noticias ESPN ${code}: HTTP ${response.status}; se conserva la edición anterior.`,
          );
          return [403, 429].includes(response.status) ? false : undefined;
        }
        const body = await response.text();
        if (body.length > 1_000_000) throw new Error("size");
        const articles = normalizeNews(JSON.parse(body), code, now, log);
        if (articles.length)
          competitionArticles[code] = [
            ...new Map(articles.map((a) => [a.url, a])).values(),
          ]
            .sort(
              (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
            )
            .slice(0, 6);
        all.push(...articles);
        if (articles.length) break;
        if (suffix)
          log(
            `Noticias ESPN ${code}: se comprueba la edición sin parámetros de idioma.`,
          );
      }
    } catch {
      log(
        "Noticias ESPN: proveedor no disponible; se conserva la edición anterior.",
      );
      return;
    }
  }
  const unique = [...new Map(all.map((a) => [a.url, a])).values()]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 6);
  if (!unique.length) {
    log(
      "Noticias ESPN: sin titulares recientes; se conserva la edición anterior.",
    );
    return;
  }
  const news: FootballNews = {
    version: 1,
    provider: "ESPN",
    linkPolicyVersion: 2,
    contentVersion: NEWS_CONTENT_VERSION,
    fetchedAt: new Date(now).toISOString(),
    articles: unique,
    competitionArticles,
  };
  await ref.set(news);
  log(`Noticias ESPN: ${unique.length} titulares guardados en un documento.`);
}
