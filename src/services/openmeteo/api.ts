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
