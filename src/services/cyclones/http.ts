/**
 * Server side of /api/cyclones: the active tropical cyclones from ECMWF's
 * newest ensemble run, the same for everyone.
 *
 * Vercel's edge keeps the answer for half an hour (ECMWF adds a run every
 * 6 hours), so ECMWF's portal is asked a few times an hour at most, however
 * many people open DooFah. A failure is kept for a minute, so a busy portal
 * isn't asked again by every page that retries.
 */

import type { CycloneFeed } from "@/lib/cyclones";
import { BufrError } from "./bufr";
import { CycloneSourceError, fetchCyclones } from "./openData";

export const FRESH_SECONDS = 1800;
/** While the next answer is fetched, the last one may be served for this long. */
const STALE_SECONDS = 6 * 3600;
const FAILED_SECONDS = 60;

export type CycloneSource = (now: number) => Promise<CycloneFeed>;

const defaultSource: CycloneSource = (now) => fetchCyclones(now);

const refuse = (status: number, reason: string, cache = "no-store") =>
  Response.json({ error: true, reason }, { status, headers: { "Cache-Control": cache } });

export async function cyclonesResponse(
  request: Request,
  source: CycloneSource = defaultSource,
  now: number = Date.now(),
): Promise<Response> {
  // Browsers say where a request comes from; other sites' pages may not use DooFah's server.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return refuse(403, "Only DooFah can use this");

  try {
    const feed = await source(now);
    return Response.json(feed, {
      headers: { "Cache-Control": `public, s-maxage=${FRESH_SECONDS}, stale-while-revalidate=${STALE_SECONDS}` },
    });
  } catch (error) {
    const cache = `public, s-maxage=${FAILED_SECONDS}`;
    if (error instanceof CycloneSourceError) return refuse(502, error.message, cache);
    if (error instanceof BufrError) return refuse(502, `ECMWF's track file could not be read: ${error.message}`, cache);
    console.error("[cyclones]", error);
    return refuse(500, "The cyclone tracks could not be made", cache);
  }
}
