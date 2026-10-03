/**
 * Data contracts for DooFah's weather data, from either source: the live
 * forecast (WRF and ECMWF, see services/forecast), or the simulated
 * WeatherNext 3 API.
 *
 * In the simulation every value comes from a deterministic, continuous field
 * model, so a point forecast, an hourly series and a radar grid for the same
 * place and time always agree with each other.
 */

import type { Model, ModelUsed } from "../forecast/types";

/** Where the weather comes from: the live forecast from /api/forecast, or DooFah's simulation. */
export type WeatherSource = "live" | "simulated";

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** South-west and north-east corners, Leaflet style: [[south, west], [north, east]]. */
export type GeoBounds = [[number, number], [number, number]];

export interface PlaceNames {
  name: string;
  region?: string;
  country: string;
}

export interface Place {
  id: string;
  name: string;
  /** Native-script name when it differs from `name`, e.g. "กรุงเทพฯ". */
  localName?: string;
  region?: string;
  country: string;
  /** Thai names for the place, region and country. */
  th?: PlaceNames;
  /** Extra search terms, e.g. "กทม" for Bangkok. */
  aliases?: string[];
  point: GeoPoint;
  /** IANA time zone used for every local time shown for this place. */
  timeZone: string;
}

/** One cell of the 5 km × 5 km WeatherNext 3 grid. */
export interface GridCell {
  id: string;
  row: number;
  col: number;
  center: GeoPoint;
  bounds: GeoBounds;
  resolutionKm: number;
}

export type WeatherCondition =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy-rain"
  | "thunderstorm"
  | "snow";

/** Visual mood of the sky, used to drive the dynamic background. */
export type AtmosphereTheme =
  | "clear-day"
  | "clear-night"
  | "golden-hour"
  | "cloudy-day"
  | "cloudy-night"
  | "fog"
  | "rain"
  | "heavy-rain"
  | "thunderstorm"
  | "snow";

export const ATMOSPHERE_THEMES: readonly AtmosphereTheme[] = [
  "clear-day",
  "clear-night",
  "golden-hour",
  "cloudy-day",
  "cloudy-night",
  "fog",
  "rain",
  "heavy-rain",
  "thunderstorm",
  "snow",
];

/** Full atmospheric state at one point and one instant. */
export interface AtmosphericSample {
  /** ISO 8601, UTC. */
  time: string;
  temperatureC: number;
  feelsLikeC: number;
  dewPointC: number;
  /** Relative humidity, 0–100. */
  humidity: number;
  /** Mean sea-level pressure. */
  pressureHpa: number;
  windSpeedKmh: number;
  windGustKmh: number;
  /** Meteorological convention: direction the wind blows FROM, 0 = north. */
  windDirectionDeg: number;
  /** Precipitation rate in mm/h (equal to the hourly accumulation for hourly steps). */
  precipitationMm: number;
  /** Probability of ≥ 0.1 mm/h, 0–100. Widens with lead time like an ensemble would. */
  precipitationProbability: number;
  /** 0–100. */
  cloudCover: number;
  visibilityKm: number;
  uvIndex: number;
  condition: WeatherCondition;
  isDay: boolean;
  /** Sun elevation above the horizon in degrees. */
  sunElevationDeg: number;
}

/** The few values shown for a spot at a glance: a favorite's chip, a stop on a road trip. */
export type SpotWeather = Pick<
  AtmosphericSample,
  "time" | "temperatureC" | "precipitationMm" | "precipitationProbability" | "condition" | "isDay"
>;

export type AqiCategory =
  | "Good"
  | "Moderate"
  | "Unhealthy for Sensitive Groups"
  | "Unhealthy"
  | "Very Unhealthy"
  | "Hazardous";

export type Pollutant = "pm25" | "pm10" | "o3";

export interface AirQuality {
  /** US EPA AQI, 0–500. */
  aqi: number;
  category: AqiCategory;
  dominantPollutant: Pollutant;
  /** µg/m³ */
  pm25: number;
  /** µg/m³ */
  pm10: number;
  /** ppb */
  o3: number;
}

export interface NowcastStep {
  time: string;
  precipitationMm: number;
}

export type RainIntensity = "drizzle" | "light" | "moderate" | "heavy";

/** What the next two hours hold, in a form any UI language can phrase. */
export type NowcastOutlook =
  | { kind: "dry" }
  | { kind: "starting"; minutes: number; intensity: RainIntensity }
  | { kind: "stopping"; minutes: number; intensity: RainIntensity }
  | { kind: "continuing"; intensity: RainIntensity };

export interface Nowcast {
  /** English sentence such as "Rain starting in about 40 min". */
  summary: string;
  outlook: NowcastOutlook;
  /** Next 2 hours in 10-minute steps. */
  steps: NowcastStep[];
}

export interface ModelInfo {
  model: string;
  version: string;
  /** ISO time the current model run was initialised. */
  runInitTime: string;
  spatialResolutionKm: number;
  temporalResolutionHours: number;
  horizonDays: number;
  ensembleMembers: number;
  simulated: true;
}

