import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { normalizeNews, newsDescription, syncNews } from "../scripts/syncNews";
import {
  currentArticles,
  newsUrl,
  validNews,
  type FootballNews,
} from "../src/lib/footballNews";
import { createNewsLoader } from "../src/lib/newsCache";
const now = Date.parse("2026-10-28T18:00:00Z");
const article = {
  headline: "Titular de prueba",
  published: "2026-10-28T17:00:00Z",
  links: { web: { href: "https://www.espn.com/soccer/story/_/id/123/test" } },
};
const feed: FootballNews = {
  version: 1,
  provider: "ESPN",
  linkPolicyVersion: 2,
  contentVersion: 1,
  fetchedAt: new Date(now).toISOString(),
  articles: normalizeNews({ articles: [article] }, "PD", now),
};
function database(previous?: unknown) {
  const set = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn().mockResolvedValue({ data: () => previous });
  const doc = vi.fn(() => ({ get, set }));
  return { db: { doc } as unknown as Firestore, set, get };
}
describe("Noticias: fuente, sincronización y caché", () => {
  it("acepta enlaces seguros de ESPN y rechaza esquemas, credenciales y dominios parecidos", () => {
    expect(newsUrl(article.links.web.href)).toBe(article.links.web.href);
    expect(newsUrl("http://www.espn.com/a")).toBe("https://www.espn.com/a");
    for (const url of [
      "javascript:alert(1)",
      "https://espn.com.evil.test/a",
      "https://evil.test/espn.com",
      "https://name:pass@espn.com/a",
      "https://espn.com:444/a",
    ])
      expect(newsUrl(url)).toBeNull();
  });
  it("no muestra titulares futuros, antiguos, sin fecha o malformados", () => {
    const articles = [
      article,
      { ...article, published: "2026-10-01" },
      { ...article, published: "2026-11-01" },
      { ...article, published: null },
      { ...article, headline: "" },
      null,
    ];
    expect(normalizeNews({ articles }, "PL", now)).toHaveLength(1);
    expect(validNews(feed)).toBe(true);
    expect(
      validNews({
        ...feed,
        articles: [{ ...feed.articles[0], competition: "CDR" }],
      }),
    ).toBe(false);
    expect(currentArticles(feed, now + 8 * 86400000)).toHaveLength(0);
  });
  it("consulta una vez cada competición y deduplica en un único documento", async () => {
    const { db, set } = database();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ articles: [article] })));
    // Each fetch gets its own response body.
    request.mockImplementation(
      async () => new Response(JSON.stringify({ articles: [article] })),
    );
    await syncNews(db, { now, request, log: vi.fn() });
    expect(request).toHaveBeenCalledTimes(3);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0].articles).toHaveLength(1);
    expect(validNews(set.mock.calls[0][0])).toBe(true);
  });
  it("respeta seis horas de caché y conserva la edición anterior ante errores o vacío", async () => {
    const { db, set } = database({...feed, competitionArticles: {PD: feed.articles}});
    const request = vi.fn<typeof fetch>();
    await syncNews(db, { now: now + 3600000, request });
    expect(request).not.toHaveBeenCalled();
    request.mockImplementation(async () => new Response("", { status: 429 }));
    await syncNews(db, { now: now + 7 * 3600000, request, log: vi.fn() });
    expect(request).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    request.mockImplementation(async () => new Response('{"articles":[]}'));
    await syncNews(db, { now: now + 7 * 3600000, request, log: vi.fn() });
    expect(set).not.toHaveBeenCalled();
  });
  it("deduplica lecturas concurrentes y reutiliza la caché tras recargar", async () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => {
        entries.set(k, v);
      },
    };
    const fetch = vi.fn().mockResolvedValue(feed);
    const load = createNewsLoader("test", () => storage, fetch);
    await Promise.all([load(), load(), load()]);
    await createNewsLoader("test", () => storage, fetch)();
    expect(fetch).toHaveBeenCalledTimes(1);
    await createNewsLoader("other-project", () => storage, fetch)();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("permite reintentar un fallo y funciona con almacenamiento bloqueado", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(null);
    const load = createNewsLoader(
      "test",
      () => {
        throw new Error("blocked");
      },
      fetch,
    );
    await expect(load()).rejects.toThrow("offline");
    expect(await load()).toBeNull();
    expect(await load()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

it("recupera la edición por defecto y convierte enlaces HTTP de ESPN a HTTPS", async () => {
  const { db, set } = database();
  const request = vi.fn<typeof fetch>().mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify({
          articles: String(url).includes("lang=es")
            ? []
            : [
                {
                  ...article,
                  links: {
                    web: {
                      href: "http://www.espn.com/soccer/story/_/id/123/test",
                    },
                  },
                },
              ],
        }),
      ),
  );
  await syncNews(db, { now, request, log: vi.fn() });
  expect(request).toHaveBeenCalledTimes(6);
  expect(set.mock.calls[0][0].articles).toHaveLength(1);
  expect(set.mock.calls[0][0].articles[0].url).toBe(article.links.web.href);
});

