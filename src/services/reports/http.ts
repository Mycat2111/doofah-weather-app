/**
 * Server side of /api/reports, everyone's weather reports from the last 3
 * hours:
 *
 * - `GET /api/reports?tile=size,row,col`: one map tile's live reports
 *   (src/lib/sharedReports.ts), one by one or counted per cell. The same for
 *   everyone, so Vercel's edge keeps each tile for 30 seconds and Supabase
 *   is asked about once a minute per tile in use, however many people look.
 * - `POST /api/reports` with `{ kind, lat, lon, device }`: sends a report.
 *   Only DooFah's own page may (browsers say where a request comes from), 30
 *   times an hour per visitor and server instance. `device` is the phone's
 *   random id; only a keyed hash of it is saved, and Supabase keeps the
 *   rules: a phone that reports again within 10 minutes and 1 km replaces
 *   its report there, and sends at most 6 an hour.
 *
 * Without Supabase both answer 503, and the page keeps reports to itself.
 */

import { createHmac } from "node:crypto";
import { REPORT_KINDS, type ReportKind } from "@/lib/crowdReports";
import { cellSize, MAX_POINTS, parseTile, tileBox } from "@/lib/sharedReports";
import { cacheHeaders } from "../http/cacheHeaders";
import { reportAfterReply, type Report } from "../ops/report";
import { isTransient, withRetry } from "../ops/retry";
import { supabaseStore, type ReportStore } from "./store";

/** A report is under 200 bytes. */
const MAX_BODY = 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 3_600_000;
/** What a phone's random id looks like (crypto.randomUUID, or anything URL-safe of that length). */
const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

export interface ReportsDeps {
  store: ReportStore | null;
  now: () => number;
  report: Report;
  /** Key for hashing phones' ids, so the saved hash can't be matched to a phone without it. */
  reporterKey: string | undefined;
}

export interface ReportsServer {
  list(request: Request): Promise<Response>;
  submit(request: Request): Promise<Response>;
}

const refuse = (status: number, reason: string) =>
  Response.json({ error: true, reason }, { status, headers: { "Cache-Control": "no-store" } });

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isKind = (value: unknown): value is ReportKind => REPORT_KINDS.includes(value as ReportKind);
const inRange = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;

/** The visitor's address, as Vercel passes it on. */
const visitorOf = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";

/** Who sent a report, as saved: a keyed hash of the phone's id, or of its address when the page sent none. */
export function reporterOf(key: string, device: string | null, visitor: string): string {
  return createHmac("sha256", key)
    .update(device ? `device:${device}` : `visitor:${visitor}`)
    .digest("base64url")
    .slice(0, 32);
}

export function reportsServer(deps: Partial<ReportsDeps> = {}): ReportsServer {
  const { store, now, report, reporterKey }: ReportsDeps = {
    store: deps.store === undefined ? supabaseStore() : deps.store,
    now: deps.now ?? Date.now,
    report: deps.report ?? reportAfterReply,
    reporterKey:
      "reporterKey" in deps
        ? deps.reporterKey
        : (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim(),
  };
  const visitors = new Map<string, number[]>();

  /** One more report from this visitor, or false when they have had their share this hour. */
  function allow(visitor: string): boolean {
    const since = now() - RATE_WINDOW_MS;
    const recent = (visitors.get(visitor) ?? []).filter((t) => t > since);
    if (recent.length >= RATE_LIMIT) return false;
    recent.push(now());
    visitors.set(visitor, recent);
    if (visitors.size > 5000) for (const [key, times] of visitors) if (times.at(-1)! <= since) visitors.delete(key);
    return true;
  }

  function failed(api: string, error: unknown): Response {
    const message = error instanceof Error ? error.message : String(error);
    report({ kind: "error", api, message: `502: ${message}` });
    return refuse(502, "Shared reports are unavailable, try again later");
  }

  return {
    async list(request) {
      // Other sites' pages may not use DooFah's reports; a browser's address bar and scripts may.
      const site = request.headers.get("sec-fetch-site");
      if (site && site !== "same-origin" && site !== "none") return refuse(403, "Only DooFah can use this");
      const tile = parseTile(new URL(request.url).searchParams.get("tile"));
      if (!tile) return refuse(400, "Give tile=size,row,col (size 0.25, 1, 5 or 15 degrees)");
      if (!store) return refuse(503, "Shared reports are not set up");
      try {
        // Asked again once after a timeout or a 5xx: reading twice changes nothing.
        const body = await withRetry(() => store.inBox(tileBox(tile), MAX_POINTS, cellSize(tile)), {
          retryable: isTransient,
        });
        return Response.json(body, {
          // Reports are minutes old at best, so 30 seconds at the edge costs nothing; while Supabase is down
          // the edge keeps the last answer for 10 minutes.
          headers: cacheHeaders({ browser: 15, fresh: 30, stale: 30, ifError: 600 }),
        });
      } catch (error) {
        return failed("/api/reports", error);
      }
    },

    async submit(request) {
      const api = "POST /api/reports";
      if (!store || !reporterKey) return refuse(503, "Shared reports are not set up");
      if (request.headers.get("sec-fetch-site") !== "same-origin") return refuse(403, "Only DooFah can use this");
      const visitor = visitorOf(request);
      if (!allow(visitor)) return refuse(429, "Too many reports, try again later");
      if (Number(request.headers.get("content-length")) > MAX_BODY) return refuse(413, "Too large");
      const text = await request.text();
      if (text.length > MAX_BODY) return refuse(413, "Too large");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return refuse(400, "Not JSON");
      }
      if (!isObject(body) || !isKind(body.kind) || !inRange(body.lat, 90) || !inRange(body.lon, 180)) {
        return refuse(400, `Give kind (${REPORT_KINDS.join(", ")}), lat and lon`);
      }
      const device = typeof body.device === "string" && DEVICE_ID.test(body.device) ? body.device : null;
      try {
        const saved = await store.submit(reporterOf(reporterKey, device, visitor), body.kind, {
          lat: body.lat,
          lon: body.lon,
        });
        if (!saved.ok) {
          return saved.reason === "too_many"
            ? refuse(429, "That's 6 reports this hour; thanks, try again later")
            : refuse(400, "Report not taken");
        }
        return Response.json(
          { report: saved.report, replaced: saved.replaced },
          { status: 201, headers: { "Cache-Control": "no-store" } },
        );
      } catch (error) {
        return failed(api, error);
      }
    },
  };
}
