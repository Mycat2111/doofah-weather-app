/**
 * The live forecast for the page. The dashboard, the favorites' chips and
 * road trips all read /api/forecast: the one forecast DooFah's server makes
 * from WRF and ECMWF (unified.ts), turned into the app's shapes by bundle.ts.
 *
 * - Every place is asked for by its rounded point (forecastQuery), so the
 *   dashboard and a favorite's chip for the same place read the very same
 *   answer: from the page for 5 minutes, and from Vercel's edge until the
 *   hour is over.
 * - Air quality isn't weather: it comes from Open-Meteo's air quality API
 *   (Copernicus CAMS), through /api/weather/air-quality when the site has a
 *   commercial key.
 * - The last forecast for a few places is saved on the device. With no
 *   connection, the dashboard shows it and says when it was downloaded.
 */

import { airQualityParams, FREE_URL, type AirQualityResponse } from "../openmeteo/api";
import { HOUR_MS } from "../weathernext3/time";
import type { ForecastBundle, GeoPoint, Place, SpotWeather } from "../weathernext3/types";
import type { WeatherService } from "../weatherService";
import { forecastBundle, spotFrom } from "./bundle";
import { forecastQuery } from "./point";
import type { UnifiedForecast } from "./types";

/** The same request within this time gets the same answer. */
const REUSE_MS = 5 * 60_000;
/** A request that takes longer than this has failed (the server waits up to 15 s for the models). */
const TIMEOUT_MS = 20_000;
/** Places asked for at once along a road trip. */
const AT_ONCE = 4;
/** Forecasts are saved on the device for this many places... */
const SAVED_PLACES = 6;
/** ...and shown offline for this long after they were downloaded. */
const SAVED_MAX_AGE_MS = 48 * HOUR_MS;
const STORAGE_KEY = "doofah-offline-forecasts";
/** Where Open-Meteo's own replies were saved before the unified forecast; cleared on the first save. */
const OLD_STORAGE_KEY = "doofah-saved-forecasts";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface Saved {
  savedAt: number;
  forecast: UnifiedForecast;
  air: AirQualityResponse | null;
}

export class ForecastError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ForecastError";
  }
}

export interface ForecastServiceOptions {
  /** Ask for air quality through DooFah's server, which holds Open-Meteo's commercial key. */
  airProxy?: boolean;
  fetch?: typeof fetch;
  now?: () => number;
  /** Where forecasts are saved for offline use: localStorage in the browser, none on the server. */
  storage?: Store | null;
}

const isForecast = (body: unknown): body is UnifiedForecast => {
  const f = body as Partial<UnifiedForecast> | null;
  return !!f && Array.isArray(f.hours) && Array.isArray(f.days) && typeof f.place?.time_zone === "string";
};

/** Runs `work` on every item, `limit` at a time, keeping their order. */
async function eachLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class ForecastService implements WeatherService {
  readonly source = "live" as const;
  private readonly airProxy: boolean;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly storage: Store | null | undefined;
  private readonly recent = new Map<string, { until: number; reply: Promise<unknown> }>();
  private readonly savedReplies = new WeakSet<UnifiedForecast>();
  private oldCopiesCleared = false;

  constructor(options: ForecastServiceOptions = {}) {
    this.airProxy = options.airProxy ?? false;
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.storage = options.storage;
  }

  async getForecastBundle(place: Place): Promise<ForecastBundle> {
    const air = airQualityParams(place);
    const [forecast, airReply] = await Promise.allSettled([
      this.forecast(place.point),
      this.request<AirQualityResponse>(
        this.airProxy ? `/api/weather/air-quality?${air}` : `${FREE_URL["air-quality"]}?${air}`,
      ),
    ]);
    const now = this.now();
    const key = forecastQuery(place.point);
    const saved = this.load(key);
    if (forecast.status === "fulfilled") {
      const airNow = airReply.status === "fulfilled" ? airReply.value : (saved?.air ?? null);
      const bundle = forecastBundle(forecast.value, airNow, place, now);
      if (!this.savedReplies.has(forecast.value)) {
        this.savedReplies.add(forecast.value);
        this.save(key, { savedAt: now, forecast: forecast.value, air: airNow });
      }
      return bundle;
    }
    if (saved && now - saved.savedAt < SAVED_MAX_AGE_MS) {
      return forecastBundle(saved.forecast, saved.air, place, now, saved.savedAt);
    }
    throw forecast.reason;
  }

  async getWeatherAlong(stops: { point: GeoPoint; time: string }[]): Promise<SpotWeather[]> {
    const keys = stops.map((s) => forecastQuery(s.point));
    const unique = [...new Set(keys)];
    // Each place once, a few at a time, so a long trip doesn't ask the server for every stop at the same moment.
    const forecasts = await eachLimited(unique, AT_ONCE, (key) => this.forecastFor(key));
    const byKey = new Map(unique.map((key, i) => [key, forecasts[i]]));
    return stops.map((stop, i) => spotFrom(byKey.get(keys[i])!, stop.point, Date.parse(stop.time)));
  }

  private forecast(point: GeoPoint): Promise<UnifiedForecast> {
    return this.forecastFor(forecastQuery(point));
  }

  private async forecastFor(query: string): Promise<UnifiedForecast> {
    const body = await this.request<unknown>(`/api/forecast?${query}`);
    if (!isForecast(body)) throw new ForecastError("The forecast came back empty", 502);
    return body;
  }

  private request<T>(url: string): Promise<T> {
    const now = this.now();
    for (const [key, entry] of this.recent) if (now >= entry.until) this.recent.delete(key);
    const hit = this.recent.get(url);
    if (hit) return hit.reply as Promise<T>;
    const reply = this.download<T>(url);
    this.recent.set(url, { until: now + REUSE_MS, reply });
    reply.catch(() => this.recent.delete(url));
    return reply;
  }

  private async download<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetcher(url, { signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      const error = body as { error?: unknown; reason?: unknown } | null;
      if (!response.ok || !body || error?.error) {
        const reason =
          typeof error?.reason === "string" ? error.reason : `${url.split("?")[0]} answered ${response.status}`;
        throw new ForecastError(reason, response.status);
      }
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private get store(): Store | null {
    if (this.storage !== undefined) return this.storage;
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      // Storage blocked (private mode): no offline forecasts.
      return null;
    }
  }

  private savedForecasts(): Record<string, Saved> {
    try {
      const all: unknown = JSON.parse(this.store?.getItem(STORAGE_KEY) ?? "{}");
      return all && typeof all === "object" ? (all as Record<string, Saved>) : {};
    } catch {
      return {};
    }
  }

  private load(key: string): Saved | null {
    const saved = this.savedForecasts()[key];
    return saved && typeof saved.savedAt === "number" && isForecast(saved.forecast) ? saved : null;
  }

  /** Keeps the newest forecasts, one per place. */
  private save(key: string, entry: Saved) {
    if (!this.oldCopiesCleared) {
      this.oldCopiesCleared = true;
      try {
        this.store?.removeItem(OLD_STORAGE_KEY);
      } catch {
        // Nothing to clear.
      }
    }
    const all = Object.entries({ ...this.savedForecasts(), [key]: entry })
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
      .slice(0, SAVED_PLACES);
    try {
      this.store?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(all)));
    } catch {
      // Storage full: keep this place at least.
      try {
        this.store?.setItem(STORAGE_KEY, JSON.stringify({ [key]: entry }));
      } catch {
        // Offline, this place will show the error instead.
      }
    }
  }
}
