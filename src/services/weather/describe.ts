/**
 * English phrasing of the structured nowcast and day outlooks. The service
 * uses it for its `summary` fields; UIs in other languages phrase the same
 * structured data themselves.
 */

import type { DayOutlook, DayPeriod, NowcastOutlook, RainIntensity } from "./types";

export function rainIntensity(rateMmH: number): RainIntensity {
  if (rateMmH >= 8) return "heavy";
  if (rateMmH >= 2) return "moderate";
  if (rateMmH >= 0.5) return "light";
  return "drizzle";
}

const INTENSITY_EN: Record<RainIntensity, string> = {
  heavy: "Heavy rain",
  moderate: "Rain",
  light: "Light rain",
  drizzle: "Drizzle",
};

export function describeNowcastEn(outlook: NowcastOutlook): string {
  switch (outlook.kind) {
    case "dry":
      return "No rain expected in the next 2 hours";
    case "starting":
      return `${INTENSITY_EN[outlook.intensity]} starting in about ${outlook.minutes} min`;
    case "stopping":
      return `${INTENSITY_EN[outlook.intensity]} easing in about ${outlook.minutes} min`;
    case "continuing":
      return `${INTENSITY_EN[outlook.intensity]} continuing for at least 2 hours`;
  }
}

const PERIOD_EN: Record<DayPeriod, string> = {
  overnight: "overnight",
  morning: "in the morning",
  afternoon: "in the afternoon",
  evening: "in the evening",
};

export function describeDayEn({ kind, period, precipitationMm, wind }: DayOutlook): string {
  const when = PERIOD_EN[period];
  let text: string;
  switch (kind) {
    case "thunderstorms":
      text = `Thunderstorms likely ${when}`;
      break;
    case "heavy-rain":
      text = `Heavy rain ${when}, around ${Math.round(precipitationMm)} mm`;
      break;
    case "downpours":
      text = `Heavy downpours ${when}`;
      break;
    case "showers":
      text = `Showers ${when}`;
      break;
    case "light-showers":
      text = `A few light showers ${when}`;
      break;
    case "snow":
      text = `Snow ${when}`;
      break;
    case "fog":
      text = "Fog early, clearing later";
      break;
    case "mostly-cloudy":
      text = "Mostly cloudy";
      break;
    case "hot-sunny-spells":
      text = "Hot with sunny spells";
      break;
    case "sun-and-cloud":
      text = "Sun and cloud";
      break;
    case "hot-sunny":
      text = "Hot and sunny";
      break;
    case "clear":
      text = "Clear skies";
      break;
  }
  if (wind === "windy") return `${text}, windy`;
  if (wind === "breezy") return `${text}, breezy`;
  return text;
}
