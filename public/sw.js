/*
 * DooFah service worker.
 *
 * The forecast model runs in the browser, so once the page and its scripts
 * are cached the whole app works offline. This worker keeps:
 * - the page itself, network first, so it opens with no connection;
 * - Next.js build files (/_next/static), which never change once built;
 * - icons and the manifest;
 * - map tiles you have already looked at, so the radar map has a base map offline.
 *
 * Bump VERSION to drop every cached page and icon on the next visit.
 */
const VERSION = "1";
const PAGES = `doofah-pages-v${VERSION}`;
const ASSETS = "doofah-assets";
const TILES = "doofah-tiles";
const KEEP = [PAGES, ASSETS, TILES];

// Build files from about three deploys; oldest are dropped first.
const MAX_ASSETS = 160;
// About three screens of map at a few zoom levels.
const MAX_TILES = 400;
// On a very slow connection, open the saved page instead of waiting.
const NAVIGATION_TIMEOUT_MS = 3500;

const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("doofah-") && !KEEP.includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "cache-assets" && Array.isArray(data.urls)) {
    // Files the page loaded before this worker was in charge.
    event.waitUntil(cacheAssets(data.urls));
  } else if (data.type === "refresh-page") {
    // The language changed: save the page as it is now rendered.
    event.waitUntil(refreshPage());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(page(event));
  } else if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, ASSETS, MAX_ASSETS));
  } else if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest")
  ) {
    event.respondWith(staleWhileRevalidate(event, PAGES));
  } else if (url.hostname.endsWith("tile.openstreetmap.org")) {
    event.respondWith(staleWhileRevalidate(event, TILES, MAX_TILES));
  }
});

/** Network first, falling back to the saved page when offline or very slow. */
async function page(event) {
  const cache = await caches.open(PAGES);
  const saved = await cache.match(event.request, { ignoreSearch: true }).then((hit) => hit || cache.match("/"));
  const network = fetch(event.request).then((response) => {
    if (response.ok && new URL(event.request.url).pathname === "/") {
      event.waitUntil(cache.put("/", response.clone()));
    }
    return response;
  });
  if (!saved) return network;
  event.waitUntil(network.catch(() => undefined));
  // A server error also falls back to the saved page; a 404 is passed through.
  const fresh = network.then((response) => (response.status >= 500 ? saved : response));
  const timeout = new Promise((resolve) => setTimeout(() => resolve(saved), NAVIGATION_TIMEOUT_MS));
  return Promise.race([fresh, timeout]).catch(() => saved);
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache, maxEntries);
  }
  return response;
}

/** Answer from the cache at once when possible, and refresh it in the background. */
async function staleWhileRevalidate(event, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  const network = fetch(event.request).then(async (response) => {
    // Opaque (no-CORS) responses are skipped: browsers count each as megabytes of quota.
    if (response.ok && response.type !== "opaque") {
      await cache.put(event.request, response.clone());
      if (maxEntries) await trim(cache, maxEntries);
    }
    return response;
  });
  if (hit) {
    event.waitUntil(network.catch(() => undefined));
    return hit;
  }
  return network;
}

async function cacheAssets(urls) {
  const cache = await caches.open(ASSETS);
  const wanted = urls.filter((u) => {
    try {
      const url = new URL(u, self.location.origin);
      return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
    } catch {
      return false;
    }
  });
  await Promise.allSettled(wanted.map(async (u) => (await cache.match(u)) || cache.add(u)));
  await trim(cache, MAX_ASSETS);
}

async function refreshPage() {
  const response = await fetch("/", { credentials: "same-origin" });
  if (response.ok) await (await caches.open(PAGES)).put("/", response);
}

/** Drop the oldest entries (caches list keys in insertion order). */
async function trim(cache, maxEntries) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
}
