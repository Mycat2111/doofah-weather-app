/**
 * Continuous atmospheric field model behind the WeatherNext 3 simulation.
 *
 * Each variable is a function of (lat, lon, time), built from seeded noise
 * that is advected by a steering flow (trade easterlies in the tropics,
 * westerlies in the mid-latitudes), so weather systems drift and evolve
 * instead of flickering. Variables are physically linked:
 *
 *   pressure ──► wind (geostrophic + friction) ──► gusts
 *      │
 *      ▼
 *   moisture ──► convective + stratiform rain ──► cloud ──► temperature, RH, visibility
 */

import { clamp, fbm3, smoothstep } from "./noise";
import { dayOfYear, localSolarHour, sunElevation } from "./solar";
import { HOUR_MS } from "./time";
import type { AirQuality, AqiCategory, Pollutant, WeatherCondition } from "./types";

const RAD = Math.PI / 180;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQ = 111.32;

/** Steering winds in km/h used to advect weather systems. */
const U_TROPICAL = -14;
const U_WESTERLY = 34;

export interface PrecipComponents {
  /** Convective (shower / thunderstorm) rate, mm/h. */
  convective: number;
  /** Stratiform (widespread) rate, mm/h. */
  stratiform: number;
  /** Raw threshold margins, used to derive ensemble-style probabilities. */
  convectiveSignal: number;
  stratiformSignal: number;
}

export interface FieldState {
  pressureHpa: number;
  moisture: number;
  precip: PrecipComponents;
  rate: number;
  cloud: number;
  temperatureC: number;
  humidity: number;
  u: number;
  v: number;
  windSpeedKmh: number;
  windGustKmh: number;
  visibilityKm: number;
  sunElevationDeg: number;
}

export class FieldModel {
  constructor(private readonly seed: number) {}

  /* ------------------------------------------------------------ */
  /* Noise helpers                                                 */
  /* ------------------------------------------------------------ */

  /** Advected fBm: blends a tropical-easterly and a westerly-steered field by latitude. */
  private advected(
    lat: number,
    lon: number,
    th: number,
    scaleKm: number,
    tauHours: number,
    seedOffset: number,
    octaves: number,
  ): number {
    const xKm = lon * KM_PER_DEG_LON_EQ * Math.cos(lat * RAD);
    const y = (lat * KM_PER_DEG_LAT) / scaleKm;
    const z = th / tauHours;
    const w = smoothstep(18, 35, Math.abs(lat));
    let v = 0;
    if (w < 1) {
      v += (1 - w) * fbm3((xKm - U_TROPICAL * th) / scaleKm, y, z, this.seed + seedOffset, octaves);
    }
    if (w > 0) {
      v += w * fbm3((xKm - U_WESTERLY * th) / scaleKm, y, z, this.seed + seedOffset + 7919, octaves);
    }
    return v;
  }

  /* ------------------------------------------------------------ */
  /* Individual fields                                             */
  /* ------------------------------------------------------------ */

  /** Mean sea-level pressure, hPa. */
  pressure(lat: number, lon: number, th: number): number {
    const a = Math.abs(lat);
    const climatology =
      1011.5 +
      6 * Math.exp(-(((a - 32) / 10) ** 2)) - // subtropical highs
      9 * Math.exp(-(((a - 62) / 10) ** 2)) - // subpolar lows
      2.5 * Math.exp(-((lat - 8) ** 2) / 60); // equatorial trough
    const midLat = smoothstep(18, 35, a);
    const amplitude = 5 + 19 * midLat; // mid-latitude cyclones are far deeper
    const synoptic = this.advected(lat, lon, th, 1100, 66, 11, 4) * amplitude;
    return climatology + synoptic;
  }

