import type { AqiCategory, CurrentConditions, HourlyForecast } from "@/services/WeatherNext3MockService";

/** Air alert above this US AQI: "Unhealthy" and worse. */
export const AQI_LIMIT = 150;
/** Above this, the air alert is severe ("Very Unhealthy" and worse). */
export const AQI_SEVERE = 200;
/** Rain alert when an hour's chance of rain is above this, in percent. */
export const RAIN_CHANCE_LIMIT = 80;
/** How far ahead rain counts: long enough to decide on an umbrella before heading out. */
export const RAIN_WINDOW_HOURS = 3;
/** How far ahead a thunderstorm counts. */
export const STORM_WINDOW_HOURS = 2;

const HOUR_MS = 3_600_000;

export type WeatherAlert =
  | {
      kind: "storm";
      level: "severe";
      /** Start of the first stormy hour, or null when it is storming now. */
      startsAt: string | null;
      /** Chance of rain in that hour, 0–100. */
      chance: number;
    }
  | {
      kind: "rain";
      level: "warning";
      /** Start of the first hour above the limit, or null for the current hour. */
      startsAt: string | null;
      /** Highest chance of rain in the window, 0–100. */
      chance: number;
      /** Heavy rain in the window: flooded roads are worth a mention. */
      heavy: boolean;
    }
  | {
      kind: "air";
      level: "warning" | "severe";
      aqi: number;
      category: AqiCategory;
      /** µg/m³ */
      pm25: number;
    };

export type AlertKind = WeatherAlert["kind"];

/** Things to do, in the order they are shown. The wording lives in the message files. */
export type AlertTip =
  | "umbrella"
  | "stayIndoors"
  | "avoidOpenGround"
  | "unplug"
  | "travelTime"
  | "floodedRoads"
  | "mask"
  | "noOutdoorExercise"
  | "closeWindows"
  | "sensitiveGroups";

export function alertTips(alert: WeatherAlert): AlertTip[] {
  switch (alert.kind) {
    case "storm":
      return ["stayIndoors", "avoidOpenGround", "umbrella", "unplug"];
    case "rain":
      return alert.heavy ? ["umbrella", "floodedRoads", "travelTime"] : ["umbrella", "travelTime"];
    case "air":
      return alert.level === "severe"
        ? ["mask", "sensitiveGroups", "noOutdoorExercise", "closeWindows"]
        : ["mask", "noOutdoorExercise", "closeWindows"];
  }
}

/** Hours that overlap the next `hours` hours from `now`. */
function upcoming(hourly: HourlyForecast[], now: number, hours: number) {
  return hourly.filter((h) => {
    const start = Date.parse(h.time);
    return start < now + hours * HOUR_MS && start + HOUR_MS > now;
  });
}

const startOf = (h: HourlyForecast, now: number) => (Date.parse(h.time) <= now ? null : h.time);

/**
 * The alerts worth a banner right now, most urgent first:
 * - a thunderstorm now or within 2 hours;
 * - air quality worse than AQI 150;
 * - a chance of rain above 80% in any hour of the next 3 hours. A storm
 *   alert already covers rain, so the two are not shown together.
 */
export function weatherAlerts(
  current: CurrentConditions,
  hourly: HourlyForecast[],
  now: number = Date.parse(current.observedAt),
): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];

  const stormHour = upcoming(hourly, now, STORM_WINDOW_HOURS).find((h) => h.condition === "thunderstorm");
  if (current.sample.condition === "thunderstorm") {
    alerts.push({ kind: "storm", level: "severe", startsAt: null, chance: current.sample.precipitationProbability });
  } else if (stormHour) {
    alerts.push({
      kind: "storm",
      level: "severe",
      startsAt: startOf(stormHour, now),
      chance: stormHour.precipitationProbability,
    });
  }

  const { aqi, category, pm25 } = current.airQuality;
  if (aqi > AQI_LIMIT) {
    alerts.push({ kind: "air", level: aqi > AQI_SEVERE ? "severe" : "warning", aqi, category, pm25 });
  }

  const rainWindow = upcoming(hourly, now, RAIN_WINDOW_HOURS);
  const wetHours = rainWindow.filter((h) => h.precipitationProbability > RAIN_CHANCE_LIMIT);
  if (wetHours.length > 0 && !alerts.some((a) => a.kind === "storm")) {
    alerts.push({
      kind: "rain",
      level: "warning",
      startsAt: startOf(wetHours[0], now),
      chance: Math.max(...wetHours.map((h) => h.precipitationProbability)),
      heavy: rainWindow.some((h) => h.condition === "heavy-rain" || h.condition === "thunderstorm"),
    });
  }

  // Severe first; otherwise keep the order above (storm, air, rain).
  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "severe" ? -1 : 1));
}

/**
 * Made-up alerts for previewing the banner with `?alert=storm`, `rain`, `air`
 * or `all`, whatever the simulated weather is doing.
 */
export function previewAlerts(kinds: readonly AlertKind[], now: number): WeatherAlert[] {
  const inAnHour = new Date(Math.floor(now / HOUR_MS + 1) * HOUR_MS).toISOString();
  const all: Record<AlertKind, WeatherAlert> = {
    storm: { kind: "storm", level: "severe", startsAt: inAnHour, chance: 90 },
    air: { kind: "air", level: "warning", aqi: 172, category: "Unhealthy", pm25: 96.4 },
    rain: { kind: "rain", level: "warning", startsAt: inAnHour, chance: 90, heavy: true },
  };
  return (["storm", "air", "rain"] as const).filter((k) => kinds.includes(k)).map((k) => all[k]);
}
