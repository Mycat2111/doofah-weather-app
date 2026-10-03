import { hoursBetween, isWetHour, RAIN_LIKELY, rainCountdown, type RainCountdown } from "@/lib/rainCountdown";
import type { CurrentConditions, DailyForecast, HourlyForecast } from "@/services/weather/types";

export type Activity = "laundry" | "carWash" | "run" | "commute" | "sunscreen" | "stargazing";
export const ACTIVITIES: readonly Activity[] = ["laundry", "carWash", "run", "commute", "sunscreen", "stargazing"];

/** Good to go, go with care, or better not. */
export type Level = "good" | "fair" | "poor";

/** Why an activity got its level. The wording lives in the message files; times are ISO. */
export type LifestyleReason =
  | { kind: "rainNow" }
  | { kind: "rainAt"; time: string }
  | { kind: "heavyRain"; time: string | null }
  | { kind: "rainTomorrow"; chance: number }
  | { kind: "rainTonight" }
  | { kind: "dryUntil"; time: string }
  | { kind: "dryDays"; days: number }
  | { kind: "noSun" }
  | { kind: "humid"; humidity: number }
  | { kind: "storm" }
  | { kind: "air"; aqi: number }
  | { kind: "heat"; feelsLikeC: number; coolerAt: string | null }
  | { kind: "pleasant"; feelsLikeC: number }
  | { kind: "uv"; peak: number; until: string }
  | { kind: "uvLow" }
  | { kind: "sunDown" }
  | { kind: "fog"; visibilityKm: number }
  | { kind: "clearRoads" }
  | { kind: "clouds"; percent: number };

export interface LifestyleStatus {
  activity: Activity;
  level: Level;
  reason: LifestyleReason;
}

/** Laundry needs this many dry hours of daylight ahead. */
export const LAUNDRY_HOURS = 4;
/** Laundry dries slowly when the air is at least this humid, in percent. */
export const LAUNDRY_HUMID = 85;
/** A car wash is wasted if rain comes within this many hours (or later today). */
export const CAR_WASH_HOURS = 12;
/** Feels-like temperatures for running: take care from HEAT_CAUTION, skip it from HEAT_DANGER (°C). */
export const HEAT_CAUTION = 36;
export const HEAT_DANGER = 41;
/** US AQI: outdoor exercise needs care above AIR_CAUTION and is off above AIR_DANGER. */
export const AIR_CAUTION = 100;
export const AIR_DANGER = 150;
/** UV index: sunscreen recommended from UV_MODERATE, essential from UV_HIGH. */
export const UV_MODERATE = 3;
export const UV_HIGH = 8;
/** Commuting is slowed by fog below this visibility, in km. */
export const FOG_KM = 2;
/** Stargazing: mean cloud cover tonight for clear (below) and cloudy (at or above), in percent. */
export const STARS_CLEAR = 35;
export const STARS_CLOUDY = 70;
/** Dark hours of tonight that stargazing looks at. */
export const NIGHT_HOURS = 5;

const HOUR_MS = 3_600_000;
const MAX_DRY_DAYS = 7;

const isHeavy = (h: HourlyForecast) => h.condition === "heavy-rain" || h.condition === "thunderstorm";

/** Start of an hour, or `now` when the hour has already begun. */
const fromNow = (h: HourlyForecast, now: number) => new Date(Math.max(Date.parse(h.time), now)).toISOString();

/** When rain arrives before `until`: from the radar countdown first, then the hourly forecast. */
function rainBefore(countdown: RainCountdown, until: number): string | null {
  if (countdown.kind === "starting" || countdown.kind === "later") {
    return Date.parse(countdown.at) < until ? countdown.at : null;
  }
  return null;
}

/**
 * Quick advice for everyday plans, from the same forecast the dashboard shows.
 * Every rule looks only at the data, so the same forecast always gives the same advice.
 */
