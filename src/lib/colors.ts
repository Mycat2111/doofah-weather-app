import type { AqiCategory } from "@/services/weather/types";

/** US EPA colour for each AQI category. */
export const AQI_COLOR: Record<AqiCategory, string> = {
  Good: "#4ade80",
  Moderate: "#facc15",
  "Unhealthy for Sensitive Groups": "#fb923c",
  Unhealthy: "#f87171",
  "Very Unhealthy": "#c084fc",
  Hazardous: "#be123c",
};

/** Continuous temperature colour, used for range bars and chips. */
export function temperatureColor(c: number): string {
  const stops: [number, [number, number, number]][] = [
    [-15, [129, 140, 248]],
    [0, [56, 189, 248]],
    [10, [45, 212, 191]],
    [18, [163, 230, 53]],
    [24, [250, 204, 21]],
    [30, [251, 146, 60]],
    [36, [239, 68, 68]],
  ];
  if (c <= stops[0][0]) return `rgb(${stops[0][1].join(",")})`;
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    const [v0, c0] = stops[i - 1];
    if (c <= v1) {
      const t = (c - v0) / (v1 - v0);
      return `rgb(${c0.map((x, k) => Math.round(x + (c1[k] - x) * t)).join(",")})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(",")})`;
}
