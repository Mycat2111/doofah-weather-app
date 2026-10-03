/**
 * The model routing engine: which model each hour of the forecast comes from.
 *
 *   0–42 h    WRF, where WRF covers the place
 *   42–48 h   WRF easing into ECMWF, in six even steps
 *   48 h on   ECMWF
 *
 * If WRF's run ends before 48 hours, the easing moves up so that it is always
 * WRF's last 6 hours; without WRF every hour is ECMWF. Each value is blended
 * on its own, the wind by its east–west and north–south parts, and the
 * condition is worked out after blending (condition.ts), so the icon only
 * changes when the numbers do. Tropical cyclones will always be ECMWF's.
 */

import { dewPoint, feelsLike, uvIndex } from "../weather/physics";
import { sunElevation } from "../weather/solar";
import { HOUR_MS } from "../weather/time";
import type { GeoPoint } from "../weather/types";
import { conditionFrom, rainChanceFrom } from "./condition";
import type { BorrowableValue, Model, ModelUsed, Run, UnifiedHour } from "./types";

/** WRF is used for this many hours from the forecast's start. */
export const WRF_HOURS = 48;
/** Hours over which WRF eases into ECMWF, ending where WRF stops. */
export const BLEND_HOURS = 6;
/** The sun is up from this elevation, degrees (upper limb, with refraction). */
const SUNRISE_ELEVATION = -0.83;
const KMH_PER_MS = 3.6;
const MODELS: Model[] = ["WRF", "ECMWF"];

/** One model's hour, in the same units whichever model it comes from. Null: the model doesn't give it. */
export interface ModelHour {
  /**
   * Start of the hour, ms. Rain, its chance, gusts and thunder are for the
   * hour from here; the other values are for this instant.
   */
  time: number;
  temperatureC: number | null;
  /** Percent. */
  humidity: number | null;
  dewPointC: number | null;
  feelsLikeC: number | null;
  pressureHpa: number | null;
  /** Percent. */
  cloudCover: number | null;
  rainMm: number | null;
  /** Percent. */
  rainChance: number | null;
  /** Wind towards the east, m/s. */
  windU: number | null;
  /** Wind towards the north, m/s. */
  windV: number | null;
  gustKmh: number | null;
  visibilityKm: number | null;
  uvIndex: number | null;
  /** 1 when the model has thunder in the hour, 0 when not. */
  thunder: number | null;
}

/** One run of one model at one place. */
export interface ModelSeries {
  run: Run;
  /** One per hour, in time order. */
  hours: ModelHour[];
}

export type Weights = Record<Model, number>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const present = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** A wind of `speedKmh` from `fromDeg` (clockwise from north) as its parts towards the east and the north, m/s. */
export function windParts(speedKmh: number, fromDeg: number): { u: number; v: number } {
  const speed = speedKmh / KMH_PER_MS;
  const rad = (fromDeg * Math.PI) / 180;
  return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad) };
}

/** The speed (km/h) and the direction it blows from (degrees, 0 when calm) of a wind given by its parts. */
export function windFrom(u: number, v: number): { speedKmh: number; fromDeg: number } {
  const speedKmh = Math.hypot(u, v) * KMH_PER_MS;
  const fromDeg = speedKmh === 0 ? 0 : ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { speedKmh, fromDeg };
}

/**
 * Where WRF stops for a forecast starting at `start`: 48 hours on, or at its
 * last hour if its run ends sooner (only hours with no gap since `start`
 * count). Null when WRF has no hour at `start`, so it is not used at all.
 */
export function wrfEnd(wrf: ModelSeries | null, start: number): number | null {
  if (!wrf) return null;
  const have = new Set(wrf.hours.map((h) => h.time));
  if (!have.has(start)) return null;
  let last = start;
  while (last < start + WRF_HOURS * HOUR_MS && have.has(last + HOUR_MS)) last += HOUR_MS;
  return last;
}

/** How much each model counts at `time` when WRF stops at `end` (null: no WRF): 1 for WRF until 6 hours before. */
export function weightsAt(time: number, end: number | null): Weights {
  if (end === null) return { WRF: 0, ECMWF: 1 };
  const wrf = clamp((end - time) / (BLEND_HOURS * HOUR_MS), 0, 1);
  return { WRF: wrf, ECMWF: 1 - wrf };
}

