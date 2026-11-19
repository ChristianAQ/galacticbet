// GalacticBet service worker.
// Private data (Firestore) always goes to the network. Only public, content-hashed
// static files are cached, so launches from the home screen are instant.
const STATIC = "galacticbet-static-v2";
const MAX_ENTRIES = 90;
const scopePath = new URL(self.registration.scope).pathname;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  ),
);

const isStatic = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith(`${scopePath}assets/`) ||
    url.pathname.startsWith(`${scopePath}splash/`) ||
    /\/icon[\w-]*\.(png|svg)$/.test(url.pathname));

async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((key) => cache.delete(key)));
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    void trim(cache);
  }
  return response;
}

const offlinePage = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#15140f"><title>Sin conexión · GalacticBet</title>
<style>html,body{margin:0;height:100%;background:#15140f;color:#f2efe6;font:16px/1.45 system-ui,sans-serif}
main{min-height:100%;display:grid;place-content:center;gap:14px;padding:32px;text-align:center}
b{display:inline-grid;place-items:center;width:64px;height:64px;margin:0 auto;border-radius:16px;background:#ffd100;color:#15140f;font-size:34px;font-weight:900}
h1{margin:0;font-size:30px;line-height:1.05}p{margin:0;color:#a8a396}
button{justify-self:center;min-height:48px;padding:0 22px;border:0;border-radius:12px;background:#ffd100;color:#15140f;font:inherit;font-weight:700}</style>
</head><body><main><b aria-hidden="true">×</b><h1>Sin cobertura en la grada</h1>
<p>Conéctate para consultar tus quinielas de GalacticBet.</p>
<button onclick="location.reload()">Reintentar</button></main></body></html>`;

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(offlinePage, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
      ),
    );
    return;
  }
  const url = new URL(request.url);
  if (isStatic(url)) event.respondWith(cacheFirst(request));
});
