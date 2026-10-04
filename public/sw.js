/*
 * DooFah service worker.
 *
 * Once the page and its scripts are cached the app opens offline, showing the
 * last forecast saved on the device (see ForecastService). This worker keeps:
 * - the page itself, network first, so it opens with no connection;
 * - Next.js build files (/_next/static), which never change once built;
 * - icons and the manifest;
 * - map tiles you have already looked at, so the radar map has a base map offline.
 *
 * It also shows storm alerts sent by Web Push (see "Storm alerts" below), even
 * when DooFah is closed.
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

/* ------------------------------------------------------------------ */
/* Storm alerts (Web Push)                                             */
/* ------------------------------------------------------------------ */

// Each push is a small JSON message already in the reader's language:
// { title, body, tag, level, lang, url }. `tag` is per storm, so a newer alert
// about the same storm replaces the one on screen instead of adding another.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON (DevTools' test push sends text). Still show it: browsers expect a notification for every push.
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "DooFah", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      // Android's status bar icon: white on transparent (`npm run icons`).
      badge: "/icons/badge-96.png",
      tag: data.tag || "doofah",
      // Buzz again when a storm's notification is replaced by a newer one.
      renotify: Boolean(data.tag),
      // Desktop Chrome keeps severe alerts on screen until they are dismissed.
      requireInteraction: data.level === "severe",
      lang: data.lang || "",
      data: { url: data.url || "/" },
    }),
  );
});

// A tap brings DooFah forward (or opens it) on the storm the alert was about.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  // Only DooFah's own pages, whatever the message says.
  const target = url.origin === self.location.origin ? url.href : self.location.origin + "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        // Only a page this worker controls can be sent somewhere else; otherwise it just comes forward.
        await open.navigate(target).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// Firefox renews subscriptions and says so here; Chrome and Safari don't fire
// this, so the page also checks its subscription each time DooFah opens.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const fresh = event.newSubscription || (old && (await self.registration.pushManager.subscribe(old.options)));
      if (!fresh) return;
      await fetch("/api/push/subscribe", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldEndpoint: old ? old.endpoint : null, subscription: fresh.toJSON() }),
      });
    })(),
  );
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
