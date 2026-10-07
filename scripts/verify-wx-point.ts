/**
 * Checks for v2 step 2, reading the forecast store: what /api/v2/point makes
 * of wx_point's answer, who it answers and how long each answer is kept, how
 * it asks Supabase, and the health check's forecast store row. Uses a
 * made-up Supabase, so it needs no network.
 *
 * With WX_DATABASE_URL set to a database that has the wx migrations and a
 * loaded run (pipeline/README.md), it also asks that database through psql,
 * the way Supabase's REST API would.
 *
 * Run with: npm run verify:wx-point
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rainRate, wxPointPath, type WxPoint } from "../src/lib/wxPoint";
import type { Alert } from "../src/services/ops/alert";
import { WX_STALE_MS, runChecks, type Probes } from "../src/services/ops/health";
import { SupabaseError } from "../src/services/reports/supabase";
import { wxPointResponse } from "../src/services/wx/http";
import { parseWxPoint, wxStore, type WxSourceStatus, type WxStore } from "../src/services/wx/store";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-07T21:00+07:00");

let checks = 0;
const check = (name: string, fn: () => void | Promise<void>) => ({ name, fn });

/** wx_point's answer for a 06Z run, as Postgres writes it: 1-hour steps, then a 3-hour one. */
const RAW = {
  source: {
    id: "ecmwf_hres",
    label_en: "ECMWF IFS 9 km",
    label_th: "ECMWF IFS 9 กม.",
    licence: "CC BY 4.0",
    attribution: "Forecast data by ECMWF (CC BY 4.0), via Open-Meteo",
  },
  run: { time: "2026-10-07T13:00+07:00", ready_at: "2026-10-07T20:52+07:00", grid_km: 9 },
  point: { lat: 13.7434, lon: 100.4959, distance_km: 1.6 },
  times: ["2026-10-07T13:00+07:00", "2026-10-07T14:00+07:00", "2026-10-07T15:00+07:00", "2026-10-07T18:00+07:00"],
  period_minutes: [0, 60, 60, 180],
  precip_mm: [null, 0, 1.2, 3],
  temp_c: [31.2, 31.8, 30.1, 27.4],
  wind_ms: [2.5, 3, 3.4, 1],
  wind_dir: [225, 230, 240, 0],
  cloud_pct: [60, 75, 100, 90],
};

const PARSED = parseWxPoint(RAW)!;

/** A store that answers `point` (or throws it) and counts the calls. */
function storeOf(point: WxPoint | null | Error | Error[]) {
  let calls = 0;
  const failures = Array.isArray(point) ? [...point] : [];
  const store: WxStore = {
    point: async () => {
      calls++;
      if (failures.length) throw failures.shift();
      if (point instanceof Error) throw point;
      return Array.isArray(point) ? PARSED : point;
    },
    status: async () => [],
  };
  return { store, calls: () => calls };
}

const ask = (query = "lat=13.75&lon=100.50", headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) =>
  new Request(`https://doofah.test/api/v2/point?${query}`, { headers });

const noReport = () => assert.fail("no alert expected");

const statusOf = (ready: string | null, newest?: Partial<WxSourceStatus["newest"]>): WxSourceStatus[] => [
  {
    source: "ecmwf_hres",
    ready: ready ? { runTime: ready, readyAt: ready, steps: 109 } : null,
    newest: newest ? { runTime: ready ?? "2026-10-07T13:00+07:00", status: "ready", error: null, ...newest } : null,
  },
];

const healthy: Probes = {
  forecast: async () => ({ hours: Array.from({ length: 360 }), days: Array.from({ length: 15 }) }) as never,
  cyclones: async () => ({ run: "2026-10-07T00:00:00.000Z", storms: [] }),
};

const storeRow = async (status: () => Promise<WxSourceStatus[]>) => {
  const rows = await runChecks(NOW, { ...healthy, forecastStore: status }, 200);
  const row = rows.find((c) => c.name.startsWith("Forecast store"));
  assert.ok(row, "the forecast store row is there");
  return row;
};

