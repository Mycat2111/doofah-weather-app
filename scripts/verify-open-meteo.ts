/**
 * Checks for Open-Meteo's air quality: the request, how its reply becomes
 * the card's AQI, and the server proxy for a commercial key. (Its ECMWF
 * forecast is checked with the unified forecast, in verify-forecast.ts.) Uses
 * replies built here in Open-Meteo's format, so it needs no network.
 * Run with: npm run verify:open-meteo
 */
import assert from "node:assert/strict";
import { airQualityFrom } from "../src/services/openmeteo/air";
import { AIR_VARIABLES, airQualityParams, type AirQualityResponse } from "../src/services/openmeteo/api";
import { proxyAirQuality } from "../src/services/openmeteo/proxy";
import { HOUR_MS } from "../src/services/weathernext3/time";
import { PLACES } from "../src/services/WeatherNext3MockService";

const NOW = Date.UTC(2026, 8, 30, 7, 20); // 30 Sep 2026, 14:20 in Bangkok
const MIN = 60_000;
const unix = (ms: number) => ms / 1000;
const bangkok = PLACES.find((p) => p.id === "bangkok")!;

const airReply = (fields: Partial<NonNullable<AirQualityResponse["current"]>> = {}): AirQualityResponse => ({
  current: {
    time: unix(NOW - 20 * MIN),
    interval: 3600,
    us_aqi: 162,
    us_aqi_pm2_5: 162,
    us_aqi_pm10: 88,
    us_aqi_ozone: 40,
    pm2_5: 76.44,
    pm10: 120.2,
    ozone: 80,
    ...fields,
  },
});

/** A fetch that answers from `answer` (or throws what it returns, if an Error) and records each URL. */
function fakeFetch(answer: (url: URL) => unknown) {
  const calls: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = answer(new URL(url));
    if (body instanceof Error) throw body;
    const status = (body as { error?: boolean })?.error ? 400 : 200;
    return Response.json(body, { status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

async function main() {
  // 1. The request -------------------------------------------------------------------
  const params = airQualityParams(bangkok);
  assert.equal(params.get("latitude"), "13.756");
  assert.equal(params.get("longitude"), "100.502");
  assert.equal(params.get("current"), AIR_VARIABLES.join(","));
  assert.equal(params.get("timezone"), "Asia/Bangkok");
  assert.equal(params.get("timeformat"), "unixtime");
  console.log("✓ air quality is asked for the place, now, to about 100 m");

  // 2. The card's AQI ----------------------------------------------------------------
  assert.deepEqual(airQualityFrom(airReply(), NOW), {
    aqi: 162,
    category: "Unhealthy",
    dominantPollutant: "pm25",
    pm25: 76.4,
    pm10: 120.2,
    o3: 41,
  });
  assert.equal(
    airQualityFrom(airReply({ us_aqi: 120, us_aqi_ozone: 120, us_aqi_pm2_5: 60 }), NOW)?.dominantPollutant,
    "o3",
  );
  assert.equal(airQualityFrom(airReply({ time: unix(NOW - 4 * HOUR_MS) }), NOW), null, "4 hours old is too old");
  assert.equal(airQualityFrom(airReply({ us_aqi: null }), NOW), null);
  assert.equal(airQualityFrom(null, NOW), null);
  console.log("✓ US AQI with its main pollutant; ozone in ppb; none when missing or old");

  // 3. The server proxy for a commercial key --------------------------------------------
  const upstream = fakeFetch((url) =>
    url.searchParams.get("latitude") === "0.000" ? { error: true, reason: "x" } : {},
  );
  const ask = (query: string, site: string | null = "same-origin") =>
    proxyAirQuality(
      new Request(`https://doofah.example/api/weather/air-quality?${query}`, {
        headers: site ? { "sec-fetch-site": site } : {},
      }),
      "SECRET",
      upstream.fetch,
    );
  const coords = "latitude=13.756&longitude=100.502";
  const noKey = await proxyAirQuality(
    new Request(`https://doofah.example/api/weather/air-quality?${coords}`),
    "",
    upstream.fetch,
  );
  assert.equal(noKey.status, 404, "no key, no proxy");
  assert.equal((await ask(coords, "cross-site")).status, 403, "other sites cannot spend the key");
  assert.equal((await ask("current=us_aqi")).status, 400, "coordinates needed");
  assert.equal((await ask("latitude=1,2&longitude=3,4")).status, 400, "one place at a time");
  assert.equal(upstream.calls.length, 0);
  const ok = await ask(`${params}&apikey=stolen&cell_selection=sea&hourly=temperature_2m`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("cache-control") ?? "", /s-maxage=300/);
  const sent = new URL(upstream.calls[0]);
  assert.equal(sent.origin, "https://customer-air-quality-api.open-meteo.com");
  assert.equal(sent.searchParams.get("apikey"), "SECRET", "the server's key, not the caller's");
  assert.equal(sent.searchParams.get("cell_selection"), null, "only the parameters DooFah uses");
  assert.equal(sent.searchParams.get("hourly"), null, "air quality only, no forecasts");
  assert.equal(sent.searchParams.get("current"), AIR_VARIABLES.join(","));
  assert.equal((await ask(coords, null)).status, 200, "requests without the header (older browsers) pass");
  const bad = await ask("latitude=0.000&longitude=0.000");
  assert.equal(bad.status, 400, "Open-Meteo's own errors come through");
  assert.equal(bad.headers.get("cache-control"), "no-store");
  const down = await proxyAirQuality(
    new Request(`https://doofah.example/api/weather/air-quality?${coords}`),
    "SECRET",
    fakeFetch(() => new TypeError("fetch failed")).fetch,
  );
  assert.equal(down.status, 502);
  console.log("✓ /api/weather/air-quality adds the key on the server, for DooFah's own pages only");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
