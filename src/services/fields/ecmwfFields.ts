/**
 * ECMWF's IFS (9 km) for one tile of the map's lattice, from Open-Meteo: one
 * request for all the tile's points, each a call of Open-Meteo's quota.
 *
 * Hours follow the router's rules (ecmwf.ts), so the map and the card read
 * the same numbers for the same hour: rain is the amount in the hour *from*
 * each time, which Open-Meteo gives at the next hour; cloud, temperature,
 * pressure and wind are at the time itself.
 */

import { CUSTOMER_URL, FREE_URL, OpenMeteoError, type ErrorResponse, type Values } from "../openmeteo/api";
import { ECMWF_MODEL } from "../forecast/ecmwf";
import { HOUR_MS } from "../weathernext3/time";
import { slotHours, TILE, tilePoints, type Spacing, type TileId } from "./lattice";

/** The variables a tile carries, in Open-Meteo's names. */
export const FIELD_VARIABLES = [
  "precipitation",
  "cloud_cover",
  "temperature_2m",
  "pressure_msl",
  "wind_speed_10m",
  "wind_direction_10m",
] as const;
type FieldVariable = (typeof FIELD_VARIABLES)[number];

const RESOLUTION_KM = 9;
const TIMEOUT_MS = 15_000;

/** One tile of the map's lattice, every hour of its slot: what /api/fields answers. */
export interface FieldTile {
  model: "ECMWF";
  resolution_km: number;
  spacing: Spacing;
  row: number;
  col: number;
  /** Points per side; values run north row first, each row west to east. */
  size: number;
  /** The first hour (ms) and how many follow it, an hour apart. */
  start: number;
  hours: number;
  /** Per hour, then per point. Null where the model gave nothing. */
  rain: (number | null)[];
  /** Percent. */
  cloud: (number | null)[];
  /** °C at 2 m. */
  temperature: (number | null)[];
  /** hPa at sea level. */
  pressure: (number | null)[];
  /** km/h towards the east and the north, at 10 m. */
  wind_u: (number | null)[];
  wind_v: (number | null)[];
}

/** The hour format Open-Meteo takes for start_hour and end_hour, in UTC. */
const hourParam = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/** The request for a tile: its points, the slot's hours plus one for the last hour's rain. */
export function fieldParams(tile: TileId, slot: number): URLSearchParams {
  const points = tilePoints(tile);
  const { start, end } = slotHours(slot);
  return new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(","),
    longitude: points.map((p) => p.lon.toFixed(3)).join(","),
    models: ECMWF_MODEL,
    hourly: FIELD_VARIABLES.join(","),
    start_hour: hourParam(start),
    end_hour: hourParam(end + HOUR_MS),
    timezone: "GMT",
    timeformat: "unixtime",
  });
}

interface LocationReply {
  hourly?: { time?: number[] } & Partial<Record<FieldVariable, Values>>;
}

const round = (v: number | null | undefined, digits: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null;

/** A tile from Open-Meteo's reply for fieldParams (one entry per point, in order). */
export function fieldTileFrom(raw: unknown, tile: TileId, slot: number): FieldTile {
  const locations = (Array.isArray(raw) ? raw : [raw]) as LocationReply[];
  const size = TILE;
  const points = size * size;
  if (locations.length !== points) {
    throw new OpenMeteoError(`Open-Meteo sent ${locations.length} places for ${points}`, 502);
  }
  const { start, end } = slotHours(slot);
  const hours = (end - start) / HOUR_MS + 1;
  const field = () => new Array<number | null>(hours * points).fill(null);
  const out: FieldTile = {
    model: "ECMWF",
    resolution_km: RESOLUTION_KM,
    spacing: tile.spacing,
    row: tile.row,
    col: tile.col,
    size,
    start,
    hours,
    rain: field(),
    cloud: field(),
    temperature: field(),
    pressure: field(),
    wind_u: field(),
    wind_v: field(),
  };
  locations.forEach((location, p) => {
    const h = location?.hourly;
    const times = h?.time;
    if (!h || !times?.length) throw new OpenMeteoError("Open-Meteo sent no hourly values", 502);
    const first = times.indexOf(start / 1000);
    if (first < 0) throw new OpenMeteoError("Open-Meteo's hours don't cover the map's", 502);
    const at = (name: FieldVariable, i: number) => h[name]?.[i] ?? null;
    for (let k = 0; k < hours; k++) {
      const i = first + k;
      const o = k * points + p;
      const rain = round(at("precipitation", i + 1), 2);
      out.rain[o] = rain === null ? null : Math.max(0, rain);
      out.cloud[o] = round(at("cloud_cover", i), 0);
      out.temperature[o] = round(at("temperature_2m", i), 1);
      out.pressure[o] = round(at("pressure_msl", i), 1);
      const speed = at("wind_speed_10m", i);
      const from = at("wind_direction_10m", i);
      if (speed !== null && from !== null) {
        const rad = (from * Math.PI) / 180;
        out.wind_u[o] = round(-speed * Math.sin(rad), 1);
        out.wind_v[o] = round(-speed * Math.cos(rad), 1);
      }
    }
  });
  return out;
}

export interface FieldFetchOptions {
  /** Open-Meteo's commercial key: then the request goes to its customer servers. */
  apiKey?: string;
  fetch?: typeof fetch;
}

/** ECMWF for one tile over its slot's hours, asked of Open-Meteo from DooFah's server. */
export async function fetchFieldTile(tile: TileId, slot: number, options: FieldFetchOptions = {}): Promise<FieldTile> {
  const { apiKey, fetch: fetcher = fetch } = options;
  const params = fieldParams(tile, slot);
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
  if (!response.ok || !body || (!Array.isArray(body) && error?.error)) {
    throw new OpenMeteoError(error?.reason ?? `Open-Meteo answered ${response.status}`, response.status);
  }
  return fieldTileFrom(body, tile, slot);
}
