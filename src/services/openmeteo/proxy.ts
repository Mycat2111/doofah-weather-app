/**
 * Server side of /api/weather/air-quality: passes the page's air quality
 * request on to Open-Meteo's commercial servers with the API key from
 * OPEN_METEO_API_KEY, so the key never reaches the browser. Only used when
 * that key is set. (Forecasts come from /api/forecast, which asks Open-Meteo
 * itself.)
 */

import { CUSTOMER_URL } from "./api";

/** The only query parameters passed on. */
const ALLOWED = ["latitude", "longitude", "current", "timezone", "timeformat"] as const;

const TIMEOUT_MS = 15_000;

const refuse = (status: number, reason: string) =>
  Response.json({ error: true, reason }, { status, headers: { "Cache-Control": "no-store" } });

export async function proxyAirQuality(
  request: Request,
  apiKey: string | undefined = process.env.OPEN_METEO_API_KEY,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (!apiKey) return refuse(404, "No Open-Meteo API key is set");
  // Browsers say where a request comes from; only DooFah's own pages may spend the key.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return refuse(403, "Only DooFah can use this");

  const incoming = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  for (const name of ALLOWED) {
    const value = incoming.get(name);
    if (value !== null) params.set(name, value);
  }
  // One place at a time: the page's.
  const coordinates = [params.get("latitude"), params.get("longitude")];
  if (coordinates.some((c) => !c || c.includes(","))) return refuse(400, "Bad coordinates");
  params.set("apikey", apiKey);

  let upstream: Response;
  try {
    upstream = await fetcher(`${CUSTOMER_URL["air-quality"]}?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return refuse(502, "Open-Meteo could not be reached");
  }
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      // Vercel's edge answers the same request again for 5 minutes without calling Open-Meteo.
      "Cache-Control": upstream.ok ? "public, s-maxage=300, stale-while-revalidate=600" : "no-store",
    },
  });
}