  /** Column moisture index 0–1 (drives cloud and rain). */
  moisture(lat: number, lon: number, th: number, pressureHpa: number): number {
    const doy = dayOfYear(th * HOUR_MS);
    // ITCZ / monsoon trough migrates with the season (≈ 15°N in Aug, ≈ -3°N in Feb).
    const itcz = 6 + 9 * Math.sin((2 * Math.PI * (doy - 110)) / 365);
    const base =
      0.4 +
      0.34 * Math.exp(-((lat - itcz) ** 2) / (2 * 11 ** 2)) -
      0.14 * Math.exp(-(((Math.abs(lat) - 26) / 6) ** 2)) +
      0.08 * smoothstep(40, 55, Math.abs(lat));
    const variability = 0.28 * this.advected(lat, lon, th, 600, 40, 23, 3);
    const lowPressureLift = clamp((1011 - pressureHpa) / 16, -0.15, 0.3);
    return clamp(base + variability + lowPressureLift, 0.03, 1);
  }

  precipitation(
    lat: number,
    lon: number,
    th: number,
    moisture: number,
    pressureHpa: number,
  ): PrecipComponents {
    const ms = th * HOUR_MS;
    const solarHour = localSolarHour(ms, lon);
    // Convection peaks in the mid/late afternoon.
    const diurnal = Math.cos((2 * Math.PI * (solarHour - 16.5)) / 24);
    const tropical = 1 - smoothstep(20, 40, Math.abs(lat));
    const instability = moisture - 0.56 + (0.1 + 0.1 * tropical) * diurnal + 0.05 * tropical;

    const cells = this.advected(lat, lon, th, 42, 2.2, 31, 3);
    const convectiveSignal = cells + instability * 0.95 - 0.48;
    const convective = convectiveSignal > 0 ? 50 * convectiveSignal ** 1.55 : 0;

    const sheets = this.advected(lat, lon, th, 260, 10, 41, 3);
    const stratiformSignal = sheets * 0.55 + (1007 - pressureHpa) / 14 + (moisture - 0.62) * 0.9 - 0.3;
    const stratiform = stratiformSignal > 0 ? 7 * stratiformSignal ** 1.25 : 0;

    return { convective, stratiform, convectiveSignal, stratiformSignal };
  }

  cloud(lat: number, lon: number, th: number, moisture: number, rate: number): number {
    const texture = this.advected(lat, lon, th, 140, 6, 53, 3);
    return clamp(0.14 + (moisture - 0.36) * 0.95 + 0.3 * texture + 0.35 * Math.min(1, rate / 2), 0, 1);
  }

  temperature(
    lat: number,
    lon: number,
    th: number,
    moisture: number,
    cloud: number,
    rate: number,
  ): number {
    const ms = th * HOUR_MS;
    const a = Math.abs(lat);
    const beyond12 = Math.max(0, a - 12);
    const annualMean = 29.5 - 0.3 * beyond12 - 0.0035 * beyond12 ** 2;
    const seasonalAmp = 0.5 + 0.24 * clamp(a - 10, 0, 28);
    const seasonal =
      seasonalAmp * Math.cos((2 * Math.PI * (dayOfYear(ms) - 200)) / 365) * Math.sign(lat || 1);

    const solarHour = localSolarHour(ms, lon);
    const diurnalAmp = (2.8 + 4.2 * (1 - moisture)) * (1 - 0.55 * cloud);
    const diurnal = diurnalAmp * Math.cos((2 * Math.PI * (solarHour - 14.5)) / 24);

    const midLat = smoothstep(18, 35, a);
    const synoptic = this.advected(lat, lon, th, 1300, 70, 61, 3) * (1.5 + 6 * midLat);
    const rainCooling = Math.min(3.5, 1.3 * Math.sqrt(rate));

    return annualMean + seasonal + diurnal + synoptic - rainCooling;
  }

