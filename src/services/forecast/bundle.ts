/**
 * The unified forecast (/api/forecast's reply, in snake_case) in the app's
 * own shapes (weather/types.ts, in camelCase), turned once when it
 * arrives: the dashboard's ForecastBundle, and a spot's weather for a
 * favorite's chip or a stop on a road trip. Both read the same hours by the
 * same rules, so a favorite's chip shows what its dashboard shows.
 *
 * Neither model steps finer than an hour, so the rain countdown's bars for
 * the next two hours each carry the rain of the hour they fall in.
 */

import { airQualityFrom } from "../openmeteo/air";
import type { AirQualityResponse } from "../openmeteo/api";
import { describeDayEn } from "../weather/describe";
import { sunElevation } from "../weather/solar";
import { atmosphereFor, nowcastFromSteps } from "../weather/summarise";
import { floorToHour, HOUR_MS, localDateKey } from "../weather/time";
import type {
  AtmosphericSample,
  CurrentConditions,
  DailyForecast,
  ForecastBundle,
  GeoPoint,
  HourlyForecast,
  Nowcast,
  NowcastStep,
  Place,
  SpotWeather,
} from "../weather/types";
import type { Model, UnifiedDay, UnifiedForecast, UnifiedHour } from "./types";

const STEP_MS = 10 * 60_000;
/** The countdown's bars: now and every 10 minutes for 2 hours. */
const NOWCAST_STEPS = 13;
/** Hours shown in the hourly strip. */
const HOURLY_HOURS = 48;
/** Air quality is a reading for now: the card keeps showing it this close to now. */
const AIR_QUALITY_MS = HOUR_MS;
/** The sun is up from this elevation, degrees (upper limb, with refraction). */
const SUNRISE_ELEVATION = -0.83;
/** Without a visibility forecast, a clear 10 km. */
const CLEAR_KM = 10;
const MODELS: Model[] = ["WRF", "ECMWF"];

const round1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const iso = (ms: number) => new Date(ms).toISOString();

/** An hour in the app's shape; `leadHours` counts from the hour the app is in (by default the reply's). */
export function appHour(h: UnifiedHour, point: GeoPoint, leadHours: number = h.lead_hours): HourlyForecast {
  return {
    time: h.time,
    temperatureC: h.temperature_c,
    feelsLikeC: h.feels_like_c,
    dewPointC: h.dew_point_c,
    humidity: h.humidity,
    pressureHpa: h.pressure_hpa,
    windSpeedKmh: h.wind_kmh,
    windGustKmh: h.gust_kmh ?? h.wind_kmh,
    windDirectionDeg: h.wind_from_deg,
    precipitationMm: h.rain_mm,
    precipitationProbability: h.rain_chance,
    cloudCover: h.cloud_cover,
    visibilityKm: h.visibility_km ?? CLEAR_KM,
    uvIndex: h.uv_index,
    condition: h.condition,
    isDay: h.is_day,
    sunElevationDeg: round1(sunElevation(Date.parse(h.time), point.lat, point.lon)),
    leadHours,
    confidence: null,
    modelUsed: h.model_used,
  };
}

/** Where the hour that `at` falls in is in `hours`; -1 when the forecast doesn't cover it. */
function hourIndex(hours: HourlyForecast[], at: number): number {
  return hours.findIndex((h) => {
    const start = Date.parse(h.time);
    return start <= at && at < start + HOUR_MS;
  });
}

/**
 * The forecast for the instant `at`: values for an instant (temperature,
 * humidity, wind speed, cloud...) between its hour and the next, the rest
 * (rain, its chance, the condition) from its hour.
 */
export function sampleAt(hours: HourlyForecast[], at: number, point: GeoPoint): AtmosphericSample {
  const i = hourIndex(hours, at);
  if (i === -1) throw new Error("The forecast does not cover this time");
  const a = hours[i];
  const b = hours[Math.min(i + 1, hours.length - 1)];
  const f = b === a ? 0 : clamp((at - Date.parse(a.time)) / HOUR_MS, 0, 1);
  const mix = (key: "temperatureC" | "feelsLikeC" | "dewPointC" | "humidity" | "pressureHpa" | "windSpeedKmh") =>
    a[key] + (b[key] - a[key]) * f;
  const elevation = sunElevation(at, point.lat, point.lon);
  return {
    time: iso(at),
    temperatureC: round1(mix("temperatureC")),
    feelsLikeC: round1(mix("feelsLikeC")),
    dewPointC: round1(mix("dewPointC")),
    humidity: Math.round(mix("humidity")),
    pressureHpa: round1(mix("pressureHpa")),
    windSpeedKmh: round1(mix("windSpeedKmh")),
    windGustKmh: a.windGustKmh,
    windDirectionDeg: a.windDirectionDeg,
    precipitationMm: a.precipitationMm,
    precipitationProbability: a.precipitationProbability,
    cloudCover: Math.round(a.cloudCover + (b.cloudCover - a.cloudCover) * f),
    visibilityKm: round1(a.visibilityKm + (b.visibilityKm - a.visibilityKm) * f),
    uvIndex: round1(a.uvIndex + (b.uvIndex - a.uvIndex) * f),
    condition: a.condition,
    isDay: elevation > SUNRISE_ELEVATION,
    sunElevationDeg: round1(elevation),
  };
}

/** The countdown's bars from `now`: each step has the rain of the hour it falls in. */
function hourlySteps(hours: HourlyForecast[], now: number): NowcastStep[] {
  return Array.from({ length: NOWCAST_STEPS }, (_, k) => {
    const at = now + k * STEP_MS;
    return { time: iso(at), precipitationMm: hours[hourIndex(hours, at)]?.precipitationMm ?? 0 };
  });
}

