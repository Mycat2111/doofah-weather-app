import { simulatedRoute } from "./SimulatedRouter";
import type { Route, RouteRequest } from "./types";

export * from "./types";

/**
 * A driving route between two points, worked out on the device over DooFah's
 * simulated highway map (see RouteSource for why not Google's).
 */
export async function getRoute(request: RouteRequest): Promise<Route> {
  return simulatedRoute(request);
}
