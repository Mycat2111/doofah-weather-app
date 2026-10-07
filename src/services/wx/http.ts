/**
 * Server side of /api/v2/point?lat=…&lon=…: v2's forecast for a place, from
 * the forecast store (ECMWF's newest 9 km run, loaded by pipeline/ every 30
 * minutes). The page asks with coordinates rounded to 0.01° (wxPointPath).
 *
 * A run stays the newest for 6 hours or more, so Vercel's edge keeps each
 * answer for 15 minutes, then serves it for another hour while it asks again
 * in the background, and for 6 hours while Supabase fails.
 *
 * 404: no forecast there (outside the area the pipeline loads, or no run yet).
 * 503: Supabase isn't set up. 502: Supabase failed, which sends an alert.
 */

import { cacheHeaders } from "../http/cacheHeaders";
import { reportAfterReply, type Report } from "../ops/report";
import { isTransient, withRetry } from "../ops/retry";
import { SupabaseError } from "../reports/supabase";
import { wxStore, type WxStore } from "./store";

const API = "/api/v2/point";

const refuse = (status: number, reason: string, headers: Record<string, string> = { "Cache-Control": "no-store" }) =>
  Response.json({ error: true, reason }, { status, headers });

function coordinate(value: string | null, limit: number): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

export async function wxPointResponse(
  request: Request,
  store: WxStore | null = wxStore(),
  report: Report = reportAfterReply,
): Promise<Response> {
  // Browsers say where a request comes from; other sites' pages may not use DooFah's database.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return refuse(403, "Only DooFah can use this");

  const params = new URL(request.url).searchParams;
  const lat = coordinate(params.get("lat"), 90);
  const lon = coordinate(params.get("lon"), 180);
  if (lat === null || lon === null) return refuse(400, "Give lat (−90 to 90) and lon (−180 to 180) as numbers");
  if (!store) return refuse(503, "The v2 forecast store isn't set up (SUPABASE_URL, SUPABASE_SECRET_KEY)");

  try {
    const point = await withRetry(() => store.point(lat, lon), { retryable: isTransient });
    if (!point) {
      // Kept briefly, so a first run shows soon after it loads.
      return refuse(
        404,
        "No v2 forecast here: it covers Thailand",
        cacheHeaders({ browser: 60, fresh: 300, stale: 300 }),
      );
    }
    return Response.json(point, {
      headers: cacheHeaders({ browser: 300, fresh: 900, stale: 3600, ifError: 6 * 3600 }),
    });
  } catch (error) {
    if (error instanceof SupabaseError) {
      // Vercel's edge now serves the place's last good answer, for up to 6 hours (stale-if-error).
      report({ kind: "error", api: API, message: `502, forecast store: ${error.message}` });
      return refuse(502, "The v2 forecast store didn't answer");
    }
    console.error("[wx point]", error);
    report({ kind: "error", api: API, message: `500: ${error instanceof Error ? error.message : error}` });
    return refuse(500, "The v2 forecast could not be read");
  }
}
