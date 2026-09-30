import { simulatedRoute } from "./SimulatedRouter";
import { RouteError, type Route, type RouteRequest } from "./types";

export * from "./types";

/**
 * Asks DooFah's server for a route (Google Maps when it has a key, otherwise
 * simulated). Offline, or when the server fails, the simulated route is
 * worked out on the device instead.
 */
export async function getRoute(request: RouteRequest, signal?: AbortSignal): Promise<Route> {
  try {
    const response = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    const data: unknown = await response.json();
    if (response.ok) return data as Route;
    const code = (data as { error?: string } | null)?.error;
    if (code === "noRoute" || code === "samePlace") throw new RouteError(code);
  } catch (error) {
    if (error instanceof RouteError || signal?.aborted) throw error;
  }
  return simulatedRoute(request);
}
