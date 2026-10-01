/**
 * Rain for the next 6 hours from Google DeepMind's WeatherNext 3, in
 * DooFah's shapes, and the same from Open-Meteo when WeatherNext 3 can't
 * answer. Pure functions only, so the browser, the server and the tests share
 * them (the BigQuery side is in server.ts).
 *
 * WeatherNext 3's 0.1° table gives each hour's rain as statistics of its 64
 * runs: the mean and the 10th, 25th, 50th, 75th and 90th percentiles, in
 * metres. It has no chance of rain, so DooFah works one out from where
 * 0.1 mm falls among the percentiles (`chanceOfRain`).
 */

import type { HourlyForecast } from "../weathernext3/types";

/** Hours of nowcast: this hour and the next five. */
export const NOWCAST_HOURS = 6;
/** WeatherNext 3's grid for rain and surface weather, in degrees. */
export const CELL_DEG = 0.1;
/** Rain that counts as rain, mm in the hour: the same as DooFah's chance of rain. */
export const RAIN_MM = 0.1;
/** Where the nowcast is asked for: Thailand, with a little room around the border. */
export const THAILAND = { south: 5.5, north: 20.6, west: 97.3, east: 105.7 } as const;

const HOUR_MS = 3_600_000;
/** The percentiles WeatherNext 3 gives, as fractions. */
const LEVELS = [0.1, 0.25, 0.5, 0.75, 0.9] as const;

export type NowcastSource = "weathernext3" | "open-meteo";
/** How exact a chance is: percentiles only bound it when 0.1 mm lies outside them. */
export type ChanceBound = "about" | "at-least" | "at-most";
export type FallbackReason =
  /** The request wasn't the owner's (only the owner's device asks WeatherNext 3). */
  | "not-owner"
  /** Asked as the owner, without the owner's cookie. */
  | "locked"
  /** An environment variable is missing or unreadable. */
  | "not-configured"
  | "outside-thailand"
  /** No recent WeatherNext 3 run covers the next 6 hours here. */
  | "no-data"
  /** The query would scan more than WEATHERNEXT_MAX_GB. */
  | "too-costly"
  /** This server has run its share of queries this hour. */
  | "busy"
  /** BigQuery refused or failed (credentials, permissions, a column name...). */
  | "error";

export interface NowcastHour {
  /** Start of the hour (ISO, UTC); like DooFah's hours, it covers the hour from this time. */
  time: string;
  /** Mean rain in the hour, mm (Open-Meteo: its forecast amount). */
  meanMm: number | null;
  /** Median rain, mm: half of WeatherNext 3's runs give less. Null from Open-Meteo. */
  p50Mm: number | null;
  /** 90th percentile, mm: only 1 run in 10 gives more. Null from Open-Meteo. */
  p90Mm: number | null;
  /** Chance of at least 0.1 mm, 0–1. */
  chance: number | null;
  chanceBound: ChanceBound;
}

export interface Nowcast {
  source: NowcastSource;
  /** Why it isn't WeatherNext 3. */
  reason?: FallbackReason;
  /** More about the reason, for the owner only (never secrets). */
  detail?: string;
  /** The WeatherNext 3 run used (ISO, UTC). */
  initTime?: string;
  /** Centre of the grid cell the numbers are for. */
  cell: { lat: number; lon: number };
  hours: NowcastHour[];
  /** When the server put this together (ISO). */
  generatedAt: string;
}

export const floorHour = (ms: number) => Math.floor(ms / HOUR_MS) * HOUR_MS;
const round2 = (v: number) => Math.round(v * 100) / 100;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A point snapped to the 0.1° grid, so nearby requests share one answer. */
export function snapToCell(lat: number, lon: number): { lat: number; lon: number } {
  const snap = (v: number) => Math.round(Math.round(v / CELL_DEG) * CELL_DEG * 10) / 10;
  return { lat: snap(lat), lon: snap(lon) };
}

export const cellKey = (cell: { lat: number; lon: number }) => `${cell.lat.toFixed(1)},${cell.lon.toFixed(1)}`;

export const inThailand = ({ lat, lon }: { lat: number; lon: number }) =>
  lat >= THAILAND.south && lat <= THAILAND.north && lon >= THAILAND.west && lon <= THAILAND.east;

/**
 * The chance of at least `threshold` mm from the percentiles (p10, p25, p50,
 * p75, p90, in mm), reading the share of runs below it off the percentiles in
 * between. Beyond them it can only be bounded: at least 90% when even p10
 * reaches it, at most 10% when p90 doesn't.
 */
export function chanceOfRain(
  percentiles: readonly (number | null | undefined)[],
  threshold = RAIN_MM,
): { chance: number | null; bound: ChanceBound } {
  if (percentiles.length !== LEVELS.length || !percentiles.every(finite)) return { chance: null, bound: "about" };
  // Percentiles never fall; rounding in the data could make them, so hold each at least at the one before.
  const q: number[] = [];
  for (const v of percentiles as number[]) q.push(Math.max(v, q.at(-1) ?? -Infinity));
  if (q[0] >= threshold) return { chance: round2(1 - LEVELS[0]), bound: "at-least" };
  if (q[q.length - 1] < threshold) return { chance: round2(1 - LEVELS[LEVELS.length - 1]), bound: "at-most" };
  for (let i = 0; i < q.length - 1; i++) {
    if (q[i] < threshold && threshold <= q[i + 1]) {
      const below = LEVELS[i] + ((LEVELS[i + 1] - LEVELS[i]) * (threshold - q[i])) / (q[i + 1] - q[i]);
      return { chance: round2(1 - below), bound: "about" };
    }
  }
  return { chance: null, bound: "about" };
}

