/**
 * Sanity and calibration checks for WeatherNext3MockService.
 * Run with: npm run verify:mock
 */
import assert from "node:assert/strict";
import {
  PLACES,
  WeatherNext3MockService,
  sampleGrid,
  type RadarLayerType,
  type WeatherCondition,
} from "../src/services/WeatherNext3MockService";

const NOW = Date.UTC(2026, 8, 30, 7, 20); // 30 Sep 2026, 14:20 in Bangkok
const svc = new WeatherNext3MockService({ latencyMs: 0, now: () => NOW });

function quantiles(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], p10: q(0.1), p50: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}
const fmt = (o: Record<string, number>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}=${v.toFixed(1)}`)
    .join(" ");

async function main() {
  // 1. Shapes and horizons -------------------------------------------------
  const bkk = PLACES[0];
  const bundle = await svc.getForecastBundle(bkk);
  assert.equal(bundle.hourly.length, 48);
  assert.equal(bundle.daily.length, 15, "15-day horizon");
  for (const day of bundle.daily) {
    assert.ok(day.hours.length >= 23 && day.hours.length <= 25, `24 hourly steps in ${day.date}`);
    assert.ok(day.minTempC <= day.maxTempC);
  }
  assert.ok(bundle.current.cell, "the simulation names its grid cell");
  assert.equal(bundle.current.cell.resolutionKm, 5);
  const [[s, w], [n, e]] = bundle.current.cell.bounds;
  const cellKmNS = (n - s) * 110.574;
  const cellKmEW = (e - w) * 111.32 * Math.cos((bkk.point.lat * Math.PI) / 180);
  assert.ok(Math.abs(cellKmNS - 5) < 0.01 && Math.abs(cellKmEW - 5) < 0.05, "cell is 5 km × 5 km");
  assert.ok(bkk.point.lat >= s && bkk.point.lat < n && bkk.point.lon >= w && bkk.point.lon < e);
  const hourSteps = bundle.hourly.slice(1).map((h, i) => Date.parse(h.time) - Date.parse(bundle.hourly[i].time));
  assert.ok(hourSteps.every((d) => d === 3_600_000), "1-hour steps");
  console.log(`✓ shapes: 48 hourly, 15 daily, cell ${bundle.current.cell.id} is ${cellKmNS.toFixed(2)}×${cellKmEW.toFixed(2)} km`);

  // 2. Determinism ----------------------------------------------------------
  const again = new WeatherNext3MockService({ latencyMs: 0, now: () => NOW });
  assert.deepEqual((await again.getForecastBundle(bkk)).hourly, bundle.hourly);
  console.log("✓ deterministic for a fixed seed and clock");

  // 3. Consistency between point series and radar grid ----------------------
  const p = bkk.point;
  const bounds: [[number, number], [number, number]] = [
    [p.lat - 1.2, p.lon - 1.2],
    [p.lat + 1.2, p.lon + 1.2],
  ];
  for (const layer of ["precipitation", "wind", "temperature", "pressure"] as RadarLayerType[]) {
    const t0 = performance.now();
    const set = await svc.getRadarFrames({ layer, bounds });
    const ms = performance.now() - t0;
    assert.equal(set.frames.length, 28, "past 3 h to +24 h = 28 frames");
    assert.equal(set.frames[3].offsetHours, 0);
    assert.equal(set.grid.cellSizeKm, 5);
    const f = set.frames[6]; // +3 h
    const hour = bundle.hourly[3];
    let gridValue: number;
    let pointValue: number;
    switch (f.layer) {
      case "precipitation":
        gridValue = sampleGrid(set.grid, f.rate, p.lat, p.lon);
        pointValue = hour.precipitationMm;
        break;
      case "wind":
        gridValue = sampleGrid(set.grid, f.speed, p.lat, p.lon);
        pointValue = hour.windSpeedKmh;
        break;
      case "temperature":
        gridValue = sampleGrid(set.grid, f.temperature, p.lat, p.lon);
        pointValue = hour.temperatureC;
        break;
      case "pressure":
        gridValue = sampleGrid(set.grid, f.pressure, p.lat, p.lon);
        pointValue = hour.pressureHpa;
        break;
    }
    const tolerance = layer === "precipitation" ? 1.5 : layer === "wind" ? 4 : 0.8;
    assert.ok(
      Math.abs(gridValue - pointValue) <= tolerance,
      `${layer}: grid ${gridValue.toFixed(2)} vs point ${pointValue} at +3 h`,
    );
    console.log(
      `✓ ${layer.padEnd(13)} ${set.grid.rows}×${set.grid.cols} cells × 28 frames in ${ms.toFixed(0)} ms; ` +
        `grid ${gridValue.toFixed(1)} ≈ point ${pointValue}; range ${set.range.min.toFixed(1)}…${set.range.max.toFixed(1)}`,
    );
  }

  // 4. Climate realism across the gazetteer over a year ---------------------
  const temps: Record<string, number[]> = {};
  const winds: number[] = [];
  const rain: number[] = [];
  const aqi: number[] = [];
  const conditions = new Map<WeatherCondition, number>();
  for (let day = 0; day < 365; day += 5) {
    for (let hour = 0; hour < 24; hour += 3) {
      const ms = Date.UTC(2026, 0, 1) + day * 86_400_000 + hour * 3_600_000;
      const clock = new WeatherNext3MockService({ latencyMs: 0, now: () => ms });
      for (const place of PLACES) {
        const sample = clock.sampleAt(place.point, ms);
        (temps[place.id] ??= []).push(sample.temperatureC);
        winds.push(sample.windSpeedKmh);
        rain.push(sample.precipitationMm);
        conditions.set(sample.condition, (conditions.get(sample.condition) ?? 0) + 1);
        if (hour === 6) aqi.push((await clock.getCurrentConditions(place)).airQuality!.aqi);
      }
    }
  }
  for (const id of ["bangkok", "chiang-mai", "singapore", "dubai", "tokyo", "london", "reykjavik", "sydney"]) {
    console.log(`  ${id.padEnd(10)} temp °C ${fmt(quantiles(temps[id]))}`);
  }
  console.log(`  wind km/h ${fmt(quantiles(winds))}`);
  const wetShare = rain.filter((r) => r >= 0.1).length / rain.length;
  console.log(`  rain ≥0.1 mm/h ${(wetShare * 100).toFixed(1)}% of hours; wet p90 ${quantiles(rain.filter((r) => r >= 0.1)).p90.toFixed(1)} mm/h`);
  console.log(`  AQI ${fmt(quantiles(aqi))}`);
  const total = [...conditions.values()].reduce((a, b) => a + b, 0);
  console.log(
    "  conditions " +
      [...conditions.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([c, k]) => `${c} ${((k / total) * 100).toFixed(1)}%`)
        .join(", "),
  );

  const median = (id: string) => quantiles(temps[id]).p50;
  assert.ok(median("bangkok") > 25 && median("bangkok") < 32, "Bangkok is hot");
  assert.ok(median("reykjavik") < 10, "Reykjavík is cold");
  assert.ok(median("london") > 5 && median("london") < 17, "London is mild");
  assert.ok(quantiles(winds).p50 > 5 && quantiles(winds).p50 < 25, "typical wind is breezy, not stormy");
  assert.ok(wetShare > 0.05 && wetShare < 0.3, "it rains some of the time");
  console.log("✓ climate ranges look realistic");

  // 5. Today in Bangkok -------------------------------------------------------
  const c = bundle.current;
  assert.ok(c.airQuality, "the simulation always has air quality");
  console.log(
    `\nBangkok now: ${c.sample.temperatureC}°C (feels ${c.sample.feelsLikeC}°C), ${c.sample.condition}, ` +
      `RH ${c.sample.humidity}%, wind ${c.sample.windSpeedKmh} km/h from ${c.sample.windDirectionDeg}°, ` +
      `${c.sample.pressureHpa} hPa, AQI ${c.airQuality.aqi} (${c.airQuality.category}), UV ${c.sample.uvIndex}, theme ${c.atmosphere}`,
  );
  console.log(`  nowcast: ${c.nowcast.summary}; sunrise ${c.sunrise} sunset ${c.sunset}`);
  for (const d of bundle.daily) {
    console.log(
      `  ${d.date} ${d.minTempC.toFixed(0).padStart(3)}–${d.maxTempC.toFixed(0).padEnd(3)} ${String(d.precipitationProbability).padStart(3)}% ${d.precipitationMm.toFixed(1).padStart(5)} mm  ${d.condition.padEnd(13)} ${d.summary}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
