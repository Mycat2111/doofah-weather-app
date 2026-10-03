/**
 * getUnifiedForecast: the one forecast for a place that every screen reads.
 * It asks both models, lets the router pick each hour's model (router.ts)
 * and sums the hours into days. Runs on DooFah's server (/api/forecast), so
 * the models' keys stay there and everyone gets the same answer.
 *
 * WRF comes from TMD (tmd.ts) when the server has TMD_API_TOKEN. Without it,
 * outside Thailand or while TMD is down, every hour is ECMWF's and the answer
 * says why (`wrf_missing`, and `wrf_reason` when TMD failed).
 */

import { FORECAST_DAYS } from "../openmeteo/api";
import { sunTimes } from "../weathernext3/solar";
import { summariseDay } from "../weathernext3/summarise";
import { floorToHour, HOUR_MS, localDateKey, zonedMidnight, zonedParts } from "../weathernext3/time";
import type { GeoPoint } from "../weathernext3/types";
import { appHour } from "./bundle";
import { fetchEcmwf, type EcmwfAnswer } from "./ecmwf";
import { snapPoint } from "./point";
import { routeHours, type ModelSeries } from "./router";
import { fetchWrf, inTmdArea } from "./tmd";
import type { ModelUsed, UnifiedDay, UnifiedForecast, UnifiedHour, WrfMissing } from "./types";

export { SNAP_DEGREES, snapPoint } from "./point";

/** WRF for a place, or why there is none. */
export type WrfAnswer = { series: ModelSeries } | { missing: WrfMissing; reason?: string };

export interface ForecastSources {
  ecmwf: (point: GeoPoint) => Promise<EcmwfAnswer>;
  /** WRF from `start` (a whole hour) on. */
  wrf: (point: GeoPoint, start: number) => Promise<WrfAnswer>;
}

/**
 * The sources DooFah uses: ECMWF from Open-Meteo (with the commercial key
 * when set), and WRF from TMD inside Thailand when TMD_API_TOKEN is set.
 */
export function defaultSources(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): ForecastSources {
  const apiKey = env.OPEN_METEO_API_KEY?.trim() || undefined;
  const token = env.TMD_API_TOKEN?.trim() || undefined;
  return {
    ecmwf: (point) => fetchEcmwf(point, { apiKey, fetch: fetcher }),
    wrf: async (point, start) => {
      if (!token) return { missing: "not-configured" };
      if (!inTmdArea(point)) return { missing: "outside-area" };
      return { series: await fetchWrf(point, start, { token, fetch: fetcher }) };
    },
  };
}

/** Local midnight at the start of the day `ms` falls in, and how many hours that day has (23 to 25 with DST). */
function localDay(ms: number, timeZone: string): { midnight: number; hours: number } {
  const { year, month, day } = zonedParts(ms, timeZone);
  const midnight = zonedMidnight(year, month, day, timeZone);
  const next = zonedParts(midnight + 26 * HOUR_MS, timeZone);
  return { midnight, hours: (zonedMidnight(next.year, next.month, next.day, timeZone) - midnight) / HOUR_MS };
}

/**
 * Local days from today, up to 15, each summarised from its hours the way
 * the dashboard does today (summarise.ts). A day is only there when every one
 * of its hours is, so a day cut short at the end of the forecast never shows
 * a low or a total of half a day.
 */
export function daysFrom(hours: UnifiedHour[], point: GeoPoint, timeZone: string, start: number): UnifiedDay[] {
  const today = localDateKey(start, timeZone);
  const byDate = new Map<string, UnifiedHour[]>();
  for (const h of hours) {
    const date = localDateKey(Date.parse(h.time), timeZone);
    if (date >= today) byDate.set(date, [...(byDate.get(date) ?? []), h]);
  }
  const days = [...byDate].flatMap(([date, dayHours]) => {
    const { midnight, hours: length } = localDay(Date.parse(dayHours[0].time), timeZone);
    if (dayHours.length < length || Date.parse(dayHours[0].time) !== midnight) return [];

    const sun = sunTimes(midnight, point.lat, point.lon);
    const summary = summariseDay(
      date,
      dayHours.map((h) => appHour(h, point)),
      sun,
      timeZone,
    );
    const models = new Set(dayHours.map((h) => h.model_used));
    const model: ModelUsed = models.size === 1 ? [...models][0] : "WRF+ECMWF";
    const { kind, period, wind } = summary.outlook;
    return [
      {
        date,
        model_used: model,
        condition: summary.condition,
        outlook: { kind, period, wind },
        min_temp_c: summary.minTempC,
        max_temp_c: summary.maxTempC,
        rain_mm: summary.precipitationMm,
        rain_chance: summary.precipitationProbability,
        max_wind_kmh: summary.maxWindKmh,
        wind_from_deg: summary.dominantWindDirectionDeg,
        max_uv_index: summary.maxUvIndex,
        mean_humidity: summary.meanHumidity,
        sunrise: summary.sunrise,
        sunset: summary.sunset,
      },
    ];
  });
  return days.slice(0, FORECAST_DAYS);
}

/**
 * The forecast at (`lat`, `lon`) counting from `timestamp` (ms, rounded down
 * to the hour): WRF for the first 48 hours where it covers the place, ECMWF
 * after, WRF easing into ECMWF over its last 6 hours. Throws when ECMWF can't
 * be had, since without WRF there is nothing else.
 */
export async function getUnifiedForecast(
  lat: number,
  lon: number,
  timestamp: number = Date.now(),
  sources: ForecastSources = defaultSources(),
): Promise<UnifiedForecast> {
  const point = snapPoint(lat, lon);
  const start = floorToHour(timestamp);
  const [ecmwf, wrf] = await Promise.all([
    sources.ecmwf(point),
    sources.wrf(point, start).catch((error: unknown): WrfAnswer => {
      const reason = error instanceof Error ? error.message : "WRF could not be had";
      console.error("[forecast] no WRF:", reason);
      return { missing: "unavailable", reason };
    }),
  ]);
  const wrfSeries = "series" in wrf ? wrf.series : null;
  const routed = routeHours(start, point, ecmwf.series, wrfSeries);
  // WRF that doesn't reach now isn't used (router.ts), and the answer says so.
  const usedWrf = routed.blend !== null;
  const missing: WrfMissing | undefined = "missing" in wrf ? wrf.missing : usedWrf ? undefined : "unavailable";
  const reason = "missing" in wrf ? wrf.reason : usedWrf ? undefined : "WRF's forecast doesn't reach this hour";
  const days = daysFrom(routed.hours, point, ecmwf.timeZone, start);
  // The hours of the days shown, from local midnight today.
  const from = localDay(start, ecmwf.timeZone).midnight;
  const last = days.at(-1)?.date;
  const hours = routed.hours.filter((h) => {
    const time = Date.parse(h.time);
    return time >= from && (!last || localDateKey(time, ecmwf.timeZone) <= last);
  });
  return {
    issued_at: new Date(start).toISOString(),
    place: { lat: point.lat, lon: point.lon, time_zone: ecmwf.timeZone },
    runs: { WRF: usedWrf && wrfSeries ? wrfSeries.run : null, ECMWF: ecmwf.series.run },
    ...(missing ? { wrf_missing: missing } : {}),
    ...(reason ? { wrf_reason: reason } : {}),
    blend: routed.blend
      ? { from: new Date(routed.blend.from).toISOString(), to: new Date(routed.blend.to).toISOString() }
      : null,
    hours,
    days,
  };
}
