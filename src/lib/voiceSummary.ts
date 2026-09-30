import type { Locale } from "@/i18n/config";
import { MESSAGES } from "@/i18n/messages";
import { placeLabel } from "@/i18n/places";
import { support } from "@/services/openmeteo/consensus";
import { zonedParts } from "@/services/weathernext3/time";
import type {
  AqiCategory,
  ConfidenceLevel,
  CurrentConditions,
  DailyForecast,
  DayOutlook,
  HourlyForecast,
  ModelVote,
  RainIntensity,
  WeatherCondition,
} from "@/services/WeatherNext3MockService";
import { AIR_CAUTION, HEAT_DANGER, UV_HIGH } from "./lifestyle";
import { hoursBetween, minutesUntil, modelsDoubt, type RainCountdown } from "./rainCountdown";
import { HEAVY_RATE } from "./routeWeather";

/**
 * The spoken weather summary ("Right now in Bangkok it's 32 degrees and
 * cloudy. Expect heavy rain around 5 PM, so you might want to bring an
 * umbrella."). The rules below pick what is worth saying from the current
 * conditions, the forecast and the rain countdown; each language then words
 * it in its message file, as people would say it rather than as the screen
 * shows it.
 */

/** Say "feels like" when it differs from the thermometer by this much, °C. */
export const FEELS_LIKE_GAP = 3;
/** Rain "is likely" from this chance; below it, give the chance, percent. */
export const RAIN_SURE = 70;
/** How far ahead rain is worth mentioning, hours. */
const RAIN_AHEAD_HOURS = 24;
/** Before this local hour the summary talks about today; from it, about tonight and tomorrow. */
export const EVENING_HOUR = 15;

const HOUR_MS = 3_600_000;

export type DayPart = "morning" | "afternoon" | "evening" | "night";

export type SummaryFact =
  | { kind: "greeting"; part: DayPart }
  | { kind: "now"; tempC: number; condition: WeatherCondition; isDay: boolean; feelsLikeC: number | null }
  /** `doubtful` when the weather models doubt it (see rainCountdown). */
  | { kind: "rainStarting"; minutes: number; intensity: RainIntensity; doubtful?: boolean }
  | { kind: "raining"; intensity: RainIntensity; until: string | null }
  /** `likely` from RAIN_SURE; below it the wording gives the chance. `thisHour`: it starts within the hour, so no clock time. */
  | {
      kind: "rainLater";
      at: string;
      thisHour: boolean;
      chance: number;
      likely: boolean;
      heavy: boolean;
      storm: boolean;
      tomorrow: boolean;
    }
  /** `weekday` of the next rainy day (0 = Sunday), or null when none is in the forecast. */
  | { kind: "dry"; hours: number; weekday: number | null }
  /**
   * After a rain or dry fact, for real forecasts: `agree` of the `total`
   * weather models back it (for a dry spell, those dry through all of it),
   * how firmly (see openmeteo/consensus.ts), and whether they doubt the rain
   * (as the countdown's badge does).
   */
  | {
      kind: "models";
      about: "rain" | "dry";
      agree: number;
      total: number;
      level: ConfidenceLevel;
      doubtful: boolean;
    }
  | { kind: "today"; maxC: number }
  | { kind: "tonight"; minC: number }
  | { kind: "tomorrow"; outlook: DayOutlook; minC: number; maxC: number }
  | { kind: "air"; aqi: number; category: AqiCategory }
  | { kind: "uv"; peak: number }
  | { kind: "heat"; feelsLikeC: number };

/** What the wording needs besides the facts. */
export interface SummaryContext {
  /** The place's name, or null for a GPS spot with no town nearby ("where you are"). */
  place: string | null;
  /** Local hour and minute of an ISO time. */
  clock: (time: string) => { hour: number; minute: number };
}

export interface SummaryInput {
  current: CurrentConditions;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
  countdown: RainCountdown;
  now?: number;
}

function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

const rainModels = (vote: ModelVote): SummaryFact => ({
  kind: "models",
  about: "rain",
  agree: vote.wet,
  total: vote.models,
  level: support(vote, true),
  doubtful: modelsDoubt(vote),
});