export function modelUsed(weights: Weights): ModelUsed {
  if (weights.ECMWF === 0) return "WRF";
  if (weights.WRF === 0) return "ECMWF";
  return "WRF+ECMWF";
}

interface Pick {
  value: number | null;
  /** Set when the value came from a model that doesn't count at this hour. */
  from?: Model;
}

/**
 * One value of an hour: the weighted mean of the models that count at this
 * hour and have it. When none has it and `borrow` allows, the other model's.
 */
function pick(
  get: (h: ModelHour) => number | null,
  hours: Record<Model, ModelHour | undefined>,
  weights: Weights,
  borrow: boolean,
): Pick {
  const counted = MODELS.flatMap((m) => {
    const v = hours[m] ? get(hours[m]) : null;
    return present(v) && weights[m] > 0 ? [{ v, w: weights[m] }] : [];
  });
  if (counted.length) {
    const total = counted.reduce((s, c) => s + c.w, 0);
    return { value: counted.reduce((s, c) => s + c.v * c.w, 0) / total };
  }
  if (!borrow) return { value: null };
  for (const m of MODELS) {
    const v = hours[m] ? get(hours[m]) : null;
    if (present(v)) return { value: v, from: m };
  }
  return { value: null };
}

/**
 * A value that follows from the others (feels-like, dew point, UV, the chance
 * of rain): each model that counts gives its own, or `workedOut` when it has
 * none, weighted like any value. So it eases from one model's to the other's
 * with the weights, rather than jumping where only one of them gives it.
 */
function ownOrWorkedOut(
  get: (h: ModelHour) => number | null,
  hours: Record<Model, ModelHour | undefined>,
  weights: Weights,
  workedOut: number,
): number {
  let sum = 0;
  let total = 0;
  for (const m of MODELS) {
    if (!(weights[m] > 0)) continue;
    const v = hours[m] ? get(hours[m]) : null;
    sum += weights[m] * (present(v) ? v : workedOut);
    total += weights[m];
  }
  return total > 0 ? sum / total : workedOut;
}

/**
 * One hour of the forecast from the models' hours and their weights; null
 * when neither model has its temperature, rain, cloud, pressure, humidity or
 * wind. Values a model lacks and that follow from the others (feels-like,
 * dew point, UV) are worked out from the hour's numbers rather than taken
 * from the other model. The chance of rain and thunder stay with the models
 * whose rain it is: a model with no chance of rain (WRF) gets one worked out
 * from its own rain (rainChanceFrom), never the other model's.
 */
