import type { AqiCategory, WeatherCondition } from "@/services/WeatherNext3MockService";

const LOCALE = "en-GB";
const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = timeZone + JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone, ...options });
    cache.set(key, f);
  }
  return f;
}

/** "14:00" */
export const formatClock = (iso: string | number, timeZone: string) =>
  formatter(timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** "14" (hour only, for dense rows) */
export const formatHour = (iso: string | number, timeZone: string) =>
  formatter(timeZone, { hour: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** "Tue" / "Today" / "Tomorrow" for a YYYY-MM-DD local date key. */
export function formatDayName(dateKey: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** "30 Sep" */
export function formatShortDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export const formatTemp = (c: number) => `${Math.round(c)}°`;

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg: number) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

export const CONDITION_LABEL: Record<WeatherCondition, string> = {
  clear: "Clear",
  "partly-cloudy": "Partly cloudy",
  cloudy: "Cloudy",
  fog: "Fog",
  drizzle: "Drizzle",
  rain: "Rain",
  "heavy-rain": "Heavy rain",
  thunderstorm: "Thunderstorms",
  snow: "Snow",
};

export function conditionLabel(condition: WeatherCondition, isDay = true): string {
  if (condition === "clear") return isDay ? "Sunny" : "Clear";
  return CONDITION_LABEL[condition];
}

export const AQI_STYLE: Record<AqiCategory, { color: string; short: string }> = {
  Good: { color: "#4ade80", short: "Good" },
  Moderate: { color: "#facc15", short: "Moderate" },
  "Unhealthy for Sensitive Groups": { color: "#fb923c", short: "Sensitive" },
  Unhealthy: { color: "#f87171", short: "Unhealthy" },
  "Very Unhealthy": { color: "#c084fc", short: "Very unhealthy" },
  Hazardous: { color: "#be123c", short: "Hazardous" },
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

export function uvLabel(uv: number): string {
  if (uv < 3) return "Low";
  if (uv < 6) return "Moderate";
  if (uv < 8) return "High";
  if (uv < 11) return "Very high";
  return "Extreme";
}