const CHECKS = [
  check("wx_point's JSON becomes steps that line up, Thai time kept", () => {
    assert.equal(PARSED.steps.length, 4);
    assert.deepEqual(PARSED.steps[3], {
      time: "2026-10-07T18:00+07:00",
      periodMinutes: 180,
      precipMm: 3,
      tempC: 27.4,
      windMs: 1,
      windDir: 0,
      cloudPct: 90,
    });
    assert.equal(PARSED.steps[0].precipMm, null, "nothing has fallen at the run's start");
    assert.deepEqual(PARSED.source.label, { en: "ECMWF IFS 9 km", th: "ECMWF IFS 9 กม." });
    assert.deepEqual(PARSED.run, { time: "2026-10-07T13:00+07:00", readyAt: "2026-10-07T20:52+07:00", gridKm: 9 });
    assert.equal(Date.parse(PARSED.run.time), Date.UTC(2026, 9, 7, 6), "+07:00 reads as 06 UTC");
    assert.equal(parseWxPoint(null), null, "no forecast there");
  }),

  check("a column the run lacks is all nulls; a short one or a strange answer is refused", () => {
    const noCloud = parseWxPoint({ ...RAW, cloud_pct: null })!;
    assert.deepEqual(
      noCloud.steps.map((s) => s.cloudPct),
      [null, null, null, null],
    );
    assert.throws(() => parseWxPoint({ ...RAW, temp_c: [30, 31] }), /temp_c has 2 steps, not 4/);
    assert.throws(() => parseWxPoint({ ...RAW, times: "soon" }), /unexpected/);
    assert.throws(() => parseWxPoint([]), /unexpected/);
  }),

  check("rain rate: a step's rain per hour, so 1- and 3-hour steps compare", () => {
    assert.equal(rainRate(PARSED.steps[0]), null);
    assert.equal(rainRate(PARSED.steps[2]), 1.2);
    assert.equal(rainRate(PARSED.steps[3]), 1, "3 mm over 3 hours");
  }),

  check("the page asks with coordinates rounded to 0.01°", () => {
    assert.equal(wxPointPath(13.756312, 100.501845), "/api/v2/point?lat=13.76&lon=100.50");
    assert.equal(wxPointPath(-0.004, 179.999), "/api/v2/point?lat=-0.00&lon=180.00");
  }),

  check(
    "/api/v2/point: a forecast is kept 5 min by the browser, 15 + 60 min at the edge, 6 h while Supabase fails",
    async () => {
      const response = await wxPointResponse(ask(), storeOf(PARSED).store, noReport);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "public, max-age=300");
      assert.equal(
        response.headers.get("vercel-cdn-cache-control"),
        "max-age=900, stale-while-revalidate=3600, stale-if-error=21600",
      );
      const body = (await response.json()) as WxPoint;
      assert.equal(body.steps.length, 4);
      assert.equal(body.point.distanceKm, 1.6);
    },
  ),

  check("/api/v2/point refuses other sites, bad coordinates, and says when it isn't set up", async () => {
    const { store, calls } = storeOf(PARSED);
    const other = await wxPointResponse(ask(undefined, { "sec-fetch-site": "cross-site" }), store, noReport);
    assert.equal(other.status, 403);
    for (const query of ["lat=13.75", "lat=91&lon=100", "lat=13&lon=abc", "lat=&lon=100"]) {
      const bad = await wxPointResponse(ask(query), store, noReport);
      assert.equal(bad.status, 400, query);
      assert.equal(bad.headers.get("cache-control"), "no-store");
    }
    assert.equal(calls(), 0, "Supabase isn't asked");
    const unset = await wxPointResponse(ask(), null, noReport);
    assert.equal(unset.status, 503);
    assert.equal(unset.headers.get("cache-control"), "no-store");
    // A server-side caller (curl, the health check) sends no sec-fetch-site and is answered.
    assert.equal((await wxPointResponse(ask(undefined, {}), store, noReport)).status, 200);
  }),

  check("/api/v2/point: no forecast there is a 404, kept 5 minutes so a first run shows soon", async () => {
    const response = await wxPointResponse(ask("lat=35.68&lon=139.69"), storeOf(null).store, noReport);
    assert.equal(response.status, 404);
    assert.match(((await response.json()) as { reason: string }).reason, /Thailand/);
    assert.equal(response.headers.get("vercel-cdn-cache-control"), "max-age=300, stale-while-revalidate=300");
  }),

  check("/api/v2/point asks again once after a 5xx, never after a 4xx", async () => {
    const flaky = storeOf([new SupabaseError(503, "wx_point answered 503: busy")]);
    assert.equal((await wxPointResponse(ask(), flaky.store, noReport)).status, 200);
    assert.equal(flaky.calls(), 2);

    const alerts: Alert[] = [];
    const refused = storeOf(new SupabaseError(401, "wx_point answered 401: Invalid API key"));
    const response = await wxPointResponse(ask(), refused.store, (a) => alerts.push(a));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(refused.calls(), 1);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].api, "/api/v2/point");
    assert.match(alerts[0].message, /401: Invalid API key/);
    assert.doesNotMatch(alerts[0].message, /13\.75|100\.5/, "an alert never says where someone looked");
  }),

  check("/api/v2/point: an answer it can't read is a 500, with an alert", async () => {
    const alerts: Alert[] = [];
    const lines: string[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      const odd = storeOf(new Error("wx_point answered something unexpected"));
      const response = await wxPointResponse(ask(), odd.store, (a) => alerts.push(a));
      assert.equal(response.status, 500);
    } finally {
      console.error = error;
    }
    assert.match(alerts[0].message, /^500: wx_point answered something unexpected/);
    assert.equal(lines.length, 1);
  }),

  check("the store calls Supabase's REST API with the secret key, on the server", async () => {
    const sent: { url: string; headers: Headers; body: unknown }[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return Response.json(String(input).endsWith("wx_point") ? RAW : [{ source: "ecmwf_hres", ready: null }]);
    }) as typeof fetch;
    assert.equal(wxStore({}, fetcher), null, "not set up");
    const store = wxStore({ SUPABASE_URL: "https://abc.supabase.co/", SUPABASE_SECRET_KEY: "sb_secret_x" }, fetcher)!;
    assert.equal((await store.point(13.75, 100.5))?.steps.length, 4);
    assert.deepEqual(await store.status(), [{ source: "ecmwf_hres", ready: null, newest: null }]);
    assert.equal(sent[0].url, "https://abc.supabase.co/rest/v1/rpc/wx_point");
    assert.deepEqual(sent[0].body, { p_lat: 13.75, p_lon: 100.5 });
    assert.equal(sent[0].headers.get("apikey"), "sb_secret_x");
    assert.equal(sent[0].headers.get("authorization"), null, "a secret key isn't a JWT");
    assert.equal(sent[1].url, "https://abc.supabase.co/rest/v1/rpc/wx_status");
  }),

  check("health: the forecast store is ok while its newest run is under 18 hours old", async () => {
    const row = await storeRow(async () => statusOf("2026-10-07T13:00+07:00", {}));
    assert.equal(row.status, "ok");
    assert.equal(row.detail, "run 2026-10-07 13:00 (+07), 8 h old, 109 steps");
    assert.equal(WX_STALE_MS, 18 * HOUR);
  }),

  check("health: degraded when the newest run is older, a newer one failed, or none has loaded", async () => {
    const old = await storeRow(async () => statusOf("2026-10-07T01:00+07:00"));
    assert.equal(old.status, "degraded");
    assert.match(old.detail, /20 h old.*ingest workflow/);

    const failed = await storeRow(async () =>
      statusOf("2026-10-07T13:00+07:00", { runTime: "2026-10-07T19:00+07:00", status: "failed", error: "404" }),
    );
    assert.equal(failed.status, "degraded");
    assert.match(failed.detail, /next run failed to load: 404/);

    const loading = await storeRow(async () => statusOf("2026-10-07T13:00+07:00", { status: "processing" }));
    assert.equal(loading.status, "ok", "a run being loaded is fine");

    const none = await storeRow(async () => statusOf(null));
    assert.equal(none.status, "degraded");
    assert.equal(none.detail, "no ECMWF run loaded yet");

    const down = await storeRow(async () => {
      throw new SupabaseError(502, "wx_status answered 502: Bad Gateway");
    });
    assert.equal(down.status, "down");
  }),

  check("health: no forecast store row while Supabase isn't set up", async () => {
    const rows = await runChecks(NOW, healthy, 200);
    assert.equal(rows.length, 2);
  }),

  check("a real database (WX_DATABASE_URL), asked the way Supabase's REST API would", async () => {
    const url = process.env.WX_DATABASE_URL;
    if (!url) {
      console.log("  (skipped: set WX_DATABASE_URL to a database with a loaded run)");
      return;
    }
    // psql stands in for PostgREST: the same function, its JSON passed through untouched.
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const fn = String(input).split("/rpc/")[1];
      const args = JSON.parse(String(init?.body)) as { p_lat?: number; p_lon?: number };
      const sql =
        fn === "wx_point"
          ? `select public.wx_point(${Number(args.p_lat)}, ${Number(args.p_lon)})`
          : `select public.${fn}()`;
      const out = execFileSync("psql", [url, "-X", "-At", "-c", sql], { encoding: "utf8" }).trim();
      return new Response(out || "null", { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const store = wxStore({ SUPABASE_URL: "https://local.test", SUPABASE_SECRET_KEY: "sb_secret_local" }, fetcher)!;

    const response = await wxPointResponse(ask("lat=13.76&lon=100.50"), store, noReport);
    assert.equal(response.status, 200);
    const point = (await response.json()) as WxPoint;
    assert.ok(point.steps.length === 109 || point.steps.length === 145, `${point.steps.length} steps`);
    assert.ok(point.point.distanceKm < 7, "ECMWF's points are 9 km apart");
    assert.ok(point.steps.every((s) => s.time.endsWith("+07:00")));
    assert.equal(point.steps[0].precipMm, null);
    assert.ok(point.steps.slice(1).every((s) => s.precipMm !== null && s.precipMm >= 0));
    assert.ok(point.steps.every((s) => s.tempC !== null && s.tempC > 10 && s.tempC < 45));
    const periods = new Set(point.steps.map((s) => s.periodMinutes));
    assert.ok([...periods].every((p) => [0, 60, 180, 360].includes(p)));

    const outside = await wxPointResponse(ask("lat=35.68&lon=139.69"), store, noReport);
    assert.equal(outside.status, 404);

    const [ecmwf] = await store.status();
    assert.equal(ecmwf.source, "ecmwf_hres");
    assert.equal(ecmwf.ready?.steps, point.steps.length);
    console.log(`  (run ${point.run.time}, nearest point ${point.point.distanceKm} km from Bangkok)`);
  }),
];

async function main() {
  for (const { name, fn } of CHECKS) {
    try {
      await fn();
      checks++;
      console.log(`✓ ${name}`);
    } catch (error) {
      console.error(`✗ ${name}`);
      throw error;
    }
  }
  console.log(`\nAll ${checks} wx point checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
