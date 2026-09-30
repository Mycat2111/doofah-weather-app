/**
 * Checks for real forecasts from Open-Meteo: the requests, how replies become
 * DooFah's forecast, the offline copy and the server proxy for a commercial
 * key. Uses replies built here in Open-Meteo's format, so it needs no network.
 * Run with: npm run verify:open-meteo
 */
import assert from "node:assert/strict";
import { createFormatters } from "../src/i18n/format";
import { MESSAGES } from "../src/i18n/messages";
import { modelOutlook, rainCountdown, type ModelOutlook, type RainCountdown } from "../src/lib/rainCountdown";
import { rainIntensity } from "../src/services/weathernext3/describe";
import { floorToHour, HOUR_MS, localDateKey, timeZoneOffsetMinutes } from "../src/services/weathernext3/time";
import {
  airQualityFrom,
  forecastBundle,
  hourlyForecasts,
  spotWeather,
  wmoCondition,
} from "../src/services/openmeteo/adapter";
import {
  CONSENSUS_MODELS,
  CONSENSUS_VARIABLES,
  consensusParams,
  CURRENT_VARIABLES,
  forecastParams,
  HOURLY_VARIABLES,
  MAX_LOCATIONS,
  OpenMeteoError,
  type AirQualityResponse,
  type ConsensusModel,
  type ConsensusResponse,
  type ForecastResponse,
} from "../src/services/openmeteo/api";
import { confidenceLevel, consensusFrom, dayVote, support, weigh } from "../src/services/openmeteo/consensus";
import { OpenMeteoService } from "../src/services/openmeteo/OpenMeteoService";
import { proxyOpenMeteo } from "../src/services/openmeteo/proxy";
import {
  PLACES,
  WeatherNext3MockService,
  type ForecastBundle,
  type HourlyForecast,
  type ModelVote,
  type Place,
  type WeatherCondition,
} from "../src/services/WeatherNext3MockService";

const NOW = Date.UTC(2026, 8, 30, 7, 20); // 30 Sep 2026, 14:20 in Bangkok
const MIN = 60_000;
const QUARTER = 15 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const unix = (ms: number) => ms / 1000;
const place = (id: string) => PLACES.find((p) => p.id === id)!;
const bangkok = place("bangkok");

/** DooFah's conditions as WMO codes, the reverse of wmoCondition. */
const WMO: Record<WeatherCondition, number> = {
  clear: 0,
  "partly-cloudy": 2,
  cloudy: 3,
  fog: 45,
  drizzle: 53,
  rain: 63,
  "heavy-rain": 65,
  snow: 73,
  thunderstorm: 95,
};

/**
 * The reply Open-Meteo would send for these hours: the instant values at each
 * time, and the rain, its chance, the gusts and the weather code of the hour
 * before it.
 */
function forecastReply(hours: HourlyForecast[], at: Place, extra: Partial<ForecastResponse> = {}): ForecastResponse {
  const before = (pick: (h: HourlyForecast) => number) => hours.map((_, i) => (i === 0 ? 0 : pick(hours[i - 1])));
  return {
    latitude: at.point.lat,
    longitude: at.point.lon,
    utc_offset_seconds: timeZoneOffsetMinutes(NOW, at.timeZone) * 60,
    timezone: at.timeZone,
    hourly: {
      time: hours.map((h) => unix(Date.parse(h.time))),
      temperature_2m: hours.map((h) => h.temperatureC),
      relative_humidity_2m: hours.map((h) => h.humidity),
      dew_point_2m: hours.map((h) => h.dewPointC),
      apparent_temperature: hours.map((h) => h.feelsLikeC),
      pressure_msl: hours.map((h) => h.pressureHpa),
      cloud_cover: hours.map((h) => h.cloudCover),
      visibility: hours.map((h) => h.visibilityKm * 1000),
      wind_speed_10m: hours.map((h) => h.windSpeedKmh),
      wind_direction_10m: hours.map((h) => h.windDirectionDeg),
      uv_index: hours.map((h) => h.uvIndex),
      precipitation: before((h) => h.precipitationMm),
      precipitation_probability: before((h) => h.precipitationProbability),
      wind_gusts_10m: before((h) => h.windGustKmh),
      weather_code: before((h) => WMO[h.condition]),
    },
    ...extra,
  };
}

/** 15-minute rain from the quarter hour NOW falls in, each value the rain of the quarter before its time. */
function quarters(mm: (number | null)[]): ForecastResponse["minutely_15"] {
  const first = Math.ceil(NOW / QUARTER) * QUARTER;
  return { time: mm.map((_, j) => unix(first + j * QUARTER)), precipitation: mm };
}

const current = (fields: Partial<NonNullable<ForecastResponse["current"]>> = {}): ForecastResponse["current"] => ({
  time: unix(NOW - 5 * MIN),
  interval: 900,
  temperature_2m: 33.3,
  relative_humidity_2m: 58,
  apparent_temperature: 38.1,
  precipitation: 0,
  weather_code: 3,
  cloud_cover: 90,
  pressure_msl: 1008.2,
  wind_speed_10m: 12.4,
  wind_direction_10m: 225,
  wind_gusts_10m: 30.2,
  ...fields,
});

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

/** Hourly spot values (SPOT_VARIABLES) from the current hour, as a forecast_hours request gets them. */
function spotReply(point: { lat: number; lon: number }, temps: number[], rain: number[] = [], codes: number[] = []) {
  const start = floorToHour(NOW);
  return {
    latitude: point.lat,
    longitude: point.lon,
    utc_offset_seconds: 0,
    timezone: "GMT",
    hourly: {
      time: temps.map((_, i) => unix(start + i * HOUR_MS)),
      temperature_2m: temps,
      precipitation: temps.map((_, i) => rain[i] ?? 0),
      precipitation_probability: temps.map((_, i) => ((rain[i] ?? 0) > 0 ? 70 : 10)),
      weather_code: temps.map((_, i) => codes[i] ?? 2),
    },
  } satisfies ForecastResponse;
}

