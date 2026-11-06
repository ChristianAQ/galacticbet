import { isCompetition, type CompetitionCode } from "./competitions";
export interface FootballArticle {
  title: string;
  description?: string;
  url: string;
  publishedAt: string;
  competition: CompetitionCode;
}
export interface FootballNews {
  version: 1;
  provider: "ESPN";
  linkPolicyVersion?: number;
  contentVersion?: number;
  fetchedAt: string;
  articles: FootballArticle[];
  competitionArticles?: Partial<Record<CompetitionCode, FootballArticle[]>>;
}
export const NEWS_MAX_AGE = 7 * 24 * 3_600_000;
const ESPN_NEWS_DOMAINS = [
  "espn.com",
  "espn.com.mx",
  "espn.com.ar",
  "espn.com.co",
  "espn.cl",
  "espn.com.pe",
  "espn.com.ec",
  "espn.com.uy",
  "espn.com.ve",
  "espn.es",
];
export function newsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1200) return null;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !ESPN_NEWS_DOMAINS.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    )
      return null;
    url.protocol = "https:";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
export function validNews(value: unknown): value is FootballNews {
  if (!value || typeof value !== "object") return false;
  const n = value as FootballNews;
  return (
    n.version === 1 &&
    n.provider === "ESPN" &&
    typeof n.fetchedAt === "string" &&
    Number.isFinite(Date.parse(n.fetchedAt)) &&
    Array.isArray(n.articles) &&
    n.articles.length <= 6 &&
    (n.competitionArticles === undefined ||
      (typeof n.competitionArticles === "object" &&
        n.competitionArticles !== null &&
        !Array.isArray(n.competitionArticles) &&
        Object.entries(n.competitionArticles).every(
          ([code, articles]) =>
            isCompetition(code) &&
            Array.isArray(articles) &&
            articles.length <= 6 &&
            articles.every((a) => a?.competition === code) &&
            validNews({ ...n, articles, competitionArticles: undefined }),
        ))) &&
    n.articles.every(
      (a) =>
        a &&
        typeof a.title === "string" &&
        a.title.trim().length > 0 &&
        a.title.length <= 240 &&
        (a.description === undefined ||
          (typeof a.description === "string" && a.description.length <= 240)) &&
        newsUrl(a.url) !== null &&
        typeof a.publishedAt === "string" &&
        Number.isFinite(Date.parse(a.publishedAt)) &&
        isCompetition(a.competition),
    )
  );
}
export function currentArticles(
  news: FootballNews,
  now = Date.now(),
  competition?: string,
  seasonId?: string,
) {
  const year = seasonId ? Number(seasonId.split("-")[1]) : null;
  const articles =
    competition && isCompetition(competition)
      ? (news.competitionArticles?.[competition] ??
        news.articles.filter((a) => a.competition === competition))
      : news.articles;
  return articles
    .filter(
      (a) =>
        Date.parse(a.publishedAt) <= now &&
        now - Date.parse(a.publishedAt) <= NEWS_MAX_AGE &&
        (!seasonId ||
          (seasonId.split("-")[0] === competition &&
            year !== null &&
            Date.parse(a.publishedAt) >= Date.UTC(year, 6, 1) &&
            Date.parse(a.publishedAt) < Date.UTC(year + 1, 6, 1))),
    )
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
