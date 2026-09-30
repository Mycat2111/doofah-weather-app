import type { GeoBounds, GeoPoint, GridCell, RadarGridSpec } from "./types";

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
    id: `WN3-5K-${row.toString(36).toUpperCase()}${col.toString(36).toUpperCase().padStart(4, "0")}`,
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

/** Bilinear interpolation of a row-major field; NaN outside the grid. */
export function sampleGrid(grid: RadarGridSpec, values: ArrayLike<number>, lat: number, lon: number): number {
  const [[, west], [north]] = grid.bounds;
  const fx = (lon - west) / grid.lonStep - 0.5;
  const fy = (north - lat) / grid.latStep - 0.5;
  if (fx < 0 || fy < 0 || fx > grid.cols - 1 || fy > grid.rows - 1) return Number.NaN;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, grid.cols - 1);
  const y1 = Math.min(y0 + 1, grid.rows - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const i = (r: number, c: number) => values[r * grid.cols + c];
  const top = i(y0, x0) * (1 - tx) + i(y0, x1) * tx;
  const bottom = i(y1, x0) * (1 - tx) + i(y1, x1) * tx;
  return top * (1 - ty) + bottom * ty;
}
