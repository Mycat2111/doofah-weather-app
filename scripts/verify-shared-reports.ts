/**
 * Checks for shared weather reports (post-launch step 5, the backend): the
 * map's report tiles, the Supabase REST client (against a stand-in for
 * Supabase's API), reading Supabase's answers, the /api/reports routes (with
 * an in-memory store), the health check, and that the migration's rules
 * match the code. Needs no network and no database. Run with:
 * npm run verify:shared-reports
 *
 * The SQL itself (supabase/migrations) was run against Postgres 16 with
 * PostGIS 3.4 and pg_cron 1.6; README: "Shared reports on Supabase".
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { REPORT_KINDS, type ReportKind } from "../src/lib/crowdReports";
import {
  CELLS_PER_SIDE,
  MAX_POINTS,
  SHARED_REPORT_TTL_MS,
  TILE_SIZES,
  cellSize,
  parseTile,
  tileAllowed,
  tileBox,
  tileKey,
  tilesFor,
  type Box,
  type TileReports,
} from "../src/lib/sharedReports";
import type { Alert } from "../src/services/ops/alert";
import { REPORTS_STALE_MS, runChecks, type Probes } from "../src/services/ops/health";
import { reporterOf, reportsServer, type ReportsDeps } from "../src/services/reports/http";
import { storeOn, type ReportStore, type Submitted } from "../src/services/reports/store";
import { SupabaseError, supabaseFrom, type Supabase } from "../src/services/reports/supabase";
import type { GeoBounds, GeoPoint } from "../src/services/weather/types";

const NOW = Date.UTC(2026, 9, 5, 23, 0);
const HOUR = 3_600_000;
const MIGRATION = "supabase/migrations/20261005230000_crowd_reports.sql";

let checks = 0;
const check = (name: string, fn: () => void | Promise<void>) => ({ name, fn });

/** Whether the tiles cover every point of the view. */
function covers(tiles: Box[], [[s, w], [n, e]]: GeoBounds) {
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const lat = s + ((n - s) * i) / 10;
      const lon = w + ((e - w) * j) / 10;
      if (!tiles.some((b) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east)) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* A stand-in for Supabase's REST API                                  */
/* ------------------------------------------------------------------ */

interface Call {
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

async function fakeSupabase(answer: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const server = createServer((req, res) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => {
      const call = { path: req.url ?? "", headers: req.headers, body: JSON.parse(text || "null") };
      calls.push(call);
      const { status, body } = answer(call);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, calls, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/* ------------------------------------------------------------------ */
/* An in-memory store                                                   */
/* ------------------------------------------------------------------ */

function memoryStore() {
  const boxes: { box: Box; maxPoints: number; cell: number }[] = [];
  const sent: { reporter: string; kind: ReportKind; point: GeoPoint }[] = [];
  let next: Submitted | null = null;
  let failures: Error[] = [];
  const store: ReportStore = {
    async inBox(box, maxPoints, cell) {
      boxes.push({ box, maxPoints, cell });
      const failure = failures.shift();
      if (failure) throw failure;
      return {
        reports: [
          { id: "7", kind: "heavyRain", lat: 13.76, lon: 100.5, time: new Date(NOW - 5 * 60_000).toISOString() },
        ],
        cells: [],
      };
    },
    async submit(reporter, kind, point) {
      sent.push({ reporter, kind, point });
      const answer = next ?? {
        ok: true as const,
        report: { id: String(sent.length), kind, lat: point.lat, lon: point.lon, time: new Date(NOW).toISOString() },
        replaced: 0,
      };
      next = null;
      return answer;
    },
    async status() {
      return { live: 3, oldest: NOW - HOUR };
    },
  };
  return {
    store,
    boxes,
    sent,
    answerNext: (answer: Submitted) => (next = answer),
    failWith: (...errors: Error[]) => (failures = errors),
  };
}

function server(change: Partial<ReportsDeps> = {}) {
  const memory = memoryStore();
  const alerts: Alert[] = [];
  const routes = reportsServer({
    store: memory.store,
    now: () => NOW,
    report: (alert) => alerts.push(alert),
    reporterKey: "test-key-not-a-secret",
    ...change,
  });
  return { routes, memory, alerts };
}

const get = (query: string, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) =>
  new Request(`https://doofah.test/api/reports${query}`, { headers });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://doofah.test/api/reports", {
    method: "POST",
    headers: {
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "203.0.113.9",
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const DEVICE = "6f1c2b9e-4d3a-4b8e-9f00-1a2b3c4d5e6f";
const report = (change: Record<string, unknown> = {}) => ({
  kind: "lightRain",
  lat: 13.7563,
  lon: 100.5018,
  device: DEVICE,
  ...change,
});

const CHECKS = [
  check("Tiles: a city view takes small tiles, a country bigger ones, never more than 3 × 3", () => {
    const views: [string, GeoBounds, number][] = [
      [
        "Bangkok",
        [
          [13.6, 100.35],
          [13.95, 100.75],
        ],
        0.25,
      ],
      [
        "Bangkok and around",
        [
          [13, 99.8],
          [14.6, 101.3],
        ],
        1,
      ],
      [
        "Northern Thailand",
        [
          [16, 97],
          [21, 102],
        ],
        5,
      ],
      [
        "Thailand",
        [
          [5, 97],
          [21, 106],
        ],
        15,
      ],
      [
        "the world",
        [
          [-85, -200],
          [85, 200],
        ],
        15,
      ],
    ];
    for (const [name, view, size] of views) {
      const tiles = tilesFor(view);
      assert.ok(tiles.length > 0 && tiles.length <= 9, `${name}: ${tiles.length} tiles`);
      assert.ok(
        tiles.every((t) => t.size === size),
        `${name}: size ${tiles[0].size}, wanted ${size}`,
      );
      assert.ok(tiles.every(tileAllowed), `${name}: every tile on the globe`);
      if (name !== "the world") assert.ok(covers(tiles.map(tileBox), view), `${name}: the tiles cover the view`);
    }
    // Two views of the same area ask for the same tiles, so the edge answers the second.
    const a = tilesFor([
      [13.61, 100.36],
      [13.94, 100.74],
    ]).map(tileKey);
    const b = tilesFor([
      [13.62, 100.4],
      [13.9, 100.7],
    ]).map(tileKey);
    assert.deepEqual(
      b.filter((k) => !a.includes(k)),
      [],
    );
    // Past the date line, reports stop at it.
    assert.ok(
      tilesFor([
        [0, 170],
        [10, 190],
      ]).every((t) => tileBox(t).east <= 180),
    );
    assert.deepEqual(
      tilesFor([
        [10, 10],
        [10, 10],
      ]),
      [],
    );
  }),

  check("Tiles: written and read back; anything else is refused", () => {
    for (const size of TILE_SIZES) {
      const tile = { size, row: 1, col: 6 };
      assert.deepEqual(parseTile(tileKey(tile)), tile);
    }
    assert.deepEqual(parseTile("0.25,55,402"), { size: 0.25, row: 55, col: 402 });
    assert.deepEqual(parseTile("15,-6,-12"), { size: 15, row: -6, col: -12 });
    for (const bad of [
      null,
      "",
      "1,1",
      "1,1,1,1",
      "0.3,1,1",
      "2,1,1",
      "15,6,0",
      "15,0,12",
      "1,1.5,2",
      "a,b,c",
      "1, 1,1",
    ]) {
      assert.equal(parseTile(bad), null, `refused: ${bad}`);
    }
    assert.deepEqual(tileBox({ size: 0.25, row: 55, col: 402 }), {
      west: 100.5,
      south: 13.75,
      east: 100.75,
      north: 14,
    });
    assert.equal(cellSize({ size: 15, row: 0, col: 6 }), 15 / CELLS_PER_SIDE);
  }),

  check("Supabase client: calls /rest/v1/rpc with the secret key in apikey only, and JSON arguments", async () => {
    const fake = await fakeSupabase(() => ({ status: 200, body: { ok: true } }));
    try {
      assert.equal(supabaseFrom({}), null);
      assert.equal(supabaseFrom({ SUPABASE_URL: fake.url }), null);
      const supabase = supabaseFrom({ SUPABASE_URL: `${fake.url}/`, SUPABASE_SECRET_KEY: " sb_secret_abc " })!;
      assert.deepEqual(await supabase.rpc("crowd_reports_status", { a: 1 }), { ok: true });
      const [call] = fake.calls;
      assert.equal(call.path, "/rest/v1/rpc/crowd_reports_status");
      assert.equal(call.headers.apikey, "sb_secret_abc");
      assert.equal(call.headers.authorization, undefined, "a secret key isn't a JWT");
      assert.deepEqual(call.body, { a: 1 });

      // The older service_role key is a JWT, and goes in both headers.
      const legacy = supabaseFrom({ NEXT_PUBLIC_SUPABASE_URL: fake.url, SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOi.x.y" })!;
      await legacy.rpc("crowd_reports_status", {});
      assert.equal(fake.calls[1].headers.authorization, "Bearer eyJhbGciOi.x.y");
    } finally {
      await fake.close();
    }
  }),

  check("Supabase client: errors keep PostgREST's message and status; no answer is a 502", async () => {
    const fake = await fakeSupabase(({ path }) =>
      path.endsWith("broken")
        ? { status: 503, body: { message: "upstream unavailable", details: "p_lat = 13.7563" } }
        : { status: 404, body: { message: "Could not find the function public.missing" } },
    );
    try {
      const supabase = supabaseFrom({ SUPABASE_URL: fake.url, SUPABASE_SECRET_KEY: "sb_secret_abc" })!;
      await assert.rejects(supabase.rpc("broken", {}), (error: SupabaseError) => {
        assert.equal(error.status, 503);
        assert.equal(error.message, "broken answered 503: upstream unavailable");
        return true;
      });
      await assert.rejects(supabase.rpc("missing", {}), { status: 404 });
    } finally {
      await fake.close();
    }
    const gone = supabaseFrom({ SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SECRET_KEY: "sb_secret_abc" })!;
    await assert.rejects(gone.rpc("crowd_reports_status", {}), { status: 502 });
  }),

  check("Store: reads Supabase's answers, times as plain ISO, and drops rows it can't use", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const answers: Record<string, unknown> = {
      crowd_reports_in_box: {
        reports: [
          { id: "12", kind: "lightRain", lat: 13.76, lon: 100.5, time: "2026-10-05T22:55:54.095244+00:00" },
          { id: "13", kind: "hail", lat: 13.7, lon: 100.4, time: "2026-10-05T22:50:00+00:00" },
        ],
        cells: [],
      },
      submit_crowd_report: { ok: false, reason: "too_many" },
      crowd_reports_status: { live: 4, oldest: "2026-10-05T20:11:54.125327+00:00" },
    };
    const supabase: Supabase = {
      async rpc<T>(fn: string, args: Record<string, unknown>) {
        calls.push([fn, args]);
        return answers[fn] as T;
      },
    };
    const store = storeOn(supabase);
    const box = { west: 100.5, south: 13.75, east: 100.75, north: 14 };
    assert.deepEqual(await store.inBox(box, 200, 0.015625), {
      reports: [{ id: "12", kind: "lightRain", lat: 13.76, lon: 100.5, time: "2026-10-05T22:55:54.095Z" }],
      cells: [],
    });
    assert.deepEqual(calls[0], ["crowd_reports_in_box", { ...box, max_points: 200, cell: 0.015625 }]);

    answers.crowd_reports_in_box = {
      reports: [],
      cells: [
        { lat: 13.035, lon: 100.12, count: 5, kinds: { sunny: 2, heavyRain: 3 }, newest: "2026-10-05T22:59:00+00:00" },
      ],
    };
    assert.deepEqual((await store.inBox(box, 200, 0.5)).cells, [
      {
        lat: 13.035,
        lon: 100.12,
        count: 5,
        kinds: { sunny: 2, cloudy: 0, lightRain: 0, heavyRain: 3 },
        newest: "2026-10-05T22:59:00.000Z",
      },
    ]);

    assert.deepEqual(await store.submit("hash-of-a-phone-1234", "sunny", { lat: 13.7, lon: 100.5 }), {
      ok: false,
      reason: "too_many",
    });
    assert.deepEqual(calls.at(-1), [
      "submit_crowd_report",
      { p_reporter: "hash-of-a-phone-1234", p_kind: "sunny", p_lat: 13.7, p_lon: 100.5 },
    ]);
    answers.submit_crowd_report = {
      ok: true,
      replaced: 1,
      report: { id: "14", kind: "sunny", lat: 13.7, lon: 100.5, time: "2026-10-05T23:00:00+00:00" },
    };
    assert.deepEqual(await store.submit("hash-of-a-phone-1234", "sunny", { lat: 13.7, lon: 100.5 }), {
      ok: true,
      replaced: 1,
      report: { id: "14", kind: "sunny", lat: 13.7, lon: 100.5, time: "2026-10-05T23:00:00.000Z" },
    });
    assert.deepEqual(await store.status(), { live: 4, oldest: Date.parse("2026-10-05T20:11:54.125Z") });
  }),

  check(
    "GET: one tile's reports, kept 30 s at the edge; bad tiles, other sites and no Supabase are refused",
    async () => {
      const { routes, memory } = server();
      const ok = await routes.list(get("?tile=0.25,55,402"));
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("cache-control"), "public, max-age=15");
      assert.equal(
        ok.headers.get("vercel-cdn-cache-control"),
        "max-age=30, stale-while-revalidate=30, stale-if-error=600",
      );
      const body = (await ok.json()) as TileReports;
      assert.equal(body.reports[0].kind, "heavyRain");
      assert.deepEqual(memory.boxes[0], {
        box: { west: 100.5, south: 13.75, east: 100.75, north: 14 },
        maxPoints: MAX_POINTS,
        cell: 0.25 / CELLS_PER_SIDE,
      });

      // Typed in the address bar, or from a script: fine. Another site's page: no.
      assert.equal((await routes.list(get("?tile=1,13,100", {}))).status, 200);
      assert.equal((await routes.list(get("?tile=1,13,100", { "sec-fetch-site": "none" }))).status, 200);
      assert.equal((await routes.list(get("?tile=1,13,100", { "sec-fetch-site": "cross-site" }))).status, 403);
      for (const query of ["", "?tile=3,1,1", "?tile=15,6,0", "?tile=1,13"]) {
        const refused = await routes.list(get(query));
        assert.equal(refused.status, 400, query);
        assert.equal(refused.headers.get("cache-control"), "no-store");
      }
      const off = await server({ store: null }).routes.list(get("?tile=1,13,100"));
      assert.equal(off.status, 503);
      assert.deepEqual(await off.json(), { error: true, reason: "Shared reports are not set up" });
    },
  ),

  check("GET: Supabase failing is asked again once, then 502 with an alert; a 4xx isn't asked again", async () => {
    const once = server();
    once.memory.failWith(new SupabaseError(503, "crowd_reports_in_box answered 503: busy"));
    assert.equal((await once.routes.list(get("?tile=1,13,100"))).status, 200);
    assert.equal(once.memory.boxes.length, 2);
    assert.equal(once.alerts.length, 0);

    const twice = server();
    twice.memory.failWith(new SupabaseError(502, "no answer"), new SupabaseError(502, "no answer"));
    const down = await twice.routes.list(get("?tile=1,13,100"));
    assert.equal(down.status, 502);
    assert.equal(down.headers.get("cache-control"), "no-store");
    assert.deepEqual(twice.alerts, [{ kind: "error", api: "/api/reports", message: "502: no answer" }]);

    const missing = server();
    missing.memory.failWith(new SupabaseError(404, "crowd_reports_in_box answered 404: Could not find the function"));
    assert.equal((await missing.routes.list(get("?tile=1,13,100"))).status, 502);
    assert.equal(missing.memory.boxes.length, 1, "the migration hasn't been run: asking again won't help");
  }),

  check("POST: a report is saved under a keyed hash of the phone's id, never the id or address", async () => {
    const { routes, memory } = server();
    const sent = await routes.submit(post(report()));
    assert.equal(sent.status, 201);
    assert.equal(sent.headers.get("cache-control"), "no-store");
    const body = (await sent.json()) as { report: { id: string; kind: string }; replaced: number };
    assert.equal(body.report.kind, "lightRain");
    assert.equal(body.replaced, 0);

    await routes.submit(post(report({ kind: "heavyRain" })));
    await routes.submit(post(report({ device: "a-different-phone-0000" })));
    await routes.submit(post(report({ device: undefined })));
    await routes.submit(post(report({ device: "short" })));
    const [first, second, other, noDevice, badDevice] = memory.sent.map((s) => s.reporter);
    assert.equal(first, second, "the same phone is the same reporter");
    assert.notEqual(first, other);
    assert.equal(noDevice, badDevice, "without a usable id, the visitor's address is hashed instead");
    assert.notEqual(noDevice, first);
    for (const reporter of [first, other, noDevice]) {
      assert.equal(reporter.length, 32);
      assert.ok(!reporter.includes(DEVICE.slice(0, 8)) && !reporter.includes("203.0.113.9"));
    }
    assert.equal(
      first,
      reporterOf("test-key-not-a-secret", DEVICE, "198.51.100.1"),
      "the address doesn't matter with an id",
    );
    assert.notEqual(
      first,
      reporterOf("another-key", DEVICE, "203.0.113.9"),
      "without the key, the hash can't be matched",
    );
    assert.deepEqual(memory.sent[0].point, { lat: 13.7563, lon: 100.5018 }, "Supabase rounds it to 0.01°");
  }),

  check("POST: only DooFah's page, a real report, and Supabase's rules", async () => {
    const { routes, memory } = server();
    assert.equal((await routes.submit(post(report(), { "sec-fetch-site": "cross-site" }))).status, 403);
    assert.equal((await routes.submit(post(report(), { "sec-fetch-site": "" }))).status, 403);
    assert.equal((await routes.submit(post("not json"))).status, 400);
    for (const bad of [
      { kind: "hail" },
      { lat: 91 },
      { lon: -180.5 },
      { lat: "13.7" },
      { lat: null },
      { lon: undefined },
    ]) {
      assert.equal((await routes.submit(post(report(bad)))).status, 400, JSON.stringify(bad));
    }
    assert.equal((await routes.submit(post(JSON.stringify(report({ note: "x".repeat(2000) }))))).status, 413);
    assert.equal(memory.sent.length, 0, "nothing reached Supabase");

    memory.answerNext({ ok: false, reason: "too_many" });
    const tooMany = await routes.submit(post(report()));
    assert.equal(tooMany.status, 429);
    assert.match(((await tooMany.json()) as { reason: string }).reason, /6 reports this hour/);
    memory.answerNext({ ok: false, reason: "invalid" });
    assert.equal((await routes.submit(post(report()))).status, 400);

    assert.equal((await server({ store: null }).routes.submit(post(report()))).status, 503);
    assert.equal((await server({ reporterKey: undefined }).routes.submit(post(report()))).status, 503);
  }),

  check("POST: 30 an hour per visitor and server instance, then 429 until the hour has passed", async () => {
    let now = NOW;
    const { routes } = server({ now: () => now });
    for (let i = 0; i < 30; i++) assert.equal((await routes.submit(post(report()))).status, 201);
    assert.equal((await routes.submit(post(report()))).status, 429);
    assert.equal((await routes.submit(post(report(), { "x-forwarded-for": "198.51.100.7, 10.0.0.1" }))).status, 201);
    now += HOUR + 1;
    assert.equal((await routes.submit(post(report()))).status, 201);
  }),

  check("POST: Supabase failing is a 502 with an alert, and isn't sent twice", async () => {
    const memory = memoryStore();
    const alerts: Alert[] = [];
    let calls = 0;
    const store: ReportStore = {
      ...memory.store,
      async submit() {
        calls++;
        throw new SupabaseError(502, "no answer: timeout");
      },
    };
    const routes = reportsServer({ store, now: () => NOW, report: (a) => alerts.push(a), reporterKey: "k".repeat(20) });
    assert.equal((await routes.submit(post(report()))).status, 502);
    assert.equal(calls, 1);
    assert.deepEqual(alerts, [{ kind: "error", api: "POST /api/reports", message: "502: no answer: timeout" }]);
  }),

  check("Health: Supabase ok, its cleanup stopped (degraded), or not answering (down)", async () => {
    const healthy: Probes = {
      forecast: async () => {
        throw new Error("not checked here");
      },
      cyclones: async () => ({ run: "2026-10-05T12:00:00Z", storms: [] }) as never,
    };
    assert.equal((await runChecks(NOW, healthy)).length, 2, "no Supabase, no check");
    const at = (live: number, oldest: number | null) =>
      runChecks(NOW, { ...healthy, reports: async () => ({ live, oldest }) }).then((c) => c[2]);
    assert.deepEqual(
      [await at(0, null), await at(1, NOW - HOUR), await at(12, NOW - REPORTS_STALE_MS - 1)].map((c) => [
        c.status,
        c.detail,
      ]),
      [
        ["ok", "0 live reports"],
        ["ok", "1 live report"],
        ["degraded", "12 live reports; oldest row 3.5 h old: is the cleanup job (pg_cron) running?"],
      ],
    );
    const down = await runChecks(NOW, {
      ...healthy,
      reports: async () => {
        throw new SupabaseError(401, "crowd_reports_status answered 401: Invalid API key");
      },
    });
    assert.deepEqual(
      [down[2].name, down[2].status, down[2].detail],
      ["Shared reports (Supabase)", "down", "crowd_reports_status answered 401: Invalid API key"],
    );
  }),

  check("Migration: the same 3 hours, kinds and rules as the code; closed to the browser's keys", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    assert.equal(SHARED_REPORT_TTL_MS, 3 * HOUR);
    assert.match(sql, /crowd_report_ttl\(\)[\s\S]*?select interval '3 hours'/);
    const kinds = sql.match(/create type public\.report_kind as enum \(([^)]*)\)/)![1];
    assert.deepEqual(
      kinds.split(",").map((k) => k.trim().replace(/'/g, "")),
      [...REPORT_KINDS],
    );
    assert.match(sql, /round\(p_lon::numeric, 2\)/, "spots rounded to 0.01°");
    assert.match(sql, /interval '10 minutes'[\s\S]*st_dwithin\([^;]*, 1000\)/, "the replace rule: 10 minutes, 1 km");
    assert.match(sql, /if recent >= 6 then/, "6 an hour");
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on table public\.crowd_reports from anon, authenticated/);
    const fns = ["crowd_reports_in_box", "submit_crowd_report", "delete_old_crowd_reports", "crowd_reports_status"];
    const revoke = sql.match(/revoke execute on function([\s\S]*?)from public, anon, authenticated;/)![1];
    const grant = sql.match(/grant execute on function([\s\S]*?)to service_role;/)![1];
    for (const fn of fns) {
      assert.ok(revoke.includes(`public.${fn}(`), `${fn} closed to the browser`);
      assert.ok(grant.includes(`public.${fn}(`), `${fn} open to the server`);
    }
    assert.match(sql, /cron\.schedule\('doofah-delete-old-reports', '\*\/10 \* \* \* \*'/);
    // Every function pins its search path, as Supabase's linter asks.
    const defined = sql.match(/create or replace function/g)!.length;
    assert.equal(sql.match(/set search_path = ''/g)!.length, defined);
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
  console.log(`\nAll ${checks} shared report checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
