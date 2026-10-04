/**
 * Values worked out from others: dew point, feels-like temperature, the UV
 * index from the sun's height and cloud, and the US EPA AQI category.
 */

import type { AqiCategory } from "./types";

const RAD = Math.PI / 180;

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
      -42.379 +
      2.04901523 * T +
      10.14333127 * R -
      0.22475541 * T * R -
      0.00683783 * T * T -
      0.05481717 * R * R +
      0.00122874 * T * T * R +
      0.00085282 * T * R * R -
      0.00000199 * T * T * R * R;
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

export function aqiCategory(aqi: number): AqiCategory {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}
