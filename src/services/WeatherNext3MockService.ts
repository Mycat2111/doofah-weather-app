/**
 * WeatherNext3MockService
 *
 * A simulated client for a WeatherNext 3 style forecast API:
 *   • 5 km × 5 km spatial grid
 *   • 1-hour temporal steps
 *   • 15-day horizon with ensemble-style probabilities that widen with lead time
 *   • Map layers: total precipitation (+ cloud), 10 m wind, 2 m temperature, MSL pressure
 *
 * All data comes from one deterministic field model, so the hero card, the
 * hourly strip, the 15-day list and every radar frame agree with each other,
 * and the same seed always reproduces the same weather.
 */

import {
  FieldModel,
  classifyCondition,
  climatologyWeight,
  dewPoint,
  ensembleDamping,
  feelsLike,
  precipitationProbability,
  uvIndex,
  type FieldState,
} from "./weathernext3/fieldModel";
import { buildGridSpec, cellCenter, snapToGrid } from "./weathernext3/grid";
import { DEFAULT_PLACE, placeForPoint, searchPlaces } from "./weathernext3/places";
import { sunTimes } from "./weathernext3/solar";
import { atmosphereFor, nowcastFromSteps, summariseDay } from "./weathernext3/summarise";
import { DAY_MS, HOUR_MS, floorToHour, localDateKey, zonedMidnight, zonedParts } from "./weathernext3/time";
import type {
  AtmosphericSample,
  CurrentConditions,
  DailyForecast,
  ForecastBundle,
  GeoPoint,
  GridCell,
  HourlyForecast,
  ModelInfo,
  Nowcast,
  Place,
  RadarFrame,
  RadarFrameOf,
  RadarFrameSet,
  RadarGridSpec,
  RadarLayerType,
  RadarRequest,
} from "./weathernext3/types";
import type { WeatherService } from "./weatherService";

export * from "./weathernext3/types";
export { DEFAULT_PLACE, PLACES } from "./weathernext3/places";
export { sampleGrid, snapToGrid } from "./weathernext3/grid";
export { describeDayEn, describeNowcastEn } from "./weathernext3/describe";
export { atmosphereFor } from "./weathernext3/summarise";

export const FORECAST_HORIZON_DAYS = 15;
const MAX_HOURLY = FORECAST_HORIZON_DAYS * 24;
const RUN_INTERVAL_MS = 6 * HOUR_MS;
const RUN_LATENCY_MS = 3 * HOUR_MS;

export interface WeatherNext3MockOptions {
  /** Changes the simulated weather entirely. Default 3. */
  seed?: number;
  /** Simulated network latency per request, ms. Default 220. Use 0 in tests. */
  latencyMs?: number;
  /** Clock override, for tests and storybook-style fixtures. */
  now?: () => number;
}

export class WeatherNext3MockService implements WeatherService {
  readonly source = "simulated" as const;
  private readonly model: FieldModel;
  private readonly latencyMs: number;
  private readonly now: () => number;
  private readonly radarCache = new Map<string, Promise<unknown>>();

  constructor(options: WeatherNext3MockOptions = {}) {
    this.model = new FieldModel(options.seed ?? 3);
    this.latencyMs = options.latencyMs ?? 220;
    this.now = options.now ?? Date.now;
  }

  /* ------------------------------------------------------------ */
  /* Metadata and places                                           */
  /* ------------------------------------------------------------ */

  getModelInfo(): ModelInfo {
    const run = Math.floor((this.now() - RUN_LATENCY_MS) / RUN_INTERVAL_MS) * RUN_INTERVAL_MS;
    return {
      model: "WeatherNext 3",
      version: "3.0-sim",
      runInitTime: new Date(run).toISOString(),
      spatialResolutionKm: 5,
      temporalResolutionHours: 1,
      horizonDays: FORECAST_HORIZON_DAYS,
      ensembleMembers: 64,
      simulated: true,
    };
  }

  snapToGrid(point: GeoPoint): GridCell {
    return snapToGrid(point);
  }

  async searchPlaces(query: string): Promise<Place[]> {
    await this.delay(0.4);
    return searchPlaces(query);
  }

