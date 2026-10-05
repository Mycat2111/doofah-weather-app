/**
 * Tropical cyclones from ECMWF's ensemble tracks (step 6): what /api/cyclones
 * sends, how strong a storm is, where it is at a time, how close it comes to
 * a place, the cone the forecasts fall in, and the storm alert.
 *
 * Shared by the server (which builds the storms from ECMWF's file), the map
 * and the alert banner, so all three agree.
 */

const HOUR_MS = 3_600_000;
const EARTH_KM = 6371;

/** A storm alert when its path comes this close to a place, km. */
export const ALERT_KM = 500;
/** A storm that close within this many hours is an urgent ("severe") alert; later ones a heads-up. */
export const SOON_HOURS = 48;
/** How far ahead tracks are drawn and checked, hours. */
export const AHEAD_HOURS = 120;
/** A storm whose path or cone comes this close to the place is "in the region", km. */
export const REGION_KM = 2000;
/** The cone holds this share of the ensemble's storm centres at each time. */
export const CONE_SHARE = 2 / 3;
/** The cone stops when fewer members than this share still have the storm. */
const CONE_MIN_SHARE = 1 / 3;
const CONE_MIN_MEMBERS = 5;
const CONE_MIN_RADIUS_KM = 30;

/**
 * Wind thresholds of the WMO scale used across Asia: a tropical storm from
 * 34 knots, a typhoon (hurricane, cyclone) from 64 knots. ECMWF gives the
 * model's strongest 10 m wind near the centre.
 */
export const STORM_KMH = 34 * 1.852;
export const TYPHOON_KMH = 64 * 1.852;

/** What a full-strength storm is called where it is. */
export type Basin = "typhoon" | "hurricane" | "cyclone";
export type CycloneCategory = "depression" | "storm" | Basin;

export interface TrackPoint {
  /** ISO time. */
  time: string;
  lat: number;
  /** Continuous along the track (may pass 180 to cross the date line). */
  lon: number;
  pressure_hpa: number | null;
  /** The strongest 10 m wind near the centre. */
  wind_kmh: number | null;
}

export interface ConePoint {
  time: string;
  /** The middle of the ensemble's storm centres. */
  lat: number;
  lon: number;
  /** Holds CONE_SHARE of them. */
  radius_km: number;
}

/** One ensemble member's storm centres: hours after the run, latitude, longitude, three numbers a point. */
export type MemberPath = number[];

export interface Cyclone {
  /** The warning centre's number, e.g. "27W". */
  id: string;
  /** e.g. "IN-FA"; null while the storm has no name. */
  name: string | null;
  basin: Basin;
  /** The most likely path: ECMWF's high-resolution forecast, else its control, else the ensemble's middle. */
  track: TrackPoint[];
  track_from: "hres" | "control" | "mean";
  cone: ConePoint[];
  /** Every member's path, for the chance of passing near a place. */
  members: MemberPath[];
}

export interface CycloneFeed {
  /** The ECMWF run the tracks are from (ISO); null when none could be found. */
  run: string | null;
  storms: Cyclone[];
  /** A made-up storm for previewing (`?cyclones=demo`). */
  demo?: boolean;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export interface GeoPoint {
  lat: number;
  lon: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whole turns (in degrees) between `lon` and `near`: take it off to draw a storm on the same side of the date line. */
export const lonShift = (lon: number, near: number) => 360 * Math.round((lon - near) / 360);

/** `lon` moved by whole turns to within 180° of `near`, so a track stays continuous over the date line. */
export const unwrap = (lon: number, near: number) => lon - lonShift(lon, near);

/** A point in time along a path. */
export interface TimedPoint extends GeoPoint {
  /** ms */
  t: number;
}

/** Where a path is at `time`, between its points; null before it starts or after it ends. */
export function pathAt(path: readonly TimedPoint[], time: number): (GeoPoint & { i: number; f: number }) | null {
  if (!path.length || time < path[0].t || time > path[path.length - 1].t) return null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (time <= b.t) {
      const f = b.t === a.t ? 0 : (time - a.t) / (b.t - a.t);
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, i, f };
    }
  }
  const last = path[path.length - 1];
  return { lat: last.lat, lon: last.lon, i: path.length - 1, f: 0 };
}

/** Checked every this many minutes between a path's points. */
const SAMPLE_MIN = 20;

/**
 * Where a path comes closest to `place` between `from` and `to` (ms): the
 * distance and when. Null when the path has nothing in that window.
 */
