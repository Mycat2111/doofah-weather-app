/**
 * The simulation's 5 km grid: a place's cell, and the grid its map layers
 * are drawn on.
 */

import type { GeoBounds, GeoPoint, GridCell, RadarGridSpec } from "../weather/types";

export const CELL_KM = 5;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQ = 111.32;
const RAD = Math.PI / 180;

export const LAT_STEP_5KM = CELL_KM / KM_PER_DEG_LAT;

const lonStepAt = (lat: number, cellKm: number) =>
  cellKm / (KM_PER_DEG_LON_EQ * Math.max(0.05, Math.cos(lat * RAD)));

/** Snap a point to its 5 km × 5 km model cell. */
export function snapToGrid(point: GeoPoint): GridCell {
  const row = Math.floor((point.lat + 90) / LAT_STEP_5KM);
  const south = -90 + row * LAT_STEP_5KM;
  const centerLat = south + LAT_STEP_5KM / 2;
  const lonStep = lonStepAt(centerLat, CELL_KM);
  const col = Math.floor((point.lon + 180) / lonStep);
  const west = -180 + col * lonStep;
  return {
    id: `SIM-5K-${row.toString(36).toUpperCase()}${col.toString(36).toUpperCase().padStart(4, "0")}`,
    row,
    col,
    center: { lat: centerLat, lon: west + lonStep / 2 },
    bounds: [
      [south, west],
      [south + LAT_STEP_5KM, west + lonStep],
    ],
    resolutionKm: CELL_KM,
  };
}

/**
 * Build a regular grid covering `bounds`, aligned to the global grid so cells
 * stay put while the map pans. Coarsens beyond `maxCellsPerSide`.
 */
export function buildGridSpec(bounds: GeoBounds, maxCellsPerSide: number): RadarGridSpec {
  const [[s0, w0], [n0, e0]] = bounds;
  const south = Math.max(-85, Math.min(s0, n0));
  const north = Math.min(85, Math.max(s0, n0));
  const west = Math.min(w0, e0);
  const east = Math.max(w0, e0);
  const centerLat = (south + north) / 2;

  const spanKm = Math.max(
    (north - south) * KM_PER_DEG_LAT,
    (east - west) * KM_PER_DEG_LON_EQ * Math.cos(centerLat * RAD),
  );
  const cellSizeKm = Math.max(CELL_KM, Math.ceil(spanKm / maxCellsPerSide / CELL_KM) * CELL_KM);
  const latStep = cellSizeKm / KM_PER_DEG_LAT;
  const lonStep = lonStepAt(Math.round(centerLat), cellSizeKm);

  const gs = Math.floor(south / latStep) * latStep;
  const gn = Math.ceil(north / latStep) * latStep;
  const gw = Math.floor(west / lonStep) * lonStep;
  const ge = Math.ceil(east / lonStep) * lonStep;
  const rows = Math.max(2, Math.round((gn - gs) / latStep));
  const cols = Math.max(2, Math.round((ge - gw) / lonStep));

  return {
    bounds: [
      [gs, gw],
      [gs + rows * latStep, gw + cols * lonStep],
    ],
    rows,
    cols,
    latStep,
    lonStep,
    cellSizeKm,
  };
}

/** Centre of grid cell (row, col). Row 0 is the northern edge. */
export function cellCenter(grid: RadarGridSpec, row: number, col: number): GeoPoint {
  const [[, west], [north]] = grid.bounds;
  return {
    lat: north - (row + 0.5) * grid.latStep,
    lon: west + (col + 0.5) * grid.lonStep,
  };
}
