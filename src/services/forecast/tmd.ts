/**
 * WRF over Thailand from the Thai Meteorological Department (TMD), for one
 * place, in the router's units. TMD's NWP API gives its WRF run hour by hour
 * at a point, from a start date and hour in Thai time:
 *
 *   GET https://data.tmd.go.th/nwpapi/v1/forecast/location/hourly/at
 *       ?lat=…&lon=…&fields=tc,rh,…&date=YYYY-MM-DD&hour=H&duration=N
 *   Authorization: Bearer <TMD_API_TOKEN>
 *
 * The token is a server setting (TMD_API_TOKEN), never in the code. Replies
 * are read as TMD documents them, but no reply from the real service has been
 * seen here yet, so these are the assumptions to check first:
 * - `rain` (and the weather code) at a time are for the hour before it, as
 *   with Open-Meteo, so hour T takes them from the record of T + 1 h.
 * - One request gives at most 48 hours. With that shift WRF then reaches 46
 *   hours ahead, and the router eases it into ECMWF over hours 40 to 46.
 * - Cloud comes as low, middle and high layers in percent; the total is
 *   worked out with the layers overlapping at random.
 * WRF gives no chance of rain, gusts, visibility, feels-like, dew point or UV
 * here: the router works them out or takes them from ECMWF, and says so.
 */

import { HOUR_MS, localDateKey, zonedParts } from "../weathernext3/time";
import type { GeoPoint } from "../weathernext3/types";
import { windParts, type ModelHour, type ModelSeries } from "./router";

export const TMD_URL = "https://data.tmd.go.th/nwpapi/v1/forecast/location/hourly/at";
/** Thai time: TMD's dates and hours are in it (no daylight saving). */
const THAI_TIME = "Asia/Bangkok";
/** Hours asked for in one request. */
export const TMD_HOURS = 48;
export const TMD_FIELDS = ["tc", "rh", "slp", "rain", "ws10m", "wd10m", "cloudlow", "cloudmed", "cloudhigh", "cond"];
/** TMD's weather code for a thunderstorm (its codes run from 1, clear, to 12, very hot). */
const THUNDERSTORM = 8;
/** Assumed: the API answers from TMD's 3 km run over Thailand rather than its 9 km regional one. */
const RESOLUTION_KM = 3;
const KMH_PER_MS = 3.6;
/** A request that takes longer than this has failed; ECMWF is shown without WRF. */
const TIMEOUT_MS = 10_000;

/**
 * Roughly Thailand, where TMD runs WRF at 3 km. Places outside it (a favorite
 * abroad) aren't asked for and get ECMWF alone. TMD's exact domain is still
 * to check.
 */
export const TMD_AREA = { south: 5, north: 21, west: 97, east: 106 };

export const inTmdArea = ({ lat, lon }: GeoPoint) =>
  lat >= TMD_AREA.south && lat <= TMD_AREA.north && lon >= TMD_AREA.west && lon <= TMD_AREA.east;

type Values = Record<string, number | string | null | undefined>;

/** A reply of the hourly forecast API. */
export interface TmdReply {
  WeatherForecasts?: {
    location?: { lat?: number; lon?: number };
    forecasts?: { time?: string; data?: Values }[];
  }[];
}

export class TmdError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TmdError";
  }
}

/** The request for one place: TMD_HOURS hours from `start` (a whole hour). */
export function tmdUrl(point: GeoPoint, start: number): string {
  const params = new URLSearchParams({
    lat: point.lat.toFixed(2),
    lon: point.lon.toFixed(2),
    fields: TMD_FIELDS.join(","),
    date: localDateKey(start, THAI_TIME),
    hour: String(zonedParts(start, THAI_TIME).hour),
    duration: String(TMD_HOURS),
  });
  return `${TMD_URL}?${params}`;
}

const num = (v: Values[string]): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Total cloud, percent, from the three layers overlapping at random; null when TMD gives none. */
function totalCloud(data: Values): number | null {
  const layers = [data.cloudlow, data.cloudmed, data.cloudhigh].map(num);
  if (layers.every((c) => c === null)) return null;
  const clear = layers.reduce<number>((sky, c) => sky * (1 - Math.min(100, Math.max(0, c ?? 0)) / 100), 1);
  return (1 - clear) * 100;
}

/** WRF's hours from a TMD reply. The last record only gives the rain of the hour before it. */
export function wrfFromTmd(reply: TmdReply): ModelSeries {
  const records = (reply.WeatherForecasts?.[0]?.forecasts ?? [])
    .map((r) => ({ time: Date.parse(r.time ?? ""), data: r.data ?? {} }))
    .filter((r) => Number.isFinite(r.time))
    .sort((a, b) => a.time - b.time);
  if (!records.length) throw new TmdError("TMD sent no hourly forecast", 502);
  const byTime = new Map(records.map((r) => [r.time, r.data]));
  const hours = records.flatMap(({ time, data }): ModelHour[] => {
    const next = byTime.get(time + HOUR_MS);
    if (!next) return [];
    const speed = num(data.ws10m);
    const from = num(data.wd10m);
    const wind = speed !== null && from !== null ? windParts(Math.max(0, speed) * KMH_PER_MS, from) : null;
    const rain = num(next.rain);
    const code = num(next.cond);
    return [
      {
        time,
        temperatureC: num(data.tc),
        humidity: num(data.rh),
        dewPointC: null,
        feelsLikeC: null,
        pressureHpa: num(data.slp),
        cloudCover: totalCloud(data),
        rainMm: rain === null ? null : Math.max(0, rain),
        rainChance: null,
        windU: wind?.u ?? null,
        windV: wind?.v ?? null,
        gustKmh: null,
        visibilityKm: null,
        uvIndex: null,
        thunder: code === null ? null : code === THUNDERSTORM ? 1 : 0,
      },
    ];
  });
  return { run: { model: "WRF", init: null, resolution_km: RESOLUTION_KM, source: "tmd" }, hours };
}

export interface TmdOptions {
  token: string;
  fetch?: typeof fetch;
}

/** What TMD said went wrong, briefly. */
function reasonFrom(body: unknown): string | null {
  const b = body as { message?: unknown; error?: unknown } | null;
  const said = typeof b?.message === "string" ? b.message : typeof b?.error === "string" ? b.error : null;
  return said ? said.slice(0, 120) : null;
}

/** WRF for one place from `start`, asked of TMD from DooFah's server. */
export async function fetchWrf(point: GeoPoint, start: number, options: TmdOptions): Promise<ModelSeries> {
  const { token, fetch: fetcher = fetch } = options;
  let response: Response;
  try {
    response = await fetcher(tmdUrl(point, start), {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new TmdError("TMD could not be reached", 502);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = reasonFrom(body);
    throw new TmdError(`TMD answered ${response.status}${reason ? `: ${reason}` : ""}`, response.status);
  }
  if (!body) throw new TmdError("TMD's reply wasn't JSON", 502);
  return wrfFromTmd(body as TmdReply);
}