  /**
   * 10 m wind from the pressure gradient: geostrophic balance (turned for the
   * hemisphere) plus a friction component toward low pressure, plus the
   * background steering flow and small-scale turbulence.
   * `dpdxKm` / `dpdyKm` are pressure gradients in hPa per km.
   */
  windFromGradient(
    lat: number,
    lon: number,
    th: number,
    dpdxKm: number,
    dpdyKm: number,
    rate: number,
  ): { u: number; v: number; speed: number; gust: number } {
    const a = Math.abs(lat);
    const coriolis = Math.sign(lat || 1) * clamp(Math.sin(a * RAD) / Math.sin(20 * RAD), 0.55, 1.6);
    // Geostrophic balance breaks down near the equator, where flow is mostly down-gradient.
    const geostrophic = 0.35 + 0.65 * smoothstep(1, 12, a);
    const K = 1900; // (km/h) per (hPa/km), tuned for realistic 10 m speeds
    const geoU = (geostrophic * -K * dpdyKm) / coriolis;
    const geoV = (geostrophic * K * dpdxKm) / coriolis;
    const friction = 700;
    const midLat = smoothstep(18, 35, a);
    const steerU = (1 - midLat) * U_TROPICAL * 0.85 + midLat * U_WESTERLY * 0.25;

    const solarHour = localSolarHour(th * HOUR_MS, lon);
    const mixing = 0.85 + 0.2 * Math.cos((2 * Math.PI * (solarHour - 14)) / 24);
    const turbulence = 1 + 0.18 * this.advected(lat, lon, th, 30, 1.5, 71, 2);

    const scale = 0.62 * mixing * turbulence;
    let u = (geoU - friction * dpdxKm + steerU) * scale;
    let v = (geoV - friction * dpdyKm) * scale;

    // Tropical winds are rarely geostrophically strong; soften the extremes.
    const raw = Math.hypot(u, v);
    const cap = 55 + 35 * midLat;
    if (raw > cap) {
      const f = (cap + Math.log1p(raw - cap) * 6) / raw;
      u *= f;
      v *= f;
    }
    const speed = Math.hypot(u, v);
    const gust = speed * (1.3 + 0.006 * speed) + 1.6 * Math.min(rate, 25);
    return { u, v, speed, gust };
  }

  wind(lat: number, lon: number, th: number, rate: number) {
    const dKm = 15;
    const dLat = dKm / KM_PER_DEG_LAT;
    const dLon = dKm / (KM_PER_DEG_LON_EQ * Math.max(0.05, Math.cos(lat * RAD)));
    const dpdx = (this.pressure(lat, lon + dLon, th) - this.pressure(lat, lon - dLon, th)) / (2 * dKm);
    const dpdy = (this.pressure(lat + dLat, lon, th) - this.pressure(lat - dLat, lon, th)) / (2 * dKm);
    return this.windFromGradient(lat, lon, th, dpdx, dpdy, rate);
  }

  /** Full, internally consistent state at one point. */
  sample(lat: number, lon: number, ms: number, leadHours: number): FieldState {
    const th = ms / HOUR_MS;
    const pressureHpa = this.pressure(lat, lon, th);
    const moisture = this.moisture(lat, lon, th, pressureHpa);
    const precip = this.precipitation(lat, lon, th, moisture, pressureHpa);
    const rate = ensembleDamping(leadHours) * (precip.convective + precip.stratiform);
    const cloud = this.cloud(lat, lon, th, moisture, rate);
    const temperatureC = this.temperature(lat, lon, th, moisture, cloud, rate);
    const wind = this.wind(lat, lon, th, rate);

    const solarHour = localSolarHour(ms, lon);
    const diurnal = Math.cos((2 * Math.PI * (solarHour - 14.5)) / 24);
    const humidity = clamp(
      34 + 62 * moisture - 17 * diurnal * (1 - 0.5 * moisture) + 14 * Math.min(1, rate) - 4 * (1 - cloud),
      10,
      100,
    );

    let visibilityKm = 24 * (1 - 0.75 * Math.min(1, rate / 10)) * (1 - 0.35 * Math.max(0, humidity - 85) / 15);
    if (humidity > 96 && wind.speed < 9 && rate < 0.3) {
      visibilityKm = Math.min(visibilityKm, 0.4 + (wind.speed / 9) * 0.8);
    }

    return {
      pressureHpa,
      moisture,
      precip,
      rate,
      cloud,
      temperatureC,
      humidity,
      u: wind.u,
      v: wind.v,
      windSpeedKmh: wind.speed,
      windGustKmh: wind.gust,
      visibilityKm: clamp(visibilityKm, 0.1, 30),
      sunElevationDeg: sunElevation(ms, lat, lon),
    };
  }

