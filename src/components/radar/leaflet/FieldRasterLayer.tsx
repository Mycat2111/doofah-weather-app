"use client";

import { useEffect, useRef } from "react";
import { sampleGrid } from "@/services/weather/grid";
import type { RadarGridSpec } from "@/services/weather/types";
import { PRECIP_SCALE, lutIndex, type ColorScale } from "../colorScales";
import { useCanvasLayer, type CanvasHandle } from "./useCanvasLayer";

interface FieldRasterLayerProps {
  grid: RadarGridSpec;
  values: Float32Array;
  scale: ColorScale;
  /** Optional cloud fraction, painted as soft white where there is no rain. */
  cloud?: Float32Array;
  opacity?: number;
  /** When set, value labels are drawn on a map-anchored lattice (e.g. "29°"). */
  label?: (value: number) => string;
  /** Paint quickly and a little softer, while the timeline moves; the full painting follows when it rests. */
  draft?: boolean;
}

/**
 * CSS pixels per painted pixel. The field is sampled at this spacing across the
 * visible map and the result is scaled up with smoothing, so the cost stays the
 * same at every zoom level and edges never show the 5 km cells as blocks.
 */
const PIXEL_STEP = 2;
/** CSS pixels per painted pixel while the timeline moves: a quarter of the work. */
const DRAFT_STEP = 4;

/**
 * Cubic B-spline weights for the four grid points around a sample. Unlike an
 * interpolating spline it never overshoots and is smooth in its slope too, so
 * rain reads as soft cloud rather than a grid of bumps, however far you zoom in.
 */
function bspline(t: number, out: Float32Array, o: number) {
  const u = 1 - t;
  const t2 = t * t;
  out[o] = (u * u * u) / 6;
  out[o + 1] = (3 * t2 * t - 6 * t2 + 4) / 6;
  out[o + 2] = (-3 * t2 * t + 3 * t2 + 3 * t + 1) / 6;
  out[o + 3] = (t2 * t) / 6;
}

/**
 * Taps for one axis: for each painted pixel, the four grid indices (clamped
 * to the grid) and their weights, or -1 when the pixel is outside the grid.
 */
function axisTaps(positions: Float64Array, count: number) {
  const index = new Int32Array(positions.length * 4);
  const weight = new Float32Array(positions.length * 4);
  for (let p = 0; p < positions.length; p++) {
    const f = positions[p];
    const o = p * 4;
    if (!(f >= -0.5 && f <= count - 0.5)) {
      index[o] = -1;
      continue;
    }
    const i = Math.floor(f);
    bspline(f - i, weight, o);
    for (let k = 0; k < 4; k++) index[o + k] = Math.min(count - 1, Math.max(0, i - 1 + k));
  }
  return { index, weight };
}

type Taps = ReturnType<typeof axisTaps>;

/** Cells over which a field fades out towards its edge, so where it ends (zoomed far out) is soft, not a hard box. */
const EDGE_FADE_CELLS = 1.5;

/** For each painted pixel along one axis, how far it is from the grid's edges as an opacity (0 at the edge, 1 inside). */
function edgeFade(positions: Float64Array, count: number) {
  const out = new Float32Array(positions.length);
  for (let p = 0; p < positions.length; p++) {
    const inside = Math.min(positions[p] + 0.5, count - 0.5 - positions[p]) / EDGE_FADE_CELLS;
    const t = inside <= 0 ? 0 : inside >= 1 ? 1 : inside;
    out[p] = t * t * (3 - 2 * t);
  }
  return out;
}

function sample(values: Float32Array, cols: number, xs: Taps, x: number, ys: Taps, y: number) {
  let sum = 0;
  for (let r = 0; r < 4; r++) {
    const row = ys.index[y + r] * cols;
    let line = 0;
    for (let c = 0; c < 4; c++) line += xs.weight[x + c] * values[row + xs.index[x + c]];
    sum += ys.weight[y + r] * line;
  }
  return sum;
}

interface Paint {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image?: ImageData;
}