/** One row of the BigQuery answer: one forecast hour of one cell, rain in metres. */
export interface WeatherNextRow {
  /** WeatherNext 3's time for the row (ms); its rain is the hour *before* it. */
  timeMs: number;
  mean: number | null;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

const mm = (metres: number | null) => (finite(metres) ? round2(Math.max(0, metres * 1000)) : null);

/**
 * The next 6 hours from WeatherNext 3's rows, or null unless every one of
 * them is there. A DooFah hour covers the hour *from* its time, and
 * WeatherNext 3's hourly rain is taken to be the hour *before* its time (as
 * ECMWF's and Open-Meteo's are), so hour T reads the row for T + 1 h.
 */
export function hoursFromWeatherNext(rows: readonly WeatherNextRow[], now: number): NowcastHour[] | null {
  const byTime = new Map(rows.map((r) => [r.timeMs, r]));
  const start = floorHour(now);
  const hours: NowcastHour[] = [];
  for (let k = 0; k < NOWCAST_HOURS; k++) {
    const at = start + k * HOUR_MS;
    const row = byTime.get(at + HOUR_MS);
    if (!row) return null;
    const percentiles = [row.p10, row.p25, row.p50, row.p75, row.p90].map(mm);
    const { chance, bound } = chanceOfRain(percentiles);
    hours.push({
      time: new Date(at).toISOString(),
      meanMm: mm(row.mean),
      p50Mm: percentiles[2],
      p90Mm: percentiles[4],
      chance,
      chanceBound: bound,
    });
  }
  return hours;
}

/** The part of an Open-Meteo forecast reply the fallback reads (`timeformat=unixtime`). */
export interface OpenMeteoNowcastReply {
  hourly?: {
    time?: number[];
    precipitation?: (number | null)[];
    precipitation_probability?: (number | null)[];
  };
}

/**
 * The next 6 hours from Open-Meteo, or null unless every one of them is
 * there. Open-Meteo's rain and chance are for the hour *before* each time,
 * so hour T reads T + 1 h, as everywhere else in DooFah.
 */
export function hoursFromOpenMeteo(reply: OpenMeteoNowcastReply, now: number): NowcastHour[] | null {
  const times = reply.hourly?.time ?? [];
  const start = floorHour(now);
  const hours: NowcastHour[] = [];
  for (let k = 0; k < NOWCAST_HOURS; k++) {
    const at = start + k * HOUR_MS;
    const i = times.indexOf((at + HOUR_MS) / 1000);
    if (i < 0) return null;
    const amount = reply.hourly?.precipitation?.[i];
    const probability = reply.hourly?.precipitation_probability?.[i];
    hours.push({
      time: new Date(at).toISOString(),
      meanMm: finite(amount) ? round2(Math.max(0, amount)) : null,
      p50Mm: null,
      p90Mm: null,
      chance: finite(probability) ? round2(Math.min(100, Math.max(0, probability)) / 100) : null,
      chanceBound: "about",
    });
  }
  return hours;
}

/**
 * A nowcast as the browser received it, or null if it isn't one (the route
 * answers JSON that is checked before it is drawn).
 */
export function readNowcast(value: unknown): Nowcast | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<Nowcast>;
  if (v.source !== "weathernext3" && v.source !== "open-meteo") return null;
  if (!v.cell || !finite(v.cell.lat) || !finite(v.cell.lon) || !Array.isArray(v.hours)) return null;
  const numberOrNull = (x: unknown) => x === null || finite(x);
  const hoursOk = v.hours.every(
    (h) =>
      h &&
      typeof h.time === "string" &&
      Number.isFinite(Date.parse(h.time)) &&
      numberOrNull(h.meanMm) &&
      numberOrNull(h.p50Mm) &&
      numberOrNull(h.p90Mm) &&
      numberOrNull(h.chance) &&
      (h.chanceBound === "about" || h.chanceBound === "at-least" || h.chanceBound === "at-most"),
  );
  return hoursOk ? (v as Nowcast) : null;
}

/** WeatherNext 3's hours by the start time of DooFah's hourly rows, for the hourly strip. */
export function nowcastByHour(nowcast: Nowcast | null, hours: readonly HourlyForecast[]): Map<string, NowcastHour> {
  const found = new Map<string, NowcastHour>();
  if (nowcast?.source !== "weathernext3") return found;
  const byStart = new Map(nowcast.hours.map((h) => [Date.parse(h.time), h]));
  for (const hour of hours) {
    const match = byStart.get(Date.parse(hour.time));
    if (match) found.set(hour.time, match);
  }
  return found;
}
