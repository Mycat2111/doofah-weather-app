/**
 * Checks for the live forecast on the screens: /api/forecast's reply as the
 * dashboard, a favorite's chip and a road trip's stops (bundle.ts and
 * ForecastService), the model tags, the hourly rain countdown and the copy
 * saved for offline use. Builds the replies here, so it needs no network.
 * Run with: npm run verify:forecast-service
 */
import assert from "node:assert/strict";
import { RAIN_LIKELY, rainCountdown } from "../src/lib/rainCountdown";
import { forecastBundle, sampleAt, spotFrom } from "../src/services/forecast/bundle";
import { ForecastError, ForecastService } from "../src/services/forecast/ForecastService";
import { forecastQuery } from "../src/services/forecast/point";
import { windParts, type ModelHour, type ModelSeries } from "../src/services/forecast/router";
import type { Model, ModelUsed, UnifiedForecast } from "../src/services/forecast/types";
import { getUnifiedForecast, type ForecastSources } from "../src/services/forecast/unified";
import type { AirQualityResponse } from "../src/services/openmeteo/api";
import { weatherSimulation } from "../src/services/simulation/SimulatedWeatherService";
import { PLACES } from "../src/services/weather/places";
import { floorToHour, HOUR_MS, localDateKey } from "../src/services/weather/time";
import type { Place, SpotWeather } from "../src/services/weather/types";
import { weatherService } from "../src/services/weatherService";

const NOW = Date.UTC(2026, 9, 2, 9, 20); // 2 Oct 2026, 16:20 in Bangkok
const START = floorToHour(NOW);
const MIDNIGHT = Date.UTC(2026, 9, 1, 17); // 2 Oct, 00:00 in Bangkok
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const round1 = (v: number) => Math.round(v * 10) / 10;
const place = (id: string) => PLACES.find((p) => p.id === id)!;
const bangkok = place("bangkok");

type Rain = (time: number) => number;
const dry: Rain = () => 0;
/** Rain in the hours from START + `from` h up to START + `to` h. */
const rainBetween =
  (from: number, to: number, mm = 2.5): Rain =>
  (t) =>
    t >= START + from * HOUR_MS && t < START + to * HOUR_MS ? mm : 0;

/**
 * One model's hours from `from`: a warm afternoon, rain where `rain` says.
 * ECMWF gives its own chance of rain (from `chance`), gusts and visibility;
 * WRF, as from TMD, gives none of them.
 */
function series(model: Model, from: number, count: number, rain: Rain, chance?: (mm: number) => number): ModelSeries {
  const wind = windParts(12, 225);
  const ecmwf = model === "ECMWF";
  const hours = Array.from({ length: count }, (_, i): ModelHour => {
    const time = from + i * HOUR_MS;
    const wave = Math.sin((2 * Math.PI * (((new Date(time).getUTCHours() + 7) % 24) - 9)) / 24);
    const mm = rain(time);
    return {
      time,
      temperatureC: round1(27 + 5 * wave + (ecmwf ? 0 : 1)),
      humidity: Math.round(78 - 12 * wave),
      dewPointC: ecmwf ? 23 : null,
      feelsLikeC: ecmwf ? round1(30 + 6 * wave) : null,
      pressureHpa: 1008,
      cloudCover: mm > 0 ? 95 : 45,
      rainMm: mm,
      rainChance: ecmwf ? (chance ?? ((v) => (v > 0 ? 75 : 15)))(mm) : null,
      windU: wind.u,
      windV: wind.v,
      gustKmh: ecmwf ? 28 : null,
      visibilityKm: ecmwf ? 20 : null,
      uvIndex: null,
      thunder: mm >= 4 ? 1 : 0,
    };
  });
  return {
    run: { model, init: null, resolution_km: ecmwf ? 9 : 3, source: ecmwf ? "open-meteo" : "tmd" },
    hours,
  };
}

interface Setup {
  ecmwf?: Rain;
  /** WRF's rain, or null for no WRF (no token, or outside Thailand). */
  wrf?: Rain | null;
  chance?: (mm: number) => number;
  at?: number;
}