  /** Nearest known city within 40 km, otherwise a coordinate label. */
  placeForPoint(point: GeoPoint, timeZone?: string): Place {
    return placeForPoint(point, timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  }

  get defaultPlace(): Place {
    return DEFAULT_PLACE;
  }

  /* ------------------------------------------------------------ */
  /* Point forecasts                                               */
  /* ------------------------------------------------------------ */

  /** Synchronous single sample at the 5 km cell containing `point`. */
  sampleAt(point: GeoPoint, time: Date | number = this.now()): AtmosphericSample {
    const ms = typeof time === "number" ? time : time.getTime();
    const { center } = snapToGrid(point);
    const lead = (ms - this.now()) / HOUR_MS;
    return this.toSample(center, ms, lead, this.model.sample(center.lat, center.lon, ms, lead));
  }

  /** The 10-minute rain nowcast from `time` at the 5 km cell containing `point`, as the radar shows it. */
  nowcastAt(point: GeoPoint, time: number): Nowcast {
    return this.buildNowcast(snapToGrid(point).center, time);
  }

  async getCurrentConditions(place: Place): Promise<CurrentConditions> {
    await this.delay(1);
    return this.buildCurrent(place);
  }

  async getHourlyForecast(place: Place, hours = 48): Promise<HourlyForecast[]> {
    await this.delay(1);
    return this.buildHourly(place, hours);
  }

  async getDailyForecast(place: Place, days = FORECAST_HORIZON_DAYS): Promise<DailyForecast[]> {
    await this.delay(1.2);
    return this.buildDaily(place, days);
  }

  /**
   * Weather at many points, each at its own time, in one request: a road
   * trip's stops at the times you reach them.
   */
  async getWeatherAlong(stops: { point: GeoPoint; time: string }[]): Promise<AtmosphericSample[]> {
    await this.delay(1);
    return stops.map((stop) => this.sampleAt(stop.point, Date.parse(stop.time)));
  }

  /** Everything the dashboard needs in one round trip. */
  async getForecastBundle(place: Place, hourlyHours = 48): Promise<ForecastBundle> {
    await this.delay(1.5);
    return {
      current: this.buildCurrent(place),
      hourly: this.buildHourly(place, hourlyHours),
      daily: this.buildDaily(place, FORECAST_HORIZON_DAYS),
    };
  }

  /* ------------------------------------------------------------ */
  /* Radar layers                                                  */
  /* ------------------------------------------------------------ */

  /**
   * Hourly frames of one layer over `bounds`, from `fromOffsetHours` (default
   * -3) to `toOffsetHours` (default +24) around the current hour. Frames are
   * computed with a yield between each so the UI stays responsive, and
   * results are cached per layer, grid and hour.
   */
  getRadarFrames<L extends RadarLayerType>(request: RadarRequest<L>): Promise<RadarFrameSet<L>> {
    const from = Math.max(-24, Math.round(request.fromOffsetHours ?? -3));
    const to = Math.min(MAX_HOURLY, Math.round(request.toOffsetHours ?? 24));
    const grid = buildGridSpec(request.bounds, request.maxCellsPerSide ?? 96);
    const baseHour = floorToHour(this.now());
    const key = [
      request.layer,
      baseHour,
      from,
      to,
      grid.rows,
      grid.cols,
      grid.bounds.flat().map((v) => v.toFixed(4)).join(","),
    ].join("|");

    const cached = this.radarCache.get(key);
    if (cached) return cached as Promise<RadarFrameSet<L>>;

    const promise = this.computeFrames(request.layer, grid, baseHour, from, to);
    this.radarCache.set(key, promise);
    if (this.radarCache.size > 12) {
      const oldest = this.radarCache.keys().next().value;
      if (oldest !== undefined) this.radarCache.delete(oldest);
    }
    promise.catch(() => this.radarCache.delete(key));
    return promise;
  }

  private async computeFrames<L extends RadarLayerType>(
    layer: L,
    grid: RadarGridSpec,
    baseHour: number,
    from: number,
    to: number,
  ): Promise<RadarFrameSet<L>> {
    await this.delay(1);
    const frames: RadarFrameOf<L>[] = [];
    let min = Infinity;
    let max = -Infinity;
    const nowMs = this.now();

    for (let offset = from; offset <= to; offset++) {
      const ms = baseHour + offset * HOUR_MS;
      const lead = Math.max(0, (ms - nowMs) / HOUR_MS);
      const frame = this.computeFrame(layer, grid, ms, lead, offset);
      const values = primaryValues(frame);
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      frames.push(frame as RadarFrameOf<L>);
      // Let the browser paint between frames.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    return { layer, grid, frames, range: { min, max }, model: this.getModelInfo() };
  }

  private computeFrame(
    layer: RadarLayerType,
    grid: RadarGridSpec,
    ms: number,
    lead: number,
    offsetHours: number,
  ): RadarFrame {
    const { rows, cols } = grid;
    const n = rows * cols;
    const th = ms / HOUR_MS;
    const base = {
      time: new Date(ms).toISOString(),
      offsetHours,
      kind: offsetHours <= 0 ? ("analysis" as const) : ("forecast" as const),
    };
    const m = this.model;
    const damping = ensembleDamping(lead);

    switch (layer) {
      case "pressure": {
        const pressure = new Float32Array(n);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const p = cellCenter(grid, r, c);
            pressure[r * cols + c] = m.pressure(p.lat, p.lon, th);
          }
        }
        return { ...base, layer, pressure };
      }

      case "wind": {
        // Pressure on a grid padded by one cell, then central differences.
        const pr = rows + 2;
        const pc = cols + 2;
        const padded = new Float32Array(pr * pc);
        for (let r = 0; r < pr; r++) {
          for (let c = 0; c < pc; c++) {
            const p = cellCenter(grid, r - 1, c - 1);
            padded[r * pc + c] = m.pressure(p.lat, p.lon, th);
          }
        }
        const u = new Float32Array(n);
        const v = new Float32Array(n);
        const speed = new Float32Array(n);
        const dyKm = grid.latStep * 110.574;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const p = cellCenter(grid, r, c);
            const dxKm = grid.lonStep * 111.32 * Math.cos((p.lat * Math.PI) / 180);
            const pi = (r + 1) * pc + (c + 1);
            const dpdx = (padded[pi + 1] - padded[pi - 1]) / (2 * dxKm);
            // Row index grows southward, so north minus south is (pi - pc) - (pi + pc).
            const dpdy = (padded[pi - pc] - padded[pi + pc]) / (2 * dyKm);
            const w = m.windFromGradient(p.lat, p.lon, th, dpdx, dpdy, 0);
            const i = r * cols + c;
            u[i] = w.u;
            v[i] = w.v;
            speed[i] = w.speed;
          }
        }
        return { ...base, layer, u, v, speed };
      }

