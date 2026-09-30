"use client";

import { useEffect } from "react";
import { sampleGrid, type RadarGridSpec } from "@/services/WeatherNext3MockService";
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
}

/** Bitmap pixels per grid cell. Values are interpolated before colouring. */
const UPSAMPLE = 4;

// One bitmap per frame, reused across pans, zooms and time-lapse loops.
const bitmapCache = new WeakMap<Float32Array, HTMLCanvasElement>();

/** Catmull-Rom cubic through p1..p2. */
const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

/** Separable bicubic upsampling of a row-major grid by an integer factor. */
function upsample(values: Float32Array, rows: number, cols: number, k: number): Float32Array {
  const W = cols * k;
  const H = rows * k;
  const clampCol = (j: number) => Math.min(cols - 1, Math.max(0, j));
  const clampRow = (j: number) => Math.min(rows - 1, Math.max(0, j));

  const horizontal = new Float32Array(rows * W);
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / k - 0.5;
      const i = Math.floor(fx);
      horizontal[r * W + x] = cubic(
        values[base + clampCol(i - 1)],
        values[base + clampCol(i)],
        values[base + clampCol(i + 1)],
        values[base + clampCol(i + 2)],
        fx - i,
      );
    }
  }

  const out = new Float32Array(H * W);
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / k - 0.5;
    const i = Math.floor(fy);
    const t = fy - i;
    const r0 = clampRow(i - 1) * W;
    const r1 = clampRow(i) * W;
    const r2 = clampRow(i + 1) * W;
    const r3 = clampRow(i + 2) * W;
    for (let x = 0; x < W; x++) {
      out[y * W + x] = cubic(horizontal[r0 + x], horizontal[r1 + x], horizontal[r2 + x], horizontal[r3 + x], t);
    }
  }
  return out;
}

function bitmapFor(grid: RadarGridSpec, values: Float32Array, scale: ColorScale, cloud?: Float32Array) {
  const cached = bitmapCache.get(values);
  if (cached) return cached;

  const W = grid.cols * UPSAMPLE;
  const H = grid.rows * UPSAMPLE;
  const field = upsample(values, grid.rows, grid.cols, UPSAMPLE);
  const cloudField = cloud ? upsample(cloud, grid.rows, grid.cols, UPSAMPLE) : null;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const image = ctx.createImageData(W, H);
  const px = image.data;
  const isPrecip = scale === PRECIP_SCALE;

  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    const o = i * 4;
    const k = lutIndex(scale, v);
    if (!isPrecip) {
      px[o] = scale.lut[k];
      px[o + 1] = scale.lut[k + 1];
      px[o + 2] = scale.lut[k + 2];
      px[o + 3] = scale.lut[k + 3];
      continue;
    }
    // Soft cloud where it is dry (fading in above ~35% cover), blended into
    // the rain colours over a small value range so echo edges are anti-aliased.
    const c = cloudField ? Math.min(1, Math.max(0, cloudField[i])) : 0;
    const cloudAlpha = Math.max(0, c - 0.35) ** 1.5 * 150;
    const t = v <= 0.05 ? 0 : v >= 0.18 ? 1 : ((v - 0.05) / 0.13) ** 2 * (3 - (2 * (v - 0.05)) / 0.13);
    px[o] = 225 + (scale.lut[k] - 225) * t;
    px[o + 1] = 232 + (scale.lut[k + 1] - 232) * t;
    px[o + 2] = 245 + (scale.lut[k + 2] - 245) * t;
    px[o + 3] = cloudAlpha + (scale.lut[k + 3] - cloudAlpha) * t;
  }
  ctx.putImageData(image, 0, 0);
  bitmapCache.set(values, canvas);
  return canvas;
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
export function FieldRasterLayer({ grid, values, scale, cloud, opacity = 1, label }: FieldRasterLayerProps) {
  const handle = useCanvasLayer("doofah-field", 350, (h: CanvasHandle) => {
    const { ctx } = h;
    ctx.clearRect(0, 0, h.width, h.height);
    const bitmap = bitmapFor(grid, values, scale, cloud);
    const [[south, west], [north, east]] = grid.bounds;
    const nw = h.project(north, west);
    const se = h.project(south, east);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
    ctx.restore();
    if (label) drawLabels(h, grid, values, label);
  });

  useEffect(() => {
    handle.current?.redraw();
  }, [handle, grid, values, scale, cloud, opacity, label]);

  return null;
}
