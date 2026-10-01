/**
 * Checks for WeatherNext 3's nowcast: the percentile maths, the hour
 * alignment, the settings, the BigQuery query, and /api/weathernext with a
 * stand-in BigQuery and Open-Meteo (nothing here reaches Google).
 * Run with: npm run verify:weathernext
 */
import assert from "node:assert/strict";
import {
  cellKey,
  chanceOfRain,
  hoursFromOpenMeteo,
  hoursFromWeatherNext,
  inThailand,
  nowcastByHour,
  readNowcast,
  snapToCell,
  type Nowcast,
  type WeatherNextRow,
} from "../src/services/weathernext/nowcast";
import {
  classifyError,
  isOwnerCookie,
  isWeatherNextOwner,
  nowcastQuery,
  ownerCookieValue,
  OWNER_COOKIE,
  parseServiceAccountKey,
  QUERIES_PER_HOUR,
  readConfig,
  weatherNextServer,
  type Env,
  type Warehouse,
  type WarehouseQuery,
} from "../src/services/weathernext/server";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 1, 13, 20); // 1 Oct 2026, 20:20 in Bangkok
const START = Date.UTC(2026, 9, 1, 13, 0);
const PEM = "-----BEGIN PRIVATE KEY-----\nMIIEfake\n-----END PRIVATE KEY-----\n";
const KEY = {
  type: "service_account",
  project_id: "doofah-weather",
  client_email: "wn@doofah-weather.iam.gserviceaccount.com",
  private_key: PEM,
};
const TOKEN = "owner-token-that-is-long-enough-123";
const ENV: Env = {
  GCP_SERVICE_ACCOUNT_KEY: JSON.stringify(KEY),
  GCP_PROJECT_ID: "doofah-weather",
  GCP_WEATHERNEXT_DATASET: "weathernext",
  WEATHERNEXT_OWNER_TOKEN: TOKEN,
};
const BANGKOK = { lat: 13.7563, lon: 100.5018 };

