/**
 * DooFah's unified forecast: one answer per place that every screen reads,
 * built from exactly two weather models. WRF covers the first 48 hours where
 * it is available, ECMWF everything after, and WRF eases into ECMWF over its
 * last 6 hours (see router.ts). Every hour says which model it came from.
 *
 * This is also the reply of /api/forecast, so it is snake_case, like
 * Open-Meteo's replies and like the `model_used` tag.
 */

import type { DayOutlook, WeatherCondition } from "../weathernext3/types";

export type Model = "WRF" | "ECMWF";

/** The model behind an hour or a day; both while WRF eases into ECMWF. */
export type ModelUsed = Model | "WRF+ECMWF";

/** Why an answer has no WRF in it. */
export type WrfMissing =
  /** DooFah has no WRF source set up yet. */
  | "not-configured"
  /** The WRF source could not be reached, or had no run for now. */
  | "unavailable"
  /** The place is outside the area WRF covers. */
  | "outside-area";

/** One run of one model, as used for an answer. */
export interface Run {
  model: Model;
  /** When the run started (UTC, ISO); null when the provider doesn't say. */
  init: string | null;
  resolution_km: number;
  /** Who served the data, e.g. "open-meteo". */
  source: string;
}

/** Values that can come from the other model when the active one has none, saying so in `borrowed`. */
export type BorrowableValue =
  | "temperature_c"
  | "humidity"
  | "pressure_hpa"
  | "cloud_cover"
  | "rain_mm"
  | "wind"
  | "gust_kmh"
  | "visibility_km";

export interface UnifiedHour {
  /**
   * Start of the hour (UTC, ISO). Rain, its chance and gusts are for the hour
   * from here; the other values are for this instant.
   */
  time: string;
  /** Whole hours from `issued_at`; negative for the hours earlier today. */
  lead_hours: number;
  model_used: ModelUsed;
  /** Only while WRF eases into ECMWF: how much each model counts, adding up to 1. */
  weights?: { WRF: number; ECMWF: number };
  /** Values the hour's model lacked, and the model they came from instead. */
  borrowed?: Partial<Record<BorrowableValue, Model>>;
  /** From the numbers below (conditionFrom), never taken from a model or blended. */
  condition: WeatherCondition;
  temperature_c: number;
  feels_like_c: number;
  /** Percent. */
  humidity: number;
  dew_point_c: number;
  rain_mm: number;
  /** Percent; null when the hour's model gives no chance of rain (it is never taken from the other model). */
  rain_chance: number | null;
  /** Percent. */
  cloud_cover: number;
  pressure_hpa: number;
  /** m/s towards the east. */
  wind_u: number;
  /** m/s towards the north. */
  wind_v: number;
  wind_kmh: number;
  /** Where the wind blows from, degrees clockwise from north. */
  wind_from_deg: number;
  gust_kmh: number | null;
  visibility_km: number | null;
  /** The model's, or worked out from the sun's height and the cloud when it has none. */
  uv_index: number;
  is_day: boolean;
}

/** How a day reads at a glance, in a form any UI language can phrase (its rain is the day's `rain_mm`). */
export type UnifiedOutlook = Omit<DayOutlook, "precipitationMm">;

/** One local calendar day, summarised from its hours. */
export interface UnifiedDay {
  /** YYYY-MM-DD in the place's time zone. */
  date: string;
  /** "WRF+ECMWF" when its hours come from both models. */
  model_used: ModelUsed;
  condition: WeatherCondition;
  outlook: UnifiedOutlook;
  min_temp_c: number;
  max_temp_c: number;
  rain_mm: number;
  /** The highest chance of rain of any of its hours; null when no hour has one. */
  rain_chance: number | null;
  max_wind_kmh: number;
  wind_from_deg: number;
  max_uv_index: number;
  mean_humidity: number;
  sunrise: string | null;
  sunset: string | null;
}

export interface UnifiedForecast {
  /** The hour the forecast counts from (UTC, ISO): `timestamp` rounded down to the hour. */
  issued_at: string;
  /** The point forecast, which may be rounded from the one asked for (see snapPoint). */
  place: { lat: number; lon: number; time_zone: string };
  runs: { WRF: Run | null; ECMWF: Run | null };
  /** Set when the answer has no WRF. */
  wrf_missing?: WrfMissing;
  /** The hours over which WRF eases into ECMWF; null without WRF. */
  blend: { from: string; to: string } | null;
  /** Every hour from local midnight today to the end of the last day. */
  hours: UnifiedHour[];
  /** Today and the days after it, each only when all its hours are there. */
  days: UnifiedDay[];
}
