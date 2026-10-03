import type { RadarGridSpec } from "./types";

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
