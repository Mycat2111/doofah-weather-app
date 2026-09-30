/**
 * From hourly values to what the dashboard shows: the mood of the sky, each
 * day's outlook and the next two hours of rain. Shared by the simulation and
 * by Open-Meteo, so both read the same way.
 */

import { describeDayEn, describeNowcastEn, rainIntensity } from "./describe";
import { zonedParts } from "./time";
import type {
  AtmosphereTheme,
  AtmosphericSample,
  DailyForecast,
  DayOutlook,
  DayOutlookKind,
  DayPeriod,
  HourlyForecast,
  Nowcast,
  NowcastOutlook,
  NowcastStep,
  WeatherCondition,
} from "./types";

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** The sky's mood for a sample; `sunElevationDeg` can be given unrounded. */
export function atmosphereFor(
  sample: AtmosphericSample,
  sunElevationDeg: number = sample.sunElevationDeg,
): AtmosphereTheme {
  switch (sample.condition) {
    case "thunderstorm":
      return "thunderstorm";
    case "heavy-rain":
      return "heavy-rain";
    case "rain":
    case "drizzle":
      return "rain";
    case "snow":
      return "snow";
    case "fog":
      return "fog";
  }
  if (sunElevationDeg > -4 && sunElevationDeg < 8 && sample.cloudCover < 80) return "golden-hour";
  if (sample.condition === "cloudy") return sample.isDay ? "cloudy-day" : "cloudy-night";
  return sample.isDay ? "clear-day" : "clear-night";
}

/** Rain rate that counts as rain in the nowcast, mm/h. */
const NOWCAST_WET = 0.1;

/** The next two hours' outlook from 10-minute steps, the first of which is now. */
export function nowcastFromSteps(steps: NowcastStep[]): Nowcast {
  const wet = (s: NowcastStep) => s.precipitationMm >= NOWCAST_WET;
  let outlook: NowcastOutlook;
  if (wet(steps[0])) {
    const stopIdx = steps.findIndex((s) => !wet(s));
    const intensity = rainIntensity(steps[0].precipitationMm);
    outlook =
      stopIdx === -1 ? { kind: "continuing", intensity } : { kind: "stopping", minutes: stopIdx * 10, intensity };
  } else {
    const startIdx = steps.findIndex(wet);
    outlook =
      startIdx === -1
        ? { kind: "dry" }
        : { kind: "starting", minutes: startIdx * 10, intensity: rainIntensity(steps[startIdx].precipitationMm) };
  }
  return { summary: describeNowcastEn(outlook), outlook, steps };
}

const SEVERITY: Record<WeatherCondition, number> = {
  clear: 0,
  "partly-cloudy": 1,
  cloudy: 2,
  fog: 3,
  drizzle: 4,
  rain: 5,
  snow: 6,
  "heavy-rain": 7,
  thunderstorm: 8,
};

function periodOfDay(localHour: number): DayPeriod {
  if (localHour < 6) return "overnight";
  if (localHour < 12) return "morning";
  if (localHour < 18) return "afternoon";
  return "evening";
}

function dayOutlookKind(condition: WeatherCondition, precipitationMm: number, maxTempC: number): DayOutlookKind {
  switch (condition) {
    case "thunderstorm":
      return "thunderstorms";
    case "heavy-rain":
      return precipitationMm >= 12 ? "heavy-rain" : "downpours";
    case "rain":
      return "showers";
    case "drizzle":
      return "light-showers";
    case "snow":
      return "snow";
    case "fog":
      return "fog";
    case "cloudy":
      return "mostly-cloudy";
    case "partly-cloudy":
      return maxTempC >= 33 ? "hot-sunny-spells" : "sun-and-cloud";
    default:
      return maxTempC >= 33 ? "hot-sunny" : "clear";
  }
}

/**
 * One day from its local hours. The chance of rain is the wettest hour's
 * unless the caller has a better figure (the simulation pulls far-out days
 * toward climatology).
 */
export function summariseDay(
  date: string,
  hours: HourlyForecast[],
  sun: { sunrise: number | null; sunset: number | null },
  timeZone: string,
  precipitationProbability: number = Math.max(...hours.map((h) => h.precipitationProbability)),
): DailyForecast {
  const temps = hours.map((h) => h.temperatureC);
  const precipitationMm = round1(hours.reduce((sum, h) => sum + h.precipitationMm, 0));
  const daytime = hours.filter((h) => h.isDay);
  const meanCloud =
    (daytime.length ? daytime : hours).reduce((s, h) => s + h.cloudCover, 0) /
    Math.max(1, (daytime.length ? daytime : hours).length);

  const windiest = hours.reduce((a, b) => (b.windSpeedKmh > a.windSpeedKmh ? b : a));
  const wettest = hours.reduce((a, b) => (b.precipitationMm > a.precipitationMm ? b : a));
  const worst = hours.reduce((a, b) => (SEVERITY[b.condition] > SEVERITY[a.condition] ? b : a));

  let condition: WeatherCondition;
  if (worst.condition === "thunderstorm" || worst.condition === "snow") condition = worst.condition;
  else if (precipitationMm >= 12 || worst.condition === "heavy-rain") condition = "heavy-rain";
  else if (precipitationMm >= 1.5) condition = "rain";
  else if (precipitationMm >= 0.3) condition = "drizzle";
  else if (hours.filter((h) => h.condition === "fog").length >= 3) condition = "fog";
  else if (meanCloud >= 72) condition = "cloudy";
  else if (meanCloud >= 30) condition = "partly-cloudy";
  else condition = "clear";

  const maxTemp = Math.max(...temps);
  const outlook: DayOutlook = {
    kind: dayOutlookKind(condition, precipitationMm, maxTemp),
    period: periodOfDay(zonedParts(new Date(wettest.time).getTime(), timeZone).hour),
    precipitationMm,
    wind: windiest.windSpeedKmh >= 40 ? "windy" : windiest.windSpeedKmh >= 28 ? "breezy" : "calm",
  };

  // Circular mean of wind direction, weighted by speed.
  let sx = 0;
  let sy = 0;
  for (const h of hours) {
    sx += Math.sin((h.windDirectionDeg * Math.PI) / 180) * h.windSpeedKmh;
    sy += Math.cos((h.windDirectionDeg * Math.PI) / 180) * h.windSpeedKmh;
  }
  const confidences = hours.map((h) => h.confidence);
  const allConfident = (list: (number | null)[]): list is number[] => list.every((c) => c !== null);

  return {
    date,
    minTempC: round1(Math.min(...temps)),
    maxTempC: round1(maxTemp),
    condition,
    summary: describeDayEn(outlook),
    outlook,
    precipitationMm,
    precipitationProbability,
    maxWindKmh: round1(windiest.windSpeedKmh),
    dominantWindDirectionDeg: Math.round(((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360),
    maxUvIndex: Math.max(...hours.map((h) => h.uvIndex)),
    meanHumidity: Math.round(hours.reduce((s, h) => s + h.humidity, 0) / hours.length),
    sunrise: sun.sunrise === null ? null : new Date(sun.sunrise).toISOString(),
    sunset: sun.sunset === null ? null : new Date(sun.sunset).toISOString(),
    confidence: allConfident(confidences) ? round2(confidences.reduce((s, c) => s + c, 0) / hours.length) : null,
    hours,
  };
}
