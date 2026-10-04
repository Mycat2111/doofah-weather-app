/**
 * Radar frames between the hourly ones, so the map's timeline moves in
 * minutes rather than jumping an hour at a time.
 *
 * Rain moves kilometres in an hour, so a plain cross-fade between two hourly
 * frames would show a shower fading out in one place and in at the next. For
 * rain and cloud the motion between the two frames is estimated instead
 * (block matching on a small image pyramid, the optical flow radar nowcasts
 * use), and each in-between frame carries both frames part of the way along
 * it before blending them. The cloud cover layer moves the same way.
 * Temperature, pressure and wind are smooth and slow-changing, so they blend
 * linearly.
 *
 * Works on any hourly frames on a grid: the simulation's, or ECMWF's from
 * /api/fields. Cells the model left empty (NaN) count as clear sky when
 * tracking motion.
 */

import type { RadarFrame, RadarGridSpec } from "@/services/weather/types";

/** Displacement from one frame to the next, per cell, in cells: east (columns) and south (rows). */
export interface Flow {
  rows: number;
  cols: number;
  dx: Float32Array;
  dy: Float32Array;
}

/** Fastest rain the motion search looks for, km/h: a fast squall line. */
export const MAX_SPEED_KMH = 80;
/** Cells either side of a cell compared when matching (a 5 × 5 window). */
const WINDOW = 2;
/** The pyramid stops halving below this many cells per side. */
const MIN_LEVEL_CELLS = 8;
/**
 * Motion is matched on the finest level with at most this many cells per
 * side, then scaled up: rain moves in a smooth pattern, and it keeps the
 * work small on a phone.
 */
const FLOW_CELLS = 64;
/** Widest search at the coarsest level, in its cells. */
const MAX_RADIUS = 8;
/**
 * Cost per cell of moving away from the coarser level's guess (or from no
 * motion at the top), so featureless areas stay still instead of wandering.
 */
const PENALTY = 0.02;

const clampIndex = (i: number, n: number) => (i < 0 ? 0 : i >= n ? n - 1 : i);

/** Bilinear sample of a row-major field at fractional (row, col), clamped to the edges. */
function bilinear(values: Float32Array, rows: number, cols: number, r: number, c: number): number {
  const y = r < 0 ? 0 : r > rows - 1 ? rows - 1 : r;
  const x = c < 0 ? 0 : c > cols - 1 ? cols - 1 : c;
  const y0 = Math.floor(y);
  const x0 = Math.floor(x);
  const y1 = Math.min(y0 + 1, rows - 1);
  const x1 = Math.min(x0 + 1, cols - 1);
  const ty = y - y0;
  const tx = x - x0;
  const top = values[y0 * cols + x0] * (1 - tx) + values[y0 * cols + x1] * tx;
  const bottom = values[y1 * cols + x0] * (1 - tx) + values[y1 * cols + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

interface Level {
  rows: number;
  cols: number;
  a: Float32Array;
  b: Float32Array;
}

/** Half the size: each cell the mean of up to four. */
function halve(values: Float32Array, rows: number, cols: number): Float32Array {
  const r2 = Math.ceil(rows / 2);
  const c2 = Math.ceil(cols / 2);
  const out = new Float32Array(r2 * c2);
  for (let r = 0; r < r2; r++) {
    for (let c = 0; c < c2; c++) {
      let sum = 0;
      let n = 0;
      for (let j = 2 * r; j < Math.min(rows, 2 * r + 2); j++) {
        for (let i = 2 * c; i < Math.min(cols, 2 * c + 2); i++) {
          sum += values[j * cols + i];
          n++;
        }
      }
      out[r * c2 + c] = sum / n;
    }
  }
  return out;
}

/**
 * Best displacement for every cell of a level: the one, near the guess,
 * where the window around the cell in `a` best matches `b`, to a fraction of
 * a cell (a parabola through the best match and its neighbours).
 */
function match(
  level: Level,
  guessX: Float32Array,
  guessY: Float32Array,
  radius: number,
  dx: Float32Array,
  dy: Float32Array,
) {
  const { rows, cols, a, b } = level;
  const span = 2 * radius + 1;
  const costs = new Float32Array(span * span);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const gx = Math.round(guessX[k]);
      const gy = Math.round(guessY[k]);
      let best = Infinity;
      let bi = 0;
      let bj = 0;
      for (let j = -radius; j <= radius; j++) {
        for (let i = -radius; i <= radius; i++) {
          const ox = gx + i;
          const oy = gy + j;
          let cost = PENALTY * (Math.abs(ox - guessX[k]) + Math.abs(oy - guessY[k])) * (2 * WINDOW + 1) ** 2;
          for (let wy = -WINDOW; wy <= WINDOW; wy++) {
            const ra = clampIndex(r + wy, rows) * cols;
            const rb = clampIndex(r + wy + oy, rows) * cols;
            for (let wx = -WINDOW; wx <= WINDOW; wx++) {
              cost += Math.abs(a[ra + clampIndex(c + wx, cols)] - b[rb + clampIndex(c + wx + ox, cols)]);
            }
          }
          costs[(j + radius) * span + i + radius] = cost;
          if (cost < best) {
            best = cost;
            bi = i;
            bj = j;
          }
        }
      }
      const at = (i: number, j: number) => costs[(j + radius) * span + i + radius];
      const vertex = (before: number, after: number) => {
        const curve = before - 2 * best + after;
        return curve > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / curve)) : 0;
      };
      dx[k] = gx + bi + (Math.abs(bi) < radius ? vertex(at(bi - 1, bj), at(bi + 1, bj)) : 0);
      dy[k] = gy + bj + (Math.abs(bj) < radius ? vertex(at(bi, bj - 1), at(bi, bj + 1)) : 0);
    }
  }
}

