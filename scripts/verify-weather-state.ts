/**
 * Checks for the dashboard's one moment (step 3): the forecast as at a time
 * picked on the map's timeline (bundleAt), the radar frames made between the
 * hourly ones (interpolate.ts), and the timeline's words. Builds its data
 * here, so it needs no network.
 * Run with: npm run verify:weather-state
 */
import assert from "node:assert/strict";
import { advect, estimateFlow, frameBetween, frameFlow, frameSpan, lerp } from "../src/components/radar/interpolate";
import { frameAt, toStep } from "../src/hooks/useRadarFrames";
import { MESSAGES } from "../src/i18n/messages";
import { rainCountdown } from "../src/lib/rainCountdown";
import { bundleAt, forecastBundle } from "../src/services/forecast/bundle";
import { windParts, type ModelHour, type ModelSeries } from "../src/services/forecast/router";
import type { Model } from "../src/services/forecast/types";
import { getUnifiedForecast } from "../src/services/forecast/unified";
import type { AirQualityResponse } from "../src/services/openmeteo/api";
import { HOUR_MS, localDateKey } from "../src/services/weathernext3/time";
import {
  PLACES,
  WeatherNext3MockService,
  type PrecipitationFrame,
  type RadarFrameSet,
  type RadarLayerType,
  type TemperatureFrame,
} from "../src/services/WeatherNext3MockService";

const NOW = Date.UTC(2026, 9, 3, 7, 20); // 3 Oct 2026, 14:20 in Bangkok
const MIDNIGHT = Date.UTC(2026, 9, 2, 17); // 3 Oct, 00:00 in Bangkok
const MIN = 60_000;
const bangkok = PLACES.find((p) => p.id === "bangkok")!;
const local = (ms: number) => new Date(ms + 7 * HOUR_MS).toISOString().slice(11, 16);

/** A model's hours from `from`: a warm afternoon, rain from 17:00 to 19:00 today (Bangkok). */
function series(model: Model, from: number, count: number): ModelSeries {
  const wind = windParts(12, 225);
  const ecmwf = model === "ECMWF";
  const hours = Array.from({ length: count }, (_, i): ModelHour => {
    const time = from + i * HOUR_MS;
    const wave = Math.sin((2 * Math.PI * (((new Date(time).getUTCHours() + 7) % 24) - 9)) / 24);
    const mm = time >= MIDNIGHT + 17 * HOUR_MS && time < MIDNIGHT + 19 * HOUR_MS ? 3 : 0;
    return {
      time,
      temperatureC: Math.round((27 + 5 * wave) * 10) / 10,
      humidity: Math.round(78 - 12 * wave),
      dewPointC: ecmwf ? 23 : null,
      feelsLikeC: ecmwf ? Math.round((30 + 6 * wave) * 10) / 10 : null,
      pressureHpa: 1008,
      cloudCover: mm > 0 ? 95 : 30,
      rainMm: mm,
      rainChance: ecmwf ? (mm > 0 ? 75 : 10) : null,
      windU: wind.u,
      windV: wind.v,
      gustKmh: ecmwf ? 28 : null,
      visibilityKm: ecmwf ? 20 : null,
      uvIndex: null,
      thunder: 0,
    };
  });
  return { run: { model, init: null, resolution_km: ecmwf ? 9 : 3, source: ecmwf ? "open-meteo" : "tmd" }, hours };
}

const air: AirQualityResponse = {
  current: {
    time: (NOW - 20 * MIN) / 1000,
    interval: 3600,
    us_aqi: 120,
    us_aqi_pm2_5: 120,
    us_aqi_pm10: 60,
    us_aqi_ozone: 30,
    pm2_5: 43,
    pm10: 70,
    ozone: 60,
  },
};

/** Gaussian blobs on a grid, moved by (dx, dy) cells. */
function blobs(rows: number, cols: number, dx: number, dy: number): Float32Array {
  const out = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let v = 0;
      for (const [br, bc, s] of [
        [20, 25, 4],
        [40, 50, 6],
        [30, 60, 3],
      ]) {
        v += Math.exp(-((r - br - dy) ** 2 + (c - bc - dx) ** 2) / (2 * s * s));
      }
      out[r * cols + c] = v;
    }
  }
  return out;
}

const meanAbs = (a: Float32Array, b: Float32Array) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;

