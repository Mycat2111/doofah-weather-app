/**
 * Server side of /api/weathernext: the next 6 hours of rain from Google
 * DeepMind's WeatherNext 3 in BigQuery, for DooFah's owner only, with
 * Open-Meteo whenever WeatherNext 3 can't answer.
 *
 * Why the owner only: WeatherNext 3's forecasts come under Google's
 * Real-Time Experimental Data terms, which allow internal use but not showing
 * them to the public, and every query is billed to the owner's Google Cloud
 * project. So the route only asks BigQuery for a browser carrying the owner's
 * cookie (set once at /api/weathernext/access?token=…), never lets Vercel's
 * CDN keep those answers, and gives everyone else Open-Meteo.
 *
 * Cost: BigQuery bills the bytes a query scans. Each query is estimated first
 * with a free dry run and refused above WEATHERNEXT_MAX_GB, BigQuery is also
 * told to refuse anything bigger (maximumBytesBilled), answers are kept until
 * the next hour, and each server runs at most QUERIES_PER_HOUR queries.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { CUSTOMER_URL, FREE_URL } from "../openmeteo/api";
import {
  cellKey,
  floorHour,
  hoursFromOpenMeteo,
  hoursFromWeatherNext,
  inThailand,
  NOWCAST_HOURS,
  snapToCell,
  type FallbackReason,
  type Nowcast,
  type OpenMeteoNowcastReply,
  type WeatherNextRow,
} from "./nowcast";

export type Env = Record<string, string | undefined>;

/** The owner's cookie: a hash of WEATHERNEXT_OWNER_TOKEN, never the token itself. */
export const OWNER_COOKIE = "doofah-wn";
/** WeatherNext 3's 0.1° table, as named in the BigQuery listing. */
export const WEATHERNEXT_TABLE = "weathernext_3_0_0_0p1deg";
/** The rain columns WeatherNext 3 has; the first is the one Google's own examples use. */
export const RAIN_VARIABLES = ["total_precipitation_1hr", "imerg_tp_1hr", "experimental_tp_1hr"] as const;
export type RainVariable = (typeof RAIN_VARIABLES)[number];

/** Most a query may scan unless WEATHERNEXT_MAX_GB says otherwise, GB. */
export const DEFAULT_MAX_GB = 1;
/** Shortest owner token accepted. */
export const MIN_TOKEN_LENGTH = 24;
/** How far back to look for the newest WeatherNext 3 run, hours (a run is started every hour). */
export const LOOKBACK_HOURS = 6;
/** Real queries one request may run (an empty run is skipped for the one before it). */
export const MAX_ATTEMPTS = 2;
/** Real queries one server instance runs in an hour, at most. */
export const QUERIES_PER_HOUR = 30;
/** How far from the point a grid cell's centre may be, metres (a 0.1° cell is about 11 km across). */
export const SEARCH_RADIUS_M = 8_000;

const HOUR_MS = 3_600_000;
const GB = 1_000_000_000;
const OPEN_METEO_TIMEOUT_MS = 10_000;
/** How long the server keeps an Open-Meteo fallback. */
const FALLBACK_MS = 10 * 60_000;
/** Cells kept in memory, at most. */
const MAX_CACHED = 300;
/** Wrong tokens one address may try in 10 minutes. */
const ACCESS_TRIES = 10;
const ACCESS_WINDOW_MS = 10 * 60_000;
const YEAR_S = 365 * 24 * 3600;

const PUBLIC_CACHE = "public, s-maxage=3600, stale-while-revalidate=600";
const OWNER_FALLBACK_CACHE = "private, max-age=300";

// ---------------------------------------------------------------------------
// Settings

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/**
 * The service account key from GCP_SERVICE_ACCOUNT_KEY: the JSON file's
 * contents as they are, or base64-encoded. Null when it isn't a service
 * account key.
 */