export interface CurrentConditions {
  place: Place;
  source: WeatherSource;
  /** The simulation's 5 km grid cell; null for real data. */
  cell: GridCell | null;
  observedAt: string;
  /**
   * Set when these are the forecast for another moment than now, picked on
   * the map's timeline: that time (ISO), which `observedAt` then also is.
   */
  forecastFor?: string;
  /**
   * Set when there was no connection and this is the last forecast saved on
   * the device: when it was downloaded (ISO). The conditions are its forecast
   * for now.
   */
  savedAt?: string;
  sample: AtmosphericSample;
  /** Null when the air quality service could not be reached. */
  airQuality: AirQuality | null;
  atmosphere: AtmosphereTheme;
  sunrise: string | null;
  sunset: string | null;
  nowcast: Nowcast;
  /** The simulated model run; null for real data. */
  model: ModelInfo | null;
  /** Live forecasts: the model behind this hour, for the tag on the card. */
  modelUsed?: ModelUsed;
  /** Live forecasts: the models behind any of its hours, for the credits. */
  models?: Model[];
}

export interface HourlyForecast extends AtmosphericSample {
  /** Hours after the current hour (0 = this hour). */
  leadHours: number;
  /** Confidence 0–1: the simulation's model confidence, which decays with lead time; null for live forecasts. */
  confidence: number | null;
  /** Live forecasts: the model behind the hour (both while WRF eases into ECMWF). */
  modelUsed?: ModelUsed;
}

export type DayPeriod = "overnight" | "morning" | "afternoon" | "evening";

export type DayOutlookKind =
  | "thunderstorms"
  | "heavy-rain"
  | "downpours"
  | "showers"
  | "light-showers"
  | "snow"
  | "fog"
  | "mostly-cloudy"
  | "hot-sunny-spells"
  | "sun-and-cloud"
  | "hot-sunny"
  | "clear";

/** The day in structured form, so any UI language can phrase it. */
export interface DayOutlook {
  kind: DayOutlookKind;
  /** When the wettest hour falls, in local time. */
  period: DayPeriod;
  precipitationMm: number;
  wind: "calm" | "breezy" | "windy";
}

export interface DailyForecast {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  minTempC: number;
  maxTempC: number;
  condition: WeatherCondition;
  /** English sentence such as "Showers in the afternoon". */
  summary: string;
  outlook: DayOutlook;
  precipitationMm: number;
  precipitationProbability: number;
  maxWindKmh: number;
  dominantWindDirectionDeg: number;
  maxUvIndex: number;
  meanHumidity: number;
  sunrise: string | null;
  sunset: string | null;
  /** As for an hour: the simulation's only. */
  confidence: number | null;
  /** Live forecasts: the model behind the day's hours, "WRF+ECMWF" when they come from both. */
  modelUsed?: ModelUsed;
  hours: HourlyForecast[];
}

export interface ForecastBundle {
  current: CurrentConditions;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
}

/* ------------------------------------------------------------------ */
/* Radar / map layers                                                  */
/* ------------------------------------------------------------------ */

export type RadarLayerType = "precipitation" | "clouds" | "wind" | "temperature" | "pressure";

/** Regular lat/lon grid. Row 0 is the northern edge, column 0 the western edge. */
export interface RadarGridSpec {
  bounds: GeoBounds;
  rows: number;
  cols: number;
  latStep: number;
  lonStep: number;
  /** Effective cell size; 5 km unless the requested area forced a coarser grid. */
  cellSizeKm: number;
}

export type FrameKind = "analysis" | "forecast";

interface RadarFrameBase {
  time: string;
  /** Hours relative to the current hour, e.g. -3 … 24: whole for the model's frames, fractional between them. */
  offsetHours: number;
  kind: FrameKind;
}

export interface PrecipitationFrame extends RadarFrameBase {
  layer: "precipitation";
  /** mm/h per cell, row-major. */
  rate: Float32Array;
  /** Cloud fraction 0–1 per cell. */
  cloud: Float32Array;
}

export interface CloudFrame extends RadarFrameBase {
  layer: "clouds";
  /** Cloud cover, percent per cell. */
  cover: Float32Array;
}

export interface WindFrame extends RadarFrameBase {
  layer: "wind";
  /** Eastward component, km/h. */
  u: Float32Array;
  /** Northward component, km/h. */
  v: Float32Array;
  speed: Float32Array;
}

export interface TemperatureFrame extends RadarFrameBase {
  layer: "temperature";
  temperature: Float32Array;
}

export interface PressureFrame extends RadarFrameBase {
  layer: "pressure";
  pressure: Float32Array;
}

export type RadarFrame = PrecipitationFrame | CloudFrame | WindFrame | TemperatureFrame | PressureFrame;

export type RadarFrameOf<L extends RadarLayerType> = Extract<RadarFrame, { layer: L }>;

export interface RadarFrameSet<L extends RadarLayerType = RadarLayerType> {
  layer: L;
  grid: RadarGridSpec;
  frames: RadarFrameOf<L>[];
  /** Value range across all frames, for stable colour scales and legends. */
  range: { min: number; max: number };
  model: FieldModel;
}

/** The model behind a map layer: the simulation's (ModelInfo), or a real one's. */
export interface FieldModel {
  model: string;
  /** ISO time of the run, when known. */
  runInitTime: string | null;
  spatialResolutionKm: number;
  simulated: boolean;
}

export interface RadarRequest<L extends RadarLayerType = RadarLayerType> {
  layer: L;
  bounds: GeoBounds;
  /** First frame, hours relative to now. Default -3. */
  fromOffsetHours?: number;
  /** Last frame, hours relative to now. Default 24. */
  toOffsetHours?: number;
  /** Upper bound on cells per side; the grid coarsens beyond it. Default 96. */
  maxCellsPerSide?: number;
}
