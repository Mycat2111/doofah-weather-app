/**
 * Data contracts for the simulated WeatherNext 3 API.
 *
 * Every value is produced by a deterministic, continuous field model so that a
 * point forecast, an hourly series and a radar grid for the same place and time
 * always agree with each other.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** South-west and north-east corners, Leaflet style: [[south, west], [north, east]]. */
export type GeoBounds = [[number, number], [number, number]];

export interface Place {
  id: string;
  name: string;
  /** Native-script name when it differs from `name`, e.g. "กรุงเทพฯ". */
  localName?: string;
  region?: string;
  country: string;
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

export interface Nowcast {
  /** Human sentence such as "Rain starting in about 40 min". */
  summary: string;
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
  cell: GridCell;
  observedAt: string;
  sample: AtmosphericSample;
  airQuality: AirQuality;
  atmosphere: AtmosphereTheme;
  sunrise: string | null;
  sunset: string | null;
  nowcast: Nowcast;
  model: ModelInfo;
}

export interface HourlyForecast extends AtmosphericSample {
  /** Hours after the current hour (0 = this hour). */
  leadHours: number;
  /** Model confidence 0–1, decays with lead time. */
  confidence: number;
}

export interface DailyForecast {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  minTempC: number;
  maxTempC: number;
  condition: WeatherCondition;
  summary: string;
  precipitationMm: number;
  precipitationProbability: number;
  maxWindKmh: number;
  dominantWindDirectionDeg: number;
  maxUvIndex: number;
  meanHumidity: number;
  sunrise: string | null;
  sunset: string | null;
  confidence: number;
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

export type RadarLayerType = "precipitation" | "wind" | "temperature" | "pressure";

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
  /** Whole hours relative to the current hour, e.g. -3 … 24. */
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

export type RadarFrame = PrecipitationFrame | WindFrame | TemperatureFrame | PressureFrame;

export type RadarFrameOf<L extends RadarLayerType> = Extract<RadarFrame, { layer: L }>;

export interface RadarFrameSet<L extends RadarLayerType = RadarLayerType> {
  layer: L;
  grid: RadarGridSpec;
  frames: RadarFrameOf<L>[];
  /** Value range across all frames, for stable colour scales and legends. */
  range: { min: number; max: number };
  model: ModelInfo;
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
