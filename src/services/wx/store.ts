/**
 * The v2 forecast store (the `wx` schema in Supabase, loaded by pipeline/),
 * read through the functions in supabase/migrations/20261007140000_wx_point_api.sql.
 */

import type { WxPoint, WxStep } from "@/lib/wxPoint";
import { supabaseFrom, type Supabase } from "../reports/supabase";

/** One source's newest ready run, and its newest run of any kind (a failed one says why). */
export interface WxSourceStatus {
  source: string;
  ready: { runTime: string; readyAt: string; steps: number } | null;
  newest: { runTime: string; status: string; error: string | null } | null;
}

export interface WxStore {
  /** ECMWF's newest run at the grid point nearest (lat, lon); null outside the loaded area or before any run. */
  point(lat: number, lon: number): Promise<WxPoint | null>;
  status(): Promise<WxSourceStatus[]>;
}

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** A Postgres array column: one number or null per step. */
function column(raw: Row, name: string, length: number): (number | null)[] {
  const values = raw[name];
  // A column the run doesn't have (an ensemble's, say) is all nulls.
  if (values === null || values === undefined) return Array.from({ length }, () => null);
  if (!Array.isArray(values) || values.length !== length) {
    throw new Error(`wx_point: ${name} has ${Array.isArray(values) ? values.length : "no"} steps, not ${length}`);
  }
  return values.map(num);
}

/** wx_point's JSON as the page's WxPoint. Throws on anything else, so a changed function can't draw nonsense. */
export function parseWxPoint(raw: unknown): WxPoint | null {
  if (raw === null) return null;
  const source = isRow(raw) && isRow(raw.source) ? raw.source : null;
  const run = isRow(raw) && isRow(raw.run) ? raw.run : null;
  const point = isRow(raw) && isRow(raw.point) ? raw.point : null;
  const times = isRow(raw) && Array.isArray(raw.times) ? raw.times.map(text) : null;
  if (!isRow(raw) || !source || !run || !point || !times || times.some((t) => t === null)) {
    throw new Error("wx_point answered something unexpected");
  }
  const n = times.length;
  const periods = column(raw, "period_minutes", n);
  const precip = column(raw, "precip_mm", n);
  const temp = column(raw, "temp_c", n);
  const windMs = column(raw, "wind_ms", n);
  const windDir = column(raw, "wind_dir", n);
  const cloud = column(raw, "cloud_pct", n);
  const steps: WxStep[] = times.map((time, i) => ({
    time: time!,
    periodMinutes: periods[i] ?? 0,
    precipMm: precip[i],
    tempC: temp[i],
    windMs: windMs[i],
    windDir: windDir[i],
    cloudPct: cloud[i],
  }));
  const runTime = text(run.time);
  const lat = num(point.lat);
  const lon = num(point.lon);
  if (!runTime || lat === null || lon === null) throw new Error("wx_point answered without its run or point");
  return {
    source: {
      id: String(source.id),
      label: { en: String(source.label_en), th: String(source.label_th) },
      licence: String(source.licence),
      attribution: String(source.attribution),
    },
    run: { time: runTime, readyAt: text(run.ready_at) ?? runTime, gridKm: num(run.grid_km) ?? 0 },
    point: { lat, lon, distanceKm: num(point.distance_km) ?? 0 },
    steps,
  };
}

export function parseWxStatus(raw: unknown): WxSourceStatus[] {
  if (!Array.isArray(raw)) throw new Error("wx_status answered something unexpected");
  return raw.filter(isRow).map((s) => {
    const ready = isRow(s.ready) ? s.ready : null;
    const newest = isRow(s.newest) ? s.newest : null;
    return {
      source: String(s.source),
      ready: ready && {
        runTime: String(ready.run_time),
        readyAt: String(ready.ready_at),
        steps: num(ready.steps) ?? 0,
      },
      newest: newest && {
        runTime: String(newest.run_time),
        status: String(newest.status),
        error: text(newest.error),
      },
    };
  });
}

/** The store through Supabase's REST API, or null while Supabase isn't set up. */
export function wxStoreFrom(supabase: Supabase | null): WxStore | null {
  if (!supabase) return null;
  return {
    point: async (lat, lon) => parseWxPoint(await supabase.rpc<unknown>("wx_point", { p_lat: lat, p_lon: lon })),
    status: async () => parseWxStatus(await supabase.rpc<unknown>("wx_status", {})),
  };
}

export function wxStore(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch) {
  return wxStoreFrom(supabaseFrom(env, fetcher));
}
