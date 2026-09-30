import type { RadarLayerType } from "@/services/WeatherNext3MockService";

type RGBA = [number, number, number, number];
export type ColorStop = [value: number, color: RGBA];

export interface ColorScale {
  stops: ColorStop[];
  unit: string;
  /** Values shown under the legend bar. */
  ticks: number[];
  /** Pre-sampled lookup table for fast per-cell colouring. */
  lut: Uint8ClampedArray;
  min: number;
  max: number;
}

const LUT_SIZE = 256;

function buildScale(stops: ColorStop[], unit: string, ticks: number[], transform?: (v: number) => number): ColorScale {
  const t = transform ?? ((v: number) => v);
  const min = t(stops[0][0]);
  const max = t(stops[stops.length - 1][0]);
  const lut = new Uint8ClampedArray(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const tv = min + ((max - min) * i) / (LUT_SIZE - 1);
    const c = interpolate(stops.map(([v, col]) => [t(v), col] as ColorStop), tv);
    lut.set([c[0], c[1], c[2], Math.round(c[3] * 255)], i * 4);
  }
  return { stops, unit, ticks, lut, min, max };
}

function interpolate(stops: ColorStop[], v: number): RGBA {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (v <= v1) {
      const [v0, c0] = stops[i - 1];
      const f = (v - v0) / (v1 - v0);
      return [0, 1, 2, 3].map((k) => c0[k] + (c1[k] - c0[k]) * f) as RGBA;
    }
  }
  return stops[stops.length - 1][1];
}

/** Classic radar ramp: light blue drizzle → green → yellow → red → magenta cores. */
export const PRECIP_SCALE = buildScale(
  [
    [0.1, [140, 205, 255, 0.4]],
    [0.6, [70, 160, 255, 0.6]],
    [1.5, [40, 110, 240, 0.72]],
    [3, [30, 200, 130, 0.8]],
    [6, [245, 222, 55, 0.86]],
    [12, [255, 145, 35, 0.9]],
    [25, [236, 45, 65, 0.92]],
    [50, [205, 50, 215, 0.95]],
  ],
  "mm/h",
  [0.1, 1, 3, 6, 12, 25, 50],
  (v) => Math.log(v),
);

export const TEMPERATURE_SCALE = buildScale(
  [
    [-20, [150, 110, 230, 0.6]],
    [-10, [90, 120, 245, 0.6]],
    [0, [70, 190, 240, 0.6]],
    [10, [60, 210, 160, 0.6]],
    [18, [170, 225, 70, 0.6]],
    [24, [250, 210, 60, 0.62]],
    [30, [250, 140, 50, 0.64]],
    [36, [235, 60, 55, 0.66]],
    [44, [150, 20, 60, 0.7]],
  ],
  "°C",
  [-20, -10, 0, 10, 20, 30, 40],
);

export const WIND_SCALE = buildScale(
  [
    [0, [60, 110, 200, 0]],
    [8, [70, 140, 240, 0.16]],
    [20, [60, 200, 200, 0.26]],
    [35, [120, 220, 110, 0.32]],
    [55, [250, 200, 60, 0.4]],
    [80, [245, 90, 70, 0.48]],
    [110, [200, 60, 200, 0.55]],
  ],
  "km/h",
  [0, 20, 40, 60, 80, 100],
);

export const PRESSURE_SCALE = buildScale(
  [
    [985, [120, 90, 220, 0.34]],
    [1000, [80, 140, 235, 0.26]],
    [1010, [90, 110, 150, 0.1]],
    [1020, [235, 140, 120, 0.24]],
    [1035, [240, 100, 90, 0.32]],
  ],
  "hPa",
  [985, 1000, 1010, 1020, 1035],
);

export const SCALES: Record<RadarLayerType, ColorScale> = {
  precipitation: PRECIP_SCALE,
  temperature: TEMPERATURE_SCALE,
  wind: WIND_SCALE,
  pressure: PRESSURE_SCALE,
};

/** Index into a scale's LUT (log-aware for precipitation). */
export function lutIndex(scale: ColorScale, value: number): number {
  const v = scale === PRECIP_SCALE ? Math.log(Math.max(value, 1e-3)) : value;
  const f = (v - scale.min) / (scale.max - scale.min);
  return Math.max(0, Math.min(LUT_SIZE - 1, Math.round(f * (LUT_SIZE - 1)))) * 4;
}

/** CSS gradient for a legend bar. */
export function legendGradient(scale: ColorScale): string {
  const span = scale.max - scale.min;
  const stops = scale.stops.map(([v, [r, g, b, a]]) => {
    const tv = scale === PRECIP_SCALE ? Math.log(v) : v;
    const pct = ((tv - scale.min) / span) * 100;
    return `rgba(${r},${g},${b},${Math.max(a, 0.55)}) ${pct.toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** Position (0–1) of a value along a legend bar. */
export function legendPosition(scale: ColorScale, value: number): number {
  const v = scale === PRECIP_SCALE ? Math.log(Math.max(value, 0.1)) : value;
  return Math.max(0, Math.min(1, (v - scale.min) / (scale.max - scale.min)));
}