async function main() {
  // 1. The forecast as at another moment --------------------------------------------
  const unified = await getUnifiedForecast(bangkok.point.lat, bangkok.point.lon, NOW, {
    ecmwf: async () => ({ series: series("ECMWF", MIDNIGHT, 16 * 24), timeZone: "Asia/Bangkok" }),
    wrf: async (_, start) => ({ series: series("WRF", start, 47) }),
  });
  const bundle = forecastBundle(unified, air, bangkok, NOW);

  const at = NOW + 2 * HOUR_MS + 20 * MIN; // 16:40
  const here = bundleAt(bundle, at)!;
  assert.ok(here, "the forecast covers 16:40");
  assert.equal(here.current.forecastFor, new Date(at).toISOString());
  assert.equal(here.current.observedAt, here.current.forecastFor);
  assert.equal(bundle.current.forecastFor, undefined, "now is not marked");
  const [h16, h17] = bundle.hourly.filter((h) => ["16:00", "17:00"].includes(local(Date.parse(h.time))));
  const expected = Math.round((h16.temperatureC + (h17.temperatureC - h16.temperatureC) * (40 / 60)) * 10) / 10;
  assert.equal(here.current.sample.temperatureC, expected, "temperature between 16:00 and 17:00");
  assert.equal(local(Date.parse(here.hourly[0].time)), "16:00", "the hours start at the moment's hour");
  assert.equal(here.daily[0].date, "2026-10-03");
  assert.equal(here.current.modelUsed, "WRF");
  assert.ok(here.current.airQuality === null, "air quality is a reading for now, not 2 h 20 min later");
  assert.equal(bundleAt(bundle, NOW + 40 * MIN)!.current.airQuality?.aqi, 120, "within the hour it stays");
  assert.equal(local(Date.parse(here.current.nowcast.steps[0].time)), "16:40", "the countdown's bars start then");
  console.log("✓ the moment's conditions, hours, model and bars; AQI only near now");

  const countdown = rainCountdown(here.current, here.hourly, here.daily);
  assert.equal(countdown.kind, "later");
  assert.ok(countdown.kind === "later" && countdown.soon && local(Date.parse(countdown.at)) === "17:00");
  const raining = bundleAt(bundle, NOW + 3 * HOUR_MS)!; // 17:20
  const wet = rainCountdown(raining.current, raining.hourly, raining.daily);
  assert.ok(
    wet.kind === "raining" && wet.until && local(Date.parse(wet.until)) === "19:00",
    "raining then, until 19:00",
  );
  assert.equal(raining.current.atmosphere, "rain", "and the sky shows it");
  console.log("✓ the rain countdown counts from the moment: rain around 17:00, then raining until 19:00");

  const tomorrow = bundleAt(bundle, MIDNIGHT + 33 * HOUR_MS)!; // 4 Oct, 09:00
  assert.equal(tomorrow.daily[0].date, "2026-10-04", "a moment tomorrow starts the days tomorrow");
  assert.equal(tomorrow.current.sunrise, tomorrow.daily[0].sunrise);
  assert.equal(tomorrow.current.sample.isDay, true);
  assert.equal(bundleAt(bundle, MIDNIGHT - HOUR_MS), null, "yesterday is not in the forecast");
  console.log("✓ tomorrow's moment reads tomorrow's day and sun; times outside the forecast give none");

  // The simulation answers from the model behind its radar.
  const sim = new WeatherNext3MockService({ latencyMs: 0, now: () => NOW });
  const simBundle = await sim.getForecastBundle(bangkok);
  const simAt = bundleAt(simBundle, at, {
    sample: sim.sampleAt(bangkok.point, at),
    nowcast: sim.nowcastAt(bangkok.point, at),
  })!;
  assert.equal(simAt.current.sample.time, new Date(at).toISOString());
  assert.equal(simAt.current.nowcast.steps.length, 13);
  assert.equal(simAt.current.nowcast.steps[1].time, new Date(at + 10 * MIN).toISOString(), "10-minute radar steps");
  assert.deepEqual(sim.nowcastAt(bangkok.point, NOW).steps.slice(1), simBundle.current.nowcast.steps.slice(1));
  console.log("✓ the simulation's moment comes from its model, with its 10-minute nowcast");

  // 2. Frames between the hours -------------------------------------------------------
  const times = [0, HOUR_MS, 2 * HOUR_MS];
  assert.deepEqual(frameSpan(times, -5), { index: 0, t: 0 });
  assert.deepEqual(frameSpan(times, 1.5 * HOUR_MS), { index: 1, t: 0.5 });
  assert.deepEqual(frameSpan(times, 2 * HOUR_MS), { index: 2, t: 0 });
  assert.equal(toStep(NOW + 4 * MIN), NOW, "steps of 10 minutes");
  assert.equal(toStep(NOW + 6 * MIN), NOW + 10 * MIN);

  const [rows, cols] = [60, 80];
  const a = blobs(rows, cols, 0, 0);
  const b = blobs(rows, cols, 3, -2);
  const flow = estimateFlow(rows, cols, a, b, 8);
  for (const k of [20 * cols + 25, 40 * cols + 50, 30 * cols + 60]) {
    assert.ok(Math.abs(flow.dx[k] - 3) < 0.5 && Math.abs(flow.dy[k] + 2) < 0.5, `motion (3, −2) found at cell ${k}`);
  }
  const truth = blobs(rows, cols, 1.5, -1);
  const moved = meanAbs(advect(a, b, flow, 0.5), truth);
  const faded = meanAbs(lerp(a, b, 0.5), truth);
  assert.ok(moved < faded / 5, `half way, moved (${moved.toFixed(4)}) beats a cross-fade (${faded.toFixed(4)})`);
  console.log("✓ rain blobs moving 3 cells east and 2 north are tracked, and the half-way frame has them half way");

  // On the simulation: its rain drifts west on the trade winds, 14 km/h.
  const set = await sim.getRadarFrames({
    layer: "precipitation" as RadarLayerType,
    bounds: [
      [13.2, 100.0],
      [14.3, 101.1],
    ],
    fromOffsetHours: 0,
    toOffsetHours: 3,
    maxCellsPerSide: 110,
  });
  const [f0, f1] = set.frames as PrecipitationFrame[];
  const simFlow = frameFlow(set.grid, f0, f1);
  assert.ok(simFlow, "the simulation's rain moves");
  let east = 0;
  let wetCells = 0;
  f0.rate.forEach((v, i) => {
    if (v > 0.5) {
      east += simFlow.dx[i];
      wetCells++;
    }
  });
  const kmh = (east / wetCells) * set.grid.cellSizeKm;
  assert.ok(kmh < -8 && kmh > -20, `rain drifts west at ${kmh.toFixed(1)} km/h`);
  const half = frameBetween(f0, f1, 0.5, Date.parse(f0.time) + 30 * MIN, simFlow) as PrecipitationFrame;
  assert.equal(half.offsetHours, 0.5);
  assert.equal(half.time, new Date(Date.parse(f0.time) + 30 * MIN).toISOString());
  assert.equal(frameBetween(f0, f1, 0, 0, simFlow), f0, "on the hour, the model's own frame");
  assert.equal(frameAt(set, Date.parse(f1.time)), f1);
  assert.equal((frameAt(set, Date.parse(f0.time) + 30 * MIN) as PrecipitationFrame).rate.length, f0.rate.length);
  console.log(
    `✓ the simulation's rain is tracked drifting west (${kmh.toFixed(1)} km/h) and frames are made between hours`,
  );

  // Fields that have nothing to do with each other barely slide: they mostly cross-fade.
  const noise = (seed: number, scale: number) => {
    const out = new Float32Array(f0.rate.length);
    let x = seed;
    for (let i = 0; i < out.length; i++) out[i] = ((x = (x * 16807) % 2147483647) / 2147483647) * scale;
    return out;
  };
  for (const seed of [7, 99, 1234]) {
    const unrelated = frameFlow(
      set.grid,
      { ...f0, rate: noise(seed, 5), cloud: noise(seed + 1, 1) },
      { ...f1, rate: noise(seed + 2, 5), cloud: noise(seed + 3, 1) },
    );
    const drift = unrelated
      ? unrelated.dx.reduce((sum, v, i) => sum + Math.hypot(v, unrelated.dy[i]), 0) / unrelated.dx.length
      : 0;
    assert.ok(drift < 0.5, `unrelated fields drift ${drift.toFixed(2)} cells, under half a cell`);
  }
  const temp = (await sim.getRadarFrames({
    ...set,
    layer: "temperature",
    bounds: set.grid.bounds,
  })) as RadarFrameSet<"temperature">;
  const [t0, t1] = temp.frames;
  assert.equal(frameFlow(temp.grid, t0, t1), null, "temperature blends");
  const mid = frameBetween(t0, t1, 0.25, 0, null) as TemperatureFrame;
  assert.ok(Math.abs(mid.temperature[5] - (t0.temperature[5] + (t1.temperature[5] - t0.temperature[5]) * 0.25)) < 1e-4);
  console.log("✓ changes no motion explains mostly cross-fade; temperature, pressure and wind blend");

  // 3. The timeline's and card's words ------------------------------------------------
  const { en, th } = MESSAGES;
  assert.equal(en.radar.offset(160), "+2 h 40 min");
  assert.equal(en.radar.offset(-20), "−20 min");
  assert.equal(en.radar.offset(60), "+1 h");
  assert.equal(th.radar.offset(160), "+2 ชม. 40 นาที");
  assert.equal(en.hero.forecastFor("16:40", 0, "Sat"), "Forecast for 16:40");
  assert.equal(en.hero.forecastFor("09:00", 1, "Sun"), "Forecast for tomorrow 09:00");
  assert.equal(th.hero.forecastFor("16:40", 0, "เสาร์"), "พยากรณ์เวลา 16:40 น.");
  assert.equal(th.hero.forecastFor("09:00", 1, "อาทิตย์"), "พยากรณ์พรุ่งนี้ 09:00 น.");
  assert.equal(localDateKey(MIDNIGHT + 33 * HOUR_MS, "Asia/Bangkok"), "2026-10-04");
  console.log("✓ “+2 h 40 min”, “Forecast for tomorrow 09:00” and their Thai");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
