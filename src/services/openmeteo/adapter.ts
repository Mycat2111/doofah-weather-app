/**
 * Open-Meteo's replies in DooFah's shapes (see weathernext3/types.ts).
 *
 * Open-Meteo gives precipitation, its probability and the gusts for the hour
 * *before* each time, while a DooFah hour covers the hour *from* its time. So
 * hour T takes those from Open-Meteo's T + 1 h, with the weather code from
 * there too so that the sky agrees with the rain, and its instant values
 * (temperature, humidity, wind, cloud...) from T.
 *
 * The forecast itself is Open-Meteo's best model for the place (ECMWF's 9 km
 * IFS over Thailand). When the other models' reply is there too, the chance
 * of rain and the confidence of the first days come from all of them
 * together (see consensus.ts).
 */

import { aqiCategory, dewPoint, feelsLike, uvIndex } from "../weathernext3/fieldModel";
import { sunElevation, sunTimes } from "../weathernext3/solar";
import { atmosphereFor, nowcastFromSteps, summariseDay } from "../weathernext3/summarise";
import { floorToHour, HOUR_MS, localDateKey, zonedMidnight, zonedParts } from "../weathernext3/time";
import type {
  AirQuality,
  AtmosphericSample,
  CurrentConditions,
  DailyForecast,
  ForecastBundle,
  GeoPoint,
  HourlyForecast,
  NowcastStep,
  Place,
  Pollutant,
  SpotWeather,
  WeatherCondition,
} from "../weathernext3/types";
import {
  FORECAST_DAYS,
  type AirQualityResponse,
  type ConsensusResponse,
  type ForecastResponse,
  type Values,
} from "./api";
import { consensusFrom, dayVote, type Consensus } from "./consensus";

const MINUTE_MS = 60_000;
const QUARTER_MS = 15 * MINUTE_MS;
const STEP_MS = 10 * MINUTE_MS;
/** The countdown's bars: now and every 10 minutes for 2 hours. */
const NOWCAST_STEPS = 13;
/** Hours shown in the hourly strip. */
const HOURLY_HOURS = 48;
/** Current conditions are used while this recent; a saved forecast older than this uses its hourly forecast for now. */
const CURRENT_MAX_AGE_MS = 90 * MINUTE_MS;
/** Air quality is shown while this recent. */
const AIR_MAX_AGE_MS = 3 * HOUR_MS;
/** Ozone from µg/m³ to ppb at 25 °C (24.45 / 48.00). */
const OZONE_PPB_PER_UG = 0.509;
/** The sun is up from this elevation, degrees (upper limb, with refraction). */
const SUNRISE_ELEVATION = -0.83;
/** Rain rate that counts as rain, mm/h, as in the countdown. */
const WET_RATE = 0.1;

const round1 = (v: number) => Math.round(v * 10) / 10;
const iso = (ms: number) => new Date(ms).toISOString();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const present = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** WMO weather codes (the ones Open-Meteo sends) as DooFah's conditions; null for an unknown code. */
export function wmoCondition(code: number): WeatherCondition | null {
  if (code === 0 || code === 1) return "clear";
  if (code === 2) return "partly-cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 61 || code === 63 || code === 66 || code === 80 || code === 81) return "rain";
  if (code === 65 || code === 67 || code === 82) return "heavy-rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95 && code <= 99) return "thunderstorm";
  return null;
}

const RAINY: readonly WeatherCondition[] = ["drizzle", "rain", "heavy-rain"];

/** A condition from the rain and the cloud, for when the weather code is missing or disagrees. */
function conditionFrom(precipitationMm: number, cloudCover: number): WeatherCondition {
  if (precipitationMm >= 4) return "heavy-rain";
  if (precipitationMm >= 1) return "rain";
  if (precipitationMm >= WET_RATE) return "drizzle";
  if (cloudCover >= 78) return "cloudy";
  if (cloudCover >= 32) return "partly-cloudy";
  return "clear";
}

function condition(code: number | null | undefined, precipitationMm: number, cloudCover: number): WeatherCondition {
  return (present(code) ? wmoCondition(code) : null) ?? conditionFrom(precipitationMm, cloudCover);
}

/** A condition that rains when the rate says it rains and not otherwise; storms and snow stay as they are. */
function withRain(sky: WeatherCondition, rate: number, cloudCover: number): WeatherCondition {
  const rainy = RAINY.includes(sky);
  if (rate >= WET_RATE && !rainy && sky !== "thunderstorm" && sky !== "snow") return conditionFrom(rate, cloudCover);
  if (rate < WET_RATE && rainy) return cloudCover >= 78 ? "cloudy" : "partly-cloudy";
  return sky;
}

