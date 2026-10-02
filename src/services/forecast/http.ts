/**
 * Server side of /api/forecast?lat=…&lon=…: the unified forecast as JSON.
 *
 * Answers are the same for everyone at the same rounded point (snapPoint) and
 * hour, so Vercel's edge keeps each one until the hour is over and serves it
 * again without asking the models. The page should ask with coordinates
 * already rounded by snapPoint, so that nearby requests share one answer.
 */

import { OpenMeteoError } from "../openmeteo/api";
import { floorToHour, HOUR_MS } from "../weathernext3/time";
import { defaultSources, getUnifiedForecast, type ForecastSources } from "./unified";

/** While a new answer is fetched after the hour, the old one may still be served for this long. */
const STALE_SECONDS = 600;
/** An answer is never kept for less than this. */
const MIN_SECONDS = 60;
/** An answer without WRF because TMD failed is kept no longer than this, so WRF is back soon after TMD is. */
const WRF_RETRY_SECONDS = 300;

const refuse = (status: number, reason: string) =>
  Response.json({ error: true, reason }, { status, headers: { "Cache-Control": "no-store" } });

function coordinate(value: string | null, limit: number): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

export async function forecastResponse(
  request: Request,
  sources: ForecastSources = defaultSources(),
  now: number = Date.now(),
): Promise<Response> {
  // Browsers say where a request comes from; other sites' pages may not spend DooFah's model calls.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return refuse(403, "Only DooFah can use this");

  const params = new URL(request.url).searchParams;
  const lat = coordinate(params.get("lat"), 90);
  const lon = coordinate(params.get("lon"), 180);
  if (lat === null || lon === null) return refuse(400, "Give lat (−90 to 90) and lon (−180 to 180) as numbers");

  try {
    const forecast = await getUnifiedForecast(lat, lon, now, sources);
    const untilHour = Math.max(MIN_SECONDS, Math.round((floorToHour(now) + HOUR_MS - now) / 1000));
    const seconds = forecast.wrf_missing === "unavailable" ? Math.min(untilHour, WRF_RETRY_SECONDS) : untilHour;
    return Response.json(forecast, {
      headers: { "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${STALE_SECONDS}` },
    });
  } catch (error) {
    if (error instanceof OpenMeteoError) return refuse(502, `ECMWF unavailable: ${error.message}`);
    console.error("[forecast]", error);
    return refuse(500, "The forecast could not be made");
  }
}
