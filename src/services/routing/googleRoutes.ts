import { distanceKm } from "../weathernext3/places";
import type { GeoPoint } from "../weathernext3/types";
import { decodePolyline } from "./polyline";
import { RouteError, type Route, type RoutePoint, type RouteRequest } from "./types";

/**
 * Google Maps Routes API (computeRoutes), called from the server so the API
 * key never reaches the browser.
 * https://developers.google.com/maps/documentation/routes/compute_route_directions
 */

export const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** Only the fields used below: the API bills by what the field mask asks for. */
export const GOOGLE_FIELD_MASK = [
  "routes.distanceMeters",
  "routes.duration",
  "routes.polyline.encodedPolyline",
  "routes.legs.steps.distanceMeters",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.polyline.encodedPolyline",
  "routes.legs.steps.navigationInstruction.maneuver",
].join(",");

interface GoogleStep {
  distanceMeters?: number;
  staticDuration?: string;
  polyline?: { encodedPolyline?: string };
  navigationInstruction?: { maneuver?: string };
}

export interface GoogleRoutesResponse {
  routes?: {
    distanceMeters?: number;
    /** With traffic, e.g. "9120s". */
    duration?: string;
    polyline?: { encodedPolyline?: string };
    legs?: { steps?: GoogleStep[] }[];
  }[];
}

const latLng = (p: GeoPoint) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } });
/** "9120s" → 9120 */
const seconds = (value: string | undefined) => (value ? Number.parseFloat(value) : 0) || 0;

export function googleRequestBody(request: RouteRequest, now: number) {
  const departure = Date.parse(request.departure);
  return {
    origin: latLng(request.origin),
    destination: latLng(request.destination),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    // The API refuses departure times in the past, so "now" is left out.
    ...(departure > now + 60_000 ? { departureTime: new Date(departure).toISOString() } : {}),
    languageCode: request.language === "th" ? "th" : "en",
    units: "METRIC",
  };
}

/** The first route of a computeRoutes response as a Route, with traffic spread over its steps. */
export function routeFromGoogle(response: GoogleRoutesResponse, request: RouteRequest): Route {
  const route = response.routes?.[0];
  const encoded = route?.polyline?.encodedPolyline;
  if (!route || !encoded) throw new RouteError("noRoute");

  const durationS = seconds(route.duration);
  const steps = (route.legs ?? []).flatMap((leg) => leg.steps ?? []).filter((s) => s.polyline?.encodedPolyline);
  // Each step's line with its time without traffic; the whole line in one step when steps are missing.
  const pieces = steps.length
    ? steps.map((s) => ({ line: decodePolyline(s.polyline!.encodedPolyline!), s: seconds(s.staticDuration) }))
    : [{ line: decodePolyline(encoded), s: durationS }];
  const staticS = pieces.reduce((sum, p) => sum + p.s, 0);
  // Traffic slows every step alike.
  const traffic = staticS > 0 && durationS > 0 ? durationS / staticS : 1;

  const path: RoutePoint[] = [];
  let km = 0;
  let min = 0;
  for (const { line, s } of pieces) {
    if (!line.length) continue;
    const lengths = line.slice(1).map((p, i) => distanceKm(line[i], p));
    const total = lengths.reduce((a, b) => a + b, 0);
    const minutes = (s * traffic) / 60;
    if (!path.length) path.push({ ...line[0], km, min });
    lengths.forEach((l, i) => {
      km += l;
      min += total > 0 ? (minutes * l) / total : 0;
      path.push({ ...line[i + 1], km, min });
    });
    // A step with no length still takes time (a ferry crossing, a wait).
    if (total === 0) {
      min += minutes;
      path[path.length - 1] = { ...path[path.length - 1], min };
    }
  }
  if (path.length < 2) throw new RouteError("noRoute");

  // Use Google's own totals, and stretch the measured line to match them.
  const distanceKmTotal = route.distanceMeters ? route.distanceMeters / 1000 : km;
  const durationMin = durationS ? durationS / 60 : min;
  const kmScale = km > 0 ? distanceKmTotal / km : 1;
  const minScale = min > 0 ? durationMin / min : 1;
  const start = Date.parse(request.departure);
  return {
    source: "google",
    departure: new Date(start).toISOString(),
    arrival: new Date(start + durationMin * 60_000).toISOString(),
    distanceKm: distanceKmTotal,
    durationMin,
    path: path.map((p) => ({ ...p, km: p.km * kmScale, min: p.min * minScale })),
    borders: 0,
    ferry: steps.some((s) => s.navigationInstruction?.maneuver?.startsWith("FERRY")),
  };
}

export async function googleRoute(
  request: RouteRequest,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<Route> {
  const response = await fetchImpl(GOOGLE_ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
    },
    body: JSON.stringify(googleRequestBody(request, now)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new RouteError("failed", `Google Routes API ${response.status}`);
  return routeFromGoogle((await response.json()) as GoogleRoutesResponse, request);
}
