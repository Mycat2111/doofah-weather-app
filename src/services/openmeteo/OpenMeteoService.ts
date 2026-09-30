/**
 * Real forecasts from Open-Meteo (https://open-meteo.com) for the dashboard,
 * the favorites' chips and road trips.
 *
 * - Free for non-commercial use, asked straight from the browser, so each
 *   visitor's requests count against their own daily limit.
 * - With a commercial key on the server, requests go through /api/weather,
 *   which adds the key (see proxy.ts).
 * - The last forecast for a few places is saved on the device. With no
 *   connection, the dashboard shows it and says when it was downloaded.
 */

import { floorToHour, HOUR_MS } from "../weathernext3/time";
import type { ForecastBundle, GeoPoint, Place, SpotWeather } from "../weathernext3/types";
import type { WeatherService } from "../weatherService";
import { forecastBundle, spotWeather } from "./adapter";
import {
  airQualityParams,
  forecastParams,
  FREE_URL,
  MAX_LOCATIONS,
  OpenMeteoError,
  pointKey,
  spotParams,
  type AirQualityResponse,
  type Endpoint,
  type ErrorResponse,
  type ForecastResponse,
} from "./api";

/** The same request within this time gets the same answer. */
const REUSE_MS = 5 * 60_000;
/** A request that takes longer than this has failed. */
const TIMEOUT_MS = 15_000;
/** Forecasts are saved on the device for this many places... */
const SAVED_PLACES = 6;
/** ...and shown offline for this long after they were downloaded. */
const SAVED_MAX_AGE_MS = 48 * HOUR_MS;
const STORAGE_KEY = "doofah-saved-forecasts";
/** Hours asked for past the last stop's hour. */
const SPOT_MARGIN_HOURS = 2;
const MAX_HOURS = 15 * 24;

type Store = Pick<Storage, "getItem" | "setItem">;

interface Saved {
  savedAt: number;
  forecast: ForecastResponse;
  air: AirQualityResponse | null;
}

export interface OpenMeteoOptions {
  /** Ask through DooFah's server, which holds the commercial API key. */
  proxy?: boolean;
  fetch?: typeof fetch;
  now?: () => number;
  /** Where forecasts are saved for offline use: localStorage in the browser, none on the server. */
  storage?: Store | null;
}

export class OpenMeteoService implements WeatherService {
  readonly source = "open-meteo" as const;
  private readonly proxy: boolean;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly storage: Store | null | undefined;
  private readonly recent = new Map<string, { at: number; reply: Promise<unknown> }>();
  private readonly savedReplies = new WeakSet<ForecastResponse>();

  constructor(options: OpenMeteoOptions = {}) {
    this.proxy = options.proxy ?? false;
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.storage = options.storage;
  }

  async getForecastBundle(place: Place): Promise<ForecastBundle> {
    const [forecast, air] = await Promise.allSettled([
      this.request<ForecastResponse>("forecast", forecastParams(place)),
      this.request<AirQualityResponse>("air-quality", airQualityParams(place)),
    ]);
    const now = this.now();
    const saved = this.load(place.point);
    if (forecast.status === "fulfilled") {
      const airReply = air.status === "fulfilled" ? air.value : (saved?.air ?? null);
      const bundle = forecastBundle(forecast.value, airReply, place, now);
      if (!this.savedReplies.has(forecast.value)) {
        this.savedReplies.add(forecast.value);
        this.save(place.point, { savedAt: now, forecast: forecast.value, air: airReply });
      }
      return bundle;
    }
    if (saved && now - saved.savedAt < SAVED_MAX_AGE_MS) {
      return forecastBundle(saved.forecast, saved.air, place, now, saved.savedAt);
    }
    throw forecast.reason;
  }

  async getWeatherAlong(stops: { point: GeoPoint; time: string }[]): Promise<SpotWeather[]> {
    if (!stops.length) return [];
    // One request for all of them, each place once.
    const keys = stops.map((s) => pointKey(s.point));
    const unique = [...new Set(keys)];
    const points = unique.map((key) => stops[keys.indexOf(key)].point);
    const last = Math.max(...stops.map((s) => Date.parse(s.time)));
    const ahead = Math.ceil((last - floorToHour(this.now())) / HOUR_MS);
    const hours = Math.min(MAX_HOURS, Math.max(0, ahead) + SPOT_MARGIN_HOURS);
    const chunks: GeoPoint[][] = [];
    for (let i = 0; i < points.length; i += MAX_LOCATIONS) chunks.push(points.slice(i, i + MAX_LOCATIONS));
    const replies = (
      await Promise.all(
        chunks.map((chunk) =>
          this.request<ForecastResponse | ForecastResponse[]>("forecast", spotParams(chunk, hours)),
        ),
      )
    ).flatMap((reply) => (Array.isArray(reply) ? reply : [reply]));
    if (replies.length !== points.length) throw new OpenMeteoError("Open-Meteo answered for other places", 502);
    return stops.map((stop, i) => spotWeather(replies[unique.indexOf(keys[i])], stop.point, Date.parse(stop.time)));
  }

  private request<T>(endpoint: Endpoint, params: URLSearchParams): Promise<T> {
    const url = this.proxy ? `/api/weather/${endpoint}?${params}` : `${FREE_URL[endpoint]}?${params}`;
    const now = this.now();
    for (const [key, entry] of this.recent) if (now - entry.at >= REUSE_MS) this.recent.delete(key);
    const hit = this.recent.get(url);
    if (hit) return hit.reply as Promise<T>;
    const reply = this.download<T>(url);
    this.recent.set(url, { at: now, reply });
    reply.catch(() => this.recent.delete(url));
    return reply;
  }

  private async download<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetcher(url, { signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      const error = body as ErrorResponse | null;
      if (!response.ok || !body || error?.error) {
        throw new OpenMeteoError(error?.reason ?? `Open-Meteo answered ${response.status}`, response.status);
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

  private load(point: GeoPoint): Saved | null {
    const saved = this.savedForecasts()[pointKey(point)];
    return saved && typeof saved.savedAt === "number" && saved.forecast?.hourly ? saved : null;
  }

  /** Keeps the newest forecasts, one per place. */
  private save(point: GeoPoint, entry: Saved) {
    const all = Object.entries({ ...this.savedForecasts(), [pointKey(point)]: entry })
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
      .slice(0, SAVED_PLACES);
    try {
      this.store?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(all)));
    } catch {
      // Storage full: keep this place at least.
      try {
        this.store?.setItem(STORAGE_KEY, JSON.stringify({ [pointKey(point)]: entry }));
      } catch {
        // Offline, this place will show the error instead.
      }
    }
  }
}