/**
 * Smooth a flow, trusting cells with detail (where matching means something)
 * over flat ones, so motion found at a shower's edges carries across it.
 */
function smooth(flow: { dx: Float32Array; dy: Float32Array }, level: Level) {
  const { rows, cols, a, b } = level;
  const weight = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const right = r * cols + clampIndex(c + 1, cols);
      const down = clampIndex(r + 1, rows) * cols + c;
      weight[k] =
        1e-3 +
        Math.abs(a[right] - a[k]) +
        Math.abs(a[down] - a[k]) +
        Math.abs(b[right] - b[k]) +
        Math.abs(b[down] - b[k]);
    }
  }
  for (const key of ["dx", "dy"] as const) {
    const src = flow[key];
    const out = new Float32Array(src.length);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let total = 0;
        for (let j = Math.max(0, r - 2); j <= Math.min(rows - 1, r + 2); j++) {
          for (let i = Math.max(0, c - 2); i <= Math.min(cols - 1, c + 2); i++) {
            const w = weight[j * cols + i];
            sum += w * src[j * cols + i];
            total += w;
          }
        }
        out[r * cols + c] = sum / total;
      }
    }
    flow[key] = out;
  }
}

/** A coarser level's flow on the next finer level: positions and distances doubled. */
function upsample(src: Float32Array, rows: number, cols: number, toRows: number, toCols: number): Float32Array {
  const out = new Float32Array(toRows * toCols);
  for (let r = 0; r < toRows; r++) {
    for (let c = 0; c < toCols; c++) {
      out[r * toCols + c] = 2 * bilinear(src, rows, cols, (r + 0.5) / 2 - 0.5, (c + 0.5) / 2 - 0.5);
    }
  }
  return out;
}

/**
 * The motion from field `a` to field `b` (row-major, `rows` × `cols`): for
 * each cell, how far its feature moved, in cells. `maxShift` is the largest
 * move to look for, in cells.
 */
