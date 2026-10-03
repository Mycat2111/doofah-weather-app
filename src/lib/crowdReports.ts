/**
 * Weather reports from people ("it's raining here"): the kinds, how long a
 * report lasts and how far it counts, and this device's own reports, kept in
 * localStorage so they survive a reload and show in every tab, and dropped an
 * hour after they were made.
 *
 * There is no shared backend yet, so with real forecasts only your own
 * reports show. Other people's come from the simulation, with `?data=sim`
 * (services/simulation/SimulatedCrowdReports.ts).
 */

import { distanceKm } from "@/services/weather/places";
import type { AtmosphericSample, GeoPoint } from "@/services/weather/types";

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
/** Reporting again within this time changes your last report instead of adding one. */
export const REPLACE_WINDOW_MS = 10 * 60_000;
/** Rain rate that people call heavy, mm/h. */
export const HEAVY_RATE = 4;
/** Cloud cover from which a dry sky counts as cloudy, percent. */
export const CLOUDY_COVER = 60;

const STORAGE_KEY = "doofah-weather-reports";

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
  /** Sends a report. It shows at once; it is kept in this device's storage. */
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
