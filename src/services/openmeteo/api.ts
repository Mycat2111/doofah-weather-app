/**
 * Requests to Open-Meteo (https://open-meteo.com/en/docs) and the shape of
 * its replies. Times are asked for as Unix seconds (`timeformat=unixtime`).
 *
 * Two of its APIs are used: the forecast, asked by DooFah's server for ECMWF
 * alone (forecast/ecmwf.ts), and air quality, asked by the page. The free
 * servers are for non-commercial use. A commercial subscription uses the
 * `customer-` servers with an API key, which only DooFah's server holds (see
 * proxy.ts).
 */

import type { Place } from "../weathernext3/types";

export type Endpoint = "forecast" | "air-quality";

export const FREE_URL: Record<Endpoint, string> = {
  forecast: "https://api.open-meteo.com/v1/forecast",
  "air-quality": "https://air-quality-api.open-meteo.com/v1/air-quality",
};

export const CUSTOMER_URL: Record<Endpoint, string> = {
  forecast: "https://customer-api.open-meteo.com/v1/forecast",
  "air-quality": "https://customer-air-quality-api.open-meteo.com/v1/air-quality",
};

/** Days of forecast: today and the next 14, like the 15-day list. */
export const FORECAST_DAYS = 15;

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
  hourly?: { time: number[] } & Partial<Record<HourlyVariable, Values>>;
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

export function airQualityParams(place: Place): URLSearchParams {
  return new URLSearchParams({
    latitude: coordinate(place.point.lat),
    longitude: coordinate(place.point.lon),
    current: AIR_VARIABLES.join(","),
    timezone: place.timeZone,
    timeformat: "unixtime",
  });
}

export class OpenMeteoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenMeteoError";
  }
}
