/**
 * Checks for the unified forecast: the ECMWF request, WRF from TMD, the
 * router's rules, the 48-hour blend, the condition rule (rain from the map's
 * first rain colour), the days and /api/forecast. Uses replies built here in
 * Open-Meteo's and TMD's formats, so it needs no network.
 * Run with: npm run verify:forecast
 */
import assert from "node:assert/strict";
import { PRECIP_SCALE } from "../src/components/radar/colorScales";
import {
  CUSTOMER_URL,
  FREE_URL,
  HOURLY_VARIABLES,
  OpenMeteoError,
  type ForecastResponse,
} from "../src/services/openmeteo/api";
import {
  conditionFrom,
  HEAVY_MM,
  isWet,
  RAIN_MM,
  rainChanceFrom,
  WET_MM,
  type ConditionInputs,
} from "../src/services/forecast/condition";
import { ecmwfFromOpenMeteo, ecmwfParams, fetchEcmwf } from "../src/services/forecast/ecmwf";
import { forecastResponse } from "../src/services/forecast/http";
import {
  BLEND_HOURS,
  routeHours,
  weightsAt,
  windFrom,
  windParts,
  WRF_HOURS,
  wrfEnd,
  type ModelHour,
  type ModelSeries,
} from "../src/services/forecast/router";
import {
  fetchWrf,
  inTmdArea,
  TMD_FIELDS,
  TMD_HOURS,
  TMD_URL,
  TmdError,
  tmdUrl,
  wrfFromTmd,
  type TmdReply,
} from "../src/services/forecast/tmd";
import type { UnifiedForecast, UnifiedHour } from "../src/services/forecast/types";
import {
  defaultSources,
  getUnifiedForecast,
  snapPoint,
  type ForecastSources,
  type WrfAnswer,
} from "../src/services/forecast/unified";
import { dewPoint, feelsLike, uvIndex } from "../src/services/weathernext3/fieldModel";
import { sunElevation } from "../src/services/weathernext3/solar";
import { HOUR_MS, localDateKey } from "../src/services/weathernext3/time";

const NOW = Date.UTC(2026, 9, 2, 9, 20); // 2 Oct 2026, 16:20 in Bangkok
const START = Date.UTC(2026, 9, 2, 9); // the hour the forecast counts from
const MIDNIGHT = Date.UTC(2026, 9, 1, 17); // 2 Oct, 00:00 in Bangkok
const DAYS_ASKED = 16;
const BANGKOK = snapPoint(13.7563, 100.5018);
const iso = (ms: number) => new Date(ms).toISOString();
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Open-Meteo's reply for `models=ecmwf_ifs` at Bangkok: afternoon storms every other day, dawn fog on odd days. */
function ecmwfReply(): ForecastResponse {
  const n = DAYS_ASKED * 24;
  const index = Array.from({ length: n }, (_, i) => i);
  const localHour = (i: number) => i % 24;
  const day = (i: number) => Math.floor(i / 24);
  const wave = (i: number) => Math.sin((2 * Math.PI * (localHour(i) - 9)) / 24);
  // Each record's rain is for the hour before it: records 16–18 hold the rain of 15:00–18:00.
  const rain = (i: number) =>
    day(i) % 2 === 0 ? (({ 16: 2.5, 17: 6, 18: 0.4 } as Record<number, number>)[localHour(i)] ?? 0) : 0;
  const foggy = (i: number) => day(i) % 2 === 1 && (localHour(i) === 5 || localHour(i) === 6);
  const cloud = (i: number) => (localHour(i) >= 14 && localHour(i) <= 19 ? 90 : foggy(i) ? 96 : 40);
  return {
    latitude: 13.75,
    longitude: 100.5,
    utc_offset_seconds: 7 * 3600,
    timezone: "Asia/Bangkok",
    hourly: {
      time: index.map((i) => (MIDNIGHT + i * HOUR_MS) / 1000),
      temperature_2m: index.map((i) => round1(26 + 5 * wave(i))),
      relative_humidity_2m: index.map((i) => Math.round(80 - 15 * wave(i))),
      dew_point_2m: index.map(() => 22),
      apparent_temperature: index.map((i) => round1(28 + 5 * wave(i))),
      precipitation: index.map(rain),
      precipitation_probability: index.map((i) => (rain(i) > 0 ? 70 : 15)),
      weather_code: index.map((i) => (rain(i) >= 6 ? 95 : rain(i) > 0 ? 61 : foggy(i) ? 45 : cloud(i) >= 78 ? 3 : 2)),
      pressure_msl: index.map((i) => round1(1009 - 1.5 * Math.sin((2 * Math.PI * (localHour(i) - 4)) / 12))),
      cloud_cover: index.map(cloud),
      visibility: index.map((i) => (foggy(i) ? 600 : 24_000)),
      wind_speed_10m: index.map(() => 12),
      wind_direction_10m: index.map(() => 225),
      wind_gusts_10m: index.map(() => 25),
      uv_index: index.map(() => null),
    },
  };
}

