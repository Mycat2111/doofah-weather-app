/**
 * Road routes from OSRM, the Open Source Routing Machine
 * (https://project-osrm.org), over OpenStreetMap's roads.
 *
 * By default DooFah asks the public car router that FOSSGIS runs at
 * routing.openstreetmap.de, straight from the browser (which sends the
 * User-Agent and Referer its terms ask for). Its terms
 * (https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/)
 * allow reasonable, non-commercial use: at most one request a second,
 * OpenStreetMap's credit with a "fix the map" link next to the route, and
 * an email address for the site's operator that is easy to find. The server
 * can be swapped with the OSRM_URL environment variable (their terms ask
 * that the address is not hard-coded), for example for a self-hosted OSRM.
 */

import { distanceKm } from "../weather/places";
import type { GeoPoint } from "../weather/types";
import { decodePolyline } from "./polyline";
import { RouteError, type FerryCrossing, type Route, type RoutePoint, type RouteRequest } from "./types";

/** FOSSGIS's car router. */
export const FOSSGIS_OSRM_URL = "https://routing.openstreetmap.de/routed-car";
/** Farther apart than this, in a straight line, is not a drive DooFah plans. */
export const MAX_TRIP_KM = 2500;
/** Closer than this is the same place. */
export const SAME_PLACE_KM = 0.5;
/** A start or end farther than this from any road the router can reach has no road route, metres. */
export const MAX_SNAP_M = 5000;
/** At most this many points are drawn; straight stretches keep fewer. */
export const MAX_PATH_POINTS = 1500;

/** The part of OSRM's /route reply that DooFah reads (http://project-osrm.org/docs/v5.24.0/api/#route-service). */
export interface OsrmResponse {
  code: string;
  message?: string;
  routes?: {
    distance: number;
    duration: number;
    /** polyline6 of the whole route. */
    geometry: string;
    legs: {
      distance: number;
      duration: number;
      /** Per stretch between two points of the geometry: metres and seconds (without turns). */
      annotation?: { distance?: number[]; duration?: number[] };
      steps?: { mode: string; name?: string; distance: number; duration: number }[];
    }[];
  }[];
  /** Where each point asked for joined the roads, and how far away that was (metres). */
  waypoints?: { location: [number, number]; distance: number; name?: string }[];
}

/** Coordinates to about 10 m, so the same trip always asks the same URL. */
const coordinate = (value: number) => value.toFixed(5);

/** The /route request for a drive between two points. */
export function osrmRouteUrl(base: string, origin: GeoPoint, destination: GeoPoint): string {
  const points = [origin, destination].map((p) => `${coordinate(p.lon)},${coordinate(p.lat)}`).join(";");
  const params = new URLSearchParams({
    overview: "full",
    geometries: "polyline6",
    annotations: "duration,distance",
    steps: "true",
    // FOSSGIS turns hints off, and asks for none.
    generate_hints: "false",
  });
  return `${base.replace(/\/+$/, "")}/route/v1/driving/${points}?${params}`;
}

/** Checks a trip before asking any router: the same place, or too far to drive. */
export function checkTrip({ origin, destination }: Pick<RouteRequest, "origin" | "destination">) {
  const km = distanceKm(origin, destination);
  if (km < SAME_PLACE_KM) throw new RouteError("samePlace");
  if (km > MAX_TRIP_KM) throw new RouteError("tooFar");
}

/** A route without its times of day, which the same trip at another time shares. */
export type RouteShape = Omit<Route, "departure" | "arrival">;

/**
 * Keeps the points that matter for drawing the line (Douglas–Peucker, in
 * degrees scaled for latitude) plus the ones in `keep`, fewer than `max` in
 * all; returns their indices in order.
 */
export function simplify(points: GeoPoint[], keep: Set<number>, max = MAX_PATH_POINTS): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  const cos = Math.cos((points[0].lat * Math.PI) / 180);
  // Squared distance from p to the segment a–b, in (scaled) degrees².
  const offset = (p: GeoPoint, a: GeoPoint, b: GeoPoint) => {
    const [ax, ay, bx, by, px, py] = [a.lon * cos, a.lat, b.lon * cos, b.lat, p.lon * cos, p.lat];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
  };
  const run = (tolerance: number) => {
    const kept = new Uint8Array(n);
    kept[0] = kept[n - 1] = 1;
    for (const i of keep) if (i >= 0 && i < n) kept[i] = 1;
    // Simplify between each pair of points that must stay.
    const anchors = [...kept.keys()].filter((i) => kept[i]);
    const stack: [number, number][] = [];
    for (let k = 1; k < anchors.length; k++) stack.push([anchors[k - 1], anchors[k]]);
    const limit = tolerance * tolerance;
    while (stack.length) {
      const [from, to] = stack.pop()!;
      let worst = -1;
      let worstOffset = limit;
      for (let i = from + 1; i < to; i++) {
        const d = offset(points[i], points[from], points[to]);
        if (d > worstOffset) [worst, worstOffset] = [i, d];
      }
      if (worst !== -1) {
        kept[worst] = 1;
        stack.push([from, worst], [worst, to]);
      }
    }
    return [...kept.keys()].filter((i) => kept[i]);
  };
  // About 5 m to start with, looser until the line is short enough.
  let tolerance = 0.00005;
  let indices = run(tolerance);
  while (indices.length > max && tolerance < 1) {
    tolerance *= 2;
    indices = run(tolerance);
  }
  return indices;
}