export function blendHour(
  time: number,
  start: number,
  point: GeoPoint,
  hours: Record<Model, ModelHour | undefined>,
  weights: Weights,
): UnifiedHour | null {
  const borrowed: Partial<Record<BorrowableValue, Model>> = {};
  const value = (key: BorrowableValue, get: (h: ModelHour) => number | null) => {
    const { value, from } = pick(get, hours, weights, true);
    if (from) borrowed[key] = from;
    return value;
  };
  const temperature = value("temperature_c", (h) => h.temperatureC);
  const humidity = value("humidity", (h) => h.humidity);
  const pressure = value("pressure_hpa", (h) => h.pressureHpa);
  const cloud = value("cloud_cover", (h) => h.cloudCover);
  const rain = value("rain_mm", (h) => h.rainMm);
  // The two parts of the wind come from the same models: those with both.
  const withWind = (h: ModelHour | undefined) => (h && present(h.windU) && present(h.windV) ? h : undefined);
  const windHours = { WRF: withWind(hours.WRF), ECMWF: withWind(hours.ECMWF) };
  const u = pick((h) => h.windU, windHours, weights, true);
  const v = pick((h) => h.windV, windHours, weights, true);
  if (u.from) borrowed.wind = u.from;
  if (
    !present(temperature) ||
    !present(humidity) ||
    !present(pressure) ||
    !present(cloud) ||
    !present(rain) ||
    !present(u.value) ||
    !present(v.value)
  )
    return null;
  const gust = value("gust_kmh", (h) => h.gustKmh);
  const visibility = value("visibility_km", (h) => h.visibilityKm);
  const thunder = pick((h) => h.thunder, hours, weights, false).value;

  const temperatureC = round1(temperature);
  const rh = Math.round(clamp(humidity, 0, 100));
  const cloudCover = Math.round(clamp(cloud, 0, 100));
  const rainMm = round1(Math.max(0, rain));
  const visibilityKm = present(visibility) ? round1(Math.max(0, visibility)) : null;
  const wind = windFrom(u.value, v.value);
  const windKmh = round1(wind.speedKmh);
  const elevation = sunElevation(time, point.lat, point.lon);
  const feels = ownOrWorkedOut((h) => h.feelsLikeC, hours, weights, feelsLike(temperatureC, rh, windKmh));
  const dew = ownOrWorkedOut((h) => h.dewPointC, hours, weights, dewPoint(temperatureC, rh));
  const uv = ownOrWorkedOut((h) => h.uvIndex, hours, weights, uvIndex(elevation, cloudCover / 100));
  const ownChance = (h: ModelHour) => h.rainChance ?? (present(h.rainMm) ? rainChanceFrom(h.rainMm) : null);
  const chance = ownOrWorkedOut(ownChance, hours, weights, rainChanceFrom(rainMm));
  const used = modelUsed(weights);

  return {
    time: new Date(time).toISOString(),
    lead_hours: Math.round((time - start) / HOUR_MS),
    model_used: used,
    ...(used === "WRF+ECMWF" ? { weights: { WRF: round2(weights.WRF), ECMWF: round2(weights.ECMWF) } } : {}),
    ...(Object.keys(borrowed).length ? { borrowed } : {}),
    // From the rounded numbers, so anyone working it out again from this reply gets the same.
    condition: conditionFrom({ rainMm, cloudCover, thunder, temperatureC, visibilityKm }),
    temperature_c: temperatureC,
    feels_like_c: round1(feels),
    humidity: rh,
    dew_point_c: round1(dew),
    rain_mm: rainMm,
    rain_chance: Math.round(clamp(chance, 0, 100)),
    cloud_cover: cloudCover,
    pressure_hpa: round1(pressure),
    wind_u: round1(u.value),
    wind_v: round1(v.value),
    wind_kmh: windKmh,
    wind_from_deg: Math.round(wind.fromDeg) % 360,
    gust_kmh: present(gust) ? round1(Math.max(gust, windKmh)) : null,
    visibility_km: visibilityKm,
    uv_index: round1(Math.max(0, uv)),
    is_day: elevation > SUNRISE_ELEVATION,
  };
}

export interface Routed {
  /** Every hour either model has, in time order. */
  hours: UnifiedHour[];
  /** The hours over which WRF eases into ECMWF (ms); null without WRF. */
  blend: { from: number; to: number } | null;
}

/**
 * The forecast from `start` (a whole hour) at `point`: every hour, each from
 * the model the rules above pick. An hour WRF lacks is ECMWF's, an hour ECMWF
 * lacks is WRF's only up to where WRF stops, and an hour neither can fill is
 * left out.
 */
export function routeHours(start: number, point: GeoPoint, ecmwf: ModelSeries | null, wrf: ModelSeries | null): Routed {
  const end = wrfEnd(wrf, start);
  const byTime = (series: ModelSeries | null) => new Map(series?.hours.map((h) => [h.time, h]) ?? []);
  // WRF's hours after it stops never count, not even where ECMWF has a gap.
  const wrfHours = byTime(end === null ? null : wrf);
  for (const time of wrfHours.keys()) if (end !== null && time > end) wrfHours.delete(time);
  const ecmwfHours = byTime(ecmwf);
  const times = [...new Set([...wrfHours.keys(), ...ecmwfHours.keys()])].sort((a, b) => a - b);
  const hours = times.flatMap((time) => {
    const own = { WRF: wrfHours.get(time), ECMWF: ecmwfHours.get(time) };
    const weights = !own.WRF ? { WRF: 0, ECMWF: 1 } : !own.ECMWF ? { WRF: 1, ECMWF: 0 } : weightsAt(time, end);
    const hour = blendHour(time, start, point, own, weights);
    return hour ? [hour] : [];
  });
  return { hours, blend: end === null ? null : { from: end - BLEND_HOURS * HOUR_MS, to: end } };
}
