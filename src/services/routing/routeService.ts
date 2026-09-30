import {
  atDeparture,
  checkTrip,
  FOSSGIS_OSRM_URL,
  osrmRouteUrl,
  routeFromOsrm,
  type OsrmResponse,
  type RouteShape,
} from "./osrm";
import { RouteError, type Route, type RouteRequest } from "./types";

export * from "./types";

export interface RouteOptions {
  /** The OSRM server; FOSSGIS's public car router unless the page was given another. */
  osrmUrl?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/** FOSSGIS allows one request a second; a little more, to be safe. */
const MIN_GAP_MS = 1100;
/** A route that takes longer than this has failed. */
const TIMEOUT_MS = 15_000;
/** Routes kept in memory, so another departure time or a swap back asks nothing new. */
const CACHED_ROUTES = 20;

const cache = new Map<string, Promise<RouteShape>>();
let nextSlot = 0;

/** Waits for this page's next free slot with the router. */
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
}

async function download(url: string, fetcher: typeof fetch): Promise<RouteShape> {
  await slot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetcher(url, { signal: controller.signal });
    } catch (error) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      throw new RouteError(offline ? "offline" : "failed", String(error));
    }
    // OSRM answers a trip it cannot route with HTTP 400 and its own code (NoRoute, NoSegment).
    const body = (await response.json().catch(() => null)) as OsrmResponse | null;
    if (!body?.code) throw new RouteError("failed", `The router answered ${response.status}`);
    return routeFromOsrm(body);
  } finally {
    clearTimeout(timer);
  }
}

/** `promise`, or the abort if `signal` fires first. */
function unlessAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * A driving route between two points along real roads, from OSRM (see
 * osrm.ts). The same trip is asked for once per page, whatever the departure
 * time, and never more than once a second.
 */
export async function getRoute(request: RouteRequest, options: RouteOptions = {}): Promise<Route> {
  checkTrip(request);
  const { osrmUrl = FOSSGIS_OSRM_URL, signal, fetch: fetcher = (input, init) => fetch(input, init) } = options;
  const url = osrmRouteUrl(osrmUrl, request.origin, request.destination);
  let shape = cache.get(url);
  if (!shape) {
    // Shared by everyone asking for this trip, so it is never cut short by one of them giving up.
    shape = download(url, fetcher);
    cache.set(url, shape);
    // Only routes are kept: after a failure the trip is asked again next time.
    shape.catch(() => cache.delete(url));
    while (cache.size > CACHED_ROUTES) cache.delete(cache.keys().next().value!);
  }
  return atDeparture(await unlessAborted(shape, signal), request.departure);
}

/** Forgets the routes kept in memory (for tests). */
export function clearRouteCache() {
  cache.clear();
  nextSlot = 0;
}