export function closestApproach(
  path: readonly TimedPoint[],
  place: GeoPoint,
  from: number,
  to: number,
): { km: number; time: number } | null {
  if (path.length === 0) return null;
  const start = Math.max(from, path[0].t);
  const end = Math.min(to, path[path.length - 1].t);
  if (start > end) return null;
  let best: { km: number; time: number } | null = null;
  const step = SAMPLE_MIN * 60_000;
  // Samples on a fixed clock grid (:00, :20, :40), so the banner and the map agree on the time whatever "now" each has.
  for (let t = start; ; t = Math.min(end, (Math.floor(t / step) + 1) * step)) {
    const p = pathAt(path, t);
    if (p) {
      const km = distanceKm(p, place);
      if (!best || km < best.km) best = { km, time: t };
    }
    if (t >= end) break;
  }
  return best;
}

export const trackPath = (track: readonly TrackPoint[]): TimedPoint[] =>
  track.map((p) => ({ t: Date.parse(p.time), lat: p.lat, lon: p.lon }));

export function memberPath(member: MemberPath, run: number): TimedPoint[] {
  const out: TimedPoint[] = [];
  for (let i = 0; i + 2 < member.length; i += 3) {
    out.push({ t: run + member[i] * HOUR_MS, lat: member[i + 1], lon: member[i + 2] });
  }
  return out;
}

/** The storm's track point at `time`, between its 6-hourly points. */
export function stormAt(storm: Cyclone, time: number): TrackPoint | null {
  const path = trackPath(storm.track);
  const at = pathAt(path, time);
  if (!at) return null;
  const a = storm.track[at.i];
  const b = storm.track[Math.min(at.i + 1, storm.track.length - 1)];
  const mix = (x: number | null, y: number | null) => (x === null || y === null ? (x ?? y) : x + (y - x) * at.f);
  return {
    time: new Date(time).toISOString(),
    lat: at.lat,
    lon: at.lon,
    pressure_hpa: mix(a.pressure_hpa, b.pressure_hpa),
    wind_kmh: mix(a.wind_kmh, b.wind_kmh),
  };
}

/* ------------------------------------------------------------------ */
/* Strength                                                            */
/* ------------------------------------------------------------------ */

/**
 * The name a strong storm gets, from the warning centre's letter: W(est
 * Pacific) typhoons; E(ast), C(entral Pacific) and L (Atlantic) hurricanes;
 * cyclones elsewhere (the Bay of Bengal, the Arabian Sea, the south). Without
 * a letter, from where it is.
 */
export function basinOf(id: string, at: GeoPoint): Basin {
  const letter = id.trim().slice(-1).toUpperCase();
  if (letter === "W") return "typhoon";
  if (letter === "E" || letter === "C" || letter === "L") return "hurricane";
  if (/^[ABSPU]$/.test(letter)) return "cyclone";
  const lon = unwrap(at.lon, 0);
  if (at.lat > 0 && lon >= 100) return "typhoon";
  if (at.lat > 0 && (lon <= -20 || lon >= 180)) return "hurricane";
  return "cyclone";
}

export function categoryOf(windKmh: number | null, basin: Basin): CycloneCategory {
  if (windKmh === null || windKmh < STORM_KMH) return "depression";
  return windKmh < TYPHOON_KMH ? "storm" : basin;
}

/* ------------------------------------------------------------------ */
/* The ensemble                                                        */
/* ------------------------------------------------------------------ */

/**
 * The cone: at each 6-hourly time, the middle of the members' storm centres
 * and the radius that holds two in three of them. It stops where too few
 * members still have a storm to say.
 */