export function estimateFlow(rows: number, cols: number, a: Float32Array, b: Float32Array, maxShift: number): Flow {
  const levels: Level[] = [{ rows, cols, a, b }];
  for (;;) {
    const top = levels[levels.length - 1];
    if (Math.min(top.rows, top.cols) < 2 * MIN_LEVEL_CELLS) break;
    levels.push({
      rows: Math.ceil(top.rows / 2),
      cols: Math.ceil(top.cols / 2),
      a: halve(top.a, top.rows, top.cols),
      b: halve(top.b, top.rows, top.cols),
    });
  }

  let finest = 0;
  while (Math.max(levels[finest].rows, levels[finest].cols) > FLOW_CELLS && finest < levels.length - 1) finest++;

  let flow: { dx: Float32Array; dy: Float32Array } = { dx: new Float32Array(0), dy: new Float32Array(0) };
  for (let l = levels.length - 1; l >= finest; l--) {
    const level = levels[l];
    const n = level.rows * level.cols;
    const coarser = levels[l + 1];
    const guessX = coarser
      ? upsample(flow.dx, coarser.rows, coarser.cols, level.rows, level.cols)
      : new Float32Array(n);
    const guessY = coarser
      ? upsample(flow.dy, coarser.rows, coarser.cols, level.rows, level.cols)
      : new Float32Array(n);
    const radius = coarser ? 1 : Math.min(MAX_RADIUS, Math.max(1, Math.ceil(maxShift / 2 ** l)));
    flow = { dx: new Float32Array(n), dy: new Float32Array(n) };
    match(level, guessX, guessY, radius, flow.dx, flow.dy);
    smooth(flow, level);
  }
  for (let l = finest; l > 0; l--) {
    const [from, to] = [levels[l], levels[l - 1]];
    flow = {
      dx: upsample(flow.dx, from.rows, from.cols, to.rows, to.cols),
      dy: upsample(flow.dy, from.rows, from.cols, to.rows, to.cols),
    };
  }
  return { rows, cols, dx: flow.dx, dy: flow.dy };
}

/**
 * The field a fraction `t` (0 to 1) of the way from `a` to `b`: each frame
 * carried that far along `flow` (from its end), then the two blended.
 */
export function advect(a: Float32Array, b: Float32Array, flow: Flow, t: number): Float32Array {
  const { rows, cols, dx, dy } = flow;
  const out = new Float32Array(a.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const u = dx[k];
      const v = dy[k];
      const from = bilinear(a, rows, cols, r - t * v, c - t * u);
      const to = bilinear(b, rows, cols, r + (1 - t) * v, c + (1 - t) * u);
      out[k] = from + (to - from) * t;
    }
  }
  return out;
}

/** A linear blend a fraction `t` of the way from `a` to `b`. */
export function lerp(a: Float32Array, b: Float32Array, t: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

/** A number, or 0 where the model left a cell empty. */
const orZero = (v: number) => (Number.isFinite(v) ? v : 0);

/** What the motion is tracked on for rain: the rain itself, saturating, plus a little of the cloud. */
function rainFeature(rate: Float32Array, cloud: Float32Array): Float32Array {
  const out = new Float32Array(rate.length);
  for (let i = 0; i < rate.length; i++)
    out[i] = 0.65 * Math.min(1, Math.sqrt(Math.max(0, orZero(rate[i]))) / 3) + 0.35 * orZero(cloud[i]);
  return out;
}

/** What the motion is tracked on for cloud cover: the cover, 0 to 1. */
function cloudFeature(cover: Float32Array): Float32Array {
  const out = new Float32Array(cover.length);
  for (let i = 0; i < cover.length; i++) out[i] = orZero(cover[i]) / 100;
  return out;
}

/** The field the motion between two frames is tracked on, for the layers that move with the weather. */
function feature(frame: RadarFrame): Float32Array | null {
  if (frame.layer === "precipitation") return rainFeature(frame.rate, frame.cloud);
  if (frame.layer === "clouds") return cloudFeature(frame.cover);
  return null;
}

/**
 * How much of the difference between `a` and `b` the flow accounts for: the
 * mismatch left after moving `a` along it, as a share of the mismatch
 * without moving it. Near 1, the change is growth and decay, not motion.
 * Moves by whole cells, so that blurring alone (as sampling between cells
 * would) never passes for motion.
 */
export function unexplained(flow: Flow, a: Float32Array, b: Float32Array): number {
  const { rows, cols, dx, dy } = flow;
  let moved = 0;
  let still = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const from = clampIndex(Math.round(r - dy[k]), rows) * cols + clampIndex(Math.round(c - dx[k]), cols);
      moved += Math.abs(a[from] - b[k]);
      still += Math.abs(a[k] - b[k]);
    }
  }
  return still > 0 ? moved / still : 1;
}