function appDay(d: UnifiedDay, hours: HourlyForecast[]): DailyForecast {
  const outlook = { ...d.outlook, precipitationMm: d.rain_mm };
  return {
    date: d.date,
    minTempC: d.min_temp_c,
    maxTempC: d.max_temp_c,
    condition: d.condition,
    summary: describeDayEn(outlook),
    outlook,
    precipitationMm: d.rain_mm,
    precipitationProbability: d.rain_chance,
    maxWindKmh: d.max_wind_kmh,
    dominantWindDirectionDeg: d.wind_from_deg,
    maxUvIndex: d.max_uv_index,
    meanHumidity: d.mean_humidity,
    sunrise: d.sunrise,
    sunset: d.sunset,
    confidence: null,
    modelUsed: d.model_used,
    hours,
  };
}

/**
 * The dashboard's data for `place` from its forecast (and an air quality
 * reply, if there is one), as at `now`. `savedAt` is set for a forecast saved
 * on the device earlier, shown because there is no connection. Times read in
 * the forecast's time zone, which the server works out from the place.
 */
export function forecastBundle(
  forecast: UnifiedForecast,
  air: AirQualityResponse | null,
  place: Place,
  now: number,
  savedAt?: number,
): ForecastBundle {
  const timeZone = forecast.place.time_zone || place.timeZone;
  const thisHour = floorToHour(now);
  const hours = forecast.hours.map((h) =>
    appHour(h, place.point, Math.round((Date.parse(h.time) - thisHour) / HOUR_MS)),
  );
  const at = hourIndex(hours, now);
  const byDate = new Map<string, HourlyForecast[]>();
  for (const h of hours) {
    const date = localDateKey(Date.parse(h.time), timeZone);
    const day = byDate.get(date);
    if (day) day.push(h);
    else byDate.set(date, [h]);
  }
  const today = localDateKey(now, timeZone);
  const daily = forecast.days.filter((d) => d.date >= today).map((d) => appDay(d, byDate.get(d.date) ?? []));
  if (at === -1 || !daily.length) throw new Error("The forecast does not reach today");

  const sample = sampleAt(hours, now, place.point);
  const current: CurrentConditions = {
    place: timeZone === place.timeZone ? place : { ...place, timeZone },
    source: "live",
    cell: null,
    observedAt: iso(now),
    ...(savedAt === undefined ? {} : { savedAt: iso(savedAt) }),
    sample,
    airQuality: airQualityFrom(air, now),
    atmosphere: atmosphereFor(sample),
    sunrise: daily[0].sunrise,
    sunset: daily[0].sunset,
    nowcast: nowcastFromSteps(hourlySteps(hours, now)),
    model: null,
    modelUsed: hours[at].modelUsed,
    models: MODELS.filter((m) => forecast.runs[m]),
  };
  return { current, hourly: hours.slice(at, at + HOURLY_HOURS), daily };
}

/**
 * The weather at `point` at `time` from its forecast, for a favorite's chip
 * or a stop on a road trip: what the dashboard would show there and then.
 */
export function spotFrom(forecast: UnifiedForecast, point: GeoPoint, time: number): SpotWeather {
  const s = sampleAt(
    forecast.hours.map((h) => appHour(h, point)),
    time,
    point,
  );
  return {
    time: s.time,
    temperatureC: s.temperatureC,
    precipitationMm: s.precipitationMm,
    precipitationProbability: s.precipitationProbability,
    condition: s.condition,
    isDay: s.isDay,
  };
}

/** Every hour a bundle has, in order: the days' hours from local midnight today, and the hourly strip's. */
function hoursOf(bundle: ForecastBundle): HourlyForecast[] {
  const byTime = new Map<string, HourlyForecast>();
  for (const h of [...bundle.daily.flatMap((d) => d.hours), ...bundle.hourly]) byTime.set(h.time, h);
  return [...byTime.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/**
 * The dashboard's data as at another moment than now, `at`, picked on the
 * map's timeline: the conditions forecast for then (marked `forecastFor`),
 * the hours and days from then on, and the rain countdown's bars from then.
 * Air quality stays only within an hour of now. The simulation passes its
 * own conditions and 10-minute nowcast for `at`, from the model behind its
 * radar. Null when the forecast doesn't cover `at`.
 */
export function bundleAt(
  bundle: ForecastBundle,
  at: number,
  own: { sample?: AtmosphericSample; nowcast?: Nowcast } = {},
): ForecastBundle | null {
  const { current } = bundle;
  const hours = hoursOf(bundle);
  const i = hourIndex(hours, at);
  const date = localDateKey(at, current.place.timeZone);
  const daily = bundle.daily.filter((d) => d.date >= date);
  if (i === -1 || !daily.length) return null;
  const sample = own.sample ?? sampleAt(hours, at, current.place.point);
  return {
    current: {
      ...current,
      observedAt: iso(at),
      forecastFor: iso(at),
      sample,
      airQuality: Math.abs(at - Date.parse(current.observedAt)) <= AIR_QUALITY_MS ? current.airQuality : null,
      atmosphere: atmosphereFor(sample),
      sunrise: daily[0].sunrise,
      sunset: daily[0].sunset,
      nowcast: own.nowcast ?? nowcastFromSteps(hourlySteps(hours, at)),
      modelUsed: hours[i].modelUsed,
    },
    hourly: hours.slice(i, i + HOURLY_HOURS),
    daily,
  };
}