export function buildCone(members: readonly TimedPoint[][]): ConePoint[] {
  const valid = members.filter((m) => m.length > 0);
  if (!valid.length) return [];
  const times = [...new Set(valid.flatMap((m) => m.map((p) => p.t)))].sort((a, b) => a - b);
  const needed = Math.max(CONE_MIN_MEMBERS, Math.ceil(valid.length * CONE_MIN_SHARE));
  const cone: ConePoint[] = [];
  let lastLon: number | null = null;
  for (const t of times) {
    const here = valid.map((m) => m.find((p) => p.t === t)).filter((p): p is TimedPoint => !!p);
    if (here.length < needed) {
      if (cone.length) break;
      continue;
    }
    const ref: number = lastLon ?? here[0].lon;
    // Measured from the rounded centre and rounded up, so the cone as sent still holds its share.
    const lat = round2(here.reduce((s, p) => s + p.lat, 0) / here.length);
    const lon: number = round2(here.reduce((s, p) => s + unwrap(p.lon, ref), 0) / here.length);
    const centre = { lat, lon };
    const km = here.map((p) => distanceKm(centre, p)).sort((a, b) => a - b);
    const radius = km[Math.max(0, Math.ceil(km.length * CONE_SHARE) - 1)];
    cone.push({
      time: new Date(t).toISOString(),
      lat,
      lon,
      radius_km: Math.ceil(Math.max(CONE_MIN_RADIUS_KM, radius)),
    });
    lastLon = lon;
  }
  return cone;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The share (0–1) of members whose storm comes within `km` of `place` between `from` and `to`; null without members. */
export function nearShare(storm: Cyclone, run: number, place: GeoPoint, from: number, to: number, km = ALERT_KM) {
  const paths = storm.members.map((m) => memberPath(m, run)).filter((p) => p.length > 0);
  if (!paths.length) return null;
  const near = paths.filter((p) => {
    const c = closestApproach(p, place, from, to);
    return c !== null && c.km <= km;
  });
  return near.length / paths.length;
}

/** Does the storm's path or its cone come within REGION_KM of `place` in the hours ahead? */
export function inRegion(storm: Cyclone, place: GeoPoint, now: number): boolean {
  const to = now + AHEAD_HOURS * HOUR_MS;
  const path = closestApproach(trackPath(storm.track), place, now - 6 * HOUR_MS, to);
  if (path && path.km <= REGION_KM) return true;
  return storm.cone.some((c) => {
    const t = Date.parse(c.time);
    return t <= to && distanceKm(c, place) - c.radius_km <= REGION_KM;
  });
}

/** The part of a storm's track from shortly before `now` to AHEAD_HOURS on: what the map draws. */
export function trackAhead(track: readonly TrackPoint[], now: number): TrackPoint[] {
  const to = now + AHEAD_HOURS * HOUR_MS;
  const from = now - 12 * HOUR_MS;
  return track.filter((p, i) => {
    const t = Date.parse(p.time);
    const next = track[i + 1] ? Date.parse(track[i + 1].time) : t;
    const prev = i > 0 ? Date.parse(track[i - 1].time) : t;
    // Keep the points either side of the window's edges so the line reaches them.
    return (t >= from || next >= from) && (t <= to || prev <= to);
  });
}

/* ------------------------------------------------------------------ */
/* The alert                                                           */
/* ------------------------------------------------------------------ */

export interface CyclonePlace {
  id: string;
  /** As the reader sees it ("Bangkok", "Home"). */
  name: string;
  point: GeoPoint;
}

export interface CycloneAlert {
  kind: "cyclone";
  /** Severe: within ALERT_KM in the next SOON_HOURS. Warning: later, up to AHEAD_HOURS. */
  level: "severe" | "warning";
  stormId: string;
  name: string | null;
  /** How strong it is now. */
  category: CycloneCategory;
  /** The place it comes closest to: the dashboard's place, else the nearest favorite. */
  place: string;
  /** That place's id (in a storm notification, the hashed ref its link opens). */
  placeId: string;
  km: number;
  /** When it is closest (ISO); null when it is that close already. */
  at: string | null;
  /** The strongest wind near its centre then, km/h. */
  windKmh: number | null;
  /** Percent of ECMWF's ensemble that brings it within ALERT_KM in the same hours. */
  chance: number | null;
  /** Other favorites it comes within ALERT_KM of. */
  also: string[];
}

interface Approach {
  place: CyclonePlace;
  km: number;
  time: number;
}

/**
 * Storm alerts for the dashboard's place and the favorites: one per storm
 * whose most likely path comes within ALERT_KM of any of them in the next
 * AHEAD_HOURS, about the dashboard's place when it is one of them, else the
 * favorite it comes closest to. Urgent ones (within SOON_HOURS) first.
 */
export function cycloneAlerts(feed: CycloneFeed, place: CyclonePlace, favorites: CyclonePlace[], now: number) {
  const alerts: CycloneAlert[] = [];
  const run = feed.run ? Date.parse(feed.run) : now;
  const to = now + AHEAD_HOURS * HOUR_MS;
  const others = favorites.filter((f) => f.id !== place.id && distanceKm(f.point, place.point) > 1);
  for (const storm of feed.storms) {
    const path = trackPath(storm.track);
    const near = [place, ...others]
      .map((p): Approach | null => {
        const c = closestApproach(path, p.point, now, to);
        return c && c.km <= ALERT_KM ? { place: p, km: c.km, time: c.time } : null;
      })
      .filter((a): a is Approach => a !== null);
    if (!near.length) continue;
    const main = near[0].place.id === place.id ? near[0] : near.reduce((a, b) => (b.km < a.km ? b : a));
    // Severe once the path is within ALERT_KM inside SOON_HOURS, even when it comes closest later.
    const early = closestApproach(path, main.place.point, now, now + SOON_HOURS * HOUR_MS);
    const soon = early !== null && early.km <= ALERT_KM;
    const share = nearShare(storm, run, main.place.point, now, soon ? now + SOON_HOURS * HOUR_MS : to);
    const nowPoint = stormAt(storm, now) ?? storm.track[0];
    const then = stormAt(storm, main.time);
    alerts.push({
      kind: "cyclone",
      level: soon ? "severe" : "warning",
      stormId: storm.id,
      name: storm.name,
      category: categoryOf(nowPoint?.wind_kmh ?? null, storm.basin),
      place: main.place.name,
      placeId: main.place.id,
      km: Math.round(main.km / 10) * 10,
      at: main.time <= now + 30 * 60_000 ? null : new Date(main.time).toISOString(),
      windKmh: then?.wind_kmh == null ? null : Math.round(then.wind_kmh),
      chance: share === null ? null : Math.round(share * 100),
      also: near.filter((a) => a !== main).map((a) => a.place.name),
    });
  }
  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "severe" ? -1 : 1));
}