  /* ------------------------------------------------------------ */
  /* Air quality                                                   */
  /* ------------------------------------------------------------ */

  airQuality(lat: number, lon: number, ms: number, state: FieldState): AirQuality {
    const th = ms / HOUR_MS;
    const regional = 0.5 + 0.5 * this.advected(lat, lon, th, 800, 90, 83, 3);
    let pm25 = 7 + 26 * regional;

    // Dry-season biomass burning over mainland South-East Asia (peaks mid-March).
    const inMainlandSea = smoothstep(12, 15, lat) * (1 - smoothstep(22, 24, lat)) *
      smoothstep(94, 96, lon) * (1 - smoothstep(105, 107, lon));
    const burning = Math.exp(-(((dayOfYear(ms) - 75) / 30) ** 2));
    pm25 += 75 * inMainlandSea * burning;

    const solarHour = localSolarHour(ms, lon);
    const inversion = 1 + 0.28 * Math.cos((2 * Math.PI * (solarHour - 7)) / 24);
    const ventilation = 1 / (1 + state.windSpeedKmh / 22);
    const washout = Math.exp(-0.45 * state.rate);
    pm25 = Math.max(1, pm25 * inversion * ventilation * washout * 1.35);

    const pm10 = pm25 * 1.65 + 4;
    const sun = Math.max(0, Math.sin(Math.max(0, state.sunElevationDeg) * RAD));
    const o3 = clamp(18 + 42 * sun * (1 - 0.6 * state.cloud) + 8 * regional, 5, 140);

    const subIndices: Record<Pollutant, number> = {
      pm25: aqiFromBreakpoints(pm25, PM25_BREAKPOINTS),
      pm10: aqiFromBreakpoints(pm10, PM10_BREAKPOINTS),
      o3: aqiFromBreakpoints(o3, O3_BREAKPOINTS),
    };
    const dominantPollutant = (Object.keys(subIndices) as Pollutant[]).reduce((a, b) =>
      subIndices[b] > subIndices[a] ? b : a,
    );
    const aqi = subIndices[dominantPollutant];
    return {
      aqi,
      category: aqiCategory(aqi),
      dominantPollutant,
      pm25: round1(pm25),
      pm10: round1(pm10),
      o3: Math.round(o3),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Derived quantities                                                  */
/* ------------------------------------------------------------------ */

/**
 * Beyond a few days the ensemble mean smears out individual storms, so the
 * deterministic amount is damped while the probability (not this) captures
 * the chance of rain.
 */
export function ensembleDamping(leadHours: number): number {
  return 1 - 0.55 * smoothstep(72, 300, leadHours);
}

/** Spread of the simulated ensemble in "signal" units, growing with lead time. */
export function ensembleSpread(leadHours: number): number {
  return 0.035 + 0.2 * (1 - Math.exp(-Math.max(0, leadHours) / 70));
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function precipitationProbability(precip: PrecipComponents, leadHours: number): number {
  const sigma = ensembleSpread(leadHours);
  const threshold = 0.012; // signal needed for ≈ 0.1 mm/h
  const pConv = normalCdf((precip.convectiveSignal - threshold) / sigma);
  const pStrat = normalCdf((precip.stratiformSignal - threshold) / (sigma * 1.4));
  const raw = 1 - (1 - pConv) * (1 - pStrat);
  // Far-out forecasts regress toward climatology: never certain either way.
  const w = climatologyWeight(leadHours);
  return Math.round(100 * (raw * (1 - 0.5 * w) + 0.12 * w));
}

/** 0 for the next day or so, rising to 1 by the end of the 15-day horizon. */
export function climatologyWeight(leadHours: number): number {
  return smoothstep(24, 336, leadHours);
}

export function dewPoint(temperatureC: number, humidity: number): number {
  const a = 17.27;
  const b = 237.7;
  const gamma = (a * temperatureC) / (b + temperatureC) + Math.log(Math.max(1, humidity) / 100);
  return (b * gamma) / (a - gamma);
}

/**
 * Feels-like: NWS heat index when hot and humid, wind chill when cold and
 * windy, Steadman apparent temperature in between.
 */
export function feelsLike(temperatureC: number, humidity: number, windKmh: number): number {
  if (temperatureC >= 27 && humidity >= 40) {
    const T = temperatureC * 1.8 + 32;
    const R = humidity;
    const hiF =
      -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T -
      0.05481717 * R * R + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    return (hiF - 32) / 1.8;
  }
  if (temperatureC <= 10 && windKmh > 4.8) {
    const v = windKmh ** 0.16;
    return 13.12 + 0.6215 * temperatureC - 11.37 * v + 0.3965 * temperatureC * v;
  }
  const e = (humidity / 100) * 6.105 * Math.exp((17.27 * temperatureC) / (237.7 + temperatureC));
  return temperatureC + 0.33 * e - 0.7 * (windKmh / 3.6) - 4;
}

export function uvIndex(sunElevationDeg: number, cloud: number): number {
  if (sunElevationDeg <= 0) return 0;
  const s = Math.sin(sunElevationDeg * RAD);
  return Math.max(0, 12.5 * s ** 2.4 * (1 - 0.72 * cloud));
}

export function classifyCondition(state: FieldState): WeatherCondition {
  const { rate, precip, temperatureC, cloud, visibilityKm } = state;
  if (rate >= 0.1 && temperatureC <= 1) return "snow";
  if (rate >= 6 && precip.convective / Math.max(rate, 1e-6) > 0.6) return "thunderstorm";
  if (rate >= 4) return "heavy-rain";
  if (rate >= 1) return "rain";
  if (rate >= 0.1) return "drizzle";
  if (visibilityKm < 1) return "fog";
  if (cloud >= 0.78) return "cloudy";
  if (cloud >= 0.32) return "partly-cloudy";
  return "clear";
}

/* ------------------------------------------------------------------ */
/* US EPA AQI                                                          */
/* ------------------------------------------------------------------ */

type Breakpoints = [cLo: number, cHi: number, iLo: number, iHi: number][];

// PM2.5 per the 2024 EPA revision (µg/m³, 24 h).
const PM25_BREAKPOINTS: Breakpoints = [
  [0, 9, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 500, 301, 500],
];
const PM10_BREAKPOINTS: Breakpoints = [
  [0, 54, 0, 50],
  [55, 154, 51, 100],
  [155, 254, 101, 150],
  [255, 354, 151, 200],
  [355, 424, 201, 300],
  [425, 604, 301, 500],
];
// O3 8 h, ppb.
const O3_BREAKPOINTS: Breakpoints = [
  [0, 54, 0, 50],
  [55, 70, 51, 100],
  [71, 85, 101, 150],
  [86, 105, 151, 200],
  [106, 200, 201, 300],
  [201, 600, 301, 500],
];

function aqiFromBreakpoints(c: number, table: Breakpoints): number {
  for (let i = 0; i < table.length; i++) {
    const [cLo, cHi, iLo, iHi] = table[i];
    const nextLo = table[i + 1]?.[0] ?? Infinity;
    if (c <= cHi || c < nextLo) {
      const clamped = clamp(c, cLo, cHi);
      return Math.round(((iHi - iLo) / (cHi - cLo)) * (clamped - cLo) + iLo);
    }
  }
  return 500;
}

export function aqiCategory(aqi: number): AqiCategory {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

const round1 = (v: number) => Math.round(v * 10) / 10;
