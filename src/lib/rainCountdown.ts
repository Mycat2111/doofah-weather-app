import { support } from "@/services/openmeteo/consensus";
import { rainIntensity } from "@/services/weathernext3/describe";
import type {
  ConfidenceLevel,
  CurrentConditions,
  DailyForecast,
  HourlyForecast,
  ModelVote,
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
/**
 * Rain the nowcast shows but that the weather models, together, give less
 * than this chance, in percent, reads as "possible" rather than "expected".
 */
export const DOUBTFUL_CHANCE = 35;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/**
 * Time to the next rain, or to the end of the current rain. The first two
 * hours come from the 10-minute nowcast (the radar in the simulation,
 * Open-Meteo's 15-minute forecast for real data), timed to the minute; after
 * that the hourly forecast takes over.
 *
 * With real data, `vote` says how the weather models see that hour (see
 * openmeteo/consensus.ts), and they have a say: rain the nowcast shows but
 * most models doubt is `doubtful`, and rain most of them expect within the
 * nowcast's two hours is reported even when the nowcast is dry.
 */
export type RainCountdown =
  /** Dry now; the radar shows rain arriving at `at`, within 2 hours. */
  | { kind: "starting"; at: string; intensity: RainIntensity; vote?: ModelVote; doubtful?: boolean }
  /**
   * Raining now. `until` is when it eases: to the minute from the radar when
   * `precise`, else the hour from the forecast; null when it lasts past the horizon.
   */
  | { kind: "raining"; intensity: RainIntensity; until: string | null; precise: boolean; vote?: ModelVote }
  /**
   * Dry for now; rain is likely from `at` (an hour of the forecast): after
   * the nowcast's 2 hours, or within them when the models say so (`soon`).
   */
  | { kind: "later"; at: string; chance: number; clear: boolean; vote?: ModelVote; soon?: boolean }
  /**
   * No rain likely for the next `hours` hours. `nextRainDay` indexes the
   * daily forecast, or is null. `vote` is the models' wettest hour in that
   * time, which is at `showerAt`.
   */
  | { kind: "dry"; hours: number; clear: boolean; nextRainDay: number | null; vote?: ModelVote; showerAt?: string };

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

/** The models' vote for the hour `at` falls in, if they cover it. */
function voteAt(hourly: HourlyForecast[], at: number): ModelVote | undefined {
  return hoursBetween(hourly, at, at + 1).find((h) => h.vote)?.vote;
}

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
  const withVote = <T extends RainCountdown>(countdown: T, vote: ModelVote | undefined): T =>
    vote ? { ...countdown, vote } : countdown;

  if (wet(steps[0])) {
    const intensity = rainIntensity(Math.max(...steps.filter(wet).map((s) => s.precipitationMm)));
    const vote = voteAt(hourly, now);
    const stop = steps.findIndex((s) => !wet(s));
    if (stop > 0)
      return withVote(
        { kind: "raining", intensity, until: iso(crossing(steps[stop - 1], steps[stop])), precise: true },
        vote,
      );
    const dryHour = after.find((h) => !isWetHour(h) && h.precipitationMm < WET_RATE);
    return withVote(
      {
        kind: "raining",
        intensity,
        until: dryHour ? iso(Math.max(Date.parse(dryHour.time), radarEnd)) : null,
        precise: false,
      },
      vote,
    );
  }

  const start = steps.findIndex(wet);
  if (start > 0) {
    // Name the rain by its heaviest step in the half hour after it arrives.
    const peak = Math.max(...steps.slice(start, start + 3).map((s) => s.precipitationMm));
    const at = crossing(steps[start - 1], steps[start]);
    const vote = voteAt(hourly, at);
    const countdown: RainCountdown = { kind: "starting", at: iso(at), intensity: rainIntensity(peak) };
    // Most models see no rain then: it may not come.
    if (vote && vote.chance < DOUBTFUL_CHANCE && vote.wet * 2 < vote.models)
      return { ...countdown, vote, doubtful: true };
    return withVote(countdown, vote);
  }

  const cloudUntil = (at: number) =>
    meanCloud(hoursBetween(hourly, now, at), current.sample.cloudCover) < CLEAR_SKY_CLOUD;

  // The nowcast is dry, but the models together expect rain within its two hours.
  const soon = hoursBetween(hourly, now, radarEnd).find((h) => h.vote && isWetHour(h));
  if (soon) {
    const at = Math.max(Date.parse(soon.time), now);
    return {
      kind: "later",
      at: iso(at),
      chance: soon.precipitationProbability,
      clear: cloudUntil(at),
      vote: soon.vote,
      soon: true,
    };
  }

  const rainHour = after.find(isWetHour);
  if (rainHour) {
    const at = Math.max(Date.parse(rainHour.time), radarEnd);
    return withVote(
      { kind: "later", at: iso(at), chance: rainHour.precipitationProbability, clear: cloudUntil(at) },
      rainHour.vote,
    );
  }

  const nextRainDay = daily.findIndex((d, i) => i > 0 && d.precipitationProbability >= RAIN_LIKELY);
  const dry: RainCountdown = {
    kind: "dry",
    hours: COUNTDOWN_HOURS,
    clear: cloudUntil(horizon),
    nextRainDay: nextRainDay === -1 ? null : nextRainDay,
  };
  // The hour the models give the best chance of a shower, if they cover the whole time.
  const ahead = hoursBetween(hourly, now, horizon);
  if (!ahead.length || !ahead.every((h) => h.vote)) return dry;
  const wettest = ahead.reduce((a, b) => {
    const [va, vb] = [a.vote!, b.vote!];
    return vb.chance > va.chance || (vb.chance === va.chance && vb.wet > va.wet) ? b : a;
  });
  return { ...dry, vote: wettest.vote, showerAt: wettest.time };
}

