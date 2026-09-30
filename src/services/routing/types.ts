import type { GeoPoint } from "../weathernext3/types";

/** One point of a route's line, with how far and how long it is from the start. */
export interface RoutePoint extends GeoPoint {
  /** Road distance from the start, km. */
  km: number;
  /** Driving time from the start, minutes (border checks and ferry waits included). */
  min: number;
}

export type RouteSource = "google" | "simulated";

export interface RouteRequest {
  origin: GeoPoint;
  destination: GeoPoint;
  /** ISO time you set off. */
  departure: string;
  /** Language for anything the router names, "th" or "en". */
  language?: string;
}

/** A driving route: its line, with the time and distance to every point on it. */
export interface Route {
  source: RouteSource;
  /** ISO times. */
  departure: string;
  arrival: string;
  distanceKm: number;
  durationMin: number;
  /** From origin to destination; the first point has km = 0 and min = 0. */
  path: RoutePoint[];
  /** Border crossings on the way. */
  borders: number;
  /** A car ferry is part of the trip. */
  ferry: boolean;
}

/** Why no route came back. */
export type RouteErrorCode =
  /** No road connects the two places (across an ocean, or too far from any road the router knows). */
  | "noRoute"
  /** Origin and destination are the same place. */
  | "samePlace"
  /** The routing service could not be reached or failed. */
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