export function parseServiceAccountKey(raw: string | undefined): ServiceAccountKey | null {
  const text = raw?.trim();
  if (!text) return null;
  const attempts = [text];
  if (!text.startsWith("{")) {
    try {
      attempts.push(Buffer.from(text, "base64").toString("utf8").trim());
    } catch {
      // Not base64 either.
    }
  }
  for (const attempt of attempts) {
    try {
      const key = JSON.parse(attempt) as Partial<ServiceAccountKey> & { type?: string };
      if (key.type !== "service_account" || typeof key.client_email !== "string") continue;
      if (typeof key.private_key !== "string") continue;
      // Pasted keys sometimes arrive with their line breaks as the two characters \n.
      const privateKey = key.private_key.replace(/\\n/g, "\n");
      if (!privateKey.includes("PRIVATE KEY")) continue;
      return {
        client_email: key.client_email,
        private_key: privateKey,
        project_id: typeof key.project_id === "string" ? key.project_id : undefined,
      };
    } catch {
      // Try the next reading.
    }
  }
  return null;
}

export interface WeatherNextConfig {
  /** The Google Cloud project queries run (and are billed) in. */
  projectId: string;
  /** `project.dataset.weathernext_3_0_0_0p1deg`. */
  table: string;
  credentials: ServiceAccountKey;
  rainVariable: RainVariable;
  maxBytes: number;
  /** The dataset's BigQuery location, if set (BigQuery otherwise works it out). */
  location?: string;
}

export type ConfigResult = { ok: true; config: WeatherNextConfig } | { ok: false; problem: string };

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATASET_ID = /^[A-Za-z0-9_]{1,1024}$/;
const LOCATION = /^[A-Za-z0-9-]{2,40}$/;

/**
 * The WeatherNext 3 settings from the environment, or what is wrong with
 * them (naming variables, never their values).
 */
export function readConfig(env: Env): ConfigResult {
  const key = parseServiceAccountKey(env.GCP_SERVICE_ACCOUNT_KEY);
  if (!env.GCP_SERVICE_ACCOUNT_KEY?.trim()) return { ok: false, problem: "GCP_SERVICE_ACCOUNT_KEY is not set" };
  if (!key) return { ok: false, problem: "GCP_SERVICE_ACCOUNT_KEY is not a service account JSON key" };
  const projectId = env.GCP_PROJECT_ID?.trim() || key.project_id || "";
  if (!projectId) return { ok: false, problem: "GCP_PROJECT_ID is not set" };
  if (!PROJECT_ID.test(projectId)) return { ok: false, problem: "GCP_PROJECT_ID is not a Google Cloud project ID" };
  // The dataset the WeatherNext listing was linked as: `dataset`, or `project.dataset` when it lives elsewhere.
  const dataset = env.GCP_WEATHERNEXT_DATASET?.trim() ?? "";
  if (!dataset) return { ok: false, problem: "GCP_WEATHERNEXT_DATASET is not set" };
  const parts = dataset.split(".");
  const [tableProject, datasetId] = parts.length === 2 ? parts : [projectId, parts[0]];
  if (parts.length > 2 || !PROJECT_ID.test(tableProject) || !DATASET_ID.test(datasetId)) {
    return { ok: false, problem: "GCP_WEATHERNEXT_DATASET must be `dataset` or `project.dataset`" };
  }
  const variable = env.WEATHERNEXT_RAIN_VARIABLE?.trim() || RAIN_VARIABLES[0];
  const rainVariable = RAIN_VARIABLES.find((v) => v === variable);
  if (!rainVariable)
    return { ok: false, problem: `WEATHERNEXT_RAIN_VARIABLE must be one of ${RAIN_VARIABLES.join(", ")}` };
  const gb = env.WEATHERNEXT_MAX_GB?.trim() ? Number(env.WEATHERNEXT_MAX_GB) : DEFAULT_MAX_GB;
  if (!Number.isFinite(gb) || gb <= 0 || gb > 1000)
    return { ok: false, problem: "WEATHERNEXT_MAX_GB must be a number of GB above 0" };
  const location = env.GCP_BIGQUERY_LOCATION?.trim() || undefined;
  if (location && !LOCATION.test(location))
    return { ok: false, problem: "GCP_BIGQUERY_LOCATION is not a BigQuery location" };
  return {
    ok: true,
    config: {
      projectId,
      table: `${tableProject}.${datasetId}.${WEATHERNEXT_TABLE}`,
      credentials: key,
      rainVariable,
      maxBytes: Math.round(gb * GB),
      location,
    },
  };
}

// ---------------------------------------------------------------------------
// The owner

const sha256 = (text: string) => createHash("sha256").update(`doofah-weathernext:${text}`).digest();