/**
 * What the weather models say about a countdown, for a line under the badge
 * (see Messages.modelOutlook). `agree` counts the models that back what the
 * badge says: rain, or a dry spell.
 */
export type ModelOutlook =
  | {
      kind: "rain";
      /** About when; null when it is less than 15 minutes away. */
      clock: string | null;
      agree: number;
      total: number;
      chance: number;
      level: ConfidenceLevel;
      /** Enough of the models have heavy rain, or thunder, to say so. */
      heavy: boolean;
      storm: boolean;
    }
  | {
      kind: "dry";
      hours: number;
      agree: number;
      total: number;
      /** The hour most likely to see a shower, and its chance. */
      showerClock: string;
      chance: number;
      level: ConfidenceLevel;
    };

/** Rain closer than this is "soon". */
const SOON_MS = 15 * MINUTE_MS;

/**
 * The models' view of a countdown, or null when they have none (the
 * simulation, rain already falling, or hours they don't cover). `clock`
 * formats a time for the place.
 */
export function modelOutlook(
  countdown: RainCountdown,
  now: number,
  clock: (time: string) => string,
): ModelOutlook | null {
  const { vote } = countdown;
  if (!vote) return null;
  switch (countdown.kind) {
    case "raining":
      return null;
    case "dry":
      if (!countdown.showerAt) return null;
      return {
        kind: "dry",
        hours: countdown.hours,
        agree: vote.models - vote.wet,
        total: vote.models,
        showerClock: clock(countdown.showerAt),
        chance: vote.chance,
        level: support(vote, false),
      };
    case "starting":
    case "later": {
      const at = Date.parse(countdown.at);
      return {
        kind: "rain",
        clock: at - now < SOON_MS ? null : clock(countdown.at),
        agree: vote.wet,
        total: vote.models,
        chance: vote.chance,
        level: support(vote, true),
        // At least two models, and half of those with rain (a third of those that forecast thunder).
        heavy: vote.heavy >= 2 && vote.heavy * 2 >= vote.wet,
        storm: vote.storm >= 2 && vote.storm * 3 >= vote.stormModels,
      };
    }
  }
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
