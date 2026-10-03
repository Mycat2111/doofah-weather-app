/**
 * Open-Meteo's air quality (from Copernicus CAMS) in DooFah's shape. Air is
 * not weather, so it stays outside the WRF and ECMWF forecast and the page
 * asks for it on its own.
 */

import { aqiCategory } from "../weather/physics";
import { HOUR_MS } from "../weather/time";
import type { AirQuality, Pollutant } from "../weather/types";
import type { AirQualityResponse } from "./api";

/** Air quality is shown while this recent. */
const AIR_MAX_AGE_MS = 3 * HOUR_MS;
/** Ozone from µg/m³ to ppb at 25 °C (24.45 / 48.00). */
const OZONE_PPB_PER_UG = 0.509;

const round1 = (v: number) => Math.round(v * 10) / 10;
const present = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

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