/**
 * How far to trust a flow from the share of the change it leaves unexplained:
 * fully up to TRUSTED, not at all from IGNORED, in proportion between. Rain
 * that grows and decays more than it moves (or a grid too coarse to follow
 * it) cross-fades instead of sliding somewhere it isn't going. Even fields
 * that have nothing to do with each other "explain" some of their difference
 * by chance (about 0.85 to 0.95), so the line sits below that.
 */
const TRUSTED = 0.8;
const IGNORED = 0.95;

/**
 * The motion between two hourly frames, for the layers that move with it,
 * scaled by how much of the change it explains. Null for the layers that
 * blend, and when no motion explains the change.
 */
export function frameFlow(grid: RadarGridSpec, a: RadarFrame, b: RadarFrame, hours = 1): Flow | null {
  if (a.layer !== b.layer) return null;
  const fa = feature(a);
  const fb = feature(b);
  if (!fa || !fb) return null;
  const flow = estimateFlow(grid.rows, grid.cols, fa, fb, (MAX_SPEED_KMH * hours) / grid.cellSizeKm);
  const trust = Math.min(1, Math.max(0, (IGNORED - unexplained(flow, fa, fb)) / (IGNORED - TRUSTED)));
  if (trust === 0) return null;
  if (trust < 1) {
    for (let i = 0; i < flow.dx.length; i++) {
      flow.dx[i] *= trust;
      flow.dy[i] *= trust;
    }
  }
  return flow;
}

/** The frame a fraction `t` of the way from frame `a` to frame `b`, at `time`. */
export function frameBetween(a: RadarFrame, b: RadarFrame, t: number, time: number, flow: Flow | null): RadarFrame {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const base = {
    time: new Date(time).toISOString(),
    offsetHours: a.offsetHours + (b.offsetHours - a.offsetHours) * t,
    kind: a.kind,
  };
  if (a.layer === "precipitation" && b.layer === "precipitation") {
    const move = (x: Float32Array, y: Float32Array) => (flow ? advect(x, y, flow, t) : lerp(x, y, t));
    return { ...base, layer: "precipitation", rate: move(a.rate, b.rate), cloud: move(a.cloud, b.cloud) };
  }
  if (a.layer === "clouds" && b.layer === "clouds") {
    return { ...base, layer: "clouds", cover: flow ? advect(a.cover, b.cover, flow, t) : lerp(a.cover, b.cover, t) };
  }
  if (a.layer === "temperature" && b.layer === "temperature") {
    return { ...base, layer: "temperature", temperature: lerp(a.temperature, b.temperature, t) };
  }
  if (a.layer === "wind" && b.layer === "wind") {
    return { ...base, layer: "wind", u: lerp(a.u, b.u, t), v: lerp(a.v, b.v, t), speed: lerp(a.speed, b.speed, t) };
  }
  if (a.layer === "pressure" && b.layer === "pressure") {
    return { ...base, layer: "pressure", pressure: lerp(a.pressure, b.pressure, t) };
  }
  return t < 0.5 ? a : b;
}

/** Where `time` falls among frames: the frame at or before it, and how far on towards the next (0 to 1). */
export function frameSpan(times: number[], time: number): { index: number; t: number } {
  if (!times.length || time <= times[0]) return { index: 0, t: 0 };
  const last = times.length - 1;
  if (time >= times[last]) return { index: last, t: 0 };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  return { index: lo, t: (time - times[lo]) / (times[hi] - times[lo]) };
}
