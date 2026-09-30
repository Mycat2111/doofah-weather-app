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
  /**
   * The OSRM server; FOSSGIS's public car router when left out. Null when the
   * site has none it may use (FOSSGIS's needs the operator's address shown):
   * every trip then fails with "unavailable".
   */
  osrmUrl?: string | null;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/** FOSSGIS allows one request a second; a little more, to be safe. */
const MIN_GAP_MS = 1100;
/** A route that takes longer than this has failed. */
const TIMEOUT_MS = 15_000;
/** Routes kept in memory, so another departure time or a swap back asks nothing new. */
const CACHED_ROUTES = 20;

/** A trip's route, asked for once and shared by everyone who wants it. */
interface Download {
  shape: Promise<RouteShape>;
  /** How many are waiting for it; when none are left by its turn, the router is never asked. */
  wanted: number;
}

const cache = new Map<string, Download>();
/** The downloads waiting for their turn with the router, one after another. */
let queue: Promise<unknown> = Promise.resolve();
let lastRequest = -Infinity;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for this page's next turn with the router, at least MIN_GAP_MS after
 * its last request. A download nobody is `wanted` for any more gives up its
 * turn (and throws) instead of spending it.
 */
function turn(wanted: () => boolean): Promise<void> {
  const mine = queue.then(async () => {
    const abandoned = () => new RouteError("failed", "Nobody wants this route any more");
    if (!wanted()) throw abandoned();
    const wait = lastRequest + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    if (!wanted()) throw abandoned();
    lastRequest = Date.now();
  });
  queue = mine.catch(() => undefined);
  return mine;
}

function download(url: string, fetcher: typeof fetch): Download {
  const entry: Download = {
    wanted: 0,
    shape: turn(() => entry.wanted > 0).then(() => fetchRoute(url, fetcher)),
  };
  return entry;
}

async function fetchRoute(url: string, fetcher: typeof fetch): Promise<RouteShape> {
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
  if (!osrmUrl) throw new RouteError("unavailable", "No route planner set up for this site");
  const url = osrmRouteUrl(osrmUrl, request.origin, request.destination);
  let trip = cache.get(url);
  if (!trip) {
    // Shared by everyone asking for this trip, so it is never cut short by one of them giving up.
    const entry = download(url, fetcher);
    cache.set(url, entry);
    // Only routes are kept: after a failure the trip is asked again next time.
    entry.shape.catch(() => {
      if (cache.get(url) === entry) cache.delete(url);
    });
    while (cache.size > CACHED_ROUTES) cache.delete(cache.keys().next().value!);
    trip = entry;
  }
  trip.wanted++;
  try {
    return atDeparture(await unlessAborted(trip.shape, signal), request.departure);
  } finally {
    trip.wanted--;
  }
}

/** Forgets the routes kept in memory, and the router's last request (for tests). */
export function clearRouteCache() {
  cache.clear();
  queue = Promise.resolve();
  lastRequest = -Infinity;
}