/** The owner token from the environment, if it is long enough to be one. */
function ownerToken(env: Env): string | null {
  const token = env.WEATHERNEXT_OWNER_TOKEN?.trim();
  return token && token.length >= MIN_TOKEN_LENGTH ? token : null;
}

/** The value of the owner's cookie for this site. */
export const ownerCookieValue = (token: string) => sha256(token).toString("hex");

/** Whether a cookie value is the owner's (in constant time). */
export function isOwnerCookie(value: string | undefined, env: Env): boolean {
  const token = ownerToken(env);
  if (!token || !value) return false;
  const expected = Buffer.from(ownerCookieValue(token));
  const given = Buffer.from(value);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Whether the page should ask for WeatherNext 3: everything is set up and the visitor is the owner. */
export function isWeatherNextOwner(cookie: string | undefined, env: Env): boolean {
  return isOwnerCookie(cookie, env) && readConfig(env).ok;
}

function cookieFrom(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// BigQuery

export interface WarehouseQuery {
  sql: string;
  params: Record<string, number | Date>;
  types: Record<string, string>;
}

/** What the server needs of BigQuery; tests stand in their own. */
export interface Warehouse {
  /** Bytes the query would scan, from a free dry run. */
  estimateBytes(query: WarehouseQuery): Promise<number>;
  /** The rows, refusing (without charge) to scan more than `maxBytes`. */
  rows(query: WarehouseQuery, maxBytes: number): Promise<Record<string, unknown>[]>;
}

/** The real BigQuery, loaded only when a query is needed. */
export async function bigQueryWarehouse(config: WeatherNextConfig): Promise<Warehouse> {
  const { BigQuery } = await import("@google-cloud/bigquery");
  const client = new BigQuery({
    projectId: config.projectId,
    credentials: { client_email: config.credentials.client_email, private_key: config.credentials.private_key },
  });
  const base = (q: WarehouseQuery) => ({
    query: q.sql,
    params: q.params,
    types: q.types,
    location: config.location,
    useLegacySql: false,
  });
  return {
    async estimateBytes(q) {
      const [job] = await client.createQueryJob({ ...base(q), dryRun: true });
      return Number(job.metadata?.statistics?.totalBytesProcessed ?? 0);
    },
    async rows(q, maxBytes) {
      const [rows] = await client.query({ ...base(q), maximumBytesBilled: String(maxBytes), jobTimeoutMs: 20_000 });
      return rows as Record<string, unknown>[];
    },
  };
}

/**
 * The query for one cell and one run: each forecast hour's rain statistics
 * for the grid cells within SEARCH_RADIUS_M of the point, over the next 6
 * hours. Only the columns used are named, since BigQuery bills by column.
 * The table and column names come from checked settings, never from the request.
 */
export function nowcastQuery(
  config: Pick<WeatherNextConfig, "table" | "rainVariable">,
  cell: { lat: number; lon: number },
  initMs: number,
  now: number,
): WarehouseQuery {
  const v = config.rainVariable;
  const start = floorHour(now);
  const sql = `SELECT
  UNIX_MILLIS(f.time) AS time_ms,
  ST_Y(ST_CENTROID(t.geography)) AS cell_lat,
  ST_X(ST_CENTROID(t.geography)) AS cell_lon,
  ST_DISTANCE(t.geography, ST_GEOGPOINT(@lon, @lat)) AS distance_m,
  f.${v}_mean AS mean_m,
  f.${v}_p10 AS p10_m,
  f.${v}_p25 AS p25_m,
  f.${v}_p50 AS p50_m,
  f.${v}_p75 AS p75_m,
  f.${v}_p90 AS p90_m
FROM \`${config.table}\` AS t, t.forecast AS f
WHERE t.init_time = @init
  AND ST_DWITHIN(t.geography, ST_GEOGPOINT(@lon, @lat), @radius)
  AND f.time > @from
  AND f.time <= @to
ORDER BY distance_m, time_ms
LIMIT 100`;
  return {
    sql,
    params: {
      lat: cell.lat,
      lon: cell.lon,
      radius: SEARCH_RADIUS_M,
      init: new Date(initMs),
      from: new Date(start),
      to: new Date(start + (NOWCAST_HOURS + 1) * HOUR_MS),
    },
    types: { lat: "FLOAT64", lon: "FLOAT64", radius: "FLOAT64", init: "TIMESTAMP", from: "TIMESTAMP", to: "TIMESTAMP" },
  };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The nearest cell's rows, read from BigQuery's answer. */
export function nearestCellRows(
  rows: readonly Record<string, unknown>[],
): { cell: { lat: number; lon: number }; rows: WeatherNextRow[] } | null {
  let best: { lat: number; lon: number; distance: number } | null = null;
  for (const r of rows) {
    const lat = num(r.cell_lat);
    const lon = num(r.cell_lon);
    const distance = num(r.distance_m);
    if (lat === null || lon === null || distance === null) continue;
    if (!best || distance < best.distance) best = { lat, lon, distance };
  }
  if (!best) return null;
  const mine = rows.filter((r) => num(r.cell_lat) === best.lat && num(r.cell_lon) === best.lon);
  return {
    cell: { lat: Math.round(best.lat * 1000) / 1000, lon: Math.round(best.lon * 1000) / 1000 },
    rows: mine.flatMap((r) => {
      const timeMs = num(r.time_ms);
      return timeMs === null
        ? []
        : [
            {
              timeMs,
              mean: num(r.mean_m),
              p10: num(r.p10_m),
              p25: num(r.p25_m),
              p50: num(r.p50_m),
              p75: num(r.p75_m),
              p90: num(r.p90_m),
            },
          ];
    }),
  };
}

/** Why BigQuery failed, in DooFah's words, with its message for the owner. */
export function classifyError(error: unknown): { reason: FallbackReason; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  const tooCostly = /bytes ?billed|bytesBilledLimitExceeded/i.test(message);
  return { reason: tooCostly ? "too-costly" : "error", detail: message.replace(/\s+/g, " ").slice(0, 300) };
}

// ---------------------------------------------------------------------------
// The route

type Outcome = { ok: true; nowcast: Nowcast } | { ok: false; reason: FallbackReason; detail?: string };

export interface WeatherNextServerOptions {
  env?: Env;
  warehouse?: (config: WeatherNextConfig) => Promise<Warehouse>;
  fetcher?: typeof fetch;
  now?: () => number;
}

export interface WeatherNextServer {
  /** GET /api/weathernext?lat=…&lon=…[&owner=1] */
  handle(request: Request): Promise<Response>;
  /** GET /api/weathernext/access?token=… (or ?off) */
  access(request: Request): Response;
}

const json = (body: unknown, status: number, cache: string, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": cache, ...extra } });

export function weatherNextServer(options: WeatherNextServerOptions = {}): WeatherNextServer {
  const env = options.env ?? process.env;
  const makeWarehouse = options.warehouse ?? bigQueryWarehouse;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;

  const answers = new Map<string, { nowcast: Nowcast; until: number }>();
  const fallbacks = new Map<string, { nowcast: Nowcast; until: number }>();
  const pending = new Map<string, Promise<Outcome>>();
  let queriesRun: number[] = [];
  const accessTries = new Map<string, number[]>();
  let warehouse: { key: string; value: Promise<Warehouse> } | null = null;

  const remember = (
    store: Map<string, { nowcast: Nowcast; until: number }>,
    key: string,
    nowcast: Nowcast,
    until: number,
  ) => {
    store.delete(key);
    store.set(key, { nowcast, until });
    while (store.size > MAX_CACHED) store.delete(store.keys().next().value!);
  };
  const recall = (store: Map<string, { nowcast: Nowcast; until: number }>, key: string) => {
    const hit = store.get(key);
    if (hit && hit.until > now()) return hit;
    if (hit) store.delete(key);
    return null;
  };

  /** The warehouse for these settings, made once (and again if the settings change). */
  function warehouseFor(config: WeatherNextConfig): Promise<Warehouse> {
    const key = `${config.projectId}|${config.credentials.client_email}|${config.location ?? ""}`;
    if (warehouse?.key !== key) {
      const value = makeWarehouse(config);
      warehouse = { key, value };
      value.catch(() => {
        if (warehouse?.value === value) warehouse = null;
      });
    }
    return warehouse.value;
  }

  function takeQuery(): boolean {
    const since = now() - HOUR_MS;
    queriesRun = queriesRun.filter((t) => t > since);
    if (queriesRun.length >= QUERIES_PER_HOUR) return false;
    queriesRun.push(now());
    return true;
  }

  /** WeatherNext 3 for a cell: the newest run with data, cheapest checks first. */
  async function fromWeatherNext(config: WeatherNextConfig, cell: { lat: number; lon: number }): Promise<Outcome> {
    let store: Warehouse;
    try {
      store = await warehouseFor(config);
    } catch (error) {
      return { ok: false, ...classifyError(error) };
    }
    const at = now();
    const newest = floorHour(at);
    const runs = Array.from({ length: LOOKBACK_HOURS + 1 }, (_, k) => newest - k * HOUR_MS);
    // Dry runs are free: a run that hasn't arrived scans nothing, so they find the newest one.
    let sizes: number[];
    try {
      sizes = await Promise.all(runs.map((init) => store.estimateBytes(nowcastQuery(config, cell, init, at))));
    } catch (error) {
      return { ok: false, ...classifyError(error) };
    }
    const present = runs.map((init, i) => ({ init, bytes: sizes[i] })).filter((r) => r.bytes > 0);
    if (!present.length) return { ok: false, reason: "no-data", detail: `No run in the last ${LOOKBACK_HOURS} hours` };
    let lastProblem: Outcome = { ok: false, reason: "no-data" };
    for (const run of present.slice(0, MAX_ATTEMPTS)) {
      if (run.bytes > config.maxBytes) {
        return {
          ok: false,
          reason: "too-costly",
          detail: `The query would scan ${(run.bytes / GB).toFixed(2)} GB; WEATHERNEXT_MAX_GB allows ${(config.maxBytes / GB).toFixed(2)} GB`,
        };
      }
      if (!takeQuery()) return { ok: false, reason: "busy", detail: `${QUERIES_PER_HOUR} queries this hour already` };
      let raw: Record<string, unknown>[];
      try {
        raw = await store.rows(nowcastQuery(config, cell, run.init, at), config.maxBytes);
      } catch (error) {
        return { ok: false, ...classifyError(error) };
      }
      const nearest = nearestCellRows(raw);
      const hours = nearest && hoursFromWeatherNext(nearest.rows, at);
      if (nearest && hours) {
        return {
          ok: true,
          nowcast: {
            source: "weathernext3",
            initTime: new Date(run.init).toISOString(),
            cell: nearest.cell,
            hours,
            generatedAt: new Date(at).toISOString(),
          },
        };
      }
      lastProblem = {
        ok: false,
        reason: "no-data",
        detail: nearest ? "The run doesn't cover the next 6 hours" : "No grid cell near this point in the run",
      };
    }
    return lastProblem;
  }

  /** Open-Meteo's next 6 hours for a cell, kept 10 minutes; null if it can't be had either. */
  async function fromOpenMeteo(cell: { lat: number; lon: number }): Promise<Nowcast | null> {
    const key = cellKey(cell);
    const hit = recall(fallbacks, key);
    if (hit) return hit.nowcast;
    const apiKey = env.OPEN_METEO_API_KEY?.trim();
    const url = new URL(apiKey ? CUSTOMER_URL.forecast : FREE_URL.forecast);
    url.search = new URLSearchParams({
      latitude: String(cell.lat),
      longitude: String(cell.lon),
      hourly: "precipitation,precipitation_probability",
      forecast_hours: String(NOWCAST_HOURS + 2),
      timeformat: "unixtime",
      timezone: "GMT",
      ...(apiKey ? { apikey: apiKey } : {}),
    }).toString();
    try {
      const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(OPEN_METEO_TIMEOUT_MS) });
      if (!response.ok) return null;
      const at = now();
      const hours = hoursFromOpenMeteo((await response.json()) as OpenMeteoNowcastReply, at);
      if (!hours) return null;
      const nowcast: Nowcast = { source: "open-meteo", cell, hours, generatedAt: new Date(at).toISOString() };
      remember(fallbacks, key, nowcast, Math.min(at + FALLBACK_MS, floorHour(at) + HOUR_MS));
      return nowcast;
    } catch {
      return null;
    }
  }

  async function fallback(
    cell: { lat: number; lon: number },
    reason: FallbackReason,
    detail: string | undefined,
    cache: string,
    owner: boolean,
  ) {
    const found = await fromOpenMeteo(cell);
    if (!found) return json({ error: true, reason: "Neither WeatherNext 3 nor Open-Meteo answered" }, 502, "no-store");
    // The detail can name settings and BigQuery's message: only the owner sees it.
    return json(
      { ...found, reason, ...(owner && detail ? { detail } : {}) },
      200,
      cache,
      owner ? { Vary: "Cookie" } : {},
    );
  }

  return {
    async handle(request) {
      // Only DooFah's own pages ask: browsers always say where a request comes from.
      if (request.headers.get("sec-fetch-site") !== "same-origin") {
        return json({ error: true, reason: "Only DooFah can use this" }, 403, "no-store");
      }
      const params = new URL(request.url).searchParams;
      const lat = Number(params.get("lat"));
      const lon = Number(params.get("lon"));
      if (
        !params.get("lat") ||
        !params.get("lon") ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      ) {
        return json({ error: true, reason: "lat and lon must be numbers" }, 400, "no-store");
      }
      const cell = snapToCell(lat, lon);
      // Owner requests have their own URL, so Vercel's CDN never hands an owner's answer to anyone else.
      const owner = params.get("owner") === "1";
      const ownerCache = OWNER_FALLBACK_CACHE;
      if (!inThailand(cell))
        return fallback(cell, "outside-thailand", undefined, owner ? ownerCache : PUBLIC_CACHE, owner);
      if (!owner) return fallback(cell, "not-owner", undefined, PUBLIC_CACHE, false);

      if (!ownerToken(env))
        return fallback(
          cell,
          "not-configured",
          "WEATHERNEXT_OWNER_TOKEN is not set (24+ characters)",
          "private, no-store",
          false,
        );
      if (!isOwnerCookie(cookieFrom(request, OWNER_COOKIE), env))
        return fallback(cell, "locked", undefined, "private, no-store", false);
      const settings = readConfig(env);
      if (!settings.ok) return fallback(cell, "not-configured", settings.problem, ownerCache, true);

      const key = cellKey(cell);
      const hit = recall(answers, key);
      let outcome: Outcome;
      if (hit) {
        outcome = { ok: true, nowcast: hit.nowcast };
      } else {
        let job = pending.get(key);
        if (!job) {
          job = fromWeatherNext(settings.config, cell).finally(() => pending.delete(key));
          pending.set(key, job);
        }
        outcome = await job;
        // Kept until the hour ends: the next hour needs the next run's numbers.
        if (outcome.ok) remember(answers, key, outcome.nowcast, floorHour(now()) + HOUR_MS);
      }
      if (!outcome.ok) {
        console.warn(`[weathernext] ${outcome.reason}: ${outcome.detail ?? ""}`);
        return fallback(cell, outcome.reason, outcome.detail, ownerCache, true);
      }
      const seconds = Math.max(30, Math.round((floorHour(now()) + HOUR_MS - now()) / 1000));
      return json(outcome.nowcast, 200, `private, max-age=${seconds}`, { Vary: "Cookie" });
    },

    access(request) {
      const url = new URL(request.url);
      const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
      const secure = url.protocol === "https:" ? "; Secure" : "";
      if (url.searchParams.has("off")) {
        return new Response(null, {
          status: 303,
          headers: {
            ...headers,
            Location: "/",
            "Set-Cookie": `${OWNER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
          },
        });
      }
      const token = ownerToken(env);
      if (!token) return new Response("WeatherNext 3 isn't set up on this site.", { status: 404, headers });
      const visitor = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      const since = now() - ACCESS_WINDOW_MS;
      const tries = (accessTries.get(visitor) ?? []).filter((t) => t > since);
      if (tries.length >= ACCESS_TRIES)
        return new Response("Too many tries. Wait 10 minutes.", { status: 429, headers });
      const given = url.searchParams.get("token") ?? "";
      if (!timingSafeEqual(sha256(given), sha256(token))) {
        accessTries.set(visitor, [...tries, now()]);
        if (accessTries.size > 5000) accessTries.clear();
        return new Response("That isn't the owner token.", { status: 403, headers });
      }
      return new Response(null, {
        status: 303,
        headers: {
          ...headers,
          Location: "/",
          "Set-Cookie": `${OWNER_COOKIE}=${ownerCookieValue(token)}; Path=/; Max-Age=${YEAR_S}; HttpOnly; SameSite=Lax${secure}`,
        },
      });
    },
  };
}
