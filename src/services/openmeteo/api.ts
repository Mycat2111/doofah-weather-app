/**
 * Requests to Open-Meteo (https://open-meteo.com/en/docs) and the shape of
 * its replies. Times are asked for as Unix seconds (`timeformat=unixtime`).
 *
 * The free servers are for non-commercial use and answer the browser
 * directly. A commercial subscription uses the `customer-` servers with an
 * API key, which only DooFah's server holds (see proxy.ts).
 */

import type { GeoPoint, Place } from "../weathernext3/types";

export type Endpoint = "forecast" | "air-quality";

export const FREE_URL: Record<Endpoint, string> = {
  forecast: "https://api.open-meteo.com/v1/forecast",
  "air-quality": "https://air-quality-api.open-meteo.com/v1/air-quality",
};

export const CUSTOMER_URL: Record<Endpoint, string> = {
  forecast: "https://customer-api.open-meteo.com/v1/forecast",
  "air-quality": "https://customer-air-quality-api.open-meteo.com/v1/air-quality",
};

/** Days of forecast asked for: today and the next 14, like the 15-day list. */
export const FORECAST_DAYS = 15;
/** 15-minute steps of rain asked for: 3 hours, enough for the 2-hour countdown. */
export const NOWCAST_QUARTERS = 12;
/** Most places in one request (a road trip's stops). */
export const MAX_LOCATIONS = 12;

/** Right now, from the 15-minute model data. Precipitation is the sum of the preceding 15 minutes. */
export const CURRENT_VARIABLES = [
  "temperature_2m",
  "relative_humidity_2m",
  "apparent_temperature",
  "precipitation",
  "weather_code",
  "cloud_cover",
  "pressure_msl",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
] as const;

/**
 * Every hour. Most values are for the instant; precipitation, its
 * probability and the gusts cover the hour before the time given.
 */
export const HOURLY_VARIABLES = [
  "temperature_2m",
  "relative_humidity_2m",
  "dew_point_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "weather_code",
  "pressure_msl",
  "cloud_cover",
  "visibility",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "uv_index",
] as const;

/** Just enough for a favorite's chip or a stop on a road trip (4 variables count as one API call per place). */
export const SPOT_VARIABLES = ["temperature_2m", "precipitation_probability", "precipitation", "weather_code"] as const;

/**
 * The global models DooFah compares for Thailand (all of Open-Meteo's that
 * cover it and are still updated; none finer than ECMWF's 9 km does). The
 * `ensemble` is the one Open-Meteo works each model's chance of rain out
 * from, with its number of members. `hourly` lists the hours ahead the model
 * steps hourly, then every `steps` hours after; the AI models and CMA only
 * ever step every 6 or 3 hours. `skill` is DooFah's own weighting (finer,
 * better-verified models count for more). Left out: BOM ACCESS-G (stopped
 * in June 2025), KMA GDPS (stopped in April 2026), JMA GSM (55 km), UK Met
 * Office (its CC BY-SA licence would carry over to the blend), Google's
 * WeatherNext (separate, experimental terms).
 */
export const CONSENSUS_MODELS = [
  { id: "ecmwf_ifs", centre: "ECMWF", name: "IFS 9 km", skill: 1, hourly: 90, steps: 3, ensemble: 51 },
  { id: "dwd_icon_global", centre: "DWD", name: "ICON", skill: 0.85, hourly: 78, steps: 3, ensemble: 40 },
  { id: "ncep_gfs_global", centre: "NOAA", name: "GFS", skill: 0.75, hourly: 120, steps: 3, ensemble: 31 },
  { id: "cmc_gem_gdps", centre: "ECCC", name: "GEM", skill: 0.7, hourly: 84, steps: 3, ensemble: 21 },
  { id: "cma_grapes_global", centre: "CMA", name: "GRAPES", skill: 0.55, hourly: 0, steps: 3, ensemble: 0 },
  { id: "ecmwf_aifs025_single", centre: "ECMWF", name: "AIFS (AI)", skill: 0.85, hourly: 0, steps: 6, ensemble: 0 },
  { id: "ncep_aigfs025", centre: "NOAA", name: "AIGFS (AI)", skill: 0.6, hourly: 0, steps: 6, ensemble: 31 },
] as const;

export type ConsensusModel = (typeof CONSENSUS_MODELS)[number];
export type ModelId = ConsensusModel["id"];