/** A made-up WRF run from `from` to `to`: 3 °C warmer than ECMWF, its own rain, a west wind, few extras. */
function wrfRun(ecmwf: ModelSeries, from: number, to: number): ModelSeries {
  const hours = ecmwf.hours
    .filter((h) => h.time >= from && h.time <= to)
    .map((h): ModelHour => {
      const wind = windParts(18, 270);
      const lead = Math.round((h.time - START) / HOUR_MS);
      return {
        time: h.time,
        temperatureC: (h.temperatureC ?? 0) + 3,
        humidity: (h.humidity ?? 0) - 5,
        dewPointC: null,
        feelsLikeC: null,
        pressureHpa: (h.pressureHpa ?? 0) - 2,
        cloudCover: 60,
        rainMm: lead % 12 === 0 ? 3 : 0,
        rainChance: null,
        windU: wind.u,
        windV: wind.v,
        gustKmh: null,
        visibilityKm: null,
        uvIndex: null,
        thunder: 0,
      };
    });
  return { run: { model: "WRF", init: iso(START - 6 * HOUR_MS), resolution_km: 3, source: "test" }, hours };
}

/** TMD's reply for `count` hours from `from`: times in Thai time, a thunderstorm in the fourth record. */
function tmdReply(
  from: number,
  count: number,
  change: (i: number) => Record<string, number | string> = () => ({}),
): TmdReply {
  const thai = (ms: number) => new Date(ms + 7 * HOUR_MS).toISOString().replace(".000Z", "+07:00");
  return {
    WeatherForecasts: [
      {
        location: { lat: 13.76, lon: 100.5 },
        forecasts: Array.from({ length: count }, (_, i) => ({
          time: thai(from + i * HOUR_MS),
          data: {
            tc: 30 + (i % 5),
            rh: 70,
            slp: 1008.5,
            rain: i === 3 ? 5.2 : 0,
            ws10m: 5,
            wd10m: 90,
            cloudlow: 50,
            cloudmed: 20,
            cloudhigh: 0,
            cond: i === 3 ? 8 : 2,
            ...change(i),
          },
        })),
      },
    ],
  };
}

/** Runs `work` without its console.error lines (the server logs why WRF is missing). */
async function quiet<T>(work: () => Promise<T>): Promise<T> {
  const error = console.error;
  console.error = () => {};
  try {
    return await work();
  } finally {
    console.error = error;
  }
}

function sources(wrf: (ecmwf: ModelSeries) => Promise<WrfAnswer> = async () => ({ missing: "not-configured" })) {
  const answer = ecmwfFromOpenMeteo(ecmwfReply());
  const used: ForecastSources = { ecmwf: async () => answer, wrf: () => wrf(answer.series) };
  return { sources: used, ecmwf: answer.series };
}

const lead = (h: UnifiedHour) => h.lead_hours;
const byLead = (f: UnifiedForecast, hours: number) => f.hours.find((h) => h.lead_hours === hours)!;

