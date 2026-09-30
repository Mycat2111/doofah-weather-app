import { googleRoute } from "@/services/routing/googleRoutes";
import { simulatedRoute } from "@/services/routing/SimulatedRouter";
import { RouteError, type RouteRequest } from "@/services/routing/types";
import type { GeoPoint } from "@/services/weathernext3/types";

/**
 * POST /api/route: a driving route between two points.
 *
 * With GOOGLE_MAPS_API_KEY set (Routes API enabled), the route comes from
 * Google Maps with live traffic; without it, or when Google cannot be reached,
 * from DooFah's simulated highway map. The key stays on the server.
 */

const isPoint = (p: unknown): p is GeoPoint => {
  const q = p as GeoPoint;
  return !!q && Number.isFinite(q.lat) && Number.isFinite(q.lon) && Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180;
};

function parse(body: unknown): RouteRequest | null {
  const r = body as RouteRequest;
  if (!r || !isPoint(r.origin) || !isPoint(r.destination) || Number.isNaN(Date.parse(r.departure))) return null;
  return {
    origin: { lat: r.origin.lat, lon: r.origin.lon },
    destination: { lat: r.destination.lat, lon: r.destination.lon },
    departure: new Date(Date.parse(r.departure)).toISOString(),
    language: r.language === "th" ? "th" : "en",
  };
}

const fail = (code: string, status: number) => Response.json({ error: code }, { status });

export async function POST(request: Request) {
  // Only DooFah's own pages may spend the Maps quota.
  if (request.headers.get("sec-fetch-site") === "cross-site") return fail("failed", 403);
  const route = parse(await request.json().catch(() => null));
  if (!route) return fail("failed", 400);

  try {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      try {
        return Response.json(await googleRoute(route, key));
      } catch (error) {
        // "No road between these places" is Google's answer; anything else falls back.
        if (error instanceof RouteError && error.code !== "failed") throw error;
        console.error("Google Routes failed, using the simulated route:", error);
      }
    }
    return Response.json(simulatedRoute(route));
  } catch (error) {
    if (error instanceof RouteError) return fail(error.code, 422);
    throw error;
  }
}
