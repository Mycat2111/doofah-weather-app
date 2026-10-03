/**
 * ECMWF's IFS at 9 km for one place, from Open-Meteo, in the router's units.
 *
 * Only ECMWF is asked for (`models=ecmwf_ifs`), never Open-Meteo's best
 * match, so no other model slips in. Open-Meteo steps ECMWF every hour to
 * 90 hours, every 3 hours to 144 and every 6 after that, filling in the hours
 * between. It gives the rain, its chance, the gusts and the weather code for
 * the hour *before* each time, while the router's hours cover the hour *from*
 * their time, so hour T takes those from Open-Meteo's T + 1 h (as adapter.ts
 * does); the last hour of the reply has no hour after it and is left out.
 */

import {
  CUSTOMER_URL,
  FORECAST_DAYS,
  FREE_URL,
  HOURLY_VARIABLES,
  OpenMeteoError,
  type ErrorResponse,
  type ForecastResponse,
  type Values,
} from "../openmeteo/api";
import type { GeoPoint } from "../weather/types";
import { windParts, type ModelHour, type ModelSeries } from "./router";

export const ECMWF_MODEL = "ecmwf_ifs";
const RESOLUTION_KM = 9;
/** One day more than the list shows: the last hour of a day reads its rain from the hour after it. */
const DAYS_ASKED = FORECAST_DAYS + 1;
/** A request that takes longer than this has failed. */
const TIMEOUT_MS = 15_000;

export interface EcmwfAnswer {
  series: ModelSeries;
  /** The place's time zone, which Open-Meteo works out from the coordinates. */
  timeZone: string;
}

/** The request for one place: every value DooFah shows, every hour from local midnight today, for 16 days. */
export function ecmwfParams(point: GeoPoint): URLSearchParams {
  return new URLSearchParams({
    latitude: point.lat.toFixed(2),
    longitude: point.lon.toFixed(2),
    models: ECMWF_MODEL,
    hourly: HOURLY_VARIABLES.join(","),
    forecast_days: String(DAYS_ASKED),
    timezone: "auto",
    timeformat: "unixtime",
  });
}

const present = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const at = (values: Values | undefined, i: number) => {
  const v = values?.[i];
  return present(v) ? v : null;
};

/** ECMWF's hours from an Open-Meteo reply for `models=ecmwf_ifs`. */
export function ecmwfFromOpenMeteo(raw: ForecastResponse): EcmwfAnswer {
  const h = raw.hourly;
  if (!h?.time?.length || !raw.timezone) throw new OpenMeteoError("Open-Meteo sent no hourly forecast", 502);
  const hours: ModelHour[] = h.time.slice(0, -1).map((t, i) => {
    const speed = at(h.wind_speed_10m, i);
    const from = at(h.wind_direction_10m, i);
    const wind = present(speed) && present(from) ? windParts(speed, from) : null;
    const visibility = at(h.visibility, i);
    const code = at(h.weather_code, i + 1);
    const rain = at(h.precipitation, i + 1);
    return {
      time: t * 1000,
      temperatureC: at(h.temperature_2m, i),
      humidity: at(h.relative_humidity_2m, i),
      dewPointC: at(h.dew_point_2m, i),
      feelsLikeC: at(h.apparent_temperature, i),
      pressureHpa: at(h.pressure_msl, i),
      cloudCover: at(h.cloud_cover, i),
      rainMm: present(rain) ? Math.max(0, rain) : null,
      rainChance: at(h.precipitation_probability, i + 1),
      windU: wind?.u ?? null,
      windV: wind?.v ?? null,
      gustKmh: at(h.wind_gusts_10m, i + 1),
      visibilityKm: present(visibility) ? visibility / 1000 : null,
      uvIndex: at(h.uv_index, i),
      // WMO codes 95–99 are thunderstorms.
      thunder: present(code) ? (code >= 95 && code <= 99 ? 1 : 0) : null,
    };
  });
  return {
    series: { run: { model: "ECMWF", init: null, resolution_km: RESOLUTION_KM, source: "open-meteo" }, hours },
    timeZone: raw.timezone,
  };
}

export interface EcmwfOptions {
  /** Open-Meteo's commercial key: then the request goes to its customer servers. */
  apiKey?: string;
  fetch?: typeof fetch;
}

/** ECMWF for one place, asked of Open-Meteo from DooFah's server. */
export async function fetchEcmwf(point: GeoPoint, options: EcmwfOptions = {}): Promise<EcmwfAnswer> {
  const { apiKey, fetch: fetcher = fetch } = options;
  const params = ecmwfParams(point);
  if (apiKey) params.set("apikey", apiKey);
  const url = `${apiKey ? CUSTOMER_URL.forecast : FREE_URL.forecast}?${params}`;
  let response: Response;
  try {
    response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new OpenMeteoError("Open-Meteo could not be reached", 502);
  }
  const body: unknown = await response.json().catch(() => null);
  const error = body as ErrorResponse | null;
  if (!response.ok || !body || error?.error) {
    throw new OpenMeteoError(error?.reason ?? `Open-Meteo answered ${response.status}`, response.status);
  }
  return ecmwfFromOpenMeteo(body as ForecastResponse);
}