export function summaryFacts({ current, hourly, daily, countdown, now }: SummaryInput): SummaryFact[] {
  const at = now ?? Date.parse(current.observedAt);
  const tz = current.place.timeZone;
  const { hour } = zonedParts(at, tz);
  const s = current.sample;
  const facts: SummaryFact[] = [{ kind: "greeting", part: dayPart(hour) }];

  const feelsLike = Math.round(s.feelsLikeC);
  facts.push({
    kind: "now",
    tempC: Math.round(s.temperatureC),
    condition: s.condition,
    isDay: s.isDay,
    feelsLikeC: Math.abs(s.feelsLikeC - s.temperatureC) >= FEELS_LIKE_GAP ? feelsLike : null,
  });

  switch (countdown.kind) {
    case "starting":
      facts.push({
        kind: "rainStarting",
        minutes: Math.max(1, minutesUntil(countdown.at, at)),
        intensity: countdown.intensity,
        ...(countdown.vote && countdown.doubtful ? { doubtful: true } : {}),
      });
      if (countdown.vote) facts.push(rainModels(countdown.vote));
      break;
    case "raining":
      facts.push({ kind: "raining", intensity: countdown.intensity, until: countdown.until });
      break;
    case "later": {
      const start = Date.parse(countdown.at);
      if (start - at > RAIN_AHEAD_HOURS * HOUR_MS) break;
      // Name the rain by its worst hour in the three from when it starts.
      const hours = hoursBetween(hourly, start, start + 3 * HOUR_MS);
      facts.push({
        kind: "rainLater",
        at: countdown.at,
        // Rain the models expect this hour starts "now" in the countdown: no clock time to say.
        thisHour: start <= at,
        chance: countdown.chance,
        likely: countdown.chance >= RAIN_SURE,
        heavy: hours.some((h) => h.precipitationMm >= HEAVY_RATE || h.condition === "heavy-rain"),
        storm: hours.some((h) => h.condition === "thunderstorm"),
        tomorrow: zonedParts(start, tz).day !== zonedParts(at, tz).day,
      });
      if (countdown.vote) facts.push(rainModels(countdown.vote));
      break;
    }
    case "dry": {
      const next = countdown.nextRainDay === null ? null : daily[countdown.nextRainDay];
      facts.push({
        kind: "dry",
        hours: countdown.hours,
        weekday: next ? new Date(`${next.date}T12:00:00Z`).getUTCDay() : null,
      });
      if (countdown.vote && countdown.models)
        facts.push({
          kind: "models",
          about: "dry",
          agree: countdown.models.dry,
          total: countdown.models.total,
          level: support(countdown.vote, false),
          doubtful: false,
        });
      break;
    }
  }

  const today = daily[0];
  const tomorrow = daily[1];
  if (hour < EVENING_HOUR) {
    if (today) facts.push({ kind: "today", maxC: Math.round(today.maxTempC) });
    // Sunscreen while there is still strong sun to come.
    const peak = Math.max(0, ...hoursBetween(hourly, at, at + 6 * HOUR_MS).map((h) => h.uvIndex));
    if (peak >= UV_HIGH) facts.push({ kind: "uv", peak: Math.round(peak) });
  } else {
    const night = hoursBetween(hourly, at, at + 12 * HOUR_MS);
    if (night.length) facts.push({ kind: "tonight", minC: Math.round(Math.min(...night.map((h) => h.temperatureC))) });
    if (tomorrow)
      facts.push({
        kind: "tomorrow",
        outlook: tomorrow.outlook,
        minC: Math.round(tomorrow.minTempC),
        maxC: Math.round(tomorrow.maxTempC),
      });
  }

  if (s.feelsLikeC >= HEAT_DANGER) facts.push({ kind: "heat", feelsLikeC: feelsLike });
  const air = current.airQuality;
  if (air && air.aqi > AIR_CAUTION) facts.push({ kind: "air", aqi: Math.round(air.aqi), category: air.category });
  return facts;
}

export interface WeatherSummary {
  /** One sentence per fact, read aloud one after another. */
  sentences: string[];
  text: string;
  /** BCP 47 language for the speech voice. */
  lang: "th-TH" | "en-US";
}

/** The summary for the dashboard's place, worded in `locale`. */
export function weatherSummary(input: SummaryInput, locale: Locale): WeatherSummary {
  const m = MESSAGES[locale];
  const tz = input.current.place.timeZone;
  const sentences = m.voiceSummary(summaryFacts(input), {
    place: input.current.place.id.startsWith("pt@") ? null : placeLabel(input.current.place, locale).name,
    clock: (time) => {
      const { hour, minute } = zonedParts(Date.parse(time), tz);
      return { hour, minute };
    },
  });
  return { sentences, text: sentences.join(" "), lang: locale === "th" ? "th-TH" : "en-US" };
}