/** Colour the visible part of the field into `paint`, one pixel per `step` CSS pixels. */
function paintField(
  h: CanvasHandle,
  paint: Paint,
  step: number,
  grid: RadarGridSpec,
  values: Float32Array,
  scale: ColorScale,
  cloud?: Float32Array,
) {
  const W = Math.ceil(h.width / step);
  const H = Math.ceil(h.height / step);
  if (paint.canvas.width !== W || paint.canvas.height !== H || !paint.image) {
    paint.canvas.width = W;
    paint.canvas.height = H;
    paint.image = paint.ctx.createImageData(W, H);
  }
  const image = paint.image;
  const px = image.data;

  // Web Mercator keeps longitude a function of x and latitude a function of y,
  // so each pixel column and row maps to one fractional grid position.
  const [[, west], [north]] = grid.bounds;
  const colPos = new Float64Array(W);
  const rowPos = new Float64Array(H);
  for (let x = 0; x < W; x++) colPos[x] = (h.unproject((x + 0.5) * step, 0).lon - west) / grid.lonStep - 0.5;
  for (let y = 0; y < H; y++) rowPos[y] = (north - h.unproject(0, (y + 0.5) * step).lat) / grid.latStep - 0.5;
  const xs = axisTaps(colPos, grid.cols);
  const ys = axisTaps(rowPos, grid.rows);
  const xFade = edgeFade(colPos, grid.cols);
  const yFade = edgeFade(rowPos, grid.rows);

  const isPrecip = scale === PRECIP_SCALE;
  const { lut } = scale;
  for (let y = 0; y < H; y++) {
    const yo = y * 4;
    const inRow = ys.index[yo] >= 0;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const xo = x * 4;
      if (!inRow || xs.index[xo] < 0) {
        px[o + 3] = 0;
        continue;
      }
      const v = sample(values, grid.cols, xs, xo, ys, yo);
      const k = lutIndex(scale, v);
      const fade = xFade[x] * yFade[y];
      if (!isPrecip) {
        px[o] = lut[k];
        px[o + 1] = lut[k + 1];
        px[o + 2] = lut[k + 2];
        px[o + 3] = lut[k + 3] * fade;
        continue;
      }
      // Soft cloud where it is dry (fading in above ~35% cover), blended into
      // the rain colours over a small value range so echo edges are anti-aliased.
      const c = cloud ? Math.min(1, Math.max(0, sample(cloud, grid.cols, xs, xo, ys, yo))) : 0;
      const cloudAlpha = Math.max(0, c - 0.35) ** 1.5 * 150;
      const t = v <= 0.05 ? 0 : v >= 0.18 ? 1 : ((v - 0.05) / 0.13) ** 2 * (3 - (2 * (v - 0.05)) / 0.13);
      px[o] = 225 + (lut[k] - 225) * t;
      px[o + 1] = 232 + (lut[k + 1] - 232) * t;
      px[o + 2] = 245 + (lut[k + 2] - 245) * t;
      px[o + 3] = (cloudAlpha + (lut[k + 3] - cloudAlpha) * t) * fade;
    }
  }
  paint.ctx.putImageData(image, 0, 0);
}

/** Power-of-two degree step so label positions stay put while panning. */
const latticeStep = (degrees: number) => 2 ** Math.round(Math.log2(Math.max(degrees, 1e-3)));

function drawLabels(h: CanvasHandle, grid: RadarGridSpec, values: Float32Array, label: (v: number) => string) {
  const { ctx } = h;
  const nw = h.unproject(0, 0);
  const se = h.unproject(h.width, h.height);
  const lonStep = latticeStep(((se.lon - nw.lon) / h.width) * 130);
  const latStep = latticeStep(((nw.lat - se.lat) / h.height) * 110);

  ctx.save();
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  for (let lat = Math.floor(nw.lat / latStep) * latStep; lat >= se.lat; lat -= latStep) {
    // Offset every other row by half a step for an even, staggered spread.
    const shift = (Math.round(lat / latStep) & 1) * (lonStep / 2);
    for (let lon = Math.floor(nw.lon / lonStep) * lonStep + shift; lon <= se.lon; lon += lonStep) {
      const p = h.project(lat, lon);
      if (p.x < 30 || p.y < 70 || p.x > h.width - 60 || p.y > h.height - 140) continue;
      const v = sampleGrid(grid, values, lat, lon);
      if (!Number.isNaN(v)) ctx.fillText(label(v), p.x, p.y);
    }
  }
  ctx.restore();
}

/** Smooth colour field (rain radar, temperature heatmap, wind speed tint). */
export function FieldRasterLayer({ grid, values, scale, cloud, opacity = 1, label, draft }: FieldRasterLayerProps) {
  const paintRef = useRef<Paint | null>(null);
  const handle = useCanvasLayer("doofah-field", 350, (h: CanvasHandle) => {
    const { ctx } = h;
    ctx.clearRect(0, 0, h.width, h.height);
    // The map has no size yet while its card is still being laid out.
    if (!h.width || !h.height) return;
    if (!paintRef.current) {
      const canvas = document.createElement("canvas");
      const paintCtx = canvas.getContext("2d");
      if (!paintCtx) return;
      paintRef.current = { canvas, ctx: paintCtx };
    }
    const paint = paintRef.current;
    const step = draft ? DRAFT_STEP : PIXEL_STEP;
    paintField(h, paint, step, grid, values, scale, cloud);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = true;
    // Smoothing a whole high-density screen finely costs ~100 ms on a laptop's
    // processor alone; while the timeline moves the simple kind does.
    ctx.imageSmoothingQuality = draft ? "low" : "high";
    ctx.drawImage(paint.canvas, 0, 0, paint.canvas.width * step, paint.canvas.height * step);
    ctx.restore();
    if (label) drawLabels(h, grid, values, label);
  });

  useEffect(() => {
    handle.current?.redraw();
  }, [handle, grid, values, scale, cloud, opacity, label, draft]);

  return null;
}
