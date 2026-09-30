import { rainIntensity } from "@/services/weathernext3/describe";
import type {
  CurrentConditions,
  DailyForecast,
  HourlyForecast,
  NowcastStep,
  RainIntensity,
} from "@/services/WeatherNext3MockService";

/** Rain rate that counts as rain, mm/h. The nowcast uses the same line. */
export const WET_RATE = 0.1;
/** An hour of the hourly forecast counts as rainy from this chance of rain, in percent. */
export const RAIN_LIKELY = 50;
/** How far ahead the countdown looks, in hours. */
export const COUNTDOWN_HOURS = 24;
/** A dry spell reads as "clear sky" when its cloud cover averages below this, in percent. */
export const CLEAR_SKY_CLOUD = 40;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/**
 * Time to the next rain, or to the end of the current rain. The first two
 * hours come from the 10-minute nowcast (the radar in the simulation,
 * Open-Meteo's 15-minute forecast for real data), timed to the minute; after
 * that the hourly forecast takes over.
 */
export type RainCountdown =
  /** Dry now; the radar shows rain arriving at `at`, within 2 hours. */
  | { kind: "starting"; at: string; intensity: RainIntensity }
  /**
   * Raining now. `until` is when it eases: to the minute from the radar when
   * `precise`, else the hour from the forecast; null when it lasts past the horizon.
   */
  | { kind: "raining"; intensity: RainIntensity; until: string | null; precise: boolean }
  /** Dry for the next 2 hours at least; rain is likely from `at` (an hour of the forecast). */
  | { kind: "later"; at: string; chance: number; clear: boolean }
  /** No rain likely for the next `hours` hours. `nextRainDay` indexes the daily forecast, or is null. */
  | { kind: "dry"; hours: number; clear: boolean; nextRainDay: number | null };

export const isWetHour = (h: HourlyForecast) => h.precipitationProbability >= RAIN_LIKELY;

/**
 * When the rate crosses WET_RATE between two nowcast steps, by linear
 * interpolation: a whole number of minutes after the first step, and at
 * least a minute after it (the first step is now).
 */
function crossing(a: NowcastStep, b: NowcastStep): number {
  const t0 = Date.parse(a.time);
  const t1 = Date.parse(b.time);
  const f = (WET_RATE - a.precipitationMm) / (b.precipitationMm - a.precipitationMm);
  const minutes = Math.round((Math.min(1, Math.max(0, f)) * (t1 - t0)) / MINUTE_MS);
  return t0 + Math.max(1, minutes) * MINUTE_MS;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Hours of `hourly` that overlap [from, to). */
export function hoursBetween(hourly: HourlyForecast[], from: number, to: number) {
  return hourly.filter((h) => {
    const start = Date.parse(h.time);
    return start < to && start + HOUR_MS > from;
  });
}

const meanCloud = (hours: HourlyForecast[], fallback: number) =>
  hours.length ? hours.reduce((sum, h) => sum + h.cloudCover, 0) / hours.length : fallback;

export function rainCountdown(
  current: CurrentConditions,
  hourly: HourlyForecast[],
  daily: DailyForecast[],
  now: number = Date.parse(current.observedAt),
): RainCountdown {
  const steps = current.nowcast.steps;
  const wet = (s: NowcastStep) => s.precipitationMm >= WET_RATE;
  // Where the radar nowcast ends and the hourly forecast takes over.
  const radarEnd = Date.parse(steps[steps.length - 1].time);
  const horizon = now + COUNTDOWN_HOURS * HOUR_MS;
  const after = hoursBetween(hourly, radarEnd, horizon);

  if (wet(steps[0])) {
    const intensity = rainIntensity(Math.max(...steps.filter(wet).map((s) => s.precipitationMm)));
    const stop = steps.findIndex((s) => !wet(s));
    if (stop > 0)
      return { kind: "raining", intensity, until: iso(crossing(steps[stop - 1], steps[stop])), precise: true };
    const dryHour = after.find((h) => !isWetHour(h) && h.precipitationMm < WET_RATE);
    return {
      kind: "raining",
      intensity,
      until: dryHour ? iso(Math.max(Date.parse(dryHour.time), radarEnd)) : null,
      precise: false,
    };
  }

  const start = steps.findIndex(wet);
  if (start > 0) {
    // Name the rain by its heaviest step in the half hour after it arrives.
    const peak = Math.max(...steps.slice(start, start + 3).map((s) => s.precipitationMm));
    return { kind: "starting", at: iso(crossing(steps[start - 1], steps[start])), intensity: rainIntensity(peak) };
  }

  const rainHour = after.find(isWetHour);
  if (rainHour) {
    const at = Math.max(Date.parse(rainHour.time), radarEnd);
    return {
      kind: "later",
      at: iso(at),
      chance: rainHour.precipitationProbability,
      clear: meanCloud(hoursBetween(hourly, now, at), current.sample.cloudCover) < CLEAR_SKY_CLOUD,
    };
  }

  const nextRainDay = daily.findIndex((d, i) => i > 0 && d.precipitationProbability >= RAIN_LIKELY);
  return {
    kind: "dry",
    hours: COUNTDOWN_HOURS,
    clear: meanCloud(hoursBetween(hourly, now, horizon), current.sample.cloudCover) < CLEAR_SKY_CLOUD,
    nextRainDay: nextRainDay === -1 ? null : nextRainDay,
  };
}

/** Whole minutes from `now` to `time`, never negative. */
export const minutesUntil = (time: string, now: number) => Math.max(0, Math.ceil((Date.parse(time) - now) / MINUTE_MS));

/** Whole hours from `now` to `time`, at least 2 (the radar already showed 2 dry hours). */
export const dryHoursUntil = (time: string, now: number) => Math.max(2, Math.floor((Date.parse(time) - now) / HOUR_MS));

export type CountdownPreview = "soon" | "now" | "later" | "dry";
export const COUNTDOWN_PREVIEWS: readonly CountdownPreview[] = ["soon", "now", "later", "dry"];

/** Made-up countdowns for previewing the badge with `?rain=soon`, `now`, `later` or `dry`. */
export function previewCountdown(kind: CountdownPreview, now: number): RainCountdown {
  switch (kind) {
    case "soon":
      return { kind: "starting", at: iso(now + 20 * MINUTE_MS), intensity: "moderate" };
    case "now":
      return { kind: "raining", intensity: "heavy", until: iso(now + 35 * MINUTE_MS), precise: true };
    case "later":
      return { kind: "later", at: iso(Math.ceil((now + 3 * HOUR_MS) / HOUR_MS) * HOUR_MS), chance: 70, clear: true };
    case "dry":
      return { kind: "dry", hours: COUNTDOWN_HOURS, clear: true, nextRainDay: 3 };
  }
}

// Radar rain rates (mm/h) per 10-minute step to go with the previews.
const PREVIEW_RATES: Record<CountdownPreview, number[]> = {
  soon: [0, 0, 1.2, 3.5, 5.2, 4.1, 2.6, 1.8, 1.1, 0.6, 0.3, 0.2, 0.1],
  now: [9.5, 8.2, 5.4, 2.1],
  later: [],
  dry: [],
};

/** Nowcast bars that match a preview countdown. */
export function previewNowcast(kind: CountdownPreview, steps: NowcastStep[]): NowcastStep[] {
  return steps.map((s, i) => ({ ...s, precipitationMm: PREVIEW_RATES[kind][i] ?? 0 }));
}
