/** Solar geometry (NOAA simplified equations), accurate to about a minute. */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;

function julianDay(ms: number): number {
  return ms / DAY_MS + 2440587.5;
}

interface SolarTerms {
  declination: number; // radians
  equationOfTimeMin: number;
}

function solarTerms(ms: number): SolarTerms {
  const jc = (julianDay(ms) - 2451545) / 36525;
  const meanLong = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const meanAnom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const center =
    Math.sin(meanAnom * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * meanAnom * RAD) * 0.000289;
  const trueLong = meanLong + center;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const obliq =
    23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60 +
    0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD));
  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eot =
    4 /
    RAD *
    (y * Math.sin(2 * meanLong * RAD) -
      2 * ecc * Math.sin(meanAnom * RAD) +
      4 * ecc * y * Math.sin(meanAnom * RAD) * Math.cos(2 * meanLong * RAD) -
      0.5 * y * y * Math.sin(4 * meanLong * RAD) -
      1.25 * ecc * ecc * Math.sin(2 * meanAnom * RAD));
  return { declination, equationOfTimeMin: eot };
}

/** Sun elevation above the horizon, degrees. */
export function sunElevation(ms: number, lat: number, lon: number): number {
  const { declination, equationOfTimeMin } = solarTerms(ms);
  const minutesUtc = ((ms % DAY_MS) + DAY_MS) % DAY_MS / 60_000;
  const trueSolarTime = (((minutesUtc + equationOfTimeMin + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = (trueSolarTime / 4 - 180) * RAD;
  const cosZenith =
    Math.sin(lat * RAD) * Math.sin(declination) +
    Math.cos(lat * RAD) * Math.cos(declination) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / RAD;
}

/** Local solar hour 0–24 (noon ≈ 12), used for diurnal cycles. */
export function localSolarHour(ms: number, lon: number): number {
  const hours = ((ms % DAY_MS) + DAY_MS) % DAY_MS / 3_600_000 + lon / 15;
  return ((hours % 24) + 24) % 24;
}

/**
 * Sunrise and sunset around the UTC day that contains `dayStartMs`'s solar noon.
 * Returns nulls during polar day or night.
 */
export function sunTimes(
  dayStartMs: number,
  lat: number,
  lon: number,
): { sunrise: number | null; sunset: number | null } {
  // Solar noon estimate for the local day that starts at dayStartMs.
  const approxNoon = dayStartMs + 12 * 3_600_000;
  const { declination, equationOfTimeMin } = solarTerms(approxNoon);
  const utcMidnight = Math.floor(approxNoon / DAY_MS) * DAY_MS;
  let noonMs = utcMidnight + (720 - 4 * lon - equationOfTimeMin) * 60_000;
  // Keep noon inside the requested local day.
  if (noonMs < dayStartMs) noonMs += DAY_MS;
  if (noonMs >= dayStartMs + DAY_MS) noonMs -= DAY_MS;

  const cosH =
    (Math.cos(90.833 * RAD) - Math.sin(lat * RAD) * Math.sin(declination)) /
    (Math.cos(lat * RAD) * Math.cos(declination));
  if (cosH > 1 || cosH < -1) return { sunrise: null, sunset: null };
  const halfDayMs = (Math.acos(cosH) / RAD) * 4 * 60_000;
  return { sunrise: noonMs - halfDayMs, sunset: noonMs + halfDayMs };
}

/** Day of year 0–365 in UTC. */
export function dayOfYear(ms: number): number {
  const d = new Date(ms);
  return (ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS;
}
