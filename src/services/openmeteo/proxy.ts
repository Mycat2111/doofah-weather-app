/**
 * Server side of /api/weather/*: passes DooFah's requests on to Open-Meteo's
 * commercial servers with the API key from OPEN_METEO_API_KEY, so the key
 * never reaches the browser. Only used when that key is set.
 */

import { CONSENSUS_MODELS, CUSTOMER_URL, MAX_LOCATIONS, type Endpoint } from "./api";

/** The only query parameters passed on. */
const ALLOWED = [
  "latitude",
  "longitude",
  "current",
  "hourly",
  "minutely_15",
  "forecast_minutely_15",
  "forecast_days",
  "forecast_hours",
  "models",
  "timezone",
  "timeformat",
] as const;

/** Models the key may be spent on: the ones DooFah compares. */
const MODELS = new Set<string>(CONSENSUS_MODELS.map((m) => m.id));

const TIMEOUT_MS = 15_000;

const refuse = (status: number, reason: string) =>
  Response.json({ error: true, reason }, { status, headers: { "Cache-Control": "no-store" } });

export async function proxyOpenMeteo(
  request: Request,
  endpoint: Endpoint,
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
  const places = params.get("latitude")?.split(",").length ?? 0;
  if (!places || !params.get("longitude") || places > MAX_LOCATIONS) return refuse(400, "Bad coordinates");
  const models = params.get("models")?.split(",");
  if (models && !models.every((m) => MODELS.has(m))) return refuse(400, "Unknown model");
  params.set("apikey", apiKey);

  let upstream: Response;
  try {
    upstream = await fetcher(`${CUSTOMER_URL[endpoint]}?${params}`, {
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
