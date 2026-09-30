/**
 * Simulated backend for crowdsourced weather reports ("it's raining here").
 *
 * - Other people's reports are generated deterministically from the same
 *   field model as the forecast: someone standing where the model has heavy
 *   rain usually reports heavy rain, and now and then someone gets it wrong.
 *   They arrive at random moments, more often when it rains, and the same
 *   place and time always give the same reports.
 * - Reports from this device are kept in localStorage, so they survive a
 *   reload and show in every tab, and are dropped an hour after they were made.
 */

import { distanceKm } from "./weathernext3/places";
import type { AtmosphericSample, GeoPoint } from "./weathernext3/types";
import { weatherNext3, type WeatherNext3MockService } from "./WeatherNext3MockService";

export type ReportKind = "sunny" | "cloudy" | "lightRain" | "heavyRain";
export const REPORT_KINDS: readonly ReportKind[] = ["sunny", "cloudy", "lightRain", "heavyRain"];

export interface CrowdReport {
  id: string;
  kind: ReportKind;
  point: GeoPoint;
  /** ISO time the report was made. */
  time: string;
  /** Sent from this device. */
  mine: boolean;
}

/** Reports fade out and leave the map an hour after they are made. */
export const REPORT_TTL_MS = 60 * 60_000;
/** Reports this close to a place are "local" to it, in km (about a city and its suburbs). */
export const REPORT_RADIUS_KM = 30;
/** Simulated reporters keep this far apart, in km, so their pins do not pile up on the map. */
const MIN_SPACING_KM = 5;
/** Reporting again within this time changes your last report instead of adding one. */
export const REPLACE_WINDOW_MS = 10 * 60_000;
/** Rain rate that people call heavy, mm/h. */
export const HEAVY_RATE = 4;
/** Cloud cover from which a dry sky counts as cloudy, percent. */
export const CLOUDY_COVER = 60;

const STORAGE_KEY = "doofah-weather-reports";
const SLOT_MS = 5 * 60_000;
const KM_PER_DEGREE = 111.32;

/** The report that matches the model at a point: what someone standing there should see. */
export function radarKind(sample: Pick<AtmosphericSample, "precipitationMm" | "cloudCover">): ReportKind {
  if (sample.precipitationMm >= HEAVY_RATE) return "heavyRain";
  if (sample.precipitationMm >= 0.1) return "lightRain";
  return sample.cloudCover >= CLOUDY_COVER ? "cloudy" : "sunny";
}

export const isRainReport = (kind: ReportKind) => kind === "lightRain" || kind === "heavyRain";

/** How much of its hour a report has left, from 1 (just made) to 0 (gone). */
export const reportLife = (report: CrowdReport, now: number) =>
  Math.min(1, Math.max(0, 1 - (now - Date.parse(report.time)) / REPORT_TTL_MS));

/** Reports still inside their hour and within `radiusKm` of `center`, newest first. */
export function liveReports(reports: CrowdReport[], now: number, center?: GeoPoint, radiusKm = REPORT_RADIUS_KM) {
  return reports
    .filter((r) => {
      const age = now - Date.parse(r.time);
      return age >= 0 && age < REPORT_TTL_MS && (!center || distanceKm(center, r.point) <= radiusKm);
    })
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

/**
 * Adds this device's report. A report within REPLACE_WINDOW_MS of the last one
 * near the same spot replaces it (changing your mind is not a second witness).
 */
export function addMyReport(mine: CrowdReport[], kind: ReportKind, point: GeoPoint, now: number): CrowdReport[] {
  const report: CrowdReport = { id: `me-${now}`, kind, point, time: new Date(now).toISOString(), mine: true };
  const kept = liveReports(mine, now).filter(
    (r) => !(now - Date.parse(r.time) < REPLACE_WINDOW_MS && distanceKm(r.point, point) < 1),
  );
  return [report, ...kept];
}

function isReport(value: unknown): value is CrowdReport {
  const r = value as CrowdReport;
  return (
    !!r &&
    typeof r.id === "string" &&
    REPORT_KINDS.includes(r.kind) &&
    typeof r.point?.lat === "number" &&
    typeof r.point?.lon === "number" &&
    !Number.isNaN(Date.parse(r.time))
  );
}

export function parseMyReports(raw: string | null): CrowdReport[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(isReport).map((r) => ({ ...r, mine: true })) : [];
  } catch {
    return [];
  }
}

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

export interface CrowdReportMockOptions {
  weather?: WeatherNext3MockService;
  /** Simulated network latency, ms. Default 180. Use 0 in tests. */
  latencyMs?: number;
  now?: () => number;
}

export class CrowdReportMockService {
  private readonly weather: WeatherNext3MockService;
  private readonly latencyMs: number;
  private readonly now: () => number;

  constructor(options: CrowdReportMockOptions = {}) {
    this.weather = options.weather ?? weatherNext3;
    this.latencyMs = options.latencyMs ?? 180;
    this.now = options.now ?? Date.now;
  }

  /** Other people's reports from the last hour within REPORT_RADIUS_KM of `center`, newest first. */
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

export const crowdReports = new CrowdReportMockService();

/* ------------------------------------------------------------------ */
/* This device's reports (for useSyncExternalStore)                    */
/* ------------------------------------------------------------------ */

const EMPTY: CrowdReport[] = [];
const listeners = new Set<() => void>();
let current: CrowdReport[] | null = null;

function load(): CrowdReport[] {
  try {
    return parseMyReports(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage blocked (private mode): reports still work for this visit.
    return EMPTY;
  }
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  current = parseMyReports(event.newValue);
  listeners.forEach((listener) => listener());
}

export const myReportsStore = {
  subscribe(listener: () => void) {
    if (listeners.size === 0) window.addEventListener("storage", onStorage);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): CrowdReport[] {
    current ??= load();
    return current;
  },
  getServerSnapshot(): CrowdReport[] {
    return EMPTY;
  },
  /** Sends a report. It shows at once; the mock backend is this device's storage. */
  submit(kind: ReportKind, point: GeoPoint, now: number = Date.now()): CrowdReport {
    current = addMyReport(myReportsStore.getSnapshot(), kind, point, now);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Still shown for this visit when storage is full or blocked.
    }
    listeners.forEach((listener) => listener());
    return current[0];
  },
};
