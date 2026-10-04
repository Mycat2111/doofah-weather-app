/**
 * The point a forecast is made for. Shared by DooFah's server and the page:
 * the page asks /api/forecast for the rounded point, so every screen that
 * shows the same place asks the same URL and gets the same answer.
 */

import type { GeoPoint } from "../weather/types";

/** Coordinates are rounded to this many degrees (about 1 km), far finer than either model. */
export const SNAP_DEGREES = 0.01;

/** The point a forecast is made for: `lat`, `lon` rounded to SNAP_DEGREES, so nearby requests share answers. */
export function snapPoint(lat: number, lon: number): GeoPoint {
  const snap = (v: number) => Math.round(v / SNAP_DEGREES) * SNAP_DEGREES;
  return { lat: Number(snap(lat).toFixed(2)), lon: Number(snap(lon).toFixed(2)) };
}

/** The query for a point's forecast, e.g. "lat=13.76&lon=100.50": the same for every point that rounds alike. */
export function forecastQuery(point: GeoPoint): string {
  const { lat, lon } = snapPoint(point.lat, point.lon);
  return `lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
}
