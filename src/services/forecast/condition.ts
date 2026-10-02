/**
 * The one rule that turns an hour's numbers into its condition (the icon and
 * its words). Rain starts where the map's rain colours start, so once the
 * weather card, the hourly strip and the map all read the unified forecast
 * (the next steps of the plan), the card says rain exactly when the map shows
 * rain at your spot.
 */

import type { WeatherCondition } from "../weathernext3/types";

/** Rain from this much in an hour counts as rain: where the map's rain colours start. */
export const WET_MM = 0.1;
/** Rain from this much in an hour is rain rather than drizzle. */
export const RAIN_MM = 1;
/** Rain from this much in an hour is heavy rain. */
export const HEAVY_MM = 4;
/** Cloud cover from this percent is cloudy, and from PARTLY_CLOUDY partly cloudy. */
export const CLOUDY = 78;
export const PARTLY_CLOUDY = 32;
/** Dry hours with visibility under this many km are fog. */
export const FOG_KM = 1;
/** Rain at or below this temperature, °C, falls as snow. */
export const SNOW_C = 1;
/** A model's thunder signal (0–1, blended like any value) from which a wet hour is a thunderstorm. */
export const THUNDER = 0.5;

export interface ConditionInputs {
  rainMm: number;
  /** Percent. */
  cloudCover: number;
  /** 1 when the model has thunder in the hour, 0 when not; in between while two models blend; null when unknown. */
  thunder: number | null;
  temperatureC: number;
  visibilityKm: number | null;
}

/**
 * The condition of an hour. Only rain makes a wet condition, so a thunderstorm
 * with no rain at the spot reads by its cloud, and fog needs a dry hour.
 */
export function conditionFrom({
  rainMm,
  cloudCover,
  thunder,
  temperatureC,
  visibilityKm,
}: ConditionInputs): WeatherCondition {
  if (rainMm >= WET_MM) {
    if (temperatureC <= SNOW_C) return "snow";
    if ((thunder ?? 0) >= THUNDER) return "thunderstorm";
    if (rainMm >= HEAVY_MM) return "heavy-rain";
    if (rainMm >= RAIN_MM) return "rain";
    return "drizzle";
  }
  if (visibilityKm !== null && visibilityKm < FOG_KM) return "fog";
  if (cloudCover >= CLOUDY) return "cloudy";
  if (cloudCover >= PARTLY_CLOUDY) return "partly-cloudy";
  return "clear";
}

/** Whether a condition is one of rain (or snow): what the map's rain layer shows. */
export const isWet = (condition: WeatherCondition) =>
  condition === "drizzle" ||
  condition === "rain" ||
  condition === "heavy-rain" ||
  condition === "thunderstorm" ||
  condition === "snow";