/* ------------------------------------------------------------------ */
/* Drawing the cone                                                    */
/* ------------------------------------------------------------------ */

const KM_PER_DEG_LAT = 110.574;
const kmPerDegLon = (lat: number) => 111.32 * Math.cos(rad(lat));
const CIRCLE_STEPS = 36;

/** Twice the signed area of a ring (positive anticlockwise, with longitude as x). */
const area2 = (ring: [number, number][]) =>
  ring.reduce((s, [lat, lon], i) => {
    const [lat2, lon2] = ring[(i + 1) % ring.length];
    return s + lon * lat2 - lon2 * lat;
  }, 0);

const anticlockwise = (ring: [number, number][]) => (area2(ring) < 0 ? ring.reverse() : ring);

/**
 * The cone as rings of [lat, lon] that together cover it: a circle at each
 * time and the band joining each circle to the next. All turn the same way,
 * so drawn as one shape with the "nonzero" fill rule they fill as one area,
 * without darker overlaps, even where the track loops.
 */
export function coneRings(cone: readonly ConePoint[]): [number, number][][] {
  const rings: [number, number][][] = [];
  cone.forEach((c, i) => {
    const kx = kmPerDegLon(c.lat);
    const circle: [number, number][] = [];
    for (let s = 0; s < CIRCLE_STEPS; s++) {
      const a = (2 * Math.PI * s) / CIRCLE_STEPS;
      circle.push([c.lat + (c.radius_km / KM_PER_DEG_LAT) * Math.sin(a), c.lon + (c.radius_km / kx) * Math.cos(a)]);
    }
    rings.push(circle);

    const next = cone[i + 1];
    if (!next) return;
    // The band between two circles: their outer tangents, worked out in km around the first.
    const mx = kmPerDegLon((c.lat + next.lat) / 2);
    const dx = (next.lon - c.lon) * mx;
    const dy = (next.lat - c.lat) * KM_PER_DEG_LAT;
    const d = Math.hypot(dx, dy);
    if (d <= Math.abs(c.radius_km - next.radius_km)) return;
    const heading = Math.atan2(dy, dx);
    const spread = Math.acos((c.radius_km - next.radius_km) / d);
    const at = (p: ConePoint, r: number, angle: number): [number, number] => [
      p.lat + (r * Math.sin(angle)) / KM_PER_DEG_LAT,
      p.lon + (r * Math.cos(angle)) / mx,
    ];
    rings.push(
      anticlockwise([
        at(c, c.radius_km, heading - spread),
        at(next, next.radius_km, heading - spread),
        at(next, next.radius_km, heading + spread),
        at(c, c.radius_km, heading + spread),
      ]),
    );
  });
  return rings;
}
