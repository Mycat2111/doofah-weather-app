import type { GeoPoint } from "../weathernext3/types";

/** One point of a route's line, with how far and how long it is from the start. */
export interface RoutePoint extends GeoPoint {
  /** Road distance from the start, km. */
  km: number;
  /** Driving time from the start, minutes (ferry crossings included). */
  min: number;
}

/**
 * Where a route came from: OSRM, the Open Source Routing Machine, over
 * OpenStreetMap's roads (see osrm.ts). Google's Routes API is not an option,
 * because its terms forbid showing its routes on a non-Google map and
 * DooFah's map is OpenStreetMap.
 */
export type RouteSource = "osrm";

export interface RouteRequest {
  origin: GeoPoint;
  destination: GeoPoint;
  /** ISO time you set off. */
  departure: string;
}

/** A stretch of the trip on a car ferry. */
export interface FerryCrossing {
  /** The ferry line's name in OpenStreetMap, if it has one. */
  name: string;
  /** Where it starts and ends in the route's path (indices). */
  from: number;
  to: number;
  /** Time on board, minutes (not the wait for the boat). */
  minutes: number;
}

/** A driving route: its line, with the time and distance to every point on it. */
export interface Route {
  source: RouteSource;
  /** ISO times. */
  departure: string;
  arrival: string;
  distanceKm: number;
  durationMin: number;
  /**
   * Along the roads from where the router joined them near the origin to
   * where it left them near the destination; the first point has km = 0 and
   * min = 0.
   */
  path: RoutePoint[];
  ferries: FerryCrossing[];
}

/** Why no route came back. */
export type RouteErrorCode =
  /** No road or car ferry connects the two places (across an ocean, or too far from any road). */
  | "noRoute"
  /** Origin and destination are the same place. */
  | "samePlace"
  /** Too far apart to plan a drive (see MAX_TRIP_KM). */
  | "tooFar"
  /** No connection to the routing service. */
  | "offline"
  /** Something else went wrong planning the trip. */
  | "failed";

export class RouteError extends Error {
  constructor(
    readonly code: RouteErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "RouteError";
  }
}
