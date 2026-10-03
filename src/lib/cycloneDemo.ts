/**
 * A made-up storm for previewing the cyclone map and alert with
 * `?cyclones=demo`, whatever the tropics are doing: a typhoon coming in from
 * the east-south-east that passes 160 km north of the place 30 hours from
 * now, with a 51-member ensemble that spreads out as it goes.
 */

import { buildCone, type Cyclone, type CycloneFeed, type GeoPoint, type MemberPath, type TimedPoint } from "./cyclones";

const HOUR_MS = 3_600_000;
const EARTH_KM = 6371;
const STEP_HOURS = 6;
const LAST_HOUR = 144;
const MEMBERS = 51;
/** km/h, a typical speed for a typhoon steered west. */
const SPEED_KMH = 18;
const HEADING = 290;
const CLOSEST_KM = 160;
const CLOSEST_IN_HOURS = 30;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** The point `km` from `from` on `bearing` (degrees). */
function move(from: GeoPoint, bearing: number, km: number): GeoPoint {
  const d = km / EARTH_KM;
  const lat1 = rad(from.lat);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(rad(bearing)));
  const lon2 =
    rad(from.lon) +
    Math.atan2(Math.sin(rad(bearing)) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: deg(lon2) };
}

/** Repeatable "random" numbers, roughly normal, from a seed. */
function normals(seed: number, count: number): number[] {
  let s = seed >>> 0 || 1;
  const uniform = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 0.5) / 2 ** 32;
  };
  return Array.from({ length: count }, () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform()));
}

/** Wind near the centre: strengthening at sea, peaking just before it passes, then weakening over land. */
function windAt(hoursToClosest: number): number {
  if (hoursToClosest > 6) return Math.min(165, 75 + (60 - Math.min(60, hoursToClosest)) * 1.6);
  if (hoursToClosest >= 0) return 165;
  return Math.max(35, 165 * Math.exp(hoursToClosest / 20));
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function demoCyclones(place: GeoPoint, now: number): CycloneFeed {
  // As if from the run of 6 to 12 hours ago, like the real tracks.
  const run = Math.floor(now / (6 * HOUR_MS)) * 6 * HOUR_MS - 6 * HOUR_MS;
  const closestAt = now + CLOSEST_IN_HOURS * HOUR_MS;
  const closest = move(place, HEADING - 270, CLOSEST_KM);
  const along = (t: number) => {
    const km = (SPEED_KMH * (t - closestAt)) / HOUR_MS;
    return km >= 0 ? move(closest, HEADING, km) : move(closest, HEADING + 180, -km);
  };

  const hours = Array.from({ length: LAST_HOUR / STEP_HOURS + 1 }, (_, i) => i * STEP_HOURS);
  const track = hours.map((h) => {
    const t = run + h * HOUR_MS;
    const p = along(t);
    const wind = Math.round(windAt((closestAt - t) / HOUR_MS));
    return {
      time: new Date(t).toISOString(),
      lat: round2(p.lat),
      lon: round2(p.lon),
      pressure_hpa: Math.round(1010 - 0.55 * Math.max(0, wind - 40)),
      wind_kmh: wind,
    };
  });

  const cross = normals(7, MEMBERS);
  const ahead = normals(11, MEMBERS);
  const members: MemberPath[] = [];
  const timed: TimedPoint[][] = [];
  for (let m = 0; m < MEMBERS; m++) {
    const path: MemberPath = [];
    const points: TimedPoint[] = [];
    // The weaker members lose the storm over land a day or two after it passes.
    const lastHour = m % 5 === 0 ? CLOSEST_IN_HOURS + 30 + m : LAST_HOUR;
    for (const h of hours) {
      const t = run + h * HOUR_MS;
      if ((t - now) / HOUR_MS > lastHour) break;
      // Members drift apart across the track and run a little ahead or behind, more the further out.
      const spread = 8 + 2.2 * h;
      const p = move(along(t + ahead[m] * spread * 0.04 * HOUR_MS), HEADING + 90, cross[m] * spread);
      path.push(h, round2(p.lat), round2(p.lon));
      points.push({ t, lat: p.lat, lon: p.lon });
    }
    members.push(path);
    timed.push(points);
  }

  const storm: Cyclone = {
    id: "99",
    name: "DEMO",
    basin: "typhoon",
    track,
    track_from: "hres",
    cone: buildCone(timed),
    members,
  };
  return { run: new Date(run).toISOString(), storms: [storm], demo: true };
}