/** Asked of every model: the rain and chance of rain of the hour before each time, and the weather code. */
export const CONSENSUS_VARIABLES = ["precipitation", "precipitation_probability", "weather_code"] as const;
/**
 * Days asked for (up to 14 costs the same). Each hour reads the next hour's
 * record, so the models cover one day less: this week.
 */
export const CONSENSUS_DAYS = 8;

/** US EPA AQI with its PM2.5, PM10 and ozone parts; concentrations in µg/m³. */
export const AIR_VARIABLES = [
  "us_aqi",
  "us_aqi_pm2_5",
  "us_aqi_pm10",
  "us_aqi_ozone",
  "pm2_5",
  "pm10",
  "ozone",
] as const;

export type CurrentVariable = (typeof CURRENT_VARIABLES)[number];
export type HourlyVariable = (typeof HOURLY_VARIABLES)[number];
export type AirVariable = (typeof AIR_VARIABLES)[number];

/** Missing values come back as null. */
export type Values = (number | null)[];

export interface ForecastResponse {
  /** The model grid cell used, which can be a few km from the point asked for. */
  latitude: number;
  longitude: number;
  utc_offset_seconds: number;
  timezone: string;
  current?: { time: number; interval: number } & Partial<Record<CurrentVariable, number | null>>;
  hourly?: { time: number[] } & Partial<Record<HourlyVariable, Values>>;
  minutely_15?: { time: number[]; precipitation?: Values };
}

/**
 * Several models in one reply: each column is named `<variable>_<model id>`
 * (just `<variable>` if only one model answered). A model with no data for a
 * place is left out, and one that lacks a variable sends a column of nulls.
 */
export interface ConsensusResponse {
  utc_offset_seconds: number;
  hourly?: { time: number[] } & Record<string, Values | number[] | undefined>;
}

export interface AirQualityResponse {
  current?: { time: number; interval: number } & Partial<Record<AirVariable, number | null>>;
}

/** Open-Meteo's own error reply (HTTP 400), e.g. for an unknown variable. */
export interface ErrorResponse {
  error: true;
  reason: string;
}

/** Coordinates to about 100 m: finer than any weather model, and the same place always asks the same URL. */
const coordinate = (value: number) => value.toFixed(3);

/** Everything the dashboard shows for one place. */
export function forecastParams(place: Place): URLSearchParams {
  return new URLSearchParams({
    latitude: coordinate(place.point.lat),
    longitude: coordinate(place.point.lon),
    current: CURRENT_VARIABLES.join(","),
    hourly: HOURLY_VARIABLES.join(","),
    minutely_15: "precipitation",
    forecast_minutely_15: String(NOWCAST_QUARTERS),
    forecast_days: String(FORECAST_DAYS),
    // Hours then start at the place's midnight, so today is a whole day.
    timezone: place.timeZone,
    timeformat: "unixtime",
  });
}

/**
 * The rain of every model in CONSENSUS_MODELS for one place, to compare them
 * (7 models × 3 variables = 2.1 API calls).
 */
export function consensusParams(place: Place): URLSearchParams {
  return new URLSearchParams({
    latitude: coordinate(place.point.lat),
    longitude: coordinate(place.point.lon),
    hourly: CONSENSUS_VARIABLES.join(","),
    models: CONSENSUS_MODELS.map((m) => m.id).join(","),
    forecast_days: String(CONSENSUS_DAYS),
    timezone: place.timeZone,
    timeformat: "unixtime",
  });
}

export function airQualityParams(place: Place): URLSearchParams {
  return new URLSearchParams({
    latitude: coordinate(place.point.lat),
    longitude: coordinate(place.point.lon),
    current: AIR_VARIABLES.join(","),
    timezone: place.timeZone,
    timeformat: "unixtime",
  });
}

/** A few values every hour for several places, from this hour for `hours` hours. */
export function spotParams(points: GeoPoint[], hours: number): URLSearchParams {
  return new URLSearchParams({
    latitude: points.map((p) => coordinate(p.lat)).join(","),
    longitude: points.map((p) => coordinate(p.lon)).join(","),
    hourly: SPOT_VARIABLES.join(","),
    forecast_hours: String(hours),
    timeformat: "unixtime",
  });
}

/** The key two points share when they would ask for the same weather. */
export const pointKey = (p: GeoPoint) => `${coordinate(p.lat)},${coordinate(p.lon)}`;

export class OpenMeteoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenMeteoError";
  }
}
