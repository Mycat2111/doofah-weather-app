/**
 * DooFah v2's forecast for one place: the newest model run in the forecast
 * store (supabase/migrations/*_wx_*.sql), as /api/v2/point sends it. Shared by
 * the server, which builds it, and the page, which draws it.
 */

/** The forecast store keeps Thai time; every time in a WxPoint is written with +07:00. */
export const WX_TIME_ZONE = "Asia/Bangkok";

export interface WxStep {
  /** When the step ends, e.g. "2026-10-07T13:00+07:00". */
  time: string;
  /** `precipMm` fell in this many minutes before `time`: 60, then 180, then 360 further out. 0 at the run's start. */
  periodMinutes: number;
  /** Null at the run's start, where nothing has fallen yet. */
  precipMm: number | null;
  tempC: number | null;
  windMs: number | null;
  /** Degrees the wind blows from. */
  windDir: number | null;
  cloudPct: number | null;
}

export interface WxPoint {
  source: { id: string; label: { en: string; th: string }; licence: string; attribution: string };
  /** The model's start time, when DooFah loaded it, and its grid spacing. */
  run: { time: string; readyAt: string; gridKm: number };
  /** The grid point the forecast is for, and how far it is from the place asked about. */
  point: { lat: number; lon: number; distanceKm: number };
  steps: WxStep[];
}

/** Rain over a step as mm per hour, so 1-, 3- and 6-hour steps compare; null where it isn't known. */
export function rainRate(step: WxStep): number | null {
  if (step.precipMm === null || step.periodMinutes <= 0) return null;
  return step.precipMm / (step.periodMinutes / 60);
}

/**
 * Where the page asks for a place's v2 forecast. Coordinates are rounded to
 * 0.01° (about 1 km; ECMWF's points are 9 km apart), so nearby taps share one
 * cached answer.
 */
export function wxPointPath(lat: number, lon: number): string {
  return `/api/v2/point?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
}
