/**
 * Service worker registration for the installable app (see public/sw.js).
 * Production only: in development a worker would serve stale files.
 */
export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  if (process.env.NODE_ENV !== "production") {
    // Remove a worker left behind by a production run on the same address.
    navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((r) => r.unregister()));
    return;
  }

  navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      // The page's own scripts, styles and fonts loaded before the worker
      // existed; hand their addresses over so the first offline launch works.
      const urls = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.startsWith(`${location.origin}/_next/static/`));
      registration.active?.postMessage({ type: "cache-assets", urls });
    })
    .catch(() => {
      // Not fatal: the app works the same online without a worker.
    });
}

/** Save the page again after something the server renders (the language) changed. */
export function refreshOfflinePage() {
  if (typeof navigator === "undefined") return;
  navigator.serviceWorker?.controller?.postMessage({ type: "refresh-page" });
}
