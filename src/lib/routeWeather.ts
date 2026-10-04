import { TOWNS } from "@/services/routing/towns";
import type { Route, RoutePoint } from "@/services/routing/types";
import { distanceKm, PLACES } from "@/services/weather/places";
import type { AtmosphericSample, GeoPoint, SpotWeather } from "@/services/weather/types";
import { RAIN_LIKELY, WET_RATE } from "./rainCountdown";

/** Where to stop along the route and check the weather: every this many minutes of driving, picked to give at most 10 stops. */
export const STOP_STEPS_MIN = [15, 20, 30, 45, 60, 90, 120, 180] as const;
export const MAX_STOPS = 10;
/** A stop is named after the nearest town this close to it, km. */
export const TOWN_KM = 40;
/** Chance of rain that shows as "rain possible", percent. Rain likely is RAIN_LIKELY, as in the countdown. */
export const RAIN_POSSIBLE = 30;
/** Rain rate that reads as heavy, mm/h. */
export const HEAVY_RATE = 4;
/** Leave now, or up to 3 hours later. */
export const DEPARTURE_OFFSETS_H = [0, 1, 2, 3] as const;

const MINUTE_MS = 60_000;

export interface TownName {
  name: string;
  th: string;
}

export interface RouteStop {
  point: GeoPoint;
  km: number;
  /** Minutes after setting off. */
  min: number;
  /** ISO time you get there. */
  eta: string;
  role: "start" | "stop" | "end";
  /** The town the stop is in or next to, if any. */
  town: TownName | null;
}

export interface RouteStopWeather extends RouteStop {
  weather: SpotWeather;
}

/** Towns along the main roads and every place in the place list, for naming stops. */
const GAZETTEER: (TownName & { point: GeoPoint })[] = [
  ...TOWNS,
  ...PLACES.filter((p) => !TOWNS.some((t) => t.id === p.id)).map((p) => ({
    name: p.name,
    th: p.th?.name ?? p.name,
    point: p.point,
  })),
];

export function nearestTown(point: GeoPoint, maxKm = TOWN_KM): TownName | null {
  let best: TownName | null = null;
  let bestKm = maxKm;
  for (const town of GAZETTEER) {
    const km = distanceKm(point, town.point);
    if (km <= bestKm) {
      best = { name: town.name, th: town.th };
      bestKm = km;
    }
  }
  return best;
}

/** Minutes between weather stops for a drive of `durationMin`. */
export function stopInterval(durationMin: number): number {
  const target = durationMin / (MAX_STOPS - 1);
  return STOP_STEPS_MIN.find((step) => step >= target) ?? STOP_STEPS_MIN[STOP_STEPS_MIN.length - 1];
}

/** Where you are `min` minutes into the drive (at the end once you have arrived). */
export function positionAt(path: RoutePoint[], min: number): RoutePoint {
  if (min <= 0) return path[0];
  const last = path[path.length - 1];
  if (min >= last.min) return last;
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].min <= min) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const f = b.min > a.min ? (min - a.min) / (b.min - a.min) : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    km: a.km + (b.km - a.km) * f,
    min,
  };
}

/**
 * Stops at the start, every stopInterval() minutes of driving, and at the
 * end. A stop that would fall close to the end is dropped so the last two
 * never crowd each other.
 */
export function routeStops(route: Route): RouteStop[] {
  const step = stopInterval(route.durationMin);
  const times = [0];
  for (let t = step; t < route.durationMin - step * 0.4; t += step) times.push(t);
  times.push(route.durationMin);
  const start = Date.parse(route.departure);
  // A stop on the way that is still in the town you left, or already in the
  // one you are going to, goes by its distance so no name shows twice.
  const ends = [route.path[0], route.path[route.path.length - 1]].map((p) => nearestTown(p)?.name);
  let previous: string | null = null;
  return times.map((t, i) => {
    const at = positionAt(route.path, t);
    const point = { lat: at.lat, lon: at.lon };
    const near = nearestTown(point);
    const middle = i > 0 && i < times.length - 1;
    // Two stops in a row near the same town: the second goes by its distance instead.
    const town = near && near.name !== previous && !(middle && ends.includes(near.name)) ? near : null;
    previous = near?.name ?? null;
    return {
      point,
      km: at.km,
      min: t,
      eta: new Date(start + t * MINUTE_MS).toISOString(),
      role: i === 0 ? "start" : i === times.length - 1 ? "end" : "stop",
      town,
    };
  });
}

export type StopRain = "dry" | "possible" | "rain" | "heavy" | "storm";

const RAIN_ORDER: StopRain[] = ["dry", "possible", "rain", "heavy", "storm"];
export const worseRain = (a: StopRain, b: StopRain) => (RAIN_ORDER.indexOf(a) >= RAIN_ORDER.indexOf(b) ? a : b);

/** How wet a stop is when you get there. */
export function stopRain(
  w: Pick<AtmosphericSample, "precipitationMm" | "precipitationProbability" | "condition">,
): StopRain {
  const wet = w.precipitationMm >= WET_RATE || w.precipitationProbability >= RAIN_LIKELY;
  if (w.condition === "thunderstorm" && wet) return "storm";
  if (wet && (w.precipitationMm >= HEAVY_RATE || w.condition === "heavy-rain")) return "heavy";
  if (wet) return "rain";
  return w.precipitationProbability >= RAIN_POSSIBLE ? "possible" : "dry";
}

/** The trip in one line, in a form any UI language can phrase. */
export type RouteOutlook =
  /** No stop has more than a small chance of rain. */
  | { kind: "dry" }
  /** Some chance of rain but no stop where it is likely; `stop` has the highest chance. */
  | { kind: "possible"; stop: number; chance: number }
  /**
   * Rain is likely at stops `from` (the first wet one) to `to` (the last).
   * `patchy` when some stops in between are dry ("on and off"). `level` is
   * the worst of it and `chance` the highest chance.
   */
  | { kind: "rain"; from: number; to: number; level: "rain" | "heavy" | "storm"; chance: number; patchy: boolean };

export function routeOutlook(stops: RouteStopWeather[]): RouteOutlook {
  const rain = stops.map((s) => stopRain(s.weather));
  const isWet = (r: StopRain) => r === "rain" || r === "heavy" || r === "storm";
  const from = rain.findIndex(isWet);
  if (from === -1) {
    let best = -1;
    stops.forEach((s, i) => {
      if (
        rain[i] === "possible" &&
        (best === -1 || s.weather.precipitationProbability > stops[best].weather.precipitationProbability)
      )
        best = i;
    });
    return best === -1
      ? { kind: "dry" }
      : { kind: "possible", stop: best, chance: stops[best].weather.precipitationProbability };
  }
  const to = rain.findLastIndex(isWet);
  const stretch = rain.slice(from, to + 1);
  return {
    kind: "rain",
    from,
    to,
    level: stretch.reduce(worseRain, "rain") as "rain" | "heavy" | "storm",
    chance: Math.max(...stops.slice(from, to + 1).map((s) => s.weather.precipitationProbability)),
    patchy: !stretch.every(isWet),
  };
}