async function main() {
  // --- The request: ECMWF alone, never Open-Meteo's best match ------------
  const params = ecmwfParams({ lat: 13.756, lon: 100.502 });
  assert.equal(params.get("models"), "ecmwf_ifs", "only ECMWF is asked for, so no other model slips in");
  assert.equal(params.get("hourly"), HOURLY_VARIABLES.join(","));
  assert.equal(params.get("forecast_days"), "16", "a day more than the list, for the last hour's rain");
  assert.equal(params.get("timezone"), "auto", "Open-Meteo works the time zone out from the place");
  assert.equal(params.get("timeformat"), "unixtime");
  assert.equal(`${params.get("latitude")},${params.get("longitude")}`, "13.76,100.50");
  console.log("✓ the request asks ECMWF's IFS alone, 16 days from local midnight, the time zone from the place");

  // --- Open-Meteo's reply in the router's units ----------------------------
  const raw = ecmwfReply();
  const { series, timeZone } = ecmwfFromOpenMeteo(raw);
  assert.equal(timeZone, "Asia/Bangkok");
  assert.equal(series.run.model, "ECMWF");
  assert.equal(series.hours.length, raw.hourly!.time.length - 1, "the last hour has no hour after it");
  series.hours.forEach((h, i) => {
    assert.equal(h.time, raw.hourly!.time[i] * 1000);
    assert.equal(h.temperatureC, raw.hourly!.temperature_2m![i], "instant values from the hour itself");
    assert.equal(h.rainMm, raw.hourly!.precipitation![i + 1], "rain from the record of the hour after");
    assert.equal(h.rainChance, raw.hourly!.precipitation_probability![i + 1]);
    assert.equal(h.gustKmh, raw.hourly!.wind_gusts_10m![i + 1]);
    assert.equal(h.thunder, raw.hourly!.weather_code![i + 1] === 95 ? 1 : 0);
    assert.equal(h.visibilityKm, raw.hourly!.visibility![i]! / 1000, "visibility in km");
    assert.equal(h.uvIndex, null);
  });
  const storms = series.hours.filter((h) => h.thunder === 1).length;
  console.log(`✓ ${series.hours.length} ECMWF hours, rain and thunder from the hour after (${storms} stormy hours)`);

  // --- Wind by its parts ------------------------------------------------------
  const east = windParts(36, 90);
  assert.ok(Math.abs(east.u + 10) < 1e-9 && Math.abs(east.v) < 1e-9, "a wind from the east blows west");
  const north = windParts(36, 0);
  assert.ok(Math.abs(north.u) < 1e-9 && Math.abs(north.v + 10) < 1e-9, "a wind from the north blows south");
  const back = windFrom(east.u, east.v);
  assert.ok(Math.abs(back.speedKmh - 36) < 1e-9 && Math.abs(back.fromDeg - 90) < 1e-9);
  assert.deepEqual(windFrom(0, 0), { speedKmh: 0, fromDeg: 0 });
  const a = windParts(10, 350);
  const b = windParts(10, 10);
  const mean = windFrom((a.u + b.u) / 2, (a.v + b.v) / 2);
  assert.ok(mean.fromDeg < 0.5 || mean.fromDeg > 359.5, `350° and 10° make north, not ${mean.fromDeg}°`);
  console.log("✓ winds are blended by their parts: 350° and 10° make 0°, not 180°");

  // --- The condition rule, rain from the map's first colour --------------------
  assert.equal(PRECIP_SCALE.stops[0][0], WET_MM, "the map's first rain colour is where the card starts saying rain");
  const dry: ConditionInputs = { rainMm: 0, cloudCover: 10, thunder: 0, temperatureC: 30, visibilityKm: 20 };
  const cases: [Partial<ConditionInputs>, string][] = [
    [{}, "clear"],
    [{ cloudCover: 32 }, "partly-cloudy"],
    [{ cloudCover: 78 }, "cloudy"],
    [{ rainMm: 0.09, cloudCover: 90 }, "cloudy"],
    [{ rainMm: 0.1 }, "drizzle"],
    [{ rainMm: 1 }, "rain"],
    [{ rainMm: 4 }, "heavy-rain"],
    [{ rainMm: 0.5, thunder: 1 }, "thunderstorm"],
    [{ rainMm: 0.5, thunder: 0.5 }, "thunderstorm"],
    [{ rainMm: 0.5, thunder: 0.4 }, "drizzle"],
    [{ rainMm: 0, thunder: 1, cloudCover: 90 }, "cloudy"],
    [{ rainMm: 2, temperatureC: 0.5 }, "snow"],
    [{ visibilityKm: 0.6 }, "fog"],
    [{ visibilityKm: 0.6, rainMm: 1 }, "rain"],
    [{ visibilityKm: null, cloudCover: 50 }, "partly-cloudy"],
  ];
  for (const [change, expected] of cases) {
    const inputs = { ...dry, ...change };
    assert.equal(conditionFrom(inputs), expected, JSON.stringify(change));
    assert.equal(isWet(conditionFrom(inputs)), inputs.rainMm >= WET_MM, "wet exactly when there is rain");
  }
  console.log(`✓ the condition comes from the numbers, wet exactly from ${WET_MM} mm (the map's first colour)`);

  // A model with no chance of rain of its own (WRF) gets one from its rain, stepping where the condition does.
  const chances: [number, number][] = [
    [0, 10],
    [WET_MM - 0.01, 10],
    [WET_MM, 60],
    [RAIN_MM - 0.01, 60],
    [RAIN_MM, 80],
    [HEAVY_MM - 0.01, 80],
    [HEAVY_MM, 90],
    [25, 90],
  ];
  for (const [mm, chance] of chances) assert.equal(rainChanceFrom(mm), chance, `${mm} mm`);
  console.log("✓ WRF's chance of rain from its own rain: 10% dry, 60% from 0.1 mm, 80% from 1 mm, 90% from 4 mm");

  // --- ECMWF only (no WRF yet) --------------------------------------------------
  const plain = sources();
  const f = await getUnifiedForecast(13.7563, 100.5018, NOW, plain.sources);
  assert.equal(f.issued_at, iso(START));
  assert.deepEqual(f.place, { lat: 13.76, lon: 100.5, time_zone: "Asia/Bangkok" });
  assert.deepEqual(f.runs, { WRF: null, ECMWF: plain.ecmwf.run });
  assert.equal(f.wrf_missing, "not-configured");
  assert.equal(f.blend, null);
  assert.equal(f.hours[0].time, iso(MIDNIGHT), "hours start at local midnight today");
  assert.equal(lead(f.hours[0]), -16, "the hours before now count back");
  assert.equal(byLead(f, 0).time, iso(START));
  f.hours.forEach((h, i) => {
    if (i) assert.equal(Date.parse(h.time) - Date.parse(f.hours[i - 1].time), HOUR_MS, "every hour, no gaps");
    assert.equal(h.model_used, "ECMWF");
    assert.equal(h.weights, undefined);
    assert.equal(h.borrowed, undefined);
    assert.equal(isWet(h.condition), h.rain_mm >= WET_MM, `${h.time}: wet exactly from the map's first colour`);
    const own = plain.ecmwf.hours.find((m) => m.time === Date.parse(h.time))!;
    assert.equal(h.temperature_c, own.temperatureC);
    assert.equal(h.rain_mm, own.rainMm);
    assert.equal(h.rain_chance, own.rainChance);
    // ECMWF sends no UV here, so it is worked out from the sun's height and the cloud.
    const elevation = sunElevation(Date.parse(h.time), BANGKOK.lat, BANGKOK.lon);
    assert.equal(h.uv_index, round1(Math.max(0, uvIndex(elevation, h.cloud_cover / 100))));
  });
  const storm = byLead(f, 0);
  assert.equal(storm.time, iso(START), "16:00 in Bangkok");
  assert.equal(storm.condition, "thunderstorm", "6 mm with ECMWF's thunder code");
  assert.equal(byLead(f, -1).condition, "rain");
  assert.equal(byLead(f, 1).condition, "drizzle");
  assert.equal(f.hours.find((h) => h.visibility_km === 0.6)?.condition, "fog");
  console.log(`✓ ECMWF alone: ${f.hours.length} hours tagged ECMWF, and why there is no WRF (${f.wrf_missing})`);

  // --- Days ---------------------------------------------------------------------
  assert.equal(f.days.length, 15, "15 whole days; the 16th is a day short of its last hour");
  assert.equal(f.days[0].date, "2026-10-02");
  assert.equal(f.days.at(-1)!.date, "2026-10-16");
  assert.equal(
    localDateKey(Date.parse(f.hours.at(-1)!.time), "Asia/Bangkok"),
    "2026-10-16",
    "hours end with the last day",
  );
  for (const day of f.days) {
    const hours = f.hours.filter((h) => localDateKey(Date.parse(h.time), "Asia/Bangkok") === day.date);
    assert.equal(hours.length, 24);
    assert.equal(day.model_used, "ECMWF");
    assert.equal(day.rain_mm, round1(hours.reduce((s, h) => s + h.rain_mm, 0)));
    assert.equal(day.rain_chance, Math.max(...hours.map((h) => h.rain_chance)));
    assert.equal(day.max_temp_c, Math.max(...hours.map((h) => h.temperature_c)));
    assert.equal(day.min_temp_c, Math.min(...hours.map((h) => h.temperature_c)));
    assert.ok(day.sunrise && day.sunset && day.sunrise < day.sunset);
  }
  assert.equal(f.days[0].condition, "thunderstorm");
  assert.equal(f.days[0].outlook.kind, "thunderstorms");
  assert.equal(f.days[1].condition, "partly-cloudy", "a dry day with dawn fog reads by its cloud");
  console.log(`✓ ${f.days.length} days, each from all 24 of its hours: "${f.days[0].outlook.kind}" today`);

  // --- WRF for 48 hours, easing into ECMWF ------------------------------------
  const withWrf = sources(async (ecmwf) => ({ series: wrfRun(ecmwf, MIDNIGHT, START + 60 * HOUR_MS) }));
  const w = await getUnifiedForecast(13.7563, 100.5018, NOW, withWrf.sources);
  const wrf = wrfRun(withWrf.ecmwf, MIDNIGHT, START + 60 * HOUR_MS);
  assert.equal(w.wrf_missing, undefined);
  assert.deepEqual(w.runs.WRF, wrf.run);
  assert.deepEqual(w.blend, { from: iso(START + 42 * HOUR_MS), to: iso(START + 48 * HOUR_MS) });
  for (const h of w.hours) {
    const time = Date.parse(h.time);
    const W = wrf.hours.find((m) => m.time === time);
    const E = withWrf.ecmwf.hours.find((m) => m.time === time)!;
    const hours = lead(h);
    if (!W || hours >= WRF_HOURS) {
      assert.equal(h.model_used, "ECMWF", `${hours} h: ECMWF`);
      assert.equal(h.temperature_c, E.temperatureC);
    } else if (hours <= WRF_HOURS - BLEND_HOURS) {
      assert.equal(h.model_used, "WRF", `${hours} h: WRF`);
      assert.equal(h.temperature_c, round1(W.temperatureC!));
      assert.equal(h.rain_mm, W.rainMm);
      assert.equal(h.wind_from_deg, 270);
      assert.equal(h.wind_kmh, 18);
    } else {
      const k = (WRF_HOURS - hours) / BLEND_HOURS;
      assert.equal(h.model_used, "WRF+ECMWF", `${hours} h: both`);
      assert.deepEqual(h.weights, { WRF: Math.round(k * 100) / 100, ECMWF: Math.round((1 - k) * 100) / 100 });
      assert.equal(h.temperature_c, round1(k * W.temperatureC! + (1 - k) * E.temperatureC!));
      assert.equal(h.rain_mm, round1(k * W.rainMm! + (1 - k) * E.rainMm!));
      // WRF has no feels-like or dew point: on its side they are worked out from the hour's numbers.
      const feels = feelsLike(h.temperature_c, h.humidity, h.wind_kmh);
      assert.equal(h.feels_like_c, round1(k * feels + (1 - k) * E.feelsLikeC!), `${hours} h feels-like`);
      assert.equal(h.dew_point_c, round1(k * dewPoint(h.temperature_c, h.humidity) + (1 - k) * E.dewPointC!));
    }
    assert.equal(isWet(h.condition), h.rain_mm >= WET_MM, `${hours} h: wet exactly from the map's first colour`);
  }
  assert.equal(byLead(w, 12).condition, "rain", "WRF's own 3 mm, not ECMWF's dry hour");
  console.log("✓ WRF to 42 hours, both from 42 to 48 in even steps, ECMWF from 48 although WRF runs on");

  // No jump at 48 hours: each hour moves by the models' own change plus a sixth of the gap, at most. WRF
  // has no feels-like or dew point here, so on its side they are the ones worked out from the hour's numbers.
  const around = w.hours.filter((h) => lead(h) >= 40 && lead(h) <= 50);
  const wrfAt = (h: UnifiedHour) => wrf.hours.find((m) => m.time === Date.parse(h.time))!;
  const ecmwfAt = (h: UnifiedHour) => withWrf.ecmwf.hours.find((m) => m.time === Date.parse(h.time))!;
  const sides: [string, (h: UnifiedHour) => number, (h: UnifiedHour) => number, (h: UnifiedHour) => number][] = [
    ["temperature", (h) => h.temperature_c, (h) => wrfAt(h).temperatureC!, (h) => ecmwfAt(h).temperatureC!],
    [
      "feels-like",
      (h) => h.feels_like_c,
      (h) => feelsLike(h.temperature_c, h.humidity, h.wind_kmh),
      (h) => ecmwfAt(h).feelsLikeC!,
    ],
    ["dew point", (h) => h.dew_point_c, (h) => dewPoint(h.temperature_c, h.humidity), (h) => ecmwfAt(h).dewPointC!],
  ];
  const worst: string[] = [];
  for (const [name, value, wrfSide, ecmwfSide] of sides) {
    let most = 0;
    for (const [i, h] of around.entries()) {
      if (!i) continue;
      const prev = around[i - 1];
      const changes = [wrfSide(h) - wrfSide(prev), ecmwfSide(h) - ecmwfSide(prev)].map(Math.abs);
      const gap = Math.abs(wrfSide(prev) - ecmwfSide(prev));
      const step = Math.abs(value(h) - value(prev));
      const limit = Math.max(...changes) + gap / BLEND_HOURS + 0.1 + 1e-9;
      assert.ok(step <= limit, `${name} moved ${step.toFixed(1)} °C at ${lead(h)} h (at most ${limit.toFixed(1)})`);
      most = Math.max(most, step);
    }
    worst.push(`${name} ${most.toFixed(1)} °C`);
  }
  console.log(`✓ no jump at 48 hours; the largest hourly changes: ${worst.join(", ")}`);

  // Values WRF lacks: worked out from WRF's own numbers, taken from ECMWF (and said so), or left out.
  const early = byLead(w, 3);
  assert.deepEqual(early.borrowed, { gust_kmh: "ECMWF", visibility_km: "ECMWF" });
  assert.equal(early.rain_chance, rainChanceFrom(wrfAt(early).rainMm!), "WRF's chance of rain, from its own rain");
  assert.equal(early.feels_like_c, round1(feelsLike(early.temperature_c, early.humidity, early.wind_kmh)));
  assert.equal(early.dew_point_c, round1(dewPoint(early.temperature_c, early.humidity)));
  const mid = byLead(w, 45);
  assert.equal(mid.borrowed, undefined, "while blending, a value only one model has is simply that model's");
  assert.equal(mid.gust_kmh, 25);
  // While blending, each model's own chance of rain by its weight: never the other model's chance for WRF's rain.
  assert.deepEqual(mid.weights, { WRF: 0.5, ECMWF: 0.5 });
  assert.equal(mid.rain_chance, Math.round((rainChanceFrom(wrfAt(mid).rainMm!) + ecmwfAt(mid).rainChance!) / 2));
  console.log(
    "✓ WRF's missing values: worked out, or borrowed from ECMWF and tagged; its chance of rain from its rain",
  );

  // Days that straddle the blend say so.
  const models = w.days.slice(0, 4).map((d) => d.model_used);
  assert.deepEqual(models, ["WRF", "WRF", "WRF+ECMWF", "ECMWF"]);
  console.log(`✓ days carry their model too: ${models.join(", ")}`);

  // --- WRF that ends early, starts late, fails or has gaps ------------------------
  const short = await getUnifiedForecast(
    13.7563,
    100.5018,
    NOW,
    sources(async (ecmwf) => ({ series: wrfRun(ecmwf, START, START + 30 * HOUR_MS) })).sources,
  );
  assert.deepEqual(short.blend, { from: iso(START + 24 * HOUR_MS), to: iso(START + 30 * HOUR_MS) });
  assert.equal(byLead(short, 24).model_used, "WRF");
  assert.deepEqual(byLead(short, 27).weights, { WRF: 0.5, ECMWF: 0.5 });
  assert.equal(byLead(short, 30).model_used, "ECMWF");
  assert.equal(byLead(short, 29).model_used, "WRF+ECMWF");
  assert.equal(wrfEnd(wrfRun(plain.ecmwf, START, START + 30 * HOUR_MS), START), START + 30 * HOUR_MS);

  const late = await getUnifiedForecast(
    13.7563,
    100.5018,
    NOW,
    sources(async (ecmwf) => ({ series: wrfRun(ecmwf, START + HOUR_MS, START + 60 * HOUR_MS) })).sources,
  );
  assert.equal(late.wrf_missing, "unavailable", "a WRF run that doesn't reach now isn't used");
  assert.equal(late.wrf_reason, "WRF's forecast doesn't reach this hour");
  assert.ok(late.hours.every((h) => h.model_used === "ECMWF"));

  const failing = await quiet(() =>
    getUnifiedForecast(
      13.7563,
      100.5018,
      NOW,
      sources(async () => {
        throw new Error("TMD is down");
      }).sources,
    ),
  );
  assert.equal(failing.wrf_missing, "unavailable");
  assert.equal(failing.wrf_reason, "TMD is down");
  assert.ok(failing.hours.every((h) => h.model_used === "ECMWF"));

  const outside = await getUnifiedForecast(
    35.68,
    139.69,
    NOW,
    sources(async () => ({ missing: "outside-area" })).sources,
  );
  assert.equal(outside.wrf_missing, "outside-area");

  // An hour ECMWF lacks after 48 hours stays out rather than coming from WRF.
  const gappy = sources(async (ecmwf) => ({ series: wrfRun(ecmwf, START, START + 60 * HOUR_MS) }));
  const holes: ForecastSources = {
    ...gappy.sources,
    ecmwf: async () => {
      const answer = ecmwfFromOpenMeteo(ecmwfReply());
      const missing = new Set([START + 10 * HOUR_MS, START + 55 * HOUR_MS]);
      answer.series.hours = answer.series.hours.filter((h) => !missing.has(h.time));
      return answer;
    },
  };
  const holed = await getUnifiedForecast(13.7563, 100.5018, NOW, holes);
  assert.equal(byLead(holed, 10).model_used, "WRF", "inside WRF's hours, WRF fills ECMWF's gap");
  assert.equal(byLead(holed, 55), undefined, "after 48 hours, a gap stays a gap");
  console.log("✓ WRF that ends early eases out sooner; WRF that is late, down or elsewhere is left out, and why");

  // --- The rules on their own ------------------------------------------------------
  assert.deepEqual(weightsAt(START, null), { WRF: 0, ECMWF: 1 });
  assert.deepEqual(weightsAt(START + 42 * HOUR_MS, START + 48 * HOUR_MS), { WRF: 1, ECMWF: 0 });
  assert.deepEqual(weightsAt(START + 48 * HOUR_MS, START + 48 * HOUR_MS), { WRF: 0, ECMWF: 1 });
  const routed = routeHours(START, BANGKOK, null, wrfRun(plain.ecmwf, START, START + 60 * HOUR_MS));
  assert.equal(routed.hours.at(-1)!.lead_hours, 48, "without ECMWF, WRF alone to 48 hours and nothing after");
  console.log("✓ without ECMWF, WRF alone to 48 hours; never a third model");

  // --- Rounding to about 1 km -------------------------------------------------------
  assert.deepEqual(snapPoint(13.7563, 100.5018), { lat: 13.76, lon: 100.5 });
  assert.deepEqual(snapPoint(-33.8688, 151.2093), { lat: -33.87, lon: 151.21 });
  assert.deepEqual(snapPoint(0.004, -0.004), { lat: 0, lon: 0 });
  console.log("✓ places are rounded to 0.01° (about 1 km), so nearby requests share an answer");

  // --- /api/forecast ----------------------------------------------------------------
  const ask = (query: string, headers: Record<string, string> = {}, at = NOW, used = plain.sources) =>
    forecastResponse(new Request(`https://doofah.test/api/forecast?${query}`, { headers }), used, at);
  for (const query of ["", "lat=13.7", "lat=abc&lon=100", "lat=91&lon=100", "lat=13&lon=181", "lat=&lon=100"]) {
    const response = await ask(query);
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal((await ask("lat=13.75&lon=100.5", { "sec-fetch-site": "cross-site" })).status, 403);
  const ok = await ask("lat=13.7563&lon=100.5018", { "sec-fetch-site": "same-origin" });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "public, s-maxage=2400, stale-while-revalidate=600", "until 10:00 UTC");
  assert.deepEqual(await ok.json(), JSON.parse(JSON.stringify(f)));
  const lateInHour = await ask("lat=13.75&lon=100.5", {}, START + HOUR_MS - 20_000);
  assert.equal(lateInHour.headers.get("cache-control"), "public, s-maxage=60, stale-while-revalidate=600");
  const down: ForecastSources = {
    ...plain.sources,
    ecmwf: async () => {
      throw new OpenMeteoError("Open-Meteo could not be reached", 502);
    },
  };
  const failed = await ask("lat=13.75&lon=100.5", {}, NOW, down);
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.match((await failed.json()).reason, /ECMWF unavailable/);
  console.log("✓ /api/forecast: checks the place, refuses other sites, kept until the hour ends, 502 without ECMWF");

  // --- Open-Meteo from the server, with or without the commercial key -------------------
  const urls: string[] = [];
  const fake = (status: number, body: unknown) =>
    (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  await fetchEcmwf(BANGKOK, { fetch: fake(200, ecmwfReply()) });
  assert.ok(urls[0].startsWith(`${FREE_URL.forecast}?`) && !urls[0].includes("apikey"));
  await fetchEcmwf(BANGKOK, { apiKey: "secret", fetch: fake(200, ecmwfReply()) });
  assert.ok(urls[1].startsWith(`${CUSTOMER_URL.forecast}?`) && urls[1].includes("apikey=secret"));
  await assert.rejects(fetchEcmwf(BANGKOK, { fetch: fake(400, { error: true, reason: "Bad model" }) }), (e) => {
    assert.ok(e instanceof OpenMeteoError && e.message === "Bad model" && e.status === 400);
    return true;
  });
  await assert.rejects(
    fetchEcmwf(BANGKOK, {
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    }),
    (e) => e instanceof OpenMeteoError && e.status === 502,
  );
  await assert.rejects(fetchEcmwf(BANGKOK, { fetch: fake(200, { timezone: "Asia/Bangkok" }) }), OpenMeteoError);
  console.log("✓ Open-Meteo's free servers, or its customer servers with the key; its errors come through");

  // --- WRF from TMD ----------------------------------------------------------------------
  // TMD's dates and hours are Thai time: 16:00 on 2 October, and midnight into 3 October.
  const asked = new URL(tmdUrl(BANGKOK, START));
  assert.equal(`${asked.origin}${asked.pathname}`, TMD_URL);
  assert.deepEqual(Object.fromEntries(asked.searchParams), {
    lat: "13.76",
    lon: "100.50",
    fields: TMD_FIELDS.join(","),
    date: "2026-10-02",
    hour: "16",
    duration: String(TMD_HOURS),
  });
  const nextDay = new URL(tmdUrl(BANGKOK, Date.UTC(2026, 9, 2, 17))).searchParams;
  assert.equal(`${nextDay.get("date")} ${nextDay.get("hour")}`, "2026-10-03 0");

  const tmd = wrfFromTmd(tmdReply(START, TMD_HOURS));
  assert.equal(tmd.run.model, "WRF");
  assert.equal(tmd.run.source, "tmd");
  assert.equal(tmd.hours.length, TMD_HOURS - 1, "the last record only gives the rain of the hour before it");
  assert.equal(tmd.hours[0].time, START);
  assert.equal(tmd.hours[0].temperatureC, 30);
  assert.equal(tmd.hours[2].rainMm, 5.2, "an hour's rain is in the record an hour later");
  assert.equal(tmd.hours[2].thunder, 1, "TMD's code 8 is a thunderstorm");
  assert.equal(tmd.hours[3].rainMm, 0);
  assert.equal(tmd.hours[3].thunder, 0);
  assert.equal(Math.round(tmd.hours[0].cloudCover!), 60, "50% low and 20% middle cloud at random make 60%");
  const tmdWind = windFrom(tmd.hours[0].windU!, tmd.hours[0].windV!);
  assert.ok(Math.abs(tmdWind.speedKmh - 18) < 1e-9 && Math.abs(tmdWind.fromDeg - 90) < 1e-9, "5 m/s from the east");
  for (const key of ["rainChance", "gustKmh", "visibilityKm", "uvIndex", "dewPointC", "feelsLikeC"] as const) {
    assert.equal(tmd.hours[0][key], null, `TMD gives no ${key}`);
  }
  const asText = wrfFromTmd(tmdReply(START, 3, () => ({ tc: "29.5" })));
  assert.equal(asText.hours[0].temperatureC, 29.5, "numbers sent as text");
  assert.throws(() => wrfFromTmd({ WeatherForecasts: [] }), TmdError);
  assert.ok(inTmdArea(BANGKOK) && inTmdArea({ lat: 6, lon: 101 }) && !inTmdArea({ lat: 35.68, lon: 139.69 }));
  console.log(
    `✓ TMD: asked in Thai time; ${tmd.hours.length} WRF hours, rain from the record after, cloud layers combined`,
  );

  const calls: { url: string; headers: Headers }[] = [];
  const tmdFake = (status: number, body: unknown) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }) as typeof fetch;
  const fetched = await fetchWrf(BANGKOK, START, { token: "test-token", fetch: tmdFake(200, tmdReply(START, 48)) });
  assert.equal(fetched.hours.length, 47);
  assert.equal(calls[0].url, tmdUrl(BANGKOK, START));
  assert.equal(calls[0].headers.get("authorization"), "Bearer test-token");
  assert.equal(calls[0].headers.get("accept"), "application/json");
  await assert.rejects(
    fetchWrf(BANGKOK, START, { token: "wrong", fetch: tmdFake(401, { message: "Unauthenticated." }) }),
    (e) => e instanceof TmdError && e.status === 401 && e.message === "TMD answered 401: Unauthenticated.",
  );
  await assert.rejects(
    fetchWrf(BANGKOK, START, { token: "t", fetch: tmdFake(429, "Too Many Attempts.") }),
    (e) => e instanceof TmdError && e.message === "TMD answered 429",
  );
  await assert.rejects(
    fetchWrf(BANGKOK, START, {
      token: "t",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    }),
    (e) => e instanceof TmdError && e.status === 502,
  );
  await assert.rejects(fetchWrf(BANGKOK, START, { token: "t", fetch: tmdFake(200, "<html>") }), TmdError);
  console.log("✓ TMD is asked with the token as a Bearer header; its refusals and failures come through");

  // The server's sources: no token, no WRF; outside Thailand, TMD isn't asked; inside, WRF from TMD.
  const servers = (tmdStatus = 200, tmdBody: unknown = tmdReply(START, TMD_HOURS)) => {
    const seen: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      seen.push(String(url));
      const fromTmd = String(url).startsWith(TMD_URL);
      return new Response(JSON.stringify(fromTmd ? tmdBody : ecmwfReply()), { status: fromTmd ? tmdStatus : 200 });
    }) as typeof fetch;
    return { fetcher, seen };
  };
  const idle = servers();
  assert.deepEqual(await defaultSources({}, idle.fetcher).wrf(BANGKOK, START), { missing: "not-configured" });
  assert.deepEqual(await defaultSources({ TMD_API_TOKEN: " " }, idle.fetcher).wrf(BANGKOK, START), {
    missing: "not-configured",
  });
  const tokyo = { lat: 35.68, lon: 139.69 };
  assert.deepEqual(await defaultSources({ TMD_API_TOKEN: "test-token" }, idle.fetcher).wrf(tokyo, START), {
    missing: "outside-area",
  });
  assert.equal(idle.seen.length, 0, "TMD isn't asked without a token, or outside Thailand");

  const live = servers();
  const viaTmd = await getUnifiedForecast(
    13.7563,
    100.5018,
    NOW,
    defaultSources({ TMD_API_TOKEN: "test-token" }, live.fetcher),
  );
  assert.equal(live.seen.filter((url) => url.startsWith(TMD_URL)).length, 1);
  assert.equal(viaTmd.wrf_missing, undefined);
  assert.equal(viaTmd.runs.WRF?.source, "tmd");
  // 48 records reach 46 hours with the rain shift, so WRF eases into ECMWF over hours 40 to 46.
  assert.deepEqual(viaTmd.blend, { from: iso(START + 40 * HOUR_MS), to: iso(START + 46 * HOUR_MS) });
  assert.equal(byLead(viaTmd, -1).model_used, "ECMWF", "earlier today is ECMWF's: TMD is asked from now");
  assert.equal(byLead(viaTmd, 0).model_used, "WRF");
  assert.equal(byLead(viaTmd, 2).condition, "thunderstorm", "TMD's storm in the hour from 18:00");
  assert.deepEqual(byLead(viaTmd, 0).borrowed, { gust_kmh: "ECMWF", visibility_km: "ECMWF" });
  assert.equal(byLead(viaTmd, 0).rain_chance, 10, "a single WRF run: its chance of rain from its own dry hour");
  assert.equal(byLead(viaTmd, 2).rain_chance, 90, "and from its 5.2 mm storm");
  assert.equal(byLead(viaTmd, 43).model_used, "WRF+ECMWF");
  assert.equal(byLead(viaTmd, 46).model_used, "ECMWF");

  const refused = servers(401, { message: "Unauthenticated." });
  const withoutWrf = await quiet(() =>
    getUnifiedForecast(13.7563, 100.5018, NOW, defaultSources({ TMD_API_TOKEN: "expired" }, refused.fetcher)),
  );
  assert.equal(withoutWrf.wrf_missing, "unavailable");
  assert.equal(withoutWrf.wrf_reason, "TMD answered 401: Unauthenticated.");
  assert.ok(withoutWrf.hours.every((h) => h.model_used === "ECMWF"));
  const busy = defaultSources({ TMD_API_TOKEN: "test-token" }, servers(429).fetcher);
  const soon = await quiet(() => ask("lat=13.75&lon=100.5", {}, NOW, busy));
  assert.equal(soon.headers.get("cache-control"), "public, s-maxage=300, stale-while-revalidate=600");
  console.log(
    "✓ with TMD_API_TOKEN, WRF from TMD in Thailand; when TMD fails, ECMWF alone, why, and only for 5 minutes",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
