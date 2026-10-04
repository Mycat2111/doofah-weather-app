/**
 * Server side of /api/cyclones: the active tropical cyclones from ECMWF's
 * newest ensemble run, the same for everyone.
 *
 * Vercel's edge keeps the answer for half an hour (ECMWF adds a run every
 * 6 hours), so ECMWF's open data is asked a few times an hour at most,
 * however many people open DooFah. While both of ECMWF's sources fail, the
 * edge keeps serving the last answer for up to 12 hours, and the storm popup
 * names the run it comes from. Reading from the second source, and every
 * failure, sends an alert (ops/alert.ts) once the reply has gone.
 */

import type { CycloneFeed } from "@/lib/cyclones";
import { cacheHeaders } from "../http/cacheHeaders";
import { reportAfterReply, type Report } from "../ops/report";
import { BufrError } from "./bufr";
import { CycloneSourceError, fetchCyclones } from "./openData";

export const FRESH_SECONDS = 1800;
/** While the next answer is fetched, the last one may be served for this long. */
const STALE_SECONDS = 6 * 3600;
/** While both sources fail, the edge keeps serving the last answer for this long (a decoded run is kept as long). */
const IF_ERROR_SECONDS = 12 * 3600;
const BROWSER_SECONDS = 300;

export type CycloneSource = (now: number, onFallback: (reason: string) => void) => Promise<CycloneFeed>;

const defaultSource: CycloneSource = (now, onFallback) => fetchCyclones(now, fetch, onFallback);

const refuse = (status: number, reason: string) =>
  Response.json({ error: true, reason }, { status, headers: { "Cache-Control": "no-store" } });

export async function cyclonesResponse(
  request: Request,
  source: CycloneSource = defaultSource,
  now: number = Date.now(),
  report: Report = reportAfterReply,
): Promise<Response> {
  // Browsers say where a request comes from; other sites' pages may not use DooFah's server.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return refuse(403, "Only DooFah can use this");

  try {
    const feed = await source(now, (reason) => report({ kind: "fallback", api: "/api/cyclones", message: reason }));
    return Response.json(feed, {
      headers: cacheHeaders({
        browser: BROWSER_SECONDS,
        fresh: FRESH_SECONDS,
        stale: STALE_SECONDS,
        ifError: IF_ERROR_SECONDS,
      }),
    });
  } catch (error) {
    // Vercel's edge now serves the last good answer, for up to 12 hours (stale-if-error).
    const reason =
      error instanceof CycloneSourceError
        ? error.message
        : error instanceof BufrError
          ? `ECMWF's track file could not be read: ${error.message}`
          : null;
    if (reason) {
      report({ kind: "error", api: "/api/cyclones", message: `502, ${reason}` });
      return refuse(502, reason);
    }
    console.error("[cyclones]", error);
    report({ kind: "error", api: "/api/cyclones", message: `500: ${error instanceof Error ? error.message : error}` });
    return refuse(500, "The cyclone tracks could not be made");
  }
}
