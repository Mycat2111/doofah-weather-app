/**
 * Other people's weather reports, simulated for `?data=sim` and the check
 * scripts.
 *
 * They are generated deterministically from the same field model as the
 * simulated forecast: someone standing where the model has heavy rain usually
 * reports heavy rain, and now and then someone gets it wrong. They arrive at
 * random moments, more often when it rains, and the same place and time
 * always give the same reports.
 */

import {
  isRainReport,
  radarKind,
  REPORT_KINDS,
  REPORT_RADIUS_KM,
  REPORT_TTL_MS,
  type CrowdReport,
  type ReportKind,
} from "@/lib/crowdReports";
import { distanceKm } from "../weather/places";
import type { GeoPoint } from "../weather/types";
import { weatherSimulation, type SimulatedWeatherService } from "./SimulatedWeatherService";

/** Simulated reporters keep this far apart, in km, so their pins do not pile up on the map. */
const MIN_SPACING_KM = 5;
const SLOT_MS = 5 * 60_000;
const KM_PER_DEGREE = 111.32;

/* ------------------------------------------------------------------ */
/* Deterministic randomness                                            */
/* ------------------------------------------------------------------ */

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A small seeded generator (mulberry32). */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* The service                                                         */
/* ------------------------------------------------------------------ */

export interface SimulatedCrowdReportsOptions {
  weather?: SimulatedWeatherService;
  /** Simulated network latency, ms. Default 180. Use 0 in tests. */
  latencyMs?: number;
  now?: () => number;
}

export class SimulatedCrowdReports {
  private readonly weather: SimulatedWeatherService;
  private readonly latencyMs: number;
  private readonly now: () => number;

  constructor(options: SimulatedCrowdReportsOptions = {}) {
    this.weather = options.weather ?? weatherSimulation;
    this.latencyMs = options.latencyMs ?? 180;
    this.now = options.now ?? Date.now;
  }

  /** Other people's reports from the last 3 hours within REPORT_RADIUS_KM of `center`, newest first. */
  async getCommunityReports(center: GeoPoint): Promise<CrowdReport[]> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    return this.communityReports(center, this.now());
  }

  communityReports(center: GeoPoint, now: number): CrowdReport[] {
    // Seeded by a ~1 km area, so the same place always has the same neighbours.
    const area = `${center.lat.toFixed(2)},${center.lon.toFixed(2)}`;
    const reports: CrowdReport[] = [];
    const firstSlot = Math.floor((now - REPORT_TTL_MS) / SLOT_MS);
    for (let slot = firstSlot; slot <= Math.floor(now / SLOT_MS); slot++) {
      const rnd = random(hash(`${area}|${slot}`));
      const time = slot * SLOT_MS + rnd() * SLOT_MS;
      // Spread over the area, but not on top of the place's own marker.
      const km = REPORT_RADIUS_KM * Math.sqrt(0.04 + 0.96 * rnd());
      const angle = rnd() * 2 * Math.PI;
      const point = {
        lat: center.lat + (km / KM_PER_DEGREE) * Math.cos(angle),
        lon: center.lon + (km / (KM_PER_DEGREE * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(angle),
      };
      const chance = rnd();
      const mistake = rnd();
      const other = rnd();
      if (time > now || now - time >= REPORT_TTL_MS) continue;
      if (reports.some((r) => distanceKm(r.point, point) < MIN_SPACING_KM)) continue;

      const seen = this.weather.sampleAt(point, time);
      const truth = radarKind(seen);
      // People report more when it rains.
      if (chance > (isRainReport(truth) ? 0.75 : 0.4)) continue;
      // About one in eight picks the wrong button or saw a shower the radar missed.
      const kind = mistake < 0.12 ? REPORT_KINDS.filter((k) => k !== truth)[Math.floor(other * 3)] : truth;
      reports.push({ id: `c-${area}-${slot}`, kind, point, time: new Date(time).toISOString(), mine: false });
    }
    return reports.reverse();
  }

  /** Where the model puts the report's spot at the report's time, for checking it. */
  radarAt(report: CrowdReport): ReportKind {
    return radarKind(this.weather.sampleAt(report.point, Date.parse(report.time)));
  }
}

/** Shared instance for `?data=sim`. */
export const crowdSimulation = new SimulatedCrowdReports();