      case "precipitation":
      case "temperature": {
        const rate = new Float32Array(n);
        const cloud = new Float32Array(n);
        const temperature = layer === "temperature" ? new Float32Array(n) : null;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const p = cellCenter(grid, r, c);
            const i = r * cols + c;
            const pressure = m.pressure(p.lat, p.lon, th);
            const moisture = m.moisture(p.lat, p.lon, th, pressure);
            const precip = m.precipitation(p.lat, p.lon, th, moisture, pressure);
            const rr = damping * (precip.convective + precip.stratiform);
            const cl = m.cloud(p.lat, p.lon, th, moisture, rr);
            rate[i] = rr;
            cloud[i] = cl;
            if (temperature) temperature[i] = m.temperature(p.lat, p.lon, th, moisture, cl, rr);
          }
        }
        return temperature
          ? { ...base, layer: "temperature", temperature }
          : { ...base, layer: "precipitation", rate, cloud };
      }
    }
  }

  /* ------------------------------------------------------------ */
  /* Builders                                                      */
  /* ------------------------------------------------------------ */

  private buildCurrent(place: Place): CurrentConditions {
    const now = this.now();
    const cell = snapToGrid(place.point);
    const { center } = cell;
    const state = this.model.sample(center.lat, center.lon, now, 0);
    const sample = this.toSample(center, now, 0, state);

    const today = zonedParts(now, place.timeZone);
    const midnight = zonedMidnight(today.year, today.month, today.day, place.timeZone);
    const sun = sunTimes(midnight, center.lat, center.lon);

    return {
      place,
      source: "simulated",
      cell,
      observedAt: new Date(now).toISOString(),
      sample,
      airQuality: this.model.airQuality(center.lat, center.lon, now, state),
      atmosphere: atmosphereFor(sample, state.sunElevationDeg),
      sunrise: sun.sunrise === null ? null : new Date(sun.sunrise).toISOString(),
      sunset: sun.sunset === null ? null : new Date(sun.sunset).toISOString(),
      nowcast: this.buildNowcast(center, now, state.rate),
      model: this.getModelInfo(),
    };
  }

  /** `rateNow` is the rain now, when already worked out with the rest of the conditions. */
  private buildNowcast(center: GeoPoint, now: number, rateNow?: number): Nowcast {
    const steps = Array.from({ length: 13 }, (_, i) => {
      const ms = now + i * 10 * 60_000;
      const th = ms / HOUR_MS;
      const m = this.model;
      const pressure = m.pressure(center.lat, center.lon, th);
      const moisture = m.moisture(center.lat, center.lon, th, pressure);
      const precip = m.precipitation(center.lat, center.lon, th, moisture, pressure);
      const rate = i === 0 && rateNow !== undefined ? rateNow : precip.convective + precip.stratiform;
      return { time: new Date(ms).toISOString(), precipitationMm: round1(rate) };
    });
    return nowcastFromSteps(steps);
  }

  private buildHourly(place: Place, hours: number): HourlyForecast[] {
    const count = Math.max(1, Math.min(MAX_HOURLY, Math.round(hours)));
    const now = this.now();
    const start = floorToHour(now);
    const { center } = snapToGrid(place.point);
    return Array.from({ length: count }, (_, k) => this.hourAt(center, start + k * HOUR_MS, now, k));
  }

  private hourAt(center: GeoPoint, ms: number, now: number, leadHours: number): HourlyForecast {
    const lead = Math.max(0, (ms - now) / HOUR_MS);
    const state = this.model.sample(center.lat, center.lon, ms, lead);
    return {
      ...this.toSample(center, ms, lead, state),
      leadHours,
      confidence: round2(Math.exp(-lead / 200) * 0.96 + 0.04),
    };
  }

  private buildDaily(place: Place, days: number): DailyForecast[] {
    const count = Math.max(1, Math.min(FORECAST_HORIZON_DAYS, Math.round(days)));
    const now = this.now();
    const { center } = snapToGrid(place.point);
    const today = zonedParts(now, place.timeZone);
    const firstMidnight = zonedMidnight(today.year, today.month, today.day, place.timeZone);

    const result: DailyForecast[] = [];
    for (let d = 0; d < count; d++) {
      // Step via noon to stay robust across DST changes.
      const noon = zonedParts(firstMidnight + d * DAY_MS + 12 * HOUR_MS, place.timeZone);
      const start = zonedMidnight(noon.year, noon.month, noon.day, place.timeZone);
      const next = zonedParts(start + 36 * HOUR_MS, place.timeZone);
      const end = zonedMidnight(next.year, next.month, next.day, place.timeZone);

      const hours: HourlyForecast[] = [];
      for (let ms = start; ms < end; ms += HOUR_MS) {
        hours.push(this.hourAt(center, ms, now, Math.round((ms - floorToHour(now)) / HOUR_MS)));
      }
      const sun = sunTimes(start, center.lat, center.lon);
      // Chance of rain at some point in the day: the wettest hour, pulled toward
      // climatology for far-out days where the ensemble disagrees.
      const w = climatologyWeight(hours[Math.floor(hours.length / 2)].leadHours);
      const peakHourly = Math.max(...hours.map((h) => h.precipitationProbability));
      const chance = Math.round(peakHourly * (1 - 0.45 * w) + 25 * w);
      result.push(summariseDay(localDateKey(start, place.timeZone), hours, sun, place.timeZone, chance));
    }
    return result;
  }

  private toSample(center: GeoPoint, ms: number, lead: number, s: FieldState): AtmosphericSample {
    const condition = classifyCondition(s);
    return {
      time: new Date(ms).toISOString(),
      temperatureC: round1(s.temperatureC),
      feelsLikeC: round1(feelsLike(s.temperatureC, s.humidity, s.windSpeedKmh)),
      dewPointC: round1(dewPoint(s.temperatureC, s.humidity)),
      humidity: Math.round(s.humidity),
      pressureHpa: round1(s.pressureHpa),
      windSpeedKmh: round1(s.windSpeedKmh),
      windGustKmh: round1(s.windGustKmh),
      windDirectionDeg: Math.round(windFromDirection(s.u, s.v)),
      precipitationMm: round1(s.rate),
      precipitationProbability: precipitationProbability(s.precip, lead),
      cloudCover: Math.round(s.cloud * 100),
      visibilityKm: round1(s.visibilityKm),
      uvIndex: round1(uvIndex(s.sunElevationDeg, s.cloud)),
      condition,
      isDay: s.sunElevationDeg > -0.83,
      sunElevationDeg: round1(s.sunElevationDeg),
    };
  }

  private delay(factor: number): Promise<void> {
    const ms = this.latencyMs * factor;
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Meteorological "from" direction for a (u, v) vector. */
function windFromDirection(u: number, v: number): number {
  const deg = (Math.atan2(-u, -v) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function primaryValues(frame: RadarFrame): Float32Array {
  switch (frame.layer) {
    case "precipitation":
      return frame.rate;
    case "wind":
      return frame.speed;
    case "temperature":
      return frame.temperature;
    case "pressure":
      return frame.pressure;
  }
}

/** Shared app-wide instance. */
export const weatherNext3 = new WeatherNext3MockService();