type ModelValue = (model: ConsensusModel, start: number) => number | null;

const isWet = (mm: number | null) => (mm ?? 0) >= 0.1;

/**
 * The models' reply (consensusParams) for 8 days from `from`: each model's
 * rain, chance of rain and weather code for the DooFah hour from `start`,
 * which Open-Meteo sends at start + 1 h. By default an ensemble gives 90%
 * when its model has rain and 5% when not (AIGFS's comes back empty, as it
 * does live), and the code is rain or cloud to match.
 */
function modelsReply(
  from: number,
  rain: ModelValue,
  chance: ModelValue = (m, t) => (!m.ensemble || m.id === "ncep_aigfs025" ? null : isWet(rain(m, t)) ? 90 : 5),
  code: ModelValue = (m, t) => (isWet(rain(m, t)) ? 61 : 3),
): ConsensusResponse {
  const time = Array.from({ length: 8 * 24 }, (_, i) => from + i * HOUR_MS);
  const hourly: NonNullable<ConsensusResponse["hourly"]> = { time: time.map(unix) };
  for (const model of CONSENSUS_MODELS) {
    const before = (value: ModelValue) => time.map((t) => value(model, t - HOUR_MS));
    hourly[`precipitation_${model.id}`] = before(rain);
    hourly[`precipitation_probability_${model.id}`] = before(chance);
    hourly[`weather_code_${model.id}`] = before(code);
  }
  return { utc_offset_seconds: 7 * 3600, hourly };
}

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
  };
}

type Answer = (url: URL) => unknown;