/** Chance of rain for an hour the ensemble has no figure for: from the model's own rain. */
function chance(value: number | null | undefined, precipitationMm: number): number {
  if (present(value)) return Math.round(clamp(value, 0, 100));
  return precipitationMm >= 1 ? 80 : precipitationMm >= WET_RATE ? 60 : 10;
}

/**
 * An instant value with its gaps filled from the nearest earlier hour (the
 * nearest later one at the start); null when the whole column is missing.
 */
function filled(values: Values | undefined, length: number): number[] | null {
  const first = values?.find(present);
  if (!values || first === undefined) return null;
  let last = first;
  return Array.from({ length }, (_, i) => {
    const v = values[i];
    if (present(v)) last = v;
    return last;
  });
}

function required(values: Values | undefined, length: number, name: string): number[] {
  const column = filled(values, length);
  if (!column) throw new Error(`Open-Meteo sent no ${name}`);
  return column;
}

/**
 * Every hour of the reply as DooFah's hours, each covering the hour from its
 * time; with the models' `consensus`, the hours they cover take its chance of
 * rain and confidence.
 */
export function hourlyForecasts(
  raw: ForecastResponse,
  point: GeoPoint,
  now: number,
  consensus: Consensus | null = null,
): HourlyForecast[] {
  const h = raw.hourly;
  if (!h?.time?.length) throw new Error("Open-Meteo sent no hourly forecast");
  const n = h.time.length;
  const times = h.time.map((t) => t * 1000);
  const temperature = required(h.temperature_2m, n, "temperature");
  const humidity = required(h.relative_humidity_2m, n, "humidity");
  const pressure = required(h.pressure_msl, n, "pressure");
  const cloud = required(h.cloud_cover, n, "cloud cover");
  const wind = required(h.wind_speed_10m, n, "wind speed");
  const direction = required(h.wind_direction_10m, n, "wind direction");
  if (!h.precipitation || !h.weather_code) throw new Error("Open-Meteo sent no precipitation");
  const dew = filled(h.dew_point_2m, n);
  const apparent = filled(h.apparent_temperature, n);
  const gusts = filled(h.wind_gusts_10m, n);
  const visibility = filled(h.visibility, n);
  const uv = filled(h.uv_index, n);
  const thisHour = floorToHour(now);

  return times.map((time, i) => {
    const next = Math.min(i + 1, n - 1);
    const precipitationMm = round1(Math.max(0, h.precipitation?.[next] ?? 0));
    const elevation = sunElevation(time, point.lat, point.lon);
    const vote = consensus?.hours.get(time);
    return {
      time: iso(time),
      temperatureC: round1(temperature[i]),
      feelsLikeC: round1(apparent?.[i] ?? feelsLike(temperature[i], humidity[i], wind[i])),
      dewPointC: round1(dew?.[i] ?? dewPoint(temperature[i], humidity[i])),
      humidity: Math.round(humidity[i]),
      pressureHpa: round1(pressure[i]),
      windSpeedKmh: round1(wind[i]),
      windGustKmh: round1(Math.max(gusts?.[next] ?? wind[i], wind[i])),
      windDirectionDeg: Math.round(direction[i]) % 360,
      precipitationMm,
      precipitationProbability: vote ? vote.chance : chance(h.precipitation_probability?.[next], precipitationMm),
      cloudCover: Math.round(cloud[i]),
      // Without a visibility forecast, a clear 10 km.
      visibilityKm: round1((visibility?.[i] ?? 10_000) / 1000),
      uvIndex: round1(Math.max(0, uv?.[i] ?? uvIndex(elevation, cloud[i] / 100))),
      condition: condition(h.weather_code?.[next], precipitationMm, cloud[i]),
      isDay: elevation > SUNRISE_ELEVATION,
      sunElevationDeg: round1(elevation),
      leadHours: Math.round((time - thisHour) / HOUR_MS),
      confidence: vote ? vote.confidence : null,
      ...(vote ? { vote } : {}),
    };
  });
}

/** The hour that `at` falls in, if the forecast has it. */
function hourAt(hours: HourlyForecast[], at: number): HourlyForecast | undefined {
  return hours.find((h) => {
    const start = Date.parse(h.time);
    return start <= at && at < start + HOUR_MS;
  });
}

