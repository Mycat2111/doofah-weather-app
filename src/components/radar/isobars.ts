import type { RadarGridSpec } from "@/services/weather/types";

/** A contour segment as [lat1, lon1, lat2, lon2]. */
export type Segment = [number, number, number, number];

export interface IsobarSet {
  interval: number;
  levels: { value: number; segments: Segment[] }[];
  centers: { kind: "H" | "L"; lat: number; lon: number; value: number }[];
}

// Marching-squares segment table. Edges: 0 top, 1 right, 2 bottom, 3 left.
const CASES: number[][][] = [
  [],
  [[3, 2]],
  [[2, 1]],
  [[3, 1]],
  [[0, 1]],
  [
    [3, 0],
    [2, 1],
  ],
  [[0, 2]],
  [[3, 0]],
  [[3, 0]],
  [[0, 2]],
  [
    [0, 1],
    [3, 2],
  ],
  [[0, 1]],
  [[3, 1]],
  [[2, 1]],
  [[3, 2]],
  [],
];

/** Isobars (every 1, 2 or 4 hPa depending on the range) plus H/L centres. */
export function computeIsobars(grid: RadarGridSpec, values: Float32Array): IsobarSet {
  const { rows, cols } = grid;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const interval = range < 6 ? 1 : range < 16 ? 2 : 4;
  const [[, west], [north]] = grid.bounds;
  const toLatLon = (r: number, c: number): [number, number] => [
    north - (r + 0.5) * grid.latStep,
    west + (c + 0.5) * grid.lonStep,
  ];
  const at = (r: number, c: number) => values[r * cols + c];

  const levels: IsobarSet["levels"] = [];
  for (let level = Math.ceil(min / interval) * interval; level <= max; level += interval) {
    const segments: Segment[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const tl = at(r, c);
        const tr = at(r, c + 1);
        const br = at(r + 1, c + 1);
        const bl = at(r + 1, c);
        // A cell the model left empty has no line through it.
        if (Number.isNaN(tl + tr + br + bl)) continue;
        const idx = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
        const edges = CASES[idx];
        if (!edges.length) continue;
        const point = (edge: number): [number, number] => {
          const f = (a: number, b: number) => (level - a) / (b - a || 1e-9);
          switch (edge) {
            case 0:
              return toLatLon(r, c + f(tl, tr));
            case 1:
              return toLatLon(r + f(tr, br), c + 1);
            case 2:
              return toLatLon(r + 1, c + f(bl, br));
            default:
              return toLatLon(r + f(tl, bl), c);
          }
        };
        for (const [a, b] of edges) {
          const p = point(a);
          const q = point(b);
          segments.push([p[0], p[1], q[0], q[1]]);
        }
      }
    }
    if (segments.length) levels.push({ value: level, segments });
  }

  // Pressure centres: strict extrema within a window, away from the edges.
  const centers: IsobarSet["centers"] = [];
  const win = Math.max(4, Math.round(Math.min(rows, cols) / 8));
  for (let r = win; r < rows - win; r += 2) {
    for (let c = win; c < cols - win; c += 2) {
      const v = at(r, c);
      if (Number.isNaN(v)) continue;
      let isMax = true;
      let isMin = true;
      for (let dr = -win; dr <= win && (isMax || isMin); dr++) {
        for (let dc = -win; dc <= win; dc++) {
          if (!dr && !dc) continue;
          const w = at(r + dr, c + dc);
          if (w >= v) isMax = false;
          if (w <= v) isMin = false;
        }
      }
      if ((isMax || isMin) && range > 0.8) {
        const [lat, lon] = toLatLon(r, c);
        centers.push({ kind: isMax ? "H" : "L", lat, lon, value: v });
      }
    }
  }

  return { interval, levels, centers };
}