/** A fetch that answers from `answer` (or throws what it returns, if an Error) and records each URL. */
function fakeFetch(answer: Answer) {
  const calls: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = answer(new URL(url, "https://doofah.test"));
    if (body instanceof Error) throw body;
    const status = (body as { error?: boolean })?.error ? 400 : 200;
    return Response.json(body, { status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

async function main() {
  const mock = new WeatherNext3MockService({ latencyMs: 0, now: () => NOW });
  const simulated = await mock.getForecastBundle(bangkok);
  // Today and the next 14 days from local midnight, as Open-Meteo sends them with `timezone`.
  const hours = simulated.daily.flatMap((d) => d.hours);
  assert.equal(hours.length, 15 * 24);
  const reply = forecastReply(hours, bangkok);
  // The models: a thunderstorm in every one of them at 16:00 (except CMA's, which sends nothing).
  const midnight = Date.parse(hours[0].time);
  const thisHour = floorToHour(NOW);
  const storm = thisHour + 2 * HOUR_MS;
  const stormReply = modelsReply(
    midnight,
    (m, t) => (m.id === "cma_grapes_global" ? null : t === storm ? 5 : 0),
    undefined,
    (_, t) => (t === storm ? 95 : 3),
  );
  /** The temperature at `at` between the hours around it. */
  const tempAt = (at: number) => {
    const i = hours.findIndex((x) => Date.parse(x.time) === floorToHour(at));
    const f = (at - floorToHour(at)) / HOUR_MS;
    return Math.round((hours[i].temperatureC + (hours[i + 1].temperatureC - hours[i].temperatureC) * f) * 10) / 10;
  };

  // 1. Requests --------------------------------------------------------------
  const params = forecastParams(bangkok);
  assert.equal(params.get("latitude"), "13.756");
  assert.equal(params.get("longitude"), "100.502");
  assert.equal(params.get("current"), CURRENT_VARIABLES.join(","));
  assert.equal(params.get("hourly"), HOURLY_VARIABLES.join(","));
  assert.equal(params.get("minutely_15"), "precipitation");
  assert.equal(params.get("forecast_minutely_15"), "12");
  assert.equal(params.get("forecast_days"), "15");
  assert.equal(params.get("timezone"), "Asia/Bangkok");
  assert.equal(params.get("timeformat"), "unixtime");
  console.log(
    `✓ one request per place: ${CURRENT_VARIABLES.length} current and ${HOURLY_VARIABLES.length} hourly values, 15 days`,
  );

  // 2. Weather codes -----------------------------------------------------------
  const codes: [number[], WeatherCondition][] = [
    [[0, 1], "clear"],
    [[2], "partly-cloudy"],
    [[3], "cloudy"],
    [[45, 48], "fog"],
    [[51, 53, 55, 56, 57], "drizzle"],
    [[61, 63, 66, 80, 81], "rain"],
    [[65, 67, 82], "heavy-rain"],
    [[71, 73, 75, 77, 85, 86], "snow"],
    [[95, 96, 99], "thunderstorm"],
  ];
  for (const [list, condition] of codes)
    for (const code of list) assert.equal(wmoCondition(code), condition, `WMO ${code}`);
  assert.equal(wmoCondition(4), null, "an unknown code has no condition");
  console.log("✓ every WMO weather code Open-Meteo sends has a condition");

  // 3. Hours: rain from the hour after, the rest at the hour ----------------------
  const adapted = hourlyForecasts(reply, bangkok.point, NOW);
  assert.equal(adapted.length, hours.length);
  const FIELDS = [
    "time",
    "temperatureC",
    "feelsLikeC",
    "dewPointC",
    "humidity",
    "pressureHpa",
    "windSpeedKmh",
    "windGustKmh",
    "windDirectionDeg",
    "precipitationMm",
    "precipitationProbability",
    "cloudCover",
    "visibilityKm",
    "uvIndex",
    "condition",
    "leadHours",
  ] as const;
  // The last hour has no hour after it in the reply.
  for (let i = 0; i < hours.length - 1; i++) {
    for (const field of FIELDS) assert.equal(adapted[i][field], hours[i][field], `${field} at ${hours[i].time}`);
    assert.equal(adapted[i].confidence, null, "Open-Meteo has no confidence");
  }
  const dayMismatch = adapted.filter((h, i) => h.isDay !== hours[i].isDay).length;
  assert.ok(dayMismatch <= 15 * 2, `day and night agree except around sunrise and sunset (${dayMismatch})`);
  const wet = hours.filter((h) => h.precipitationMm > 0).length;
  console.log(`✓ ${hours.length} hours read back exactly, rain from the hour after (${wet} wet hours)`);

  // 4. Gaps -------------------------------------------------------------------
  const gappy = structuredClone(reply);
  const h = gappy.hourly!;
  h.temperature_2m![0] = null;
  h.temperature_2m![5] = null;
  delete h.visibility;
  delete h.uv_index;
  delete h.dew_point_2m;
  delete h.apparent_temperature;
  const filled = hourlyForecasts(gappy, bangkok.point, NOW);
  assert.equal(filled[0].temperatureC, hours[1].temperatureC, "a missing first value takes the next one");
  assert.equal(filled[5].temperatureC, hours[4].temperatureC, "a missing value takes the one before");
  assert.ok(
    filled.every((x) => x.visibilityKm === 10),
    "no visibility forecast reads as 10 km",
  );
  assert.ok(filled.every((x) => Number.isFinite(x.dewPointC) && Number.isFinite(x.feelsLikeC) && x.uvIndex >= 0));
  const noTemps = structuredClone(reply);
  noTemps.hourly!.temperature_2m = noTemps.hourly!.temperature_2m!.map(() => null);
  assert.throws(() => hourlyForecasts(noTemps, bangkok.point, NOW), /no temperature/);
  assert.throws(() => hourlyForecasts({ ...reply, hourly: undefined }, bangkok.point, NOW), /no hourly/);
  console.log("✓ gaps filled from the nearest hour; no temperatures at all is an error");

  // 5. The dashboard's forecast ------------------------------------------------
  const bundle = forecastBundle(reply, null, bangkok, NOW);
  assert.equal(bundle.hourly.length, 48);
  assert.equal(bundle.hourly[0].time, iso(floorToHour(NOW)), "the strip starts this hour");
  assert.equal(bundle.hourly[0].leadHours, 0);
  assert.equal(bundle.daily.length, 15);
  assert.equal(bundle.daily[0].date, localDateKey(NOW, bangkok.timeZone), "the list starts today");
  bundle.daily.forEach((day, i) => {
    assert.equal(day.hours.length, 24, `24 hours on ${day.date}`);
    assert.equal(day.confidence, null);
    assert.equal(day.precipitationProbability, Math.max(...day.hours.map((x) => x.precipitationProbability)));
    assert.ok(day.sunrise && day.sunset && day.sunrise < day.sunset, `sunrise before sunset on ${day.date}`);
    if (i < 14) {
      const sim = simulated.daily[i];
      assert.equal(day.date, sim.date);
      assert.deepEqual(
        [day.minTempC, day.maxTempC, day.precipitationMm, day.outlook.kind],
        [sim.minTempC, sim.maxTempC, sim.precipitationMm, sim.outlook.kind],
        `day ${day.date} sums up the same`,
      );
    }
  });
  const c = bundle.current;
  assert.equal(c.source, "open-meteo");
  assert.equal(c.cell, null);
  assert.equal(c.model, null);
  assert.equal(c.airQuality, null);
  assert.equal(c.savedAt, undefined);
  assert.equal(c.observedAt, iso(NOW));
  assert.equal(c.nowcast.steps.length, 13);
  assert.equal(c.sunrise, bundle.daily[0].sunrise);
  console.log(`✓ 48 hours from this hour, 15 days from today: ${bundle.daily[0].summary}`);

  // 6. Right now -----------------------------------------------------------------
  const fresh = forecastBundle(forecastReply(hours, bangkok, { current: current() }), null, bangkok, NOW).current;
  assert.deepEqual(
    [fresh.sample.temperatureC, fresh.sample.feelsLikeC, fresh.sample.humidity, fresh.sample.pressureHpa],
    [33.3, 38.1, 58, 1008.2],
  );
  assert.deepEqual(
    [fresh.sample.windSpeedKmh, fresh.sample.windGustKmh, fresh.sample.windDirectionDeg, fresh.sample.cloudCover],
    [12.4, 30.2, 225, 90],
  );
  assert.equal(fresh.sample.condition, "cloudy");
  const stale = forecastBundle(
    forecastReply(hours, bangkok, { current: current({ time: unix(NOW - 3 * HOUR_MS) }) }),
    null,
    bangkok,
    NOW,
  ).current;
  assert.equal(stale.sample.temperatureC, tempAt(NOW), "old conditions give way to the hourly forecast");
  console.log(
    `✓ now is Open-Meteo's current conditions (${fresh.sample.temperatureC}°C), or the hourly forecast when those are old`,
  );

  // 7. The next two hours of rain --------------------------------------------------
  const dry = hours.map((x) => ({
    ...x,
    precipitationMm: 0,
    precipitationProbability: 5,
    condition: "cloudy" as const,
  }));
  const nowcast = (minutely: ForecastResponse["minutely_15"], rainNow = 0, code = 3, base = dry) =>
    forecastBundle(
      forecastReply(base, bangkok, {
        current: current({ precipitation: rainNow, weather_code: code }),
        minutely_15: minutely,
      }),
      null,
      bangkok,
      NOW,
    ).current;
  // NOW is 14:20; the quarters end 14:30, 14:45, 15:00...; the 14:45–15:00 one has 0.5 mm (2 mm/h).
  const starting = nowcast(quarters([0, 0, 0.5, 0.75, 0.75, 0.5, 0.25, 0, 0, 0, 0, 0]));
  assert.deepEqual(starting.nowcast.outlook, { kind: "starting", minutes: 30, intensity: rainIntensity(2) });
  assert.deepEqual(
    starting.nowcast.steps.slice(0, 6).map((s) => s.precipitationMm),
    [0, 0, 0, 2, 3, 3],
    "each 10 minutes has the rate of its quarter hour",
  );
  assert.equal(starting.sample.condition, "cloudy", "dry now");
  const stopping = nowcast(quarters([0.3, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 0.3);
  assert.equal(stopping.nowcast.steps[0].precipitationMm, 1.2, "the last quarter hour's rain is the rate now");
  assert.deepEqual(stopping.nowcast.outlook, { kind: "stopping", minutes: 30, intensity: rainIntensity(1.2) });
  assert.equal(stopping.sample.condition, "rain", "the sky rains when the rate says it rains");
  assert.equal(stopping.atmosphere, "rain");
  // Without 15-minute data, the hourly forecast: 3 mm in the 15:00 hour.
  const showerAt3 = dry.map((x) =>
    Date.parse(x.time) === floorToHour(NOW) + HOUR_MS ? { ...x, precipitationMm: 3 } : x,
  );
  const hourlyOnly = nowcast(undefined, 0, 3, showerAt3);
  assert.deepEqual(hourlyOnly.nowcast.outlook, { kind: "starting", minutes: 40, intensity: rainIntensity(3) });
  const missingQuarter = nowcast(quarters([0, 0, null, null, null, 0, 0, 0, 0, 0, 0, 0]), 0, 3, showerAt3);
  assert.deepEqual(
    missingQuarter.nowcast.steps.slice(3, 7).map((s) => s.precipitationMm),
    [0, 3, 3, 3],
    "a missing quarter hour falls back to its hour",
  );
  console.log(`✓ rain countdown from 15-minute data: "${starting.nowcast.summary}", "${stopping.nowcast.summary}"`);

  // 8. The sky agrees with the rain ------------------------------------------------
  assert.equal(nowcast(quarters(Array(12).fill(0)), 0, 61).sample.condition, "cloudy", "no rain, no rain icon");
  assert.equal(nowcast(quarters(Array(12).fill(0)), 1, 0).sample.condition, "heavy-rain", "4 mm/h is heavy rain");
  assert.equal(nowcast(quarters(Array(12).fill(0)), 0, 95).sample.condition, "thunderstorm", "storms stay storms");
  console.log("✓ the condition now always agrees with the rain countdown");

  // 9. Air quality -----------------------------------------------------------------
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
  const withAir = forecastBundle(reply, airReply(), bangkok, NOW).current.airQuality;
  assert.equal(withAir?.aqi, 162);
  console.log("✓ US AQI with its main pollutant; ozone in ppb; none when missing or old");

  // 10. Weather at a spot ------------------------------------------------------------
  const spot = spotReply(bangkok.point, [30, 32, 33, 33, 32, 31, 30, 29], [0, 2.4], [2, 63]);
  // 14:30 is halfway through the 14:00 hour, whose rain Open-Meteo gives at 15:00.
  assert.deepEqual(spotWeather(spot, bangkok.point, NOW + 10 * MIN), {
    time: iso(NOW + 10 * MIN),
    temperatureC: 31,
    precipitationMm: 2.4,
    precipitationProbability: 70,
    condition: "rain",
    isDay: true,
  });
  assert.equal(spotWeather(spot, bangkok.point, NOW + 3 * HOUR_MS).condition, "partly-cloudy");
  console.log("✓ a spot's weather at any time: the temperature between hours, the rain of its hour");

  // 11. The service: requests, reuse, proxy, errors ------------------------------------
  const good = () =>
    fakeFetch((url) =>
      url.pathname.endsWith("/air-quality")
        ? airReply()
        : url.searchParams.has("models")
          ? stormReply
          : forecastReply(hours, bangkok, { current: current(), minutely_15: quarters(Array(12).fill(0)) }),
    );
  let clock = NOW;
  const net = good();
  const service = new OpenMeteoService({ fetch: net.fetch, now: () => clock, storage: null });
  const live = await service.getForecastBundle(bangkok);
  assert.equal(net.calls.length, 3);
  assert.ok(net.calls[0].startsWith("https://api.open-meteo.com/v1/forecast?latitude=13.756&longitude=100.502&"));
  assert.ok(net.calls[1].startsWith("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=13.756&"));
  assert.ok(net.calls[2].startsWith("https://api.open-meteo.com/v1/forecast?latitude=13.756&longitude=100.502&"));
  assert.equal(new URL(net.calls[2]).searchParams.get("models"), consensusParams(bangkok).get("models"));
  assert.equal(live.current.source, "open-meteo");
  assert.equal(live.current.airQuality?.aqi, 162);
  assert.equal(live.current.blend?.length, 6);
  clock += 4 * MIN;
  await service.getForecastBundle(bangkok);
  assert.equal(net.calls.length, 3, "the same request within 5 minutes is not sent again");
  clock += 2 * MIN;
  await service.getForecastBundle(bangkok);
  assert.equal(net.calls.length, 5, "after 5 minutes it is, but the models' reply is kept for 30 minutes");
  clock += 25 * MIN;
  await service.getForecastBundle(bangkok);
  assert.equal(net.calls.length, 8, "after 30 minutes the models are asked again");

  const viaServer = good();
  await new OpenMeteoService({ proxy: true, fetch: viaServer.fetch, now: () => NOW, storage: null }).getForecastBundle(
    bangkok,
  );
  assert.ok(viaServer.calls[0].startsWith("/api/weather/forecast?latitude=13.756&"));
  assert.ok(viaServer.calls[1].startsWith("/api/weather/air-quality?latitude=13.756&"));
  assert.ok(viaServer.calls[2].startsWith("/api/weather/forecast?latitude=13.756&"));
  assert.ok(new URL(viaServer.calls[2], "https://doofah.test").searchParams.has("models"));

  const refused = fakeFetch(() => ({ error: true, reason: "Parameter 'hourly' is invalid" }));
  await assert.rejects(
    new OpenMeteoService({ fetch: refused.fetch, now: () => NOW, storage: null }).getForecastBundle(bangkok),
    (e: unknown) => e instanceof OpenMeteoError && e.status === 400 && e.message === "Parameter 'hourly' is invalid",
  );
  const noAir = fakeFetch((url) => (url.pathname.endsWith("/air-quality") ? new TypeError("fetch failed") : reply));
  const withoutAir = await new OpenMeteoService({
    fetch: noAir.fetch,
    now: () => NOW,
    storage: null,
  }).getForecastBundle(bangkok);
  assert.equal(withoutAir.current.airQuality, null, "the forecast still shows when air quality fails");
  const modelsDown = () =>
    fakeFetch((url) =>
      url.searchParams.has("models")
        ? { error: true, reason: "No data is available for this location" }
        : url.pathname.endsWith("/air-quality")
          ? airReply()
          : reply,
    );
  const withoutModels = await new OpenMeteoService({
    fetch: modelsDown().fetch,
    now: () => NOW,
    storage: null,
  }).getForecastBundle(bangkok);
  assert.equal(withoutModels.current.blend, undefined, "...and when the models fail");
  assert.equal(withoutModels.hourly[0].vote, undefined);
  console.log("✓ free servers from the browser, or /api/weather with a key; Open-Meteo's errors come through");

  // 12. Offline --------------------------------------------------------------------
  const storage = memoryStorage();
  await new OpenMeteoService({ fetch: good().fetch, now: () => NOW, storage }).getForecastBundle(bangkok);
  assert.ok(storage.items.get("doofah-saved-forecasts")?.includes('"13.756,100.502"'));
  const offline = fakeFetch(() => new TypeError("Failed to fetch"));
  const later = NOW + 2 * HOUR_MS;
  const saved = await new OpenMeteoService({ fetch: offline.fetch, now: () => later, storage }).getForecastBundle(
    bangkok,
  );
  assert.equal(saved.current.savedAt, iso(NOW), "says when it was downloaded");
  assert.equal(saved.current.observedAt, iso(later));
  assert.equal(saved.hourly[0].time, iso(floorToHour(later)), "the hours start at the hour it is now");
  assert.equal(saved.current.sample.temperatureC, tempAt(later), "now comes from the saved hourly forecast");
  assert.equal(saved.current.airQuality?.aqi, 162, "with the saved air quality while it is recent");
  assert.equal(saved.current.blend?.length, 6, "and the saved models");
  // Online, but the models fail: the saved ones fill in while they are under 6 hours old.
  const modelsStore = memoryStorage();
  await new OpenMeteoService({ fetch: good().fetch, now: () => NOW, storage: modelsStore }).getForecastBundle(bangkok);
  const in1h = await new OpenMeteoService({
    fetch: modelsDown().fetch,
    now: () => NOW + HOUR_MS,
    storage: modelsStore,
  }).getForecastBundle(bangkok);
  assert.equal(in1h.current.blend?.length, 6, "the saved models fill in when the new ones fail");
  const in7h = await new OpenMeteoService({
    fetch: modelsDown().fetch,
    now: () => NOW + 7 * HOUR_MS,
    storage: modelsStore,
  }).getForecastBundle(bangkok);
  assert.equal(in7h.current.blend, undefined, "but not once they are 6 hours old, though saved again since");
  await assert.rejects(
    new OpenMeteoService({ fetch: offline.fetch, now: () => NOW + 49 * HOUR_MS, storage }).getForecastBundle(bangkok),
    TypeError,
    "a forecast saved over 2 days ago is not shown",
  );
  await assert.rejects(
    new OpenMeteoService({ fetch: offline.fetch, now: () => NOW, storage: memoryStorage() }).getForecastBundle(bangkok),
    TypeError,
    "nothing saved: the error",
  );
  const many = memoryStorage();
  for (const [i, p] of PLACES.slice(0, 8).entries()) {
    const net8 = fakeFetch((url) => (url.pathname.endsWith("/air-quality") ? airReply() : forecastReply(hours, p)));
    await new OpenMeteoService({ fetch: net8.fetch, now: () => NOW + i * MIN, storage: many }).getForecastBundle(p);
  }
  const kept = Object.keys(JSON.parse(many.items.get("doofah-saved-forecasts")!));
  assert.equal(kept.length, 6, "6 places at most");
  assert.ok(!kept.includes("13.756,100.502"), "the oldest go first");
  const full = memoryStorage(true);
  await new OpenMeteoService({ fetch: good().fetch, now: () => NOW, storage: full }).getForecastBundle(bangkok);
  console.log("✓ offline: the last forecast for 6 places, up to 2 days old, with the time it was downloaded");

  // 13. Many spots in one request ---------------------------------------------------
  const chiangMai = place("chiang-mai");
  const spots = fakeFetch((url) => {
    const lats = url.searchParams.get("latitude")!.split(",");
    const replies = lats.map((lat, i) => spotReply({ lat: Number(lat), lon: 0 }, Array(8).fill(25 + i)));
    return replies.length === 1 ? replies[0] : replies;
  });
  const spotService = new OpenMeteoService({ fetch: spots.fetch, now: () => NOW, storage: null });
  const along = await spotService.getWeatherAlong([
    { point: bangkok.point, time: iso(NOW + HOUR_MS) },
    { point: chiangMai.point, time: iso(NOW + 5.5 * HOUR_MS) },
    { point: bangkok.point, time: iso(NOW + 3 * HOUR_MS) },
  ]);
  assert.equal(spots.calls.length, 1, "one request");
  const asked = new URL(spots.calls[0]).searchParams;
  assert.equal(asked.get("latitude"), "13.756,18.788", "each place once");
  assert.equal(asked.get("forecast_hours"), "8", "up to the last stop's hour and a little more");
  assert.deepEqual(
    along.map((s) => s.temperatureC),
    [25, 26, 25],
  );
  const one = await spotService.getWeatherAlong([{ point: chiangMai.point, time: iso(NOW) }]);
  assert.equal(one.length, 1, "a single place gets a single reply");
  const thirteen = PLACES.slice(0, 13).map((p) => ({ point: p.point, time: iso(NOW) }));
  const before = spots.calls.length;
  assert.equal((await spotService.getWeatherAlong(thirteen)).length, 13);
  assert.equal(spots.calls.length - before, 2, `${MAX_LOCATIONS} places per request`);
  const short = fakeFetch(() => [spotReply(bangkok.point, [30, 30])]);
  await assert.rejects(
    new OpenMeteoService({ fetch: short.fetch, now: () => NOW, storage: null }).getWeatherAlong([
      { point: bangkok.point, time: iso(NOW) },
      { point: chiangMai.point, time: iso(NOW) },
    ]),
    OpenMeteoError,
  );
  console.log("✓ favorites and road trip stops: one request for up to 12 places");

  // 14. The server proxy for a commercial key ------------------------------------------
  const upstream = fakeFetch((url) =>
    url.searchParams.get("latitude") === "0.000" ? { error: true, reason: "x" } : {},
  );
  const ask = (query: string, site: string | null = "same-origin", endpoint: "forecast" | "air-quality" = "forecast") =>
    proxyOpenMeteo(
      new Request(`https://doofah.example/api/weather/${endpoint}?${query}`, {
        headers: site ? { "sec-fetch-site": site } : {},
      }),
      endpoint,
      "SECRET",
      upstream.fetch,
    );
  const coords = "latitude=13.756&longitude=100.502";
  assert.equal(
    (
      await proxyOpenMeteo(
        new Request(`https://doofah.example/api/weather/forecast?${coords}`),
        "forecast",
        "",
        upstream.fetch,
      )
    ).status,
    404,
    "no key, no proxy",
  );
  assert.equal((await ask(coords, "cross-site")).status, 403, "other sites cannot spend the key");
  assert.equal((await ask("hourly=temperature_2m")).status, 400, "coordinates needed");
  const lots = Array(13).fill("1").join(",");
  assert.equal((await ask(`latitude=${lots}&longitude=${lots}`)).status, 400, "12 places at most");
  assert.equal((await ask(`${coords}&models=ecmwf_ifs,gfs_seamless`)).status, 400, "only the models DooFah blends");
  assert.equal(upstream.calls.length, 0);
  const ok = await ask(`${coords}&hourly=temperature_2m&timeformat=unixtime&apikey=stolen&cell_selection=sea`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("cache-control") ?? "", /s-maxage=300/);
  const sent = new URL(upstream.calls[0]);
  assert.equal(sent.origin, "https://customer-api.open-meteo.com");
  assert.equal(sent.searchParams.get("apikey"), "SECRET", "the server's key, not the caller's");
  assert.equal(sent.searchParams.get("cell_selection"), null, "only the parameters DooFah uses");
  assert.equal(sent.searchParams.get("hourly"), "temperature_2m");
  assert.equal((await ask(coords, null)).status, 200, "requests without the header (older browsers) pass");
  await ask(coords, "same-origin", "air-quality");
  assert.equal(new URL(upstream.calls.at(-1)!).origin, "https://customer-air-quality-api.open-meteo.com");
  const bad = await ask("latitude=0.000&longitude=0.000");
  assert.equal(bad.status, 400, "Open-Meteo's own errors come through");
  assert.equal(bad.headers.get("cache-control"), "no-store");
  const down = await proxyOpenMeteo(
    new Request(`https://doofah.example/api/weather/forecast?${coords}`),
    "forecast",
    "SECRET",
    fakeFetch(() => new TypeError("fetch failed")).fetch,
  );
  assert.equal(down.status, 502);
  const blendAsked = await ask(`${coords}&${consensusParams(bangkok)}`);
  assert.equal(blendAsked.status, 200);
  assert.equal(new URL(upstream.calls.at(-1)!).searchParams.get("models"), consensusParams(bangkok).get("models"));
  console.log("✓ /api/weather adds the key on the server, for DooFah's own pages only");

  // 15. The models' blend: how the chance of rain and the confidence are weighed -----------
  const models = consensusParams(bangkok);
  assert.equal(models.get("models"), CONSENSUS_MODELS.map((m) => m.id).join(","));
  assert.equal(models.get("hourly"), "precipitation,precipitation_probability,weather_code");
  assert.equal(models.get("forecast_days"), "8");
  assert.equal(models.get("timezone"), "Asia/Bangkok");
  // Open-Meteo counts every 10 variables (models × variables) as one call.
  assert.equal((CONSENSUS_MODELS.length * CONSENSUS_VARIABLES.length) / 10, 2.1);
  const votes = (wet: number, dry = 0) => Array.from({ length: wet + dry }, (_, i) => ({ wet: i < wet, weight: 1 }));
  const ens = (...chances: number[]) => chances.map((chance) => ({ chance, members: 36 }));
  assert.deepEqual(weigh({ votes: votes(7), ensembles: ens(1, 1, 1) }), { chance: 100, confidence: 1 });
  assert.deepEqual(weigh({ votes: votes(0, 7), ensembles: ens(0, 0) }), { chance: 0, confidence: 1 });
  assert.deepEqual(
    weigh({ votes: votes(3, 3), ensembles: ens(0.5, 0.5) }),
    { chance: 50, confidence: 0 },
    "50% is never confident, however well the sources agree",
  );
  const likely = weigh({ votes: votes(6, 1), ensembles: ens(0.9, 0.8) })!;
  assert.equal(likely.chance, 85);
  assert.equal(confidenceLevel(likely.confidence), "high");
  assert.equal(support(likely, true), "high");
  assert.equal(support(likely, false), "low", "they lean the other way");
  const clash = weigh({ votes: votes(6), ensembles: ens(0.2, 0.2) })!;
  assert.equal(clash.chance, 52, "every model has rain, but only 20% of the ensembles' runs");
  assert.equal(confidenceLevel(clash.confidence), "low");
  assert.equal(weigh({ votes: votes(7), ensembles: [] }), null, "the votes alone can't be checked against anything");
  assert.equal(weigh({ votes: votes(2), ensembles: ens(0.9) }), null, "two models are not a source of their own");
  assert.ok(weigh({ votes: votes(2), ensembles: ens(0.9, 0.7) }), "two ensembles are two sources");
  console.log(
    `✓ weighing: all agree ${JSON.stringify(weigh({ votes: votes(7), ensembles: ens(1, 1) }))}, ` +
      `likely ${JSON.stringify(likely)}, clash ${JSON.stringify(clash)}`,
  );

  // 16. The models' blend for each hour and day ------------------------------------------
  const blend = consensusFrom(stormReply, NOW)!;
  assert.deepEqual(
    blend.models.map((m) => m.id),
    CONSENSUS_MODELS.map((m) => m.id).filter((id) => id !== "cma_grapes_global"),
    "a model that sent only nulls is left out",
  );
  const at16 = blend.hours.get(storm)!;
  const { chance: chance16, confidence: confidence16, ...counts16 } = at16;
  assert.deepEqual(counts16, {
    models: 6,
    // Heavy rain counts only from models stepping hourly then (not the 6-hourly AI models).
    wet: 6,
    heavy: 4,
    // Thunder only from models that forecast it (not the AI models).
    stormModels: 4,
    storm: 4,
    // ECMWF 51, DWD 40, NOAA 31 and Canada 21 runs; AIGFS's chance is empty.
    ensembles: 4,
    members: 143,
  });
  assert.equal(chance16, 94);
  assert.equal(confidenceLevel(confidence16), "high");
  assert.equal(blend.hours.get(storm - HOUR_MS)!.wet, 0, "each hour reads the record an hour after it");
  assert.equal(blend.hours.get(storm + HOUR_MS)!.wet, 0);
  assert.equal(blend.hours.get(storm - HOUR_MS)!.chance, 3);
  assert.ok(blend.hours.has(midnight + 190 * HOUR_MS));
  assert.ok(!blend.hours.has(midnight + 191 * HOUR_MS), "the last record's hour has no record after it");
  const farAhead = thisHour + 100 * HOUR_MS;
  const far = consensusFrom(
    modelsReply(midnight, (_, t) => (t === farAhead ? 5 : 0)),
    NOW,
  )!.hours.get(farAhead)!;
  assert.deepEqual([far.wet, far.heavy], [7, 1], "100 hours ahead only GFS still steps hourly");
  const gap = consensusFrom(
    modelsReply(midnight, (m, t) => (m.id === "dwd_icon_global" && t === storm ? null : 0)),
    NOW,
  )!;
  assert.equal(gap.hours.get(storm)!.models, 6, "a model missing an hour doesn't vote on it");
  assert.equal(
    consensusFrom(
      modelsReply(midnight, (m) => (m.id === "ecmwf_ifs" ? 0 : null)),
      NOW,
    ),
    null,
  );
  assert.equal(consensusFrom(null, NOW), null);

  const startsOf = (day: number) => bundle.daily[day].hours.map((x) => Date.parse(x.time));
  const stormDay = dayVote(stormReply, startsOf(0))!;
  assert.deepEqual(
    [stormDay.models, stormDay.wet, stormDay.storm, stormDay.stormModels, stormDay.chance],
    [6, 6, 4, 4, 94],
  );
  assert.equal(dayVote(stormReply, startsOf(1))!.wet, 0);
  const drizzle = modelsReply(midnight, () => 0.05);
  assert.equal(consensusFrom(drizzle, NOW)!.hours.get(storm)!.wet, 0, "0.05 mm in an hour isn't rain...");
  assert.equal(dayVote(drizzle, startsOf(0))!.wet, 7, "...but 1.2 mm in a day is a rainy day");
  assert.equal(dayVote(stormReply, startsOf(7)), null, "a day the reply doesn't cover whole");

  const blended = forecastBundle(reply, null, bangkok, NOW, undefined, stormReply);
  const hourAt = (b: ForecastBundle, t: number) => b.hourly.find((x) => Date.parse(x.time) === t)!;
  assert.equal(hourAt(blended, storm).precipitationProbability, 94);
  assert.equal(hourAt(blended, storm).confidence, confidence16);
  assert.deepEqual(hourAt(blended, storm).vote, at16);
  assert.equal(
    hourAt(blended, storm).precipitationMm,
    hourAt(bundle, storm).precipitationMm,
    "the rain itself stays the forecast's (ECMWF 9 km)",
  );
  assert.ok(
    blended.hourly.every((x) => x.vote),
    "the 48-hour strip is all blended",
  );
  blended.daily.forEach((day, i) => {
    if (i < 7) {
      assert.ok(day.vote, `the models' view of ${day.date}`);
      assert.equal(day.confidence, day.vote.confidence);
      assert.equal(day.precipitationProbability, day.vote.chance);
    } else {
      assert.equal(day.vote, undefined, `${day.date} is past the models' week`);
      assert.equal(day.confidence, null);
    }
  });
  assert.deepEqual(
    blended.current.blend?.map((b) => b.centre),
    ["ECMWF", "DWD", "NOAA", "ECCC", "ECMWF", "NOAA"],
  );
  assert.equal(bundle.current.blend, undefined);
  console.log(
    `✓ 16:00 storm: ${counts16.wet}/${counts16.models} models, ${chance16}% (${confidenceLevel(confidence16)}); ` +
      `this week blended, the rest from the forecast alone`,
  );

  // 17. The rain countdown listens to the models --------------------------------------------
  const fen = createFormatters("en");
  const clockAt = (t: string) => fen.clock(t, bangkok.timeZone);
  const withModels = (minutely: ForecastResponse["minutely_15"], raw: ConsensusResponse) => {
    const b = forecastBundle(
      forecastReply(dry, bangkok, { current: current(), minutely_15: minutely }),
      null,
      bangkok,
      NOW,
      undefined,
      raw,
    );
    return rainCountdown(b.current, b.hourly, b.daily, NOW);
  };
  const wetFrom = (start: number) => modelsReply(midnight, (_, t) => (t >= start && t < start + 3 * HOUR_MS ? 3 : 0));
  const showerQuarters = quarters([0, 0, 0.5, 0.75, 0.75, 0.5, 0.25, 0, 0, 0, 0, 0]);
  const dryQuarters = quarters(Array(12).fill(0));
  const say = (c: RainCountdown) => {
    const o = modelOutlook(c, NOW, clockAt);
    return o && MESSAGES.en.modelOutlook(o);
  };

  const doubted = withModels(
    showerQuarters,
    modelsReply(midnight, () => 0),
  );
  assert.equal(doubted.kind, "starting");
  assert.equal(doubted.kind === "starting" && doubted.doubtful, true, "rain no model has is only possible");
  assert.deepEqual(modelOutlook(doubted, NOW, clockAt), {
    kind: "rain",
    clock: "14:41",
    agree: 0,
    total: 7,
    chance: 3,
    level: "low",
    heavy: false,
    storm: false,
  });
  const backed = withModels(showerQuarters, wetFrom(thisHour));
  assert.equal(backed.kind === "starting" && backed.doubtful, undefined);
  assert.equal(modelOutlook(backed, NOW, clockAt)?.level, "high");
  const soon = withModels(dryQuarters, wetFrom(thisHour + HOUR_MS));
  assert.deepEqual(
    soon.kind === "later" && [soon.soon, soon.at],
    [true, iso(thisHour + HOUR_MS)],
    "rain the models agree on within 2 hours, though the 15-minute forecast has none",
  );
  const soonNow = withModels(dryQuarters, wetFrom(thisHour));
  assert.equal(soonNow.kind === "later" && soonNow.at, iso(NOW));
  assert.equal((modelOutlook(soonNow, NOW, clockAt) as Extract<ModelOutlook, { kind: "rain" }>).clock, null);
  const showerAt18 = withModels(
    dryQuarters,
    modelsReply(midnight, (m, t) =>
      t === thisHour + 4 * HOUR_MS && (m.id === "ncep_gfs_global" || m.id === "dwd_icon_global") ? 0.5 : 0,
    ),
  );
  assert.equal(showerAt18.kind, "dry");
  assert.equal(showerAt18.kind === "dry" && showerAt18.showerAt, iso(thisHour + 4 * HOUR_MS));
  const dryOutlook = modelOutlook(showerAt18, NOW, clockAt) as Extract<ModelOutlook, { kind: "dry" }>;
  assert.deepEqual([dryOutlook.agree, dryOutlook.total, dryOutlook.showerClock], [5, 7, "18:00"]);
  const allDry = withModels(
    dryQuarters,
    modelsReply(midnight, () => 0),
  );
  assert.deepEqual(modelOutlook(allDry, NOW, clockAt), {
    kind: "dry",
    hours: 24,
    agree: 7,
    total: 7,
    showerClock: clockAt(allDry.kind === "dry" ? allDry.showerAt! : ""),
    chance: 3,
    level: "high",
  });

  const vote = (fields: Partial<ModelVote> = {}): ModelVote => ({
    models: 7,
    wet: 4,
    heavy: 0,
    stormModels: 5,
    storm: 0,
    ensembles: 4,
    members: 143,
    chance: 70,
    confidence: 0.8,
    ...fields,
  });
  const rainIn = (v: ModelVote, minutes = 60) =>
    modelOutlook(
      { kind: "later", at: iso(NOW + minutes * MIN), chance: v.chance, clear: false, vote: v },
      NOW,
      clockAt,
    ) as Extract<ModelOutlook, { kind: "rain" }>;
  assert.equal(rainIn(vote(), 10).clock, null, "under 15 minutes away is soon");
  assert.equal(rainIn(vote(), 38).clock, "14:58", "else when");
  assert.equal(rainIn(vote({ heavy: 2, wet: 4 })).heavy, true);
  assert.equal(rainIn(vote({ heavy: 2, wet: 5 })).heavy, false, "heavy in under half the models with rain");
  assert.equal(rainIn(vote({ heavy: 1, wet: 1 })).heavy, false, "one model is not enough");
  assert.equal(rainIn(vote({ storm: 2, stormModels: 6 })).storm, true);
  assert.equal(rainIn(vote({ storm: 2, stormModels: 7 })).storm, false);
  assert.equal(rainIn(vote({ chance: 30 })).level, "low", "the models lean dry");
  assert.equal(
    modelOutlook({ kind: "raining", intensity: "light", until: null, precise: false, vote: vote() }, NOW, clockAt),
    null,
  );
  assert.equal(modelOutlook({ kind: "later", at: iso(NOW + HOUR_MS), chance: 70, clear: false }, NOW, clockAt), null);
  const split = { kind: "rain", clock: "23:00", agree: 3, total: 7, level: "low", heavy: false, storm: false } as const;
  assert.equal(
    MESSAGES.en.modelOutlook({ ...split, chance: 69 }),
    "Models are split on rain around 23:00: 3 of 7 expect it (69%).",
    "a likely chance from the ensembles never reads as 'may stay dry'",
  );
  assert.equal(
    MESSAGES.en.modelOutlook({ ...split, chance: 31 }),
    "Only 3 of 7 models expect rain around 23:00, so it may stay dry (31%).",
  );
  for (const c of [doubted, backed, soon, showerAt18, allDry]) console.log(`  ${c.kind}: ${say(c)}`);
  console.log("✓ the countdown doubts rain the models don't see, and warns of rain they agree on");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