/** The hourly forecast for the instant `at`: instant values interpolated, the rest from its hour. */
function sampleFromHours(hours: HourlyForecast[], at: number, point: GeoPoint): AtmosphericSample {
  const i = hours.findIndex((h) => {
    const start = Date.parse(h.time);
    return start <= at && at < start + HOUR_MS;
  });
  if (i === -1) throw new Error("The forecast does not cover this time");
  const a = hours[i];
  const b = hours[Math.min(i + 1, hours.length - 1)];
  const f = b === a ? 0 : clamp((at - Date.parse(a.time)) / HOUR_MS, 0, 1);
  const mix = (key: "temperatureC" | "feelsLikeC" | "dewPointC" | "humidity" | "pressureHpa" | "windSpeedKmh") =>
    a[key] + (b[key] - a[key]) * f;
  const elevation = sunElevation(at, point.lat, point.lon);
  return {
    time: iso(at),
    temperatureC: round1(mix("temperatureC")),
    feelsLikeC: round1(mix("feelsLikeC")),
    dewPointC: round1(mix("dewPointC")),
    humidity: Math.round(mix("humidity")),
    pressureHpa: round1(mix("pressureHpa")),
    windSpeedKmh: round1(mix("windSpeedKmh")),
    windGustKmh: a.windGustKmh,
    windDirectionDeg: a.windDirectionDeg,
    precipitationMm: a.precipitationMm,
    precipitationProbability: a.precipitationProbability,
    cloudCover: Math.round(a.cloudCover + (b.cloudCover - a.cloudCover) * f),
    visibilityKm: round1(a.visibilityKm + (b.visibilityKm - a.visibilityKm) * f),
    uvIndex: round1(a.uvIndex + (b.uvIndex - a.uvIndex) * f),
    condition: a.condition,
    isDay: elevation > SUNRISE_ELEVATION,
    sunElevationDeg: round1(elevation),
  };
}

/**
 * Rain every 10 minutes for the next 2 hours: the rate of the quarter hour
 * each step falls in (Open-Meteo's 15-minute value is the rain of the quarter
 * hour before its time), else of its hour.
 */
function nowcastSteps(raw: ForecastResponse, hours: HourlyForecast[], now: number): NowcastStep[] {
  const minutely = raw.minutely_15;
  const quarters = (minutely?.time ?? []).flatMap((t, j) => {
    const mm = minutely?.precipitation?.[j];
    return present(mm) ? [{ end: t * 1000, rate: Math.max(0, mm) * (HOUR_MS / QUARTER_MS) }] : [];
  });
  return Array.from({ length: NOWCAST_STEPS }, (_, k) => {
    const at = now + k * STEP_MS;
    const quarter = quarters.find((q) => q.end - QUARTER_MS <= at && at < q.end);
    const rate = quarter?.rate ?? hourAt(hours, at)?.precipitationMm ?? 0;
    return { time: iso(at), precipitationMm: round1(rate) };
  });
}

/** Air quality from the reply, if recent enough. */
export function airQualityFrom(raw: AirQualityResponse | null, now: number): AirQuality | null {
  const c = raw?.current;
  if (!c || !present(c.us_aqi) || Math.abs(now - c.time * 1000) > AIR_MAX_AGE_MS) return null;
  const aqi = Math.round(c.us_aqi);
  const parts: [Pollutant, number | null | undefined][] = [
    ["pm25", c.us_aqi_pm2_5],
    ["pm10", c.us_aqi_pm10],
    ["o3", c.us_aqi_ozone],
  ];
  let dominantPollutant: Pollutant = "pm25";
  let worst = -1;
  for (const [pollutant, index] of parts) {
    if (present(index) && index > worst) [dominantPollutant, worst] = [pollutant, index];
  }
  return {
    aqi,
    category: aqiCategory(aqi),
    dominantPollutant,
    pm25: round1(c.pm2_5 ?? 0),
    pm10: round1(c.pm10 ?? 0),
    o3: Math.round((c.ozone ?? 0) * OZONE_PPB_PER_UG),
  };
}

/**
 * Local days from today, each summarised from its hours; the days the models'
 * reply covers whole take their chance of rain and confidence from all of them.
 */
function dailyForecasts(
  hours: HourlyForecast[],
  place: Place,
  now: number,
  models: ConsensusResponse | null,
): DailyForecast[] {
  const { timeZone, point } = place;
  const today = localDateKey(now, timeZone);
  const byDate = new Map<string, HourlyForecast[]>();
  for (const h of hours) {
    const date = localDateKey(Date.parse(h.time), timeZone);
    if (date < today) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), h]);
  }
  return [...byDate].slice(0, FORECAST_DAYS).map(([date, dayHours]) => {
    const { year, month, day } = zonedParts(Date.parse(dayHours[0].time), timeZone);
    const sun = sunTimes(zonedMidnight(year, month, day, timeZone), point.lat, point.lon);
    const vote = dayVote(
      models,
      dayHours.map((h) => Date.parse(h.time)),
    );
    if (!vote) return { ...summariseDay(date, dayHours, sun, timeZone), confidence: null };
    return { ...summariseDay(date, dayHours, sun, timeZone, vote.chance), confidence: vote.confidence, vote };
  });
}