it("acepta las ediciones regionales españolas sin aceptar dominios parecidos", () => {
  for (const domain of ["espn.com.ar", "espn.com.co", "espn.cl", "espn.es"]) {
    expect(newsUrl(`http://www.${domain}/futbol/nota/_/id/123`)).toBe(
      `https://www.${domain}/futbol/nota/_/id/123`,
    );
    expect(newsUrl(`https://www.${domain}.evil.test/noticia`)).toBeNull();
  }
});
it("prioriza la edición española y renueva una edición guardada con el filtro anterior", async () => {
  const { db, set } = database({ ...feed, linkPolicyVersion: undefined });
  const request = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          articles: [
            {
              ...article,
              links: {
                web: { href: "https://www.espn.com.ar/futbol/nota/_/id/123" },
              },
            },
          ],
        }),
      ),
  );
  await syncNews(db, { now, request, log: vi.fn() });
  expect(request).toHaveBeenCalledTimes(3);
  expect(
    request.mock.calls.every(([url]) => String(url).includes("lang=es")),
  ).toBe(true);
  expect(set.mock.calls[0][0].linkPolicyVersion).toBe(2);
});

it("conserva descripciones breves como texto y omite las ausentes o repetidas", () => {
  expect(
    newsDescription(
      "<p>Un <b>resumen</b> &amp; contexto.</p>",
      article.headline,
    ),
  ).toBe("Un resumen & contexto.");
  expect(newsDescription(article.headline, article.headline)).toBeUndefined();
  expect(newsDescription(null, article.headline)).toBeUndefined();
  expect(
    newsDescription("<script>alert(1)</script>", article.headline),
  ).toBeUndefined();
  expect(
    newsDescription("Una noticia extensa ".repeat(30), article.headline)
      ?.length,
  ).toBeLessThanOrEqual(240);
  const articles = normalizeNews(
    { articles: [{ ...article, description: "Resumen de ESPN" }] },
    "PD",
    now,
  );
  expect(articles[0].description).toBe("Resumen de ESPN");
  expect(validNews({ ...feed, articles })).toBe(true);
  expect(
    validNews({ ...feed, articles: [{ ...articles[0], description: 123 }] }),
  ).toBe(false);
});
it("renueva una edición sin descripciones aunque todavía esté en caché", async () => {
  const { db, set } = database({ ...feed, contentVersion: undefined });
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            articles: [{ ...article, description: "Resumen de ESPN" }],
          }),
        ),
    );
  await syncNews(db, { now, request, log: vi.fn() });
  expect(request).toHaveBeenCalledTimes(3);
  expect(set.mock.calls[0][0].articles[0].description).toBe("Resumen de ESPN");
  expect(set.mock.calls[0][0].contentVersion).toBe(1);
});