/** What /api/forecast answers for `p` with these models: 16 days of ECMWF, and WRF's 47 hours from now. */
function unified(p: Place, { ecmwf = dry, wrf = dry, chance, at = NOW }: Setup = {}): Promise<UnifiedForecast> {
  const sources: ForecastSources = {
    ecmwf: async () => ({ series: series("ECMWF", MIDNIGHT, 16 * 24, ecmwf, chance), timeZone: "Asia/Bangkok" }),
    wrf: async (_, start) => (wrf ? { series: series("WRF", start, 47, wrf) } : { missing: "not-configured" }),
  };
  return getUnifiedForecast(p.point.lat, p.point.lon, at, sources);
}

const airReply = (fields: Partial<NonNullable<AirQualityResponse["current"]>> = {}): AirQualityResponse => ({
  current: {
    time: (NOW - 20 * MIN) / 1000,
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

/** localStorage stand-in. */
function memoryStorage(failWrites = false) {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("QuotaExceededError");
      items.set(key, value);
    },
    removeItem: (key: string) => void items.delete(key),
  };
}

/**
 * A fetch that answers /api/forecast from `forecasts` (by its query) and air
 * quality with `air`, records each URL and how many were asked at once.
 * An Error answer is thrown; `{ status, body }` is sent as is.
 */
function fakeFetch(forecasts: (query: string) => unknown, air: () => unknown = () => airReply(), delayMs = 0) {
  const calls: string[] = [];
  let open = 0;
  let mostAtOnce = 0;
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "https://doofah.test");
    calls.push(String(input));
    open++;
    mostAtOnce = Math.max(mostAtOnce, open);
    try {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const answer = url.pathname === "/api/forecast" ? forecasts(url.search.slice(1)) : air();
      if (answer instanceof Error) throw answer;
      const sent = answer as { status?: number; body?: unknown };
      if (sent && typeof sent.status === "number") return Response.json(sent.body, { status: sent.status });
      return Response.json(answer);
    } finally {
      open--;
    }
  }) as typeof globalThis.fetch;
  return { fetch, calls, mostAtOnce: () => mostAtOnce };
}

/** The chip's fields of a sample. */
const chip = (s: SpotWeather): SpotWeather => ({
  time: s.time,
  temperatureC: s.temperatureC,
  precipitationMm: s.precipitationMm,
  precipitationProbability: s.precipitationProbability,
  condition: s.condition,
  isDay: s.isDay,
});