async function main() {
  // 1. Cells and Thailand ------------------------------------------------------
  assert.deepEqual(snapToCell(BANGKOK.lat, BANGKOK.lon), { lat: 13.8, lon: 100.5 });
  assert.deepEqual(snapToCell(-0.04, 179.96), { lat: -0, lon: 180 });
  assert.equal(cellKey({ lat: 13.8, lon: 100.5 }), "13.8,100.5");
  assert.ok(inThailand({ lat: 13.8, lon: 100.5 }));
  assert.ok(inThailand({ lat: 20.4, lon: 99.9 }), "Chiang Rai");
  assert.ok(inThailand({ lat: 6.0, lon: 101.9 }), "Narathiwat");
  assert.ok(!inThailand({ lat: 35.7, lon: 139.7 }), "Tokyo");
  assert.ok(!inThailand({ lat: -6.2, lon: 106.8 }), "Jakarta");
  console.log("✓ cells and the Thailand box");

  // 2. Chance of rain from the percentiles ------------------------------------
  assert.deepEqual(chanceOfRain([0, 0, 0, 0, 0]), { chance: 0.1, bound: "at-most" });
  assert.deepEqual(chanceOfRain([0.2, 0.5, 1, 2, 4]), { chance: 0.9, bound: "at-least" });
  // p75 = 0.05, p90 = 0.4: 0.1 mm lies 1/7 of the way from p75 to p90.
  assert.deepEqual(chanceOfRain([0, 0, 0, 0.05, 0.4]), { chance: 0.23, bound: "about" });
  assert.deepEqual(chanceOfRain([0, 0, 0.1, 0.5, 2]), { chance: 0.5, bound: "about" }, "exactly the median");
  // A percentile below the one before it is held up to it.
  assert.deepEqual(chanceOfRain([0, 0.3, 0.2, 0.5, 1]), chanceOfRain([0, 0.3, 0.3, 0.5, 1]));
  assert.deepEqual(chanceOfRain([0, null, 0, 0, 1]), { chance: null, bound: "about" });
  assert.deepEqual(chanceOfRain([0, 0, 0]), { chance: null, bound: "about" });
  for (let i = 0; i < 200; i++) {
    const q = Array.from({ length: 5 }, (_, k) => ((i * 7 + k * 13) % 23) / 10).sort((a, b) => a - b);
    const { chance } = chanceOfRain(q);
    assert.ok(chance !== null && chance >= 0.1 && chance <= 0.9, `chance in range for ${q}`);
  }
  console.log("✓ chance of rain from percentiles");

  // 3. WeatherNext 3's rows, aligned like DooFah's hours ----------------------
  const row = (hoursAhead: number, mm: number): WeatherNextRow => ({
    timeMs: START + hoursAhead * HOUR,
    mean: mm / 1000,
    p10: 0,
    p25: 0,
    p50: mm / 2000,
    p75: mm / 1000,
    p90: (mm * 2) / 1000,
  });
  const rows = [1, 2, 3, 4, 5, 6, 7].map((h) => row(h, h));
  const hours = hoursFromWeatherNext(rows, NOW)!;
  assert.equal(hours.length, 6);
  assert.equal(hours[0].time, new Date(START).toISOString(), "starts at this hour");
  // Hour T reads the row for T + 1 h (the rain of the hour before its time).
  assert.equal(hours[0].meanMm, 1);
  assert.equal(hours[0].p90Mm, 2);
  assert.equal(hours[5].meanMm, 6);
  assert.equal(hours[0].p50Mm, 0.5);
  assert.equal(
    hoursFromWeatherNext(
      rows.filter((r) => r.timeMs !== START + 4 * HOUR),
      NOW,
    ),
    null,
    "a missing hour",
  );
  const negative = hoursFromWeatherNext(
    rows.map((r) => ({ ...r, mean: -0.00001 })),
    NOW,
  )!;
  assert.equal(negative[0].meanMm, 0, "no negative rain");
  console.log("✓ WeatherNext 3 hours");

  // 4. Open-Meteo's, aligned the same way --------------------------------------
  const om = {
    hourly: {
      time: Array.from({ length: 8 }, (_, k) => (START + k * HOUR) / 1000),
      precipitation: [9, 1, 2, 3, 4, 5, 6, 7],
      precipitation_probability: [99, 10, 20, 30, 40, 50, 60, 70],
    },
  };
  const omHours = hoursFromOpenMeteo(om, NOW)!;
  assert.equal(omHours[0].meanMm, 1, "hour T reads T + 1 h");
  assert.equal(omHours[0].chance, 0.1);
  assert.equal(omHours[5].chance, 0.6);
  assert.equal(omHours[0].p90Mm, null);
  assert.equal(hoursFromOpenMeteo({ hourly: { ...om.hourly, time: om.hourly.time.slice(0, 5) } }, NOW), null);
  console.log("✓ Open-Meteo hours");

  // 5. What the browser accepts -------------------------------------------------
  const good: Nowcast = {
    source: "weathernext3",
    cell: { lat: 13.8, lon: 100.5 },
    hours,
    generatedAt: new Date(NOW).toISOString(),
  };
  assert.ok(readNowcast(JSON.parse(JSON.stringify(good))));
  assert.equal(readNowcast({ ...good, source: "google" }), null);
  assert.equal(readNowcast({ ...good, hours: [{ ...hours[0], chance: "high" }] }), null);
  assert.equal(readNowcast({ error: true }), null);
  assert.equal(readNowcast(null), null);
  const strip = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ time: new Date(START + k * HOUR).toISOString() })) as never[];
  assert.equal(nowcastByHour(good, strip).size, 6);
  assert.equal(nowcastByHour({ ...good, source: "open-meteo" }, strip).size, 0, "Open-Meteo isn't highlighted");
  console.log("✓ the browser's check");

  // 6. Settings ----------------------------------------------------------------
  assert.ok(parseServiceAccountKey(JSON.stringify(KEY)));
  assert.ok(parseServiceAccountKey(Buffer.from(JSON.stringify(KEY)).toString("base64")), "base64");
  const escaped = parseServiceAccountKey(JSON.stringify({ ...KEY, private_key: PEM.replace(/\n/g, "\\n") }));
  assert.equal(escaped?.private_key, PEM, "literal \\n become line breaks");
  assert.equal(parseServiceAccountKey(JSON.stringify({ ...KEY, type: "authorized_user" })), null);
  assert.equal(parseServiceAccountKey("not json"), null);
  assert.equal(parseServiceAccountKey(undefined), null);
  const config = readConfig(ENV);
  assert.ok(config.ok);
  assert.equal(config.config.table, "doofah-weather.weathernext.weathernext_3_0_0_0p1deg");
  assert.equal(config.config.rainVariable, "total_precipitation_1hr");
  assert.equal(config.config.maxBytes, 1_000_000_000);
  const other = readConfig({ ...ENV, GCP_WEATHERNEXT_DATASET: "other-project.wn", WEATHERNEXT_MAX_GB: "2.5" });
  assert.ok(
    other.ok && other.config.table === "other-project.wn.weathernext_3_0_0_0p1deg" && other.config.maxBytes === 2.5e9,
  );
  const problem = (env: Env) => {
    const r = readConfig(env);
    return r.ok ? null : r.problem;
  };
  assert.match(problem({ ...ENV, GCP_SERVICE_ACCOUNT_KEY: undefined })!, /GCP_SERVICE_ACCOUNT_KEY is not set/);
  assert.match(problem({ ...ENV, GCP_SERVICE_ACCOUNT_KEY: "{}" })!, /not a service account/);
  assert.match(problem({ ...ENV, GCP_WEATHERNEXT_DATASET: "" })!, /GCP_WEATHERNEXT_DATASET/);
  assert.match(problem({ ...ENV, GCP_WEATHERNEXT_DATASET: "wn`; DROP TABLE x; --" })!, /GCP_WEATHERNEXT_DATASET/);
  assert.match(problem({ ...ENV, GCP_PROJECT_ID: "Bad_Project" })!, /GCP_PROJECT_ID/);
  assert.match(
    problem({ ...ENV, WEATHERNEXT_RAIN_VARIABLE: "total_precipitation_1hr_p50 FROM x" })!,
    /WEATHERNEXT_RAIN_VARIABLE/,
  );
  assert.match(problem({ ...ENV, WEATHERNEXT_MAX_GB: "lots" })!, /WEATHERNEXT_MAX_GB/);
  assert.ok(readConfig({ ...ENV, GCP_PROJECT_ID: undefined }).ok, "the key's project_id is enough");
  for (const env of [ENV, { ...ENV, GCP_SERVICE_ACCOUNT_KEY: "{}" }]) {
    const r = readConfig(env);
    assert.ok(!JSON.stringify(r.ok ? {} : r).includes("PRIVATE KEY"), "problems never quote the key");
  }
  console.log("✓ settings");

  // 7. The query ---------------------------------------------------------------
  assert.ok(config.ok);
  const query = nowcastQuery(
    { ...config.config, rainVariable: "imerg_tp_1hr" },
    { lat: 13.8, lon: 100.5 },
    START - HOUR,
    NOW,
  );
  assert.match(query.sql, /FROM `doofah-weather\.weathernext\.weathernext_3_0_0_0p1deg` AS t, t\.forecast AS f/);
  assert.match(query.sql, /WHERE t\.init_time = @init/, "the partition filter");
  assert.match(query.sql, /f\.imerg_tp_1hr_p90 AS p90_m/);
  assert.ok(!/SELECT \*|f\.\*/.test(query.sql), "names only the columns it reads");
  assert.deepEqual((query.params.init as Date).getTime(), START - HOUR);
  assert.deepEqual((query.params.from as Date).getTime(), START);
  assert.deepEqual((query.params.to as Date).getTime(), START + 7 * HOUR);
  assert.equal(query.types.init, "TIMESTAMP");
  console.log("✓ the BigQuery query");

  // 8. The route ------------------------------------------------------------------
  let clock = NOW;
  const omCalls: string[] = [];
  let omOk = true;
  const fetcher = (async (input: string | URL) => {
    omCalls.push(String(input));
    if (!omOk) return new Response("down", { status: 503 });
    return Response.json(om);
  }) as typeof fetch;

  /** A stand-in BigQuery: runs from `newest` back hold data; `cells` near the point. */
  function fakeWarehouse(opts: {
    newest: number;
    bytes?: number;
    rows?: (q: WarehouseQuery) => Record<string, unknown>[];
    fail?: Error;
  }) {
    const calls = { estimates: 0, rows: 0, maxBytes: [] as number[] };
    const warehouse: Warehouse = {
      async estimateBytes(q) {
        calls.estimates++;
        if (opts.fail) throw opts.fail;
        return (q.params.init as Date).getTime() <= opts.newest ? (opts.bytes ?? 4e8) : 0;
      },
      async rows(q, maxBytes) {
        calls.rows++;
        calls.maxBytes.push(maxBytes);
        if (opts.rows) return opts.rows(q);
        // Two cells: the nearer one has 1 mm more an hour than the farther one.
        return [0, 1].flatMap((far) =>
          rows.map((r) => ({
            time_ms: r.timeMs,
            cell_lat: far ? 13.9 : 13.8,
            cell_lon: 100.5,
            distance_m: far ? 9000 : 400,
            mean_m: r.mean! + (far ? 0 : 0.001),
            p10_m: r.p10,
            p25_m: r.p25,
            p50_m: r.p50,
            p75_m: r.p75,
            p90_m: r.p90,
          })),
        );
      },
    };
    return { warehouse, calls };
  }

  const request = (query: string, init: { site?: string | null; cookie?: string } = {}) =>
    new Request(`https://doofah.example/api/weathernext?${query}`, {
      headers: {
        ...(init.site === null ? {} : { "sec-fetch-site": init.site ?? "same-origin" }),
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
    });
  const ownerCookie = `${OWNER_COOKIE}=${ownerCookieValue(TOKEN)}`;
  const bkk = `lat=${BANGKOK.lat}&lon=${BANGKOK.lon}`;

  {
    const fake = fakeWarehouse({ newest: START - HOUR });
    const server = weatherNextServer({ env: ENV, warehouse: async () => fake.warehouse, fetcher, now: () => clock });

    const foreign = await server.handle(request(bkk, { site: null }));
    assert.equal(foreign.status, 403, "not from a DooFah page");
    assert.equal((await server.handle(request("lat=abc&lon=1"))).status, 400);
    assert.equal((await server.handle(request("lon=100"))).status, 400);

    // Everyone but the owner: Open-Meteo, cached by Vercel for an hour; BigQuery never asked.
    const pub = await server.handle(request(bkk));
    const pubBody = (await pub.json()) as Nowcast;
    assert.equal(pub.status, 200);
    assert.equal(pub.headers.get("cache-control"), "public, s-maxage=3600, stale-while-revalidate=600");
    assert.equal(pubBody.source, "open-meteo");
    assert.equal(pubBody.reason, "not-owner");
    assert.equal(pubBody.detail, undefined);
    assert.match(omCalls[0], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=13\.8&longitude=100\.5&/);
    assert.equal(fake.calls.estimates + fake.calls.rows, 0);

    // Asking as the owner without the cookie: Open-Meteo, never kept by anyone.
    const locked = await server.handle(request(`${bkk}&owner=1`));
    assert.equal(((await locked.json()) as Nowcast).reason, "locked");
    assert.equal(locked.headers.get("cache-control"), "private, no-store");
    const forged = await server.handle(request(`${bkk}&owner=1`, { cookie: `${OWNER_COOKIE}=${"0".repeat(64)}` }));
    assert.equal(((await forged.json()) as Nowcast).reason, "locked");
    assert.equal(fake.calls.estimates, 0);

    // The owner: WeatherNext 3 from the newest run that has arrived, nearest cell.
    const mine = await server.handle(request(`${bkk}&owner=1`, { cookie: `theme=dark; ${ownerCookie}` }));
    const body = (await mine.json()) as Nowcast;
    assert.equal(mine.status, 200);
    assert.equal(body.source, "weathernext3");
    assert.equal(body.initTime, new Date(START - HOUR).toISOString(), "the run that has arrived");
    assert.deepEqual(body.cell, { lat: 13.8, lon: 100.5 }, "the nearest cell");
    assert.equal(body.hours.length, 6);
    assert.equal(body.hours[0].meanMm, 2, "the nearest cell's numbers");
    assert.equal(mine.headers.get("cache-control"), "private, max-age=2400", "kept until the hour ends");
    assert.equal(mine.headers.get("vary"), "Cookie");
    assert.equal(fake.calls.rows, 1);
    assert.deepEqual(fake.calls.maxBytes, [1e9], "BigQuery refuses anything over the cap");
    assert.ok(!JSON.stringify(body).includes("PRIVATE KEY"));

    // Asked again this hour: from memory.
    clock = NOW + 10 * 60_000;
    await server.handle(request(`${bkk}&owner=1`, { cookie: ownerCookie }));
    assert.equal(fake.calls.rows, 1, "no second query this hour");
    // Next hour: asked again.
    clock = NOW + HOUR;
    const later = (await (await server.handle(request(`${bkk}&owner=1`, { cookie: ownerCookie }))).json()) as Nowcast;
    assert.equal(fake.calls.rows, 2);
    assert.equal(later.hours[0].time, new Date(START + HOUR).toISOString());
    clock = NOW;

    // Outside Thailand: Open-Meteo, BigQuery not asked.
    const tokyo = (await (
      await server.handle(request("lat=35.68&lon=139.69&owner=1", { cookie: ownerCookie }))
    ).json()) as Nowcast;
    assert.equal(tokyo.reason, "outside-thailand");
    assert.equal(fake.calls.rows, 2);
  }
  console.log("✓ the route: who gets what, and caching");

  {
    // A missing setting: the owner is told which.
    const server = weatherNextServer({
      env: { ...ENV, GCP_WEATHERNEXT_DATASET: undefined },
      fetcher,
      now: () => clock,
    });
    const r = await server.handle(request(`${bkk}&owner=1`, { cookie: ownerCookie }));
    const body = (await r.json()) as Nowcast;
    assert.equal(body.reason, "not-configured");
    assert.match(body.detail!, /GCP_WEATHERNEXT_DATASET/);
    assert.equal(r.headers.get("cache-control"), "private, max-age=300");
    // Without the owner token nothing can be unlocked, and nothing is said.
    const none = weatherNextServer({ env: { ...ENV, WEATHERNEXT_OWNER_TOKEN: "short" }, fetcher, now: () => clock });
    const noneBody = (await (await none.handle(request(`${bkk}&owner=1`, { cookie: ownerCookie }))).json()) as Nowcast;
    assert.equal(noneBody.reason, "not-configured");
    assert.equal(noneBody.detail, undefined);
  }
  {
    // Too costly: refused before anything is billed.
    const fake = fakeWarehouse({ newest: START, bytes: 5e9 });
    const server = weatherNextServer({ env: ENV, warehouse: async () => fake.warehouse, fetcher, now: () => clock });
    const body = (await (await server.handle(request(`${bkk}&owner=1`, { cookie: ownerCookie }))).json()) as Nowcast;
    assert.equal(body.source, "open-meteo");
    assert.equal(body.reason, "too-costly");
    assert.match(body.detail!, /5\.00 GB/);
    assert.equal(fake.calls.rows, 0);
  }
  {
    // No run in the last hours.
    const fake = fakeWarehouse({ newest: START - 30 * HOUR });
    const server = weatherNextServer({ env: ENV, warehouse: async () => fake.warehouse, fetcher, now: () => clock });
    const body = (await (await server.handle(request(`${bkk}&owner=1`, { cookie: ownerCookie }))).json()) as Nowcast;
    assert.equal(body.reason, "no-data");
    assert.equal(fake.calls.rows, 0);
  }
  {
    // The newest run has no rows yet: the one before it is used.
    const fake = fakeWarehouse({
      newest: START,
      rows: (q) => ((q.params.init as Date).getTime() === START ? [] : defaultRows()),
    });
    const server = weatherNextServer({ env: ENV, warehouse: async () => fake.warehouse, fetcher, now: () => clock });
    const body = (await (await server.handle(request(`${bkk}&owner=1`, { cookie: ownerCookie }))).json()) as Nowcast;
    assert.equal(body.source, "weathernext3");
    assert.equal(body.initTime, new Date(START - HOUR).toISOString());
    assert.equal(fake.calls.rows, 2);
  }
  {
    // BigQuery refuses (a wrong column, no permission...): Open-Meteo, and the owner sees why.
    const fake = fakeWarehouse({
      newest: START,
      fail: new Error("Access Denied: Table doofah-weather:weathernext.x: User does not have permission"),
    });
    const server = weatherNextServer({ env: ENV, warehouse: async () => fake.warehouse, fetcher, now: () => clock });
    const r = await server.handle(request(`${bkk}&owner=1`, { cookie: ownerCookie }));
    const body = (await r.json()) as Nowcast;
    assert.equal(body.reason, "error");
    assert.match(body.detail!, /Access Denied/);
    assert.equal(r.headers.get("cache-control"), "private, max-age=300");
    // And when Open-Meteo is down too: a plain error, never cached.
    omOk = false;
    const server2 = weatherNextServer({
      env: ENV,
      warehouse: async () => fake.warehouse,
      fetcher,
      now: () => clock + 1,
    });
    const both = await server2.handle(request(`lat=14.0&lon=100.6&owner=1`, { cookie: ownerCookie }));
    assert.equal(both.status, 502);
    assert.equal(both.headers.get("cache-control"), "no-store");
    omOk = true;
  }
  {
    // A budget of queries an hour.
    const fake = fakeWarehouse({ newest: START });
    const server = weatherNextServer({ env: ENV, warehouse: async () => fake.warehouse, fetcher, now: () => clock });
    const reasons: (string | undefined)[] = [];
    for (let i = 0; i <= QUERIES_PER_HOUR; i++) {
      const lat = (14 + i / 10).toFixed(1);
      const body = (await (
        await server.handle(request(`lat=${lat}&lon=100.5&owner=1`, { cookie: ownerCookie }))
      ).json()) as Nowcast;
      reasons.push(body.reason);
    }
    assert.equal(fake.calls.rows, QUERIES_PER_HOUR);
    assert.equal(reasons.at(-1), "busy");
  }
  {
    // Two requests for the same cell at once share one query.
    const fake = fakeWarehouse({ newest: START });
    const server = weatherNextServer({ env: ENV, warehouse: async () => fake.warehouse, fetcher, now: () => clock });
    await Promise.all([1, 2, 3].map(() => server.handle(request(`${bkk}&owner=1`, { cookie: ownerCookie }))));
    assert.equal(fake.calls.rows, 1);
  }
  assert.equal(
    classifyError(new Error("Query exceeded limit for bytes billed: 1000000000. 5000000000 or higher required."))
      .reason,
    "too-costly",
  );
  console.log("✓ the route: failures fall back to Open-Meteo");

  // 9. Unlocking the owner's browser ---------------------------------------------
  {
    const server = weatherNextServer({ env: ENV, fetcher, now: () => clock });
    const access = (q: string, ip = "1.2.3.4") =>
      server.access(
        new Request(`https://doofah.example/api/weathernext/access?${q}`, { headers: { "x-forwarded-for": ip } }),
      );
    const wrong = access("token=guess");
    assert.equal(wrong.status, 403);
    assert.equal(wrong.headers.get("set-cookie"), null);
    const right = access(`token=${encodeURIComponent(TOKEN)}`);
    assert.equal(right.status, 303);
    assert.equal(right.headers.get("location"), "/");
    const cookie = right.headers.get("set-cookie")!;
    assert.match(cookie, /^doofah-wn=[0-9a-f]{64}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure$/);
    assert.ok(!cookie.includes(TOKEN), "the cookie holds a hash, not the token");
    const value = cookie.split(";")[0].split("=")[1];
    assert.ok(isOwnerCookie(value, ENV));
    assert.ok(isWeatherNextOwner(value, ENV));
    assert.ok(!isWeatherNextOwner(value, { ...ENV, GCP_SERVICE_ACCOUNT_KEY: undefined }), "not until it's all set up");
    assert.ok(
      !isOwnerCookie(value, { ...ENV, WEATHERNEXT_OWNER_TOKEN: `${TOKEN}x` }),
      "a new token locks old browsers out",
    );
    const off = access("off");
    assert.equal(off.status, 303);
    assert.match(off.headers.get("set-cookie")!, /^doofah-wn=; Path=\/; Max-Age=0/);
    for (let i = 0; i < 10; i++) access("token=nope", "5.6.7.8");
    assert.equal(access("token=nope", "5.6.7.8").status, 429, "guessing is slowed down");
    const unset = weatherNextServer({ env: { ...ENV, WEATHERNEXT_OWNER_TOKEN: undefined } });
    assert.equal(unset.access(new Request("https://doofah.example/api/weathernext/access?token=x")).status, 404);
  }
  console.log("✓ unlocking the owner's browser");

  console.log("\nall WeatherNext 3 checks passed");
}

/** The rows of a run with data, nearest cell only. */
function defaultRows() {
  return [1, 2, 3, 4, 5, 6, 7].map((h) => ({
    time_ms: START + h * HOUR,
    cell_lat: 13.8,
    cell_lon: 100.5,
    distance_m: 400,
    mean_m: h / 1000,
    p10_m: 0,
    p25_m: 0,
    p50_m: h / 2000,
    p75_m: h / 1000,
    p90_m: (h * 2) / 1000,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