/**
 * The dashboard's data for `place` from a forecast reply (and an air quality
 * reply and the other models' reply, if there are). `savedAt` is set for a
 * forecast saved on the device earlier, shown because there is no connection.
 */
export function forecastBundle(
  raw: ForecastResponse,
  air: AirQualityResponse | null,
  place: Place,
  now: number,
  savedAt?: number,
  models: ConsensusResponse | null = null,
): ForecastBundle {
  const { point } = place;
  const consensus = consensusFrom(models, now);
  const hours = hourlyForecasts(raw, point, now, consensus);
  const hourly = hours.filter((h) => Date.parse(h.time) >= floorToHour(now)).slice(0, HOURLY_HOURS);
  const daily = dailyForecasts(hours, place, now, consensus ? models : null);
  if (!hourly.length || !daily.length) throw new Error("The forecast does not reach today");

  const steps = nowcastSteps(raw, hours, now);
  const fromHours = sampleFromHours(hours, now, point);
  const c = raw.current;
  let sample: AtmosphericSample = fromHours;
  if (c && Math.abs(now - c.time * 1000) <= CURRENT_MAX_AGE_MS) {
    const temperatureC = c.temperature_2m ?? fromHours.temperatureC;
    const humidity = c.relative_humidity_2m ?? fromHours.humidity;
    const windSpeedKmh = c.wind_speed_10m ?? fromHours.windSpeedKmh;
    const cloudCover = c.cloud_cover ?? fromHours.cloudCover;
    // The rain of the last quarter hour, as a rate, is the rain now.
    if (present(c.precipitation) && c.interval > 0) {
      steps[0] = { ...steps[0], precipitationMm: round1(Math.max(0, c.precipitation) * (HOUR_MS / 1000 / c.interval)) };
    }
    sample = {
      ...fromHours,
      temperatureC: round1(temperatureC),
      feelsLikeC: round1(c.apparent_temperature ?? fromHours.feelsLikeC),
      dewPointC: round1(dewPoint(temperatureC, humidity)),
      humidity: Math.round(humidity),
      pressureHpa: round1(c.pressure_msl ?? fromHours.pressureHpa),
      windSpeedKmh: round1(windSpeedKmh),
      windGustKmh: round1(Math.max(c.wind_gusts_10m ?? fromHours.windGustKmh, windSpeedKmh)),
      windDirectionDeg: Math.round(c.wind_direction_10m ?? fromHours.windDirectionDeg) % 360,
      cloudCover: Math.round(cloudCover),
      condition: present(c.weather_code) ? (wmoCondition(c.weather_code) ?? fromHours.condition) : fromHours.condition,
    };
  }
  // The sky and the countdown agree on whether it is raining now.
  const rateNow = steps[0].precipitationMm;
  sample = { ...sample, precipitationMm: rateNow, condition: withRain(sample.condition, rateNow, sample.cloudCover) };

  const today = daily[0];
  const current: CurrentConditions = {
    place,
    source: "open-meteo",
    cell: null,
    observedAt: iso(now),
    ...(savedAt === undefined ? {} : { savedAt: iso(savedAt) }),
    sample,
    airQuality: airQualityFrom(air, now),
    atmosphere: atmosphereFor(sample),
    sunrise: today.sunrise,
    sunset: today.sunset,
    nowcast: nowcastFromSteps(steps),
    model: null,
    ...(consensus ? { blend: consensus.models.map(({ centre, name }) => ({ centre, name })) } : {}),
  };
  return { current, hourly, daily };
}

/**
 * A spot's weather at `time` from a reply of SPOT_VARIABLES for one place:
 * the temperature between the hours around it, the rain of its hour.
 */
export function spotWeather(raw: ForecastResponse, point: GeoPoint, time: number): SpotWeather {
  const h = raw.hourly;
  if (!h?.time?.length) throw new Error("Open-Meteo sent no hourly forecast");
  const n = h.time.length;
  const times = h.time.map((t) => t * 1000);
  const temperature = required(h.temperature_2m, n, "temperature");
  const i = Math.max(
    0,
    times.findLastIndex((t) => t <= time),
  );
  const next = Math.min(i + 1, n - 1);
  const f = next > i ? clamp((time - times[i]) / (times[next] - times[i]), 0, 1) : 0;
  const precipitationMm = round1(Math.max(0, h.precipitation?.[next] ?? 0));
  return {
    time: iso(time),
    temperatureC: round1(temperature[i] + (temperature[next] - temperature[i]) * f),
    precipitationMm,
    precipitationProbability: chance(h.precipitation_probability?.[next], precipitationMm),
    // No cloud cover is asked for; a missing code reads as partly cloudy when dry.
    condition: condition(h.weather_code?.[next], precipitationMm, 50),
    isDay: sunElevation(time, point.lat, point.lon) > SUNRISE_ELEVATION,
  };
}
