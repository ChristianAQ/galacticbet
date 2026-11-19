// GalacticBet service worker.
// Private data (Firestore) always goes to the network. Only public files are
// cached: content-hashed assets (cache first) and the app shell, index.html,
// which opens from the cache at once and is refreshed in the background, so a
// launch from the home screen never waits for the network.
// v3/v2: drop copies kept by earlier workers (an old index.html still
// pointed at the 180 px icon, and icons were cached forever).
const STATIC = "galacticbet-static-v3";
const SHELL = "galacticbet-shell-v2";
const MAX_ENTRIES = 120;
const scope = self.registration.scope;
const scopePath = new URL(scope).pathname;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC && key !== SHELL)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);

// Content-hashed build files never change under the same name: cache first.
const isHashed = (url) =>
  url.origin === self.location.origin && url.pathname.startsWith(`${scopePath}assets/`);
// Icons and launch screens keep their names across versions: serve the copy at
// hand and refresh it, so a new icon reaches the device on the next request.
const isArtwork = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith(`${scopePath}splash/`) ||
    /\/icon[\w-]*\.(png|svg)$/.test(url.pathname));

async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((key) => cache.delete(key)));
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request).then(async (response) => {
    if (response.ok && response.type === "basic")
      await cache.put(event.request, response.clone());
    return response;
  });
  if (!hit) return refresh;
  event.waitUntil(refresh.catch(() => {}));
  return hit;
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

const offline = () =>
  new Response(offlinePage, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

const isShell = (url) =>
  url.origin === self.location.origin &&
  (url.pathname === scopePath || url.pathname === `${scopePath}index.html`);

/** Downloads index.html; tells open windows when a new version was stored. */
async function refreshShell(previous) {
  const response = await fetch(scope, { cache: "no-cache", credentials: "same-origin" });
  if (!response.ok || response.redirected || response.type !== "basic") return response;
  const body = await response.clone().text();
  const cache = await caches.open(SHELL);
  await cache.put(scope, response.clone());
  if (previous !== undefined && previous !== body) {
    const windows = await self.clients.matchAll({ type: "window" });
    for (const client of windows) client.postMessage({ type: "galacticbet:update" });
  }
  return response;
}

async function openShell(event) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(scope);
  if (!cached) {
    // First launch with this worker: the network as usual, and keep a copy.
    event.waitUntil(refreshShell().catch(() => {}));
    return fetch(event.request).catch(offline);
  }
  const previous = await cached.clone().text();
  event.waitUntil(refreshShell(previous).catch(() => {}));
  return cached;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    const url = new URL(request.url);
    event.respondWith(isShell(url) ? openShell(event) : fetch(request).catch(offline));
    return;
  }
  const url = new URL(request.url);
  if (isHashed(url)) event.respondWith(cacheFirst(request));
  else if (isArtwork(url)) event.respondWith(staleWhileRevalidate(event));
});
