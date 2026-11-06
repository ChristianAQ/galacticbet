import { validNews, type FootballNews } from "./footballNews";
import { createMemoryCache } from "./memoryCache";
const TTL = 3_600_000;
const EMPTY_TTL = 120_000;
export function createNewsLoader(
  project: string,
  storage: () => Pick<Storage, "getItem" | "setItem">,
  fetchNews: () => Promise<unknown>,
) {
  const cache = createMemoryCache(1);
  const key = `galacticbet:news:v5:${project}`;
  return () =>
    cache.read<FootballNews | null>(
      key,
      async () => {
        try {
          const raw = storage().getItem(key);
          if (raw && raw.length <= 64000) {
            const saved = JSON.parse(raw);
            if (
              typeof saved.at === "number" &&
              saved.at <= Date.now() &&
              Date.now() - saved.at < (saved.news === null ? EMPTY_TTL : TTL) &&
              (saved.news === null || validNews(saved.news))
            )
              return saved.news;
          }
        } catch {
          /* Storage is optional. */
        }
        const value = await fetchNews();
        const news = validNews(value) ? value : null;
        try {
          storage().setItem(key, JSON.stringify({ at: Date.now(), news }));
        } catch {
          /* Memory cache still works. */
        }
        return news;
      },
      EMPTY_TTL,
    );
}
