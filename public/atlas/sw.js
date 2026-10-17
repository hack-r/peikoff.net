// Service worker for the Atlas of Objectivism (installable web app). Plain script, no build step.
//
// It is registered as ./sw.js, so its scope follows the page: /atlas/ on peikoff.net, / on atlas.peikoff.net (where the Worker serves /atlas/ at the root).
// Every address below is resolved against this file's own location, so the same file works on both hosts.
//
// What it does:
//   page (navigations)            network first (5 s), then the saved copy of the app, then offline.html
//   app shell (html, js, icons)   saved at install; network first (5 s) so a new deploy shows up on the next load, the saved copy when offline
//   vendor/ (three.js)            saved at install; cache first (these files only change with a version bump below)
//   data/ (whoneedsit.json)       network first, saved copy when offline
//   models/, audio/tracks.json    stale-while-revalidate in a cache that survives updates (the 11 MB of models are not re-downloaded on every release)
// What it never touches: anything that is not a same-origin GET, anything under /api/, /version.json, Range requests (audio/video seeking),
// and everything outside its scope (/privacy, /terms and the other pages of the site). Sign-in cookies, Google / GitHub sign-in redirects,
// Stripe Checkout and the billing portal all go through /api/ or leave the origin, so they never see this worker.
//
// Update strategy: bump VERSION when the SHELL list or the vendor files change. The new worker installs in the background, takes over at once
// (skipWaiting + clients.claim: safe, because the shell is fetched network first, so there is no mixed old/new page) and deletes old shell caches.

const VERSION = "2026-10-17.1";
const SHELL_CACHE = `atlas-shell-${VERSION}`;
const MODELS_CACHE = "atlas-models-v1";
const DATA_CACHE = "atlas-data-v1";
const KEEP = new Set([SHELL_CACHE, MODELS_CACHE, DATA_CACHE]);
const NETWORK_TIMEOUT_MS = 5000;

const SHELL = [
  "./", "offline.html", "site.webmanifest",
  "main.js", "bridges.js", "chat.js", "crowd.js", "elevator.js", "figures.js", "floors.js", "focus.js", "haul.js", "kira-face.js",
  "minimap.js", "models.js", "music.js", "names.js", "paths.js", "perf.js", "pwa.js", "search.js",
  "vendor/three.module.js", "vendor/GLTFLoader.js", "vendor/OrbitControls.js", "vendor/BufferGeometryUtils.js",
  "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png", "apple-touch-icon.png", "favicon.svg", "favicon-32.png",
  "data/whoneedsit.json",
];

const here = new URL("./", self.location.href);                       // the directory this worker lives in: /atlas/ or /
const abs = (rel) => new URL(rel, here).href;
const SHELL_URLS = new Set(SHELL.map(abs));

/** What kind of request this is: "page", "shell", "vendor", "data", "media", or null (not ours: let the browser handle it). */
function classify(request) {
  if (request.method !== "GET" || request.headers.get("range")) return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;
  if (url.pathname.startsWith("/api/") || url.pathname === "/version.json") return null;
  if (!url.pathname.startsWith(here.pathname)) return null;
  const rel = url.pathname.slice(here.pathname.length);
  if (request.mode === "navigate") return rel === "" || rel === "index.html" ? "page" : null;
  if (rel.startsWith("api/")) return null;
  if (rel.startsWith("vendor/")) return "vendor";
  if (rel.startsWith("data/")) return "data";
  if (rel.startsWith("models/") || rel === "audio/tracks.json") return "media";
  if (SHELL_URLS.has(url.origin + url.pathname)) return "shell";
  return null;
}

const cacheable = (res) => res && res.status === 200 && res.type === "basic" && !res.redirected;
const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

async function put(cacheName, key, res) {
  try { if (cacheable(res)) await (await caches.open(cacheName)).put(key, res.clone()); } catch (e) { /* storage full: the network copy still works */ }
  return res;
}

/** Network first with a time limit; the saved copy answers when the network fails or is too slow. The network request still finishes and refreshes the copy. */
async function networkFirst(event, request, cacheName, key) {
  const net = fetch(request).then((res) => put(cacheName, key, res));
  event.waitUntil(net.catch(() => {}));
  try { return await Promise.race([net, timeout(NETWORK_TIMEOUT_MS)]); }
  catch (e) { const hit = await caches.match(key, { ignoreSearch: false }); if (hit) return hit; return net; }
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName), hit = await cache.match(request);
  const net = fetch(request).then((res) => put(cacheName, request, res));
  if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName), hit = await cache.match(request);
  return hit || put(cacheName, request, await fetch(request));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map(async (rel) => { const res = await fetch(abs(rel), { cache: "reload" }); if (!res.ok) throw new Error(`${rel}: ${res.status}`); await cache.put(abs(rel), res); }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("atlas-") && !KEEP.has(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request, kind = classify(request);
  if (!kind) return;                                                  // not ours: no respondWith, the browser goes straight to the network
  if (kind === "page") {
    event.respondWith((async () => {
      try {
        const net = fetch(request).then((res) => put(SHELL_CACHE, abs("./"), res));   // ?billing=success and the like are the same page: one saved copy
        event.waitUntil(net.catch(() => {}));
        return await Promise.race([net, timeout(NETWORK_TIMEOUT_MS)]);
      } catch (e) {
        return (await caches.match(abs("./"))) || (await caches.match(abs("offline.html"))) || Response.error();
      }
    })());
  } else if (kind === "shell") event.respondWith(networkFirst(event, request, SHELL_CACHE, request.url));
  else if (kind === "data") event.respondWith(networkFirst(event, request, DATA_CACHE, request.url));
  else if (kind === "vendor") event.respondWith(cacheFirst(request, SHELL_CACHE));
  else event.respondWith(staleWhileRevalidate(event, request, MODELS_CACHE));
});

// The first visit loads the models before this worker controls the page, so they were not saved. The page then lists what it loaded
// (performance entries) and the worker saves those it recognises. They come from the browser's own cache, so this costs no second download.
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "save-loaded" || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    for (const u of event.data.urls.slice(0, 200)) {
      let request; try { request = new Request(new URL(u, self.location.href).href); } catch (e) { continue; }
      const kind = classify(request); if (kind !== "media" && kind !== "data") continue;
      const name = kind === "media" ? MODELS_CACHE : DATA_CACHE, cache = await caches.open(name);
      if (await cache.match(request)) continue;
      try { await put(name, request, await fetch(request)); } catch (e) { /* offline or gone: skip it */ }
    }
  })());
});

if (typeof self.__swTest === "object") Object.assign(self.__swTest, { classify, SHELL, VERSION, here });   // lets test/pwa.test.js look inside
