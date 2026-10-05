/**
 * Where shared weather reports are kept: the `crowd_reports` table in
 * Supabase (Postgres with PostGIS), read and written only through the
 * functions in supabase/migrations, so the rules (3 hours, rounding to about
 * 1 km, one report per phone and spot, 6 an hour) live next to the data.
 */

import { REPORT_KINDS, type ReportKind } from "@/lib/crowdReports";
import type { Box, ReportCell, SharedReport, TileReports } from "@/lib/sharedReports";
import type { GeoPoint } from "../weather/types";
import { supabaseFrom, type Supabase } from "./supabase";

export type Submitted =
  | { ok: true; report: SharedReport; replaced: number }
  /** `too_many`: this phone already sent 6 reports in the last hour. `invalid`: the server's own checks missed something. */
  | { ok: false; reason: "too_many" | "invalid" };

export interface ReportStore {
  /** The live reports in a box, one by one up to `maxPoints`, otherwise counted per `cell`-degree cell. */
  inBox(box: Box, maxPoints: number, cell: number): Promise<TileReports>;
  /** Saves a report for `reporter` (a hash, never a phone's own id). */
  submit(reporter: string, kind: ReportKind, point: GeoPoint): Promise<Submitted>;
  /** How many reports are live, and when the oldest row was made (null when there are none). */
  status(): Promise<{ live: number; oldest: number | null }>;
}

const isKind = (value: unknown): value is ReportKind => REPORT_KINDS.includes(value as ReportKind);
/** Postgres writes times like "2026-10-05T23:00:54.095244+00:00"; the page gets plain ISO. */
const iso = (value: unknown) => new Date(String(value)).toISOString();

function readReport(raw: unknown): SharedReport | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || !isKind(r.kind) || typeof r.lat !== "number" || typeof r.lon !== "number") return null;
  return { id: String(r.id), kind: r.kind, lat: r.lat, lon: r.lon, time: iso(r.time) };
}

function readCell(raw: unknown): ReportCell | null {
  const c = raw as Record<string, unknown> | null;
  const kinds = (c?.kinds ?? {}) as Record<string, unknown>;
  if (!c || typeof c.count !== "number") return null;
  return {
    lat: Number(c.lat),
    lon: Number(c.lon),
    count: c.count,
    kinds: Object.fromEntries(REPORT_KINDS.map((k) => [k, Number(kinds[k] ?? 0)])) as Record<ReportKind, number>,
    newest: iso(c.newest),
  };
}

const present = <T>(value: T | null): value is T => value !== null;

/** The store on Supabase's REST API. */
export function storeOn(supabase: Supabase): ReportStore {
  return {
    async inBox({ west, south, east, north }, maxPoints, cell) {
      const answer = await supabase.rpc<{ reports?: unknown[]; cells?: unknown[] }>("crowd_reports_in_box", {
        west,
        south,
        east,
        north,
        max_points: maxPoints,
        cell,
      });
      return {
        reports: (answer.reports ?? []).map(readReport).filter(present),
        cells: (answer.cells ?? []).map(readCell).filter(present),
      };
    },

    async submit(reporter, kind, { lat, lon }) {
      const answer = await supabase.rpc<{ ok: boolean; reason?: string; report?: unknown; replaced?: number }>(
        "submit_crowd_report",
        { p_reporter: reporter, p_kind: kind, p_lat: lat, p_lon: lon },
      );
      const report = answer.ok ? readReport(answer.report) : null;
      if (report) return { ok: true, report, replaced: Number(answer.replaced ?? 0) };
      return { ok: false, reason: answer.reason === "too_many" ? "too_many" : "invalid" };
    },

    async status() {
      const answer = await supabase.rpc<{ live?: number; oldest?: string | null }>("crowd_reports_status", {});
      return { live: Number(answer.live ?? 0), oldest: answer.oldest ? Date.parse(answer.oldest) : null };
    },
  };
}

/** The store, or null while Supabase isn't set up (the routes then answer 503 and the page keeps reports to itself). */
export function supabaseStore(env: Record<string, string | undefined> = process.env): ReportStore | null {
  const supabase = supabaseFrom(env);
  return supabase ? storeOn(supabase) : null;
}