async function main() {
  // 1. The dashboard from /api/forecast's reply ------------------------------------
  const withWrf = await unified(bangkok, { wrf: rainBetween(1, 3), ecmwf: rainBetween(5, 6) });
  const bundle = forecastBundle(withWrf, airReply(), bangkok, NOW);
  const { current, hourly, daily } = bundle;
  assert.equal(current.source, "live");
  assert.equal(current.cell, null);
  assert.equal(current.observedAt, iso(NOW));
  assert.equal(current.savedAt, undefined);
  assert.equal(current.airQuality?.aqi, 162);
  assert.equal(hourly.length, 48, "48 hours from this hour");
  assert.equal(hourly[0].time, iso(START));
  assert.deepEqual(
    hourly.slice(0, 3).map((h) => h.leadHours),
    [0, 1, 2],
  );
  assert.ok(
    hourly.every((h) => h.confidence === null),
    "a live forecast has no simulated confidence",
  );
  assert.equal(daily[0].date, "2026-10-02", "days from today, in Bangkok");
  assert.equal(daily.length, 15);
  for (const day of daily) {
    assert.equal(day.hours.length, 24, `${day.date} has its 24 hours`);
    assert.ok(day.hours.every((h) => localDateKey(Date.parse(h.time), "Asia/Bangkok") === day.date));
  }
  // Now is between 16:00 and 17:00: the temperature a third of the way, the rain and the icon of the hour.
  const [h16, h17] = [daily[0].hours[16], daily[0].hours[17]];
  assert.equal(current.sample.temperatureC, round1(h16.temperatureC + (h17.temperatureC - h16.temperatureC) / 3));
  assert.equal(current.sample.precipitationMm, h16.precipitationMm);
  assert.equal(current.sample.condition, h16.condition);
  // The countdown's bars, every 10 minutes, carry the rain of their hour: dry to 17:00, then WRF's 2.5 mm.
  const bars = current.nowcast.steps;
  assert.equal(bars.length, 13);
  assert.equal(bars[0].time, iso(NOW));
  assert.deepEqual(
    bars.map((s) => s.precipitationMm),
    [0, 0, 0, 0, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5],
  );
  console.log(`✓ the dashboard: now, 48 hours and 15 days from one reply; the bars an hour at a time`);

  // 2. Each hour, day and the card say which model they come from ------------------------
  assert.equal(current.modelUsed, "WRF");
  assert.deepEqual(current.models, ["WRF", "ECMWF"]);
  const tags = hourly.map((h) => h.modelUsed!);
  const runs = tags.filter((tag, i) => tag !== tags[i - 1]);
  assert.deepEqual(runs, ["WRF", "WRF+ECMWF", "ECMWF"], "WRF, easing into ECMWF, then ECMWF");
  assert.equal(tags.lastIndexOf("WRF"), 40, "WRF alone to hour 40 with TMD's 47 hours,");
  assert.equal(tags.indexOf("ECMWF"), 46, "then easing into ECMWF over hours 41 to 45");
  assert.deepEqual(
    daily.slice(0, 4).map((d) => d.modelUsed),
    withWrf.days.slice(0, 4).map((d) => d.model_used),
  );
  assert.ok(daily.every((d) => d.confidence === null));
  const ecmwfOnly = forecastBundle(await unified(bangkok, { wrf: null }), null, bangkok, NOW);
  assert.equal(ecmwfOnly.current.modelUsed, "ECMWF");
  assert.deepEqual(ecmwfOnly.current.models, ["ECMWF"], "the footer credits TMD only when WRF is in the forecast");
  assert.ok(ecmwfOnly.hourly.every((h) => h.modelUsed === ("ECMWF" satisfies ModelUsed)));
  assert.equal(ecmwfOnly.current.airQuality, null, "no air quality reply, none shown");
  console.log(`✓ model tags: ${runs.join(" → ")} by the hour, the card and the days; ECMWF alone when WRF is missing`);

  // 3. The chance of rain: ECMWF's own, WRF's from its rain --------------------------------
  assert.deepEqual(
    hourly.slice(0, 4).map((h) => h.precipitationProbability),
    [10, 80, 80, 10],
    "WRF: 10% dry, 80% for 2.5 mm",
  );
  const late = hourly.find((h) => h.modelUsed === "ECMWF")!;
  assert.equal(late.precipitationProbability, 15, "ECMWF's own (its ensemble's) chance");
  console.log("✓ the chance of rain: ECMWF's own; WRF's from its own rain while it leads");

  // 4. A favorite's chip shows what its dashboard shows -------------------------------------
  const thai = PLACES.filter((p) => p.country === "Thailand").slice(0, 6);
  for (const p of thai) {
    const forecast = await unified(p, { wrf: rainBetween(0, 2, 0.4), ecmwf: rainBetween(0, 8, 3) });
    for (const at of [NOW, NOW + 7 * MIN, NOW + 41 * MIN]) {
      const dashboard = forecastBundle(forecast, null, p, at).current.sample;
      assert.deepEqual(spotFrom(forecast, p.point, at), chip(dashboard), `${p.id} at ${iso(at)}`);
    }
    // And a stop on a road trip reads the same hours as the dashboard's strip.
    const trip = NOW + 5.5 * HOUR_MS;
    const strip = forecastBundle(forecast, null, p, NOW).hourly;
    assert.deepEqual(spotFrom(forecast, p.point, trip), chip(sampleAt(strip, trip, p.point)), `${p.id} on a trip`);
  }
  assert.throws(() => spotFrom(withWrf, bangkok.point, MIDNIGHT + 20 * 24 * HOUR_MS), /does not cover/);
  console.log(`✓ a favorite's chip and a trip's stop read what the dashboard reads (${thai.length} places)`);

  // 5. The service: one request per place, reused, air quality alongside ---------------------
  let clock = NOW;
  const replies = new Map<string, UnifiedForecast>();
  for (const p of PLACES.slice(0, 13)) replies.set(forecastQuery(p.point), await unified(p, { wrf: null }));
  const net = fakeFetch((query) => replies.get(query) ?? { status: 404, body: { error: true, reason: "Not here" } });
  const service = new ForecastService({ fetch: net.fetch, now: () => clock, storage: null });
  const live = await service.getForecastBundle(bangkok);
  assert.deepEqual(net.calls.slice(0, 1), ["/api/forecast?lat=13.76&lon=100.50"]);
  assert.ok(net.calls[1].startsWith("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=13.756&"));
  assert.equal(net.calls.length, 2);
  assert.equal(live.current.airQuality?.aqi, 162);
  // The chip for the dashboard's place, at the dashboard's time: the same reply, the same numbers.
  const [chipNow] = await service.getWeatherAlong([{ point: bangkok.point, time: live.current.observedAt }]);
  assert.equal(net.calls.length, 2, "the chip reuses the dashboard's forecast");
  assert.deepEqual(chipNow, chip(live.current.sample));
  clock += 4 * MIN;
  await service.getForecastBundle(bangkok);
  assert.equal(net.calls.length, 2, "the same request within 5 minutes is not sent again");
  clock += 2 * MIN;
  await service.getForecastBundle(bangkok);
  assert.equal(net.calls.length, 4, "after 5 minutes it is");

  const slow = fakeFetch((query) => replies.get(query), undefined, 5);
  const stops = PLACES.slice(0, 13).map((p, i) => ({ point: p.point, time: iso(NOW + i * 20 * MIN) }));
  const along = await new ForecastService({ fetch: slow.fetch, now: () => NOW, storage: null }).getWeatherAlong([
    ...stops,
    stops[0],
  ]);
  assert.equal(along.length, 14);
  assert.equal(slow.calls.length, 13, "each place once");
  assert.equal(slow.mostAtOnce(), 4, "4 at a time");
  assert.deepEqual(along[13], along[0], "in the order asked");
  assert.equal(along[3].time, stops[3].time);

  const viaServer = fakeFetch((query) => replies.get(query));
  await new ForecastService({
    airProxy: true,
    fetch: viaServer.fetch,
    now: () => NOW,
    storage: null,
  }).getForecastBundle(bangkok);
  assert.ok(viaServer.calls[1].startsWith("/api/weather/air-quality?latitude=13.756&longitude=100.502&"));

  const noAir = fakeFetch(
    (query) => replies.get(query),
    () => new TypeError("fetch failed"),
  );
  const withoutAir = await new ForecastService({ fetch: noAir.fetch, now: () => NOW, storage: null }).getForecastBundle(
    bangkok,
  );
  assert.equal(withoutAir.current.airQuality, null, "the forecast still shows when air quality fails");

  const down = fakeFetch(() => ({ status: 502, body: { error: true, reason: "ECMWF unavailable: timeout" } }));
  await assert.rejects(
    new ForecastService({ fetch: down.fetch, now: () => NOW, storage: null }).getForecastBundle(bangkok),
    (e: unknown) => e instanceof ForecastError && e.status === 502 && e.message === "ECMWF unavailable: timeout",
  );
  const empty = fakeFetch(() => ({ hours: "none" }));
  await assert.rejects(
    new ForecastService({ fetch: empty.fetch, now: () => NOW, storage: null }).getForecastBundle(bangkok),
    (e: unknown) => e instanceof ForecastError && e.message === "The forecast came back empty",
  );
  const broken = fakeFetch(() => ({ status: 500, body: null }));
  await assert.rejects(
    new ForecastService({ fetch: broken.fetch, now: () => NOW, storage: null }).getForecastBundle(bangkok),
    (e: unknown) => e instanceof ForecastError && e.message === "/api/forecast answered 500",
  );
  console.log("✓ /api/forecast once per place (4 at a time), reused for 5 minutes; air quality free or via the server");

  // 6. Offline --------------------------------------------------------------------------------
  const storage = memoryStorage();
  storage.items.set("doofah-saved-forecasts", "{}");
  await new ForecastService({ fetch: net.fetch, now: () => NOW, storage }).getForecastBundle(bangkok);
  assert.equal(storage.items.has("doofah-saved-forecasts"), false, "the old copies (Open-Meteo's replies) go");
  const savedText = storage.items.get("doofah-offline-forecasts")!;
  assert.ok(savedText.includes('"lat=13.76&lon=100.50"'));
  const offline = fakeFetch(() => new TypeError("Failed to fetch"));
  const later = NOW + 2 * HOUR_MS;
  const saved = await new ForecastService({ fetch: offline.fetch, now: () => later, storage }).getForecastBundle(
    bangkok,
  );
  assert.equal(saved.current.savedAt, iso(NOW), "says when it was downloaded");
  assert.equal(saved.current.observedAt, iso(later));
  assert.equal(saved.hourly[0].time, iso(floorToHour(later)), "the hours start at the hour it is now");
  assert.equal(saved.hourly[0].leadHours, 0);
  assert.equal(saved.current.airQuality?.aqi, 162, "with the saved air quality while it is recent");
  const stale = await new ForecastService({
    fetch: offline.fetch,
    now: () => NOW + 4 * HOUR_MS,
    storage,
  }).getForecastBundle(bangkok);
  assert.equal(stale.current.airQuality, null, "but not air quality 4 hours old");
  await assert.rejects(
    new ForecastService({ fetch: offline.fetch, now: () => NOW + 49 * HOUR_MS, storage }).getForecastBundle(bangkok),
    TypeError,
    "a forecast saved over 2 days ago is not shown",
  );
  await assert.rejects(
    new ForecastService({ fetch: offline.fetch, now: () => NOW, storage: memoryStorage() }).getForecastBundle(bangkok),
    TypeError,
    "nothing saved: the error",
  );
  const many = memoryStorage();
  for (const [i, p] of PLACES.slice(0, 8).entries()) {
    await new ForecastService({ fetch: net.fetch, now: () => NOW + i * MIN, storage: many }).getForecastBundle(p);
  }
  const kept = Object.keys(JSON.parse(many.items.get("doofah-offline-forecasts")!));
  assert.equal(kept.length, 6, "6 places at most");
  assert.ok(!kept.includes(forecastQuery(bangkok.point)), "the oldest go first");
  const size = many.items.get("doofah-offline-forecasts")!.length;
  assert.ok(size < 2_000_000, `6 places fit well inside localStorage's 5 MB (${size} characters)`);
  await new ForecastService({ fetch: net.fetch, now: () => NOW, storage: memoryStorage(true) }).getForecastBundle(
    bangkok,
  );
  console.log(
    `✓ offline: the last forecast for 6 places (${Math.round(savedText.length / 1000)} kB each), up to 2 days old`,
  );

  // 7. The rain countdown names hours ------------------------------------------------------------
  const countdownFor = async (setup: Setup) => {
    const b = forecastBundle(await unified(bangkok, setup), null, bangkok, NOW);
    return rainCountdown(b.current, b.hourly, b.daily, NOW);
  };
  assert.deepEqual(await countdownFor({ wrf: rainBetween(0, 3) }), {
    kind: "raining",
    intensity: "moderate",
    until: iso(START + 3 * HOUR_MS),
    precise: false,
  });
  assert.deepEqual(await countdownFor({ wrf: rainBetween(1, 2) }), {
    kind: "later",
    at: iso(START + HOUR_MS),
    chance: 80,
    clear: false,
    soon: true,
  });
  const inFive = await countdownFor({ wrf: rainBetween(5, 6, 0.3) });
  assert.deepEqual(inFive, { kind: "later", at: iso(START + 5 * HOUR_MS), chance: 60, clear: false });
  // ECMWF's showers that its ensemble isn't sure of: rain possible, with its chance.
  const possible = await countdownFor({ wrf: null, ecmwf: rainBetween(1, 2, 0.2), chance: (mm) => (mm ? 35 : 10) });
  assert.equal(possible.kind === "later" && possible.chance, 35);
  assert.ok(possible.kind === "later" && possible.chance < RAIN_LIKELY && possible.soon);
  const none = await countdownFor({});
  assert.equal(none.kind, "dry");
  console.log("✓ the countdown, an hour at a time: raining until 19:00, rain at 17:00, possible at 35%, dry");

  // 8. Which service the page uses ------------------------------------------------------------------
  const sim = weatherService({ source: "simulated", proxy: false });
  assert.equal(sim.source, "simulated");
  assert.equal(weatherService({ source: "simulated", proxy: false }), sim);
  const [first] = PLACES;
  assert.equal(sim.momentAt?.(first.point, Date.now()), null, "the simulation is loaded only once it is asked for");
  assert.equal((await sim.getForecastBundle(first)).current.source, "simulated");
  const moment = Date.now() + 90 * 60_000;
  assert.deepEqual(sim.momentAt?.(first.point, moment)?.sample, weatherSimulation.sampleAt(first.point, moment));
  const page = weatherService({ source: "live", proxy: false });
  assert.ok(page instanceof ForecastService);
  assert.equal(page.source, "live");
  assert.equal(weatherService({ source: "live", proxy: false }), page, "one service for the page, so its reuse works");
  assert.notEqual(weatherService({ source: "live", proxy: true }), page);
  console.log("✓ the page uses the live forecast, one service per setup; the simulation with ?data=sim");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