export function lifestyleIndex(
  current: CurrentConditions,
  hourly: HourlyForecast[],
  daily: DailyForecast[],
  now: number = Date.parse(current.observedAt),
  countdown: RainCountdown = rainCountdown(current, hourly, daily, now),
): LifestyleStatus[] {
  const s = current.sample;
  const raining = countdown.kind === "raining";
  const sunset = current.sunset ? Date.parse(current.sunset) : null;
  const sunrise = current.sunrise ? Date.parse(current.sunrise) : null;
  const tomorrow = daily[1];
  const endOfToday = tomorrow ? Date.parse(tomorrow.hours[0]?.time ?? tomorrow.date) : now + 12 * HOUR_MS;

  function laundry(): Omit<LifestyleStatus, "activity"> {
    if (raining) return { level: "poor", reason: { kind: "rainNow" } };
    const rainAt = rainBefore(countdown, now + LAUNDRY_HOURS * HOUR_MS);
    if (rainAt) return { level: "poor", reason: { kind: "rainAt", time: rainAt } };
    // Needs a good stretch of daylight; after about 16:30 or before sunrise, wait for the morning.
    const daylightLeft = sunset !== null && sunrise !== null && now >= sunrise ? sunset - now : 0;
    if (!s.isDay || daylightLeft < 1.5 * HOUR_MS) return { level: "fair", reason: { kind: "noSun" } };
    const window = hoursBetween(hourly, now, now + LAUNDRY_HOURS * HOUR_MS);
    const humidity = Math.round(
      window.length ? window.reduce((sum, h) => sum + h.humidity, 0) / window.length : s.humidity,
    );
    if (humidity >= LAUNDRY_HUMID) return { level: "fair", reason: { kind: "humid", humidity } };
    const dryUntil = rainBefore(countdown, sunset!) ?? new Date(sunset!).toISOString();
    return { level: "good", reason: { kind: "dryUntil", time: dryUntil } };
  }

  function carWash(): Omit<LifestyleStatus, "activity"> {
    if (raining) return { level: "poor", reason: { kind: "rainNow" } };
    const rainAt = rainBefore(countdown, Math.max(now + CAR_WASH_HOURS * HOUR_MS, endOfToday));
    if (rainAt) return { level: "poor", reason: { kind: "rainAt", time: rainAt } };
    if (tomorrow && tomorrow.precipitationProbability >= RAIN_LIKELY) {
      return { level: "fair", reason: { kind: "rainTomorrow", chance: tomorrow.precipitationProbability } };
    }
    let days = 1;
    while (days < Math.min(daily.length, MAX_DRY_DAYS) && daily[days].precipitationProbability < RAIN_LIKELY) days++;
    return { level: "good", reason: { kind: "dryDays", days } };
  }

  function run(): Omit<LifestyleStatus, "activity"> {
    const next = hoursBetween(hourly, now, now + 2 * HOUR_MS);
    if (s.condition === "thunderstorm" || next.some((h) => h.condition === "thunderstorm")) {
      return { level: "poor", reason: { kind: "storm" } };
    }
    // With no recent air reading, judge by the weather alone.
    const aqi = current.airQuality?.aqi ?? 0;
    if (aqi > AIR_DANGER) return { level: "poor", reason: { kind: "air", aqi } };
    const feelsLikeC = Math.round(s.feelsLikeC);
    // The next hour cool and dry enough to run, within the next 12 hours.
    const cooler = hoursBetween(hourly, now + HOUR_MS, now + 12 * HOUR_MS).find(
      (h) => h.feelsLikeC < HEAT_CAUTION && !isWetHour(h) && h.condition !== "thunderstorm",
    );
    const heat = { kind: "heat", feelsLikeC, coolerAt: cooler?.time ?? null } as const;
    if (s.feelsLikeC >= HEAT_DANGER) return { level: "poor", reason: heat };
    if (raining) return { level: "fair", reason: { kind: "rainNow" } };
    const rainAt = rainBefore(countdown, now + HOUR_MS);
    if (rainAt) return { level: "fair", reason: { kind: "rainAt", time: rainAt } };
    if (s.feelsLikeC >= HEAT_CAUTION) return { level: "fair", reason: heat };
    if (aqi > AIR_CAUTION) return { level: "fair", reason: { kind: "air", aqi } };
    if (s.isDay && s.uvIndex >= UV_HIGH) return { level: "fair", reason: uvReason() };
    return { level: "good", reason: { kind: "pleasant", feelsLikeC } };
  }

  function commute(): Omit<LifestyleStatus, "activity"> {
    const next = hoursBetween(hourly, now, now + 3 * HOUR_MS);
    if (
      s.condition === "heavy-rain" ||
      s.condition === "thunderstorm" ||
      (raining && countdown.intensity === "heavy")
    ) {
      return { level: "poor", reason: { kind: "heavyRain", time: null } };
    }
    if (countdown.kind === "starting" && countdown.intensity === "heavy") {
      return { level: "poor", reason: { kind: "heavyRain", time: countdown.at } };
    }
    const heavyHour = next.find(isHeavy);
    if (heavyHour) return { level: "poor", reason: { kind: "heavyRain", time: fromNow(heavyHour, now) } };
    if (raining) return { level: "fair", reason: { kind: "rainNow" } };
    const rainAt = rainBefore(countdown, now + 3 * HOUR_MS);
    if (rainAt) return { level: "fair", reason: { kind: "rainAt", time: rainAt } };
    if (s.visibilityKm < FOG_KM) return { level: "fair", reason: { kind: "fog", visibilityKm: s.visibilityKm } };
    return { level: "good", reason: { kind: "clearRoads" } };
  }

  /** Today's highest UV from now on, and when it drops back below UV_MODERATE. */
  function uvReason(): Extract<LifestyleReason, { kind: "uv" }> {
    const today = hoursBetween(hourly, now, endOfToday).filter((h) => h.isDay);
    const strong = today.filter((h) => h.uvIndex >= UV_MODERATE);
    const peak = Math.round(Math.max(s.uvIndex, ...today.map((h) => h.uvIndex)));
    const last = strong.at(-1);
    const until = last ? Date.parse(last.time) + HOUR_MS : now + HOUR_MS;
    return { kind: "uv", peak, until: new Date(until).toISOString() };
  }

  function sunscreen(): Omit<LifestyleStatus, "activity"> {
    if (!s.isDay) return { level: "good", reason: { kind: "sunDown" } };
    const uv = uvReason();
    if (uv.peak >= UV_HIGH) return { level: "poor", reason: uv };
    if (uv.peak >= UV_MODERATE) return { level: "fair", reason: uv };
    return { level: "good", reason: { kind: "uvLow" } };
  }

  function stargazing(): Omit<LifestyleStatus, "activity"> {
    // Tonight's first dark hours (sun 6° or more below the horizon), or the rest of this night.
    const night = hourly
      .filter((h) => h.sunElevationDeg < -6 && Date.parse(h.time) + HOUR_MS > now)
      .slice(0, NIGHT_HOURS);
    const percent = Math.round(
      meanOf(
        night.map((h) => h.cloudCover),
        s.cloudCover,
      ),
    );
    if (night.some(isWetHour)) return { level: "poor", reason: { kind: "rainTonight" } };
    if (percent >= STARS_CLOUDY) return { level: "poor", reason: { kind: "clouds", percent } };
    if (percent >= STARS_CLEAR) return { level: "fair", reason: { kind: "clouds", percent } };
    return { level: "good", reason: { kind: "clouds", percent } };
  }

  const rules: Record<Activity, () => Omit<LifestyleStatus, "activity">> = {
    laundry,
    carWash,
    run,
    commute,
    sunscreen,
    stargazing,
  };
  return ACTIVITIES.map((activity) => ({ activity, ...rules[activity]() }));
}

const meanOf = (values: number[], fallback: number) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback;