/** OSRM's reply as a DooFah route (without its times of day). */
export function routeFromOsrm(raw: OsrmResponse): RouteShape {
  if (raw.code === "NoRoute" || raw.code === "NoSegment") throw new RouteError("noRoute", raw.message);
  if (raw.code !== "Ok") throw new RouteError("failed", raw.message ?? raw.code);
  const route = raw.routes?.[0];
  if (!route?.geometry) throw new RouteError("noRoute");
  // A start or end that only reaches a road far away (an island with no car ferry, a spot at sea).
  if ((raw.waypoints ?? []).some((w) => w.distance > MAX_SNAP_M)) throw new RouteError("noRoute");

  const points = decodePolyline(route.geometry, 6);
  if (points.length < 2) throw new RouteError("noRoute");
  const segments = points.length - 1;
  const leg = route.legs.length === 1 ? route.legs[0] : null;
  const metres = leg?.annotation?.distance;
  const seconds = leg?.annotation?.duration;
  // OSRM gives each stretch's length and time; without them, lengths from the
  // map and time shared out by length.
  const lengths =
    metres?.length === segments
      ? metres
      : Array.from({ length: segments }, (_, i) => distanceKm(points[i], points[i + 1]) * 1000);
  const times = seconds?.length === segments ? seconds : lengths;

  // Running totals, scaled so the end matches the route's own totals (the
  // stretch times leave out time spent turning).
  const totalLength = lengths.reduce((s, v) => s + v, 0) || 1;
  const totalTime = times.reduce((s, v) => s + v, 0) || 1;
  const kmScale = route.distance / 1000 / totalLength;
  const minScale = route.duration / 60 / totalTime;
  const metresAt = [0];
  const path: RoutePoint[] = [{ ...points[0], km: 0, min: 0 }];
  let length = 0;
  let time = 0;
  for (let i = 0; i < segments; i++) {
    length += lengths[i];
    time += times[i];
    metresAt.push(length);
    path.push({ ...points[i + 1], km: length * kmScale, min: time * minScale });
  }

  // Ferry crossings, placed on the line by the distance before them.
  const ferries: FerryCrossing[] = [];
  // Step distances are the route's metres; the running totals are the stretches'.
  const toStretches = totalLength / (route.distance || totalLength);
  let before = 0;
  for (const step of leg?.steps ?? []) {
    if (step.mode === "ferry" && step.distance > 0) {
      const start = before * toStretches;
      const end = (before + step.distance) * toStretches;
      const from = Math.max(
        0,
        metresAt.findLastIndex((m) => m <= start + 1),
      );
      const reached = metresAt.findIndex((m) => m >= end - 1);
      const to = Math.min(segments, Math.max(from + 1, reached === -1 ? segments : reached));
      ferries.push({ name: step.name ?? "", from, to, minutes: step.duration / 60 });
    }
    before += step.distance;
  }

  // Fewer points to draw, keeping where each ferry starts and ends.
  const kept = simplify(path, new Set(ferries.flatMap((f) => [f.from, f.to])));
  const position = new Map(kept.map((index, i) => [index, i]));
  const last = path[path.length - 1];
  return {
    source: "osrm",
    distanceKm: last.km,
    durationMin: last.min,
    path: kept.map((i) => path[i]),
    ferries: ferries.map(
      (f): FerryCrossing => ({ ...f, from: position.get(f.from) ?? 0, to: position.get(f.to) ?? kept.length - 1 }),
    ),
  };
}

/** A route shape for a trip leaving at `departure`. */
export function atDeparture(shape: RouteShape, departure: string): Route {
  const start = Date.parse(departure);
  return {
    ...shape,
    departure: new Date(start).toISOString(),
    arrival: new Date(start + shape.durationMin * 60_000).toISOString(),
  };
}
