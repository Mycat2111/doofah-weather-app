/**
 * Checks for the map's live layers (step 4): the lattice and its slots, the
 * ECMWF request and reply for a tile, /api/fields, the frames the page puts
 * together from tiles (all five layers, every hour of the timeline), that
 * the map reads the same numbers as the forecast card for the same place and
 * hour, and the motion between hours for the cloud layer. Builds Open-Meteo's
 * replies here, so it needs no network.
 * Run with: npm run verify:fields
 */
import assert from "node:assert/strict";
import { frameBetween, frameFlow } from "../src/components/radar/interpolate";
import { frameAt } from "../src/hooks/useRadarFrames";
import { ecmwfFromOpenMeteo } from "../src/services/forecast/ecmwf";
import { FieldError, FieldService, framesFrom } from "../src/services/fields/FieldService";
import { FIELD_VARIABLES, fieldParams, fieldTileFrom, type FieldTile } from "../src/services/fields/ecmwfFields";
import { defaultTileSource, fieldsResponse, type TileSource } from "../src/services/fields/http";
import type { Alert } from "../src/services/ops/alert";
import {
  AHEAD_HOURS,
  fieldView,
  latticeRange,
  MAX_VIEW,
  parseSlot,
  PAST_HOURS,
  SLOT_MS,
  slotHours,
  slotKey,
  slotOf,
  SPACINGS,
  spacingFor,
  TILE,
  tileAllowed,
  tileKey,
  tilePoints,
  tilesFor,
  type Spacing,
  type TileId,
} from "../src/services/fields/lattice";
import { CUSTOMER_URL, FREE_URL, OpenMeteoError, type ForecastResponse } from "../src/services/openmeteo/api";
import { weatherSimulation } from "../src/services/simulation/SimulatedWeatherService";
import { sampleGrid } from "../src/services/weather/grid";
import { floorToHour, HOUR_MS } from "../src/services/weather/time";
import type {
  CloudFrame,
  GeoBounds,
  PrecipitationFrame,
  RadarFrameSet,
  RadarGridSpec,
  RadarLayerType,
  TemperatureFrame,
  WindFrame,
} from "../src/services/weather/types";

const MIN = 60_000;
const KMH_PER_MS = 3.6;
const NOW = Date.UTC(2026, 9, 3, 7, 20); // 3 Oct 2026, 14:20 in Bangkok
const SLOT = Date.UTC(2026, 9, 3, 2); // its slot: 02 to 08 UTC
const BANGKOK: GeoBounds = [
  [12.5, 99.5],
  [15, 102],
];
const LAYERS: RadarLayerType[] = ["precipitation", "wind", "clouds", "temperature", "pressure"];

let checks = 0;
const check = (name: string, fn: () => void | Promise<void>) => ({ name, fn });

/* ------------------------------------------------------------------ */
/* Synthetic ECMWF: smooth fields of place and time, as Open-Meteo     */
/* would send them for a list of points.                               */
/* ------------------------------------------------------------------ */

/** Values at a place and hour (ms), in Open-Meteo's units. */
function weather(lat: number, lon: number, time: number) {
  const h = (time - SLOT) / HOUR_MS;
  return {
    // Rain for the hour *before* `time`, as Open-Meteo gives it: a band moving east.
    precipitation: Math.max(0, 4 - Math.abs(lon - 100 - 0.2 * h) * 3 + (lat - 13) * 0.1),
    cloud_cover: Math.min(100, Math.max(0, 50 + 20 * Math.sin(lat + h / 5) + 10 * Math.cos(lon))),
    temperature_2m: 30 - 0.4 * (lat - 13) + 0.05 * lon + Math.sin(h / 4),
    pressure_msl: 1008 + 0.3 * lat - 0.1 * h,
    wind_speed_10m: 10 + Math.abs(lat - lon / 10),
    wind_direction_10m: (225 + 10 * h) % 360,
  };
}

/** Open-Meteo's reply for a request: one entry per point, hourly from start_hour to end_hour. */
function openMeteoReply(params: URLSearchParams, options: { drop?: boolean; late?: number } = {}) {
  const lats = params.get("latitude")!.split(",").map(Number);
  const lons = params.get("longitude")!.split(",").map(Number);
  const start = Date.parse(`${params.get("start_hour")}Z`) + (options.late ?? 0);
  const end = Date.parse(`${params.get("end_hour")}Z`);
  const times: number[] = [];
  for (let t = start; t <= end; t += HOUR_MS) times.push(t);
  const reply = lats.map((lat, p) => {
    const lon = lons[p];
    const hourly: Record<string, (number | null)[]> = { time: times.map((t) => t / 1000) };
    for (const name of FIELD_VARIABLES) hourly[name] = times.map((t) => weather(lat, lon, t)[name]);
    return { latitude: lat, longitude: lon, utc_offset_seconds: 0, timezone: "GMT", hourly };
  });
  return options.drop ? reply.slice(1) : reply;
}

/** A tile as /api/fields would answer it, built from the synthetic reply. */
const tileFor = (tile: TileId, slot = SLOT) => fieldTileFrom(openMeteoReply(fieldParams(tile, slot)), tile, slot);

/** A fetch that answers /api/fields from synthetic tiles, counting what it was asked. */
function fieldsFetch(options: { fail?: (url: string) => number | null } = {}) {
  const asked: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const failing = options.fail?.(url);
    if (failing) return Response.json({ error: true, reason: "busy" }, { status: failing });
    const q = new URL(url, "https://doofah.test").searchParams;
    const [row, col] = q.get("tile")!.split(",").map(Number);
    const spacing = Number(q.get("spacing")) as Spacing;
    return Response.json(tileFor({ spacing, row, col }, parseSlot(q.get("slot"))!));
  }) as typeof fetch;
  return { fetcher, asked };
}

const close = (a: number, b: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} vs ${b}`);

/** The lattice point a grid cell is centred on. */
const cellPoint = (grid: RadarGridSpec, r: number, c: number) => ({
  lat: grid.bounds[1][0] - (r + 0.5) * grid.latStep,
  lon: grid.bounds[0][1] + (c + 0.5) * grid.lonStep,
});

const CHECKS = [
  /* ---------------- Lattice and slots ---------------- */

  check("slots start at 02, 08, 14 and 20 UTC", () => {
    assert.equal(slotOf(NOW), SLOT);
    assert.equal(slotOf(SLOT), SLOT);
    assert.equal(slotOf(SLOT - 1), Date.UTC(2026, 9, 2, 20));
    assert.equal(slotOf(Date.UTC(2026, 9, 3, 23, 59)), Date.UTC(2026, 9, 3, 20));
    assert.equal(slotKey(SLOT), "2026-10-03T02");
    assert.equal(parseSlot("2026-10-03T02"), SLOT);
    assert.equal(parseSlot("2026-10-03T20"), Date.UTC(2026, 9, 3, 20));
    for (const bad of [null, "", "2026-10-03T03", "2026-10-03T02:00", "2026-13-03T02", "x"]) {
      assert.equal(parseSlot(bad), null, String(bad));
    }
  }),

  check("a tile's hours cover the whole timeline at every moment of its slot", () => {
    const { start, end } = slotHours(SLOT);
    for (let now = SLOT; now < SLOT + SLOT_MS; now += 10 * MIN) {
      const hour = floorToHour(now);
      assert.ok(hour - PAST_HOURS * HOUR_MS >= start, new Date(now).toISOString());
      assert.ok(hour + AHEAD_HOURS * HOUR_MS <= end, new Date(now).toISOString());
    }
  }),

  check("the spacing keeps about a dozen points across any view", () => {
    for (const span of [0.5, 1, 1.5, 3, 6, 12, 24, 40, 50]) {
      const view = fieldView([
        [13, 100],
        [13 + span * 0.6, 100 + span],
      ]);
      const spacing = spacingFor(view);
      const across = Math.max(view[1][0] - view[0][0], view[1][1] - view[0][1]) / spacing;
      if (spacing !== SPACINGS[SPACINGS.length - 1]) assert.ok(across <= 12, `${span}° → ${spacing}°`);
    }
    assert.equal(spacingFor(BANGKOK), 0.25);
    assert.equal(
      spacingFor([
        [13, 100],
        [14, 101],
      ]),
      0.125,
    );
  }),

  check("zoomed far out, only the middle of the view gets layers", () => {
    const [[s, w], [n, e]] = fieldView([
      [-80, -40],
      [85, 140],
    ]);
    assert.equal(e - w, MAX_VIEW.lon);
    assert.equal(w + (e - w) / 2, 50);
    assert.ok(n - s <= MAX_VIEW.lat && s >= -75 && n <= 75);
  }),

  check("every view asks for a small, bounded number of tiles, all of which the server answers", () => {
    let most = 0;
    for (let lat = -70; lat <= 70; lat += 7.3) {
      for (let lon = -200; lon <= 380; lon += 23.7) {
        for (const span of [0.6, 1.4, 2.9, 5.5, 11, 23, 47, 90, 160]) {
          const view = fieldView([
            [lat - span * 0.35, lon - span / 2],
            [lat + span * 0.35, lon + span / 2],
          ]);
          const spacing = spacingFor(view);
          const tiles = tilesFor(view, spacing);
          most = Math.max(most, tiles.length);
          for (const tile of tiles) assert.ok(tileAllowed(tile), `${tileKey(tile)} at ${spacing}°`);
          // The tiles hold every point the view needs.
          const { i0, i1, j0, j1 } = latticeRange(view, spacing);
          const rows = new Set(tiles.map((t) => t.row));
          const cols = new Set(tiles.map((t) => t.col));
          for (let i = i0; i <= i1; i++) assert.ok(rows.has(Math.floor(i / TILE)));
          for (let j = j0; j <= j1; j++) assert.ok(cols.has(Math.floor(j / TILE)));
        }
      }
    }
    // Open-Meteo counts each point: at most this many calls for a view no tile of which is cached yet.
    assert.ok(most <= 16, `${most} tiles`);
    console.log(`  most tiles for one view: ${most} (${most * TILE * TILE} points)`);
  }),

  check("a tile's points run north row first, west to east, wrapped to ±180°", () => {
    const points = tilePoints({ spacing: 0.25, row: 2, col: 1 });
    assert.equal(points.length, TILE * TILE);
    assert.deepEqual(points[0], { lat: 4.25, lon: 1.5 });
    assert.deepEqual(points[TILE - 1], { lat: 4.25, lon: 2.75 });
    assert.deepEqual(points[TILE * TILE - 1], { lat: 3, lon: 2.75 });
    const east = tilePoints({ spacing: 2, row: 0, col: 15 });
    assert.ok(east.every((p) => p.lon >= -180 && p.lon < 180));
    assert.equal(east[0].lon, 180 - 360);
    assert.ok(!tileAllowed({ spacing: 2, row: 9, col: 0 }), "beyond the poles");
    assert.ok(!tileAllowed({ spacing: 2, row: 0, col: 50 }), "too far round the world");
  }),

  /* ---------------- The ECMWF request and reply ---------------- */

  check("a tile's request asks ECMWF for its points and its slot's hours", () => {
    const tile: TileId = { spacing: 0.25, row: 9, col: 66 };
    const params = fieldParams(tile, SLOT);
    assert.equal(params.get("models"), "ecmwf_ifs");
    assert.equal(params.get("hourly"), FIELD_VARIABLES.join(","));
    assert.equal(params.get("latitude")!.split(",").length, TILE * TILE);
    assert.equal(params.get("latitude")!.split(",")[0], "14.750");
    assert.equal(params.get("longitude")!.split(",")[0], "99.000");
    assert.equal(params.get("start_hour"), "2026-10-02T23:00");
    // The slot's last hour (a day after it ends) and one more for that hour's rain.
    assert.equal(params.get("end_hour"), "2026-10-04T09:00");
    assert.equal(params.get("timezone"), "GMT");
    assert.equal(params.get("timeformat"), "unixtime");
  }),

  check("a tile reads the rain from the hour after, like the forecast; the rest at the hour", () => {
    const id: TileId = { spacing: 0.25, row: 9, col: 66 };
    const tile = tileFor(id);
    const { start, end } = slotHours(SLOT);
    assert.equal(tile.start, start);
    assert.equal(tile.hours, (end - start) / HOUR_MS + 1);
    assert.equal(tile.size, TILE);
    const points = tilePoints(id);
    for (const k of [0, 5, tile.hours - 1]) {
      for (const p of [0, 7, 35]) {
        const { lat, lon } = points[p];
        const time = start + k * HOUR_MS;
        const at = weather(lat, lon, time);
        const o = k * TILE * TILE + p;
        close(tile.rain[o]!, weather(lat, lon, time + HOUR_MS).precipitation, 0.005, "rain");
        assert.equal(tile.cloud[o], Math.round(at.cloud_cover));
        close(tile.temperature[o]!, at.temperature_2m, 0.051, "temperature");
        close(tile.pressure[o]!, at.pressure_msl, 0.051, "pressure");
        const speed = Math.hypot(tile.wind_u[o]!, tile.wind_v[o]!);
        close(speed, at.wind_speed_10m, 0.1, "wind speed");
      }
    }
  }),

  check("wind turns into its parts towards the east and north, in km/h", () => {
    const id: TileId = { spacing: 2, row: 0, col: 0 };
    const reply = openMeteoReply(fieldParams(id, SLOT)) as { hourly: Record<string, (number | null)[]> }[];
    const set = (speed: number, from: number) => {
      reply[0].hourly.wind_speed_10m[0] = speed;
      reply[0].hourly.wind_direction_10m[0] = from;
      const tile = fieldTileFrom(reply, id, SLOT);
      return { u: tile.wind_u[0]!, v: tile.wind_v[0]! };
    };
    const north = set(10, 0); // from the north: blows south
    close(north.u, 0, 1e-9, "u");
    close(north.v, -10, 1e-9, "v");
    const east = set(20, 90); // from the east: blows west
    close(east.u, -20, 1e-9, "u");
    close(east.v, 0, 0.051, "v");
  }),

  check("gaps stay empty, negative rain is none, and a short or wrong reply is refused", () => {
    const id: TileId = { spacing: 2, row: 0, col: 0 };
    const reply = openMeteoReply(fieldParams(id, SLOT)) as { hourly: Record<string, (number | null)[]> }[];
    reply[3].hourly.temperature_2m[0] = null;
    reply[3].hourly.precipitation[1] = -0.2;
    reply[4].hourly.wind_direction_10m[0] = null;
    const tile = fieldTileFrom(reply, id, SLOT);
    assert.equal(tile.temperature[3], null);
    assert.equal(tile.rain[3], 0);
    assert.equal(tile.wind_u[4], null);
    assert.throws(() => fieldTileFrom(reply.slice(1), id, SLOT), OpenMeteoError);
    assert.throws(
      () => fieldTileFrom(openMeteoReply(fieldParams(id, SLOT), { late: HOUR_MS }), id, SLOT),
      OpenMeteoError,
    );
    assert.throws(() => fieldTileFrom([{}, ...reply.slice(1)], id, SLOT), OpenMeteoError);
  }),

  check("the map reads the same numbers as the forecast card for the same place and hour", () => {
    const id: TileId = { spacing: 0.125, row: 18, col: 134 }; // Bangkok
    const tile = tileFor(id);
    const p = 14;
    const { lat, lon } = tilePoints(id)[p];
    // The card's ECMWF for that point, from the same model values.
    const params = fieldParams(id, SLOT);
    const one = openMeteoReply(params)[p];
    const card = ecmwfFromOpenMeteo({ ...one, timezone: "Asia/Bangkok" } as unknown as ForecastResponse).series.hours;
    for (const [k, hour] of card.entries()) {
      const o = k * TILE * TILE + p;
      assert.equal(hour.time, tile.start + k * HOUR_MS);
      close(tile.rain[o]!, hour.rainMm!, 0.005, `rain ${k}`);
      assert.equal(tile.cloud[o], Math.round(hour.cloudCover!));
      close(tile.temperature[o]!, hour.temperatureC!, 0.051, `temperature ${k}`);
      close(tile.pressure[o]!, hour.pressureHpa!, 0.051, `pressure ${k}`);
      close(tile.wind_u[o]! / KMH_PER_MS, hour.windU!, 0.051, `wind east ${k}`);
      close(tile.wind_v[o]! / KMH_PER_MS, hour.windV!, 0.051, `wind north ${k}`);
    }
    assert.equal(card.length, tile.hours);
    assert.ok(lat > 13 && lat < 14 && lon > 100 && lon < 101, `${lat}, ${lon}`);
    assert.ok(
      card.some((h) => (h.rainMm ?? 0) > 0),
      "some rain to compare",
    );
  }),

  /* ---------------- /api/fields ---------------- */

  check("/api/fields answers a tile, kept in the browser and at the edge for the rest of its slot", async () => {
    const id: TileId = { spacing: 0.25, row: 9, col: 66 };
    const asked: string[] = [];
    const source: TileSource = async (tile, slot) => {
      asked.push(`${tileKey(tile)}@${slotKey(slot)}`);
      return tileFor(tile, slot);
    };
    const url = `https://doofah.test/api/fields?spacing=0.25&tile=9,66&slot=2026-10-03T02`;
    const response = await fieldsResponse(
      new Request(url, { headers: { "sec-fetch-site": "same-origin" } }),
      source,
      NOW,
    );
    assert.equal(response.status, 200);
    const left = (SLOT + SLOT_MS - NOW) / 1000;
    assert.equal(response.headers.get("Cache-Control"), `public, max-age=${left}`);
    assert.equal(response.headers.get("Vercel-CDN-Cache-Control"), `max-age=${left}, stale-while-revalidate=3600`);
    const body = (await response.json()) as FieldTile;
    assert.deepEqual(body, tileFor(id));
    assert.deepEqual(asked, ["9,66@2026-10-03T02"]);
    // The slot before, for a clock a little behind: answered, kept a minute.
    const before = await fieldsResponse(new Request(url.replace("2026-10-03T02", "2026-10-02T20")), source, NOW);
    assert.equal(before.status, 200);
    assert.equal(before.headers.get("Cache-Control"), "public, max-age=60");
    assert.match(before.headers.get("Vercel-CDN-Cache-Control")!, /^max-age=60,/);
  }),

  check("/api/fields refuses other sites, bad requests, far-off tiles and other slots", async () => {
    const source: TileSource = async () => assert.fail("must not ask Open-Meteo");
    const ask = (query: string, site?: string) =>
      fieldsResponse(
        new Request(`https://doofah.test/api/fields?${query}`, site ? { headers: { "sec-fetch-site": site } } : {}),
        source,
        NOW,
      );
    const good = "spacing=0.25&tile=9,66&slot=2026-10-03T02";
    assert.equal((await ask(good, "cross-site")).status, 403);
    for (const bad of [
      "spacing=0.3&tile=9,66&slot=2026-10-03T02",
      "spacing=0.25&tile=9&slot=2026-10-03T02",
      "spacing=0.25&tile=9,66,1&slot=2026-10-03T02",
      "spacing=0.25&tile=a,b&slot=2026-10-03T02",
      "spacing=0.25&tile=9,66&slot=2026-10-03T03",
      "spacing=0.25&tile=9,66",
      "spacing=2&tile=9,0&slot=2026-10-03T02",
      "spacing=0.25&tile=9,66&slot=2026-10-02T14",
      "spacing=0.25&tile=9,66&slot=2026-10-03T14",
    ]) {
      const response = await ask(bad);
      assert.equal(response.status, 400, bad);
      assert.equal(response.headers.get("Cache-Control"), "no-store", bad);
    }
  }),

  check("/api/fields says when Open-Meteo is busy or down, and sends an alert", async () => {
    const alerts: Alert[] = [];
    const ask = (error: Error) =>
      fieldsResponse(
        new Request("https://doofah.test/api/fields?spacing=0.25&tile=9,66&slot=2026-10-03T02"),
        async () => {
          throw error;
        },
        NOW,
        (alert) => alerts.push(alert),
      );
    const busy = await ask(new OpenMeteoError("Too many requests", 429));
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get("Retry-After"), "60");
    assert.equal(busy.headers.get("Cache-Control"), "no-store");
    assert.equal(busy.headers.get("Vercel-CDN-Cache-Control"), null, "a failure is never kept");
    assert.equal((await ask(new OpenMeteoError("Bad", 400))).status, 502);
    const log = console.error;
    console.error = () => {};
    try {
      assert.equal((await ask(new Error("boom"))).status, 500);
    } finally {
      console.error = log;
    }
    assert.deepEqual(alerts, [
      { kind: "error", api: "/api/fields", message: "503, Open-Meteo's per-minute limit: Too many requests" },
      { kind: "error", api: "/api/fields", message: "502, ECMWF unavailable: Bad" },
      { kind: "error", api: "/api/fields", message: "500: boom" },
    ]);
  }),

  check("tiles go to Open-Meteo's free servers, or its customer servers with the key", async () => {
    const urls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const params = new URL(String(input)).searchParams;
      return Response.json(openMeteoReply(params));
    }) as typeof fetch;
    const id: TileId = { spacing: 0.25, row: 9, col: 66 };
    await defaultTileSource({}, fetcher)(id, SLOT);
    await defaultTileSource({ OPEN_METEO_API_KEY: " k3y " }, fetcher)(id, SLOT);
    assert.ok(urls[0].startsWith(`${FREE_URL.forecast}?`) && !urls[0].includes("apikey"));
    assert.ok(urls[1].startsWith(`${CUSTOMER_URL.forecast}?`) && urls[1].includes("apikey=k3y"));
    const failing = (async () =>
      Response.json({ error: true, reason: "Hourly limit exceeded" }, { status: 429 })) as unknown as typeof fetch;
    await assert.rejects(defaultTileSource({}, failing)(id, SLOT), (e: unknown) => {
      return e instanceof OpenMeteoError && e.status === 429;
    });
  }),

  check("a tile is asked for again once after a 5xx, never after a 429", async () => {
    const statuses: number[] = [];
    const answering = (...first: number[]) =>
      (async (input: RequestInfo | URL) => {
        const status = first.shift() ?? 200;
        statuses.push(status);
        return status === 200
          ? Response.json(openMeteoReply(new URL(String(input)).searchParams))
          : Response.json({ error: true, reason: "Busy" }, { status });
      }) as typeof fetch;
    const id: TileId = { spacing: 0.25, row: 9, col: 66 };
    assert.deepEqual(await defaultTileSource({}, answering(503))(id, SLOT), tileFor(id, SLOT));
    assert.deepEqual(statuses.splice(0), [503, 200], "the second try answers");
    await assert.rejects(defaultTileSource({}, answering(502, 504))(id, SLOT), /Busy/);
    assert.deepEqual(statuses.splice(0), [502, 504], "two tries in all");
    await assert.rejects(defaultTileSource({}, answering(429))(id, SLOT), /Busy/);
    assert.deepEqual(statuses.splice(0), [429], "a 429 isn't asked again");
  }),

  /* ---------------- Frames in the page ---------------- */

  check("the page's frames put each lattice point at a cell centre, every hour of the timeline", async () => {
    const { fetcher, asked } = fieldsFetch();
    const service = new FieldService({ fetch: fetcher, now: () => NOW });
    const set = (await service.getRadarFrames({
      layer: "temperature",
      bounds: BANGKOK,
    })) as RadarFrameSet<"temperature">;
    assert.ok(
      asked.every((url) => url.startsWith("/api/fields?spacing=0.25&tile=") && url.endsWith("slot=2026-10-03T02")),
    );
    assert.equal(set.frames.length, PAST_HOURS + AHEAD_HOURS + 1);
    const hour = floorToHour(NOW);
    set.frames.forEach((frame, i) => {
      assert.equal(Date.parse(frame.time), hour + (i - PAST_HOURS) * HOUR_MS);
      assert.equal(frame.offsetHours, i - PAST_HOURS);
      assert.equal(frame.kind, i <= PAST_HOURS ? "analysis" : "forecast");
    });
    const { grid } = set;
    assert.equal(grid.latStep, 0.25);
    assert.equal(grid.cellSizeKm, 28);
    // The view is inside the grid, with a point to spare on every side.
    assert.ok(grid.bounds[0][0] < BANGKOK[0][0] && grid.bounds[1][0] > BANGKOK[1][0]);
    assert.ok(grid.bounds[0][1] < BANGKOK[0][1] && grid.bounds[1][1] > BANGKOK[1][1]);
    const frame = set.frames[PAST_HOURS + 2] as TemperatureFrame;
    const time = Date.parse(frame.time);
    for (const [r, c] of [
      [0, 0],
      [3, 7],
      [grid.rows - 1, grid.cols - 1],
    ]) {
      const { lat, lon } = cellPoint(grid, r, c);
      assert.ok(Math.abs(lat / 0.25 - Math.round(lat / 0.25)) < 1e-9, "on the lattice");
      close(frame.temperature[r * grid.cols + c], weather(lat, lon, time).temperature_2m, 0.06, `cell ${r},${c}`);
      close(sampleGrid(grid, frame.temperature, lat, lon), weather(lat, lon, time).temperature_2m, 0.06, "sampled");
    }
    // Between points the map blends them smoothly.
    const mid = sampleGrid(grid, frame.temperature, 13.625, 100.5);
    close(mid, weather(13.625, 100.5, time).temperature_2m, 0.1, "between points");
    assert.ok(set.range.min <= set.range.max && Number.isFinite(set.range.min));
    assert.equal(set.model.model, "ECMWF");
    assert.equal(set.model.simulated, false);
  }),

  check("all five layers come from the same tiles, so switching asks for nothing more", async () => {
    const { fetcher, asked } = fieldsFetch();
    const service = new FieldService({ fetch: fetcher, now: () => NOW });
    const sets = new Map<RadarLayerType, RadarFrameSet>();
    for (const layer of LAYERS) sets.set(layer, await service.getRadarFrames({ layer, bounds: BANGKOK }));
    const tiles = tilesFor(fieldView(BANGKOK), spacingFor(BANGKOK)).length;
    assert.equal(asked.length, tiles);
    const k = PAST_HOURS + 4;
    const rain = sets.get("precipitation")!.frames[k] as PrecipitationFrame;
    const clouds = sets.get("clouds")!.frames[k] as CloudFrame;
    const wind = sets.get("wind")!.frames[k] as WindFrame;
    const { grid } = sets.get("precipitation")!;
    const x = 5 * grid.cols + 6;
    const { lat, lon } = cellPoint(grid, 5, 6);
    const time = Date.parse(rain.time);
    close(rain.rate[x], weather(lat, lon, time + HOUR_MS).precipitation, 0.006, "rain");
    assert.equal(clouds.cover[x], Math.round(weather(lat, lon, time).cloud_cover));
    close(rain.cloud[x], clouds.cover[x] / 100, 1e-6, "rain layer's cloud");
    close(wind.speed[x], Math.hypot(wind.u[x], wind.v[x]), 1e-4, "speed");
    close(wind.speed[x], weather(lat, lon, time).wind_speed_10m, 0.1, "wind");
    for (const layer of LAYERS) assert.equal(sets.get(layer)!.frames.length, PAST_HOURS + AHEAD_HOURS + 1, layer);
    // Panning a little reuses the tiles too.
    await service.getRadarFrames({
      layer: "clouds",
      bounds: [
        [12.6, 99.6],
        [15.1, 102.1],
      ],
    });
    assert.ok(asked.length <= tiles + 3, `${asked.length - tiles} more`);
  }),

  check("late in a slot the timeline still has every hour", async () => {
    const { fetcher } = fieldsFetch();
    const late = SLOT + SLOT_MS - MIN;
    const service = new FieldService({ fetch: fetcher, now: () => late });
    const set = await service.getRadarFrames({ layer: "precipitation", bounds: BANGKOK });
    assert.equal(set.frames.length, PAST_HOURS + AHEAD_HOURS + 1);
    assert.equal(Date.parse(set.frames.at(-1)!.time), floorToHour(late) + AHEAD_HOURS * HOUR_MS);
    const rain = set.frames.at(-1) as PrecipitationFrame;
    assert.ok(rain.rate.every((v) => Number.isFinite(v)));
  }),

  check("a failed tile fails the frames with its reason, and is asked for again next time", async () => {
    let failing = true;
    const { fetcher, asked } = fieldsFetch({ fail: () => (failing ? 503 : null) });
    const service = new FieldService({ fetch: fetcher, now: () => NOW });
    await assert.rejects(service.getRadarFrames({ layer: "wind", bounds: BANGKOK }), (e: unknown) => {
      return e instanceof FieldError && e.status === 503 && e.message === "busy";
    });
    failing = false;
    const before = asked.length;
    const set = await service.getRadarFrames({ layer: "wind", bounds: BANGKOK });
    assert.ok(asked.length > before);
    assert.equal(set.frames.length, PAST_HOURS + AHEAD_HOURS + 1);
  }),

  check("missing values are left empty and kept out of the range", () => {
    const view = fieldView(BANGKOK);
    const spacing = spacingFor(view);
    const tiles = new Map(tilesFor(view, spacing).map((id) => [tileKey(id), tileFor(id)]));
    const first = tiles.values().next().value!;
    first.temperature.fill(null);
    const set = framesFrom("temperature", view, spacing, tiles, floorToHour(NOW));
    const frame = set.frames[0] as TemperatureFrame;
    assert.ok(frame.temperature.some(Number.isNaN));
    assert.ok(frame.temperature.some(Number.isFinite));
    assert.ok(Number.isFinite(set.range.min) && Number.isFinite(set.range.max));
    // The playhead between hours carries the gaps along without spreading NaN into the motion.
    const between = frameAt(set as RadarFrameSet, Date.parse(frame.time) + 20 * MIN) as TemperatureFrame;
    assert.ok(between.temperature.some(Number.isFinite));
  }),

  /* ---------------- Cloud motion between hours ---------------- */

  check("cloud cover moves between hours instead of fading", () => {
    const grid: RadarGridSpec = {
      bounds: [
        [10, 98],
        [16, 104],
      ],
      rows: 24,
      cols: 24,
      latStep: 0.25,
      lonStep: 0.25,
      cellSizeKm: 28,
    };
    const blob = (cx: number) => {
      const cover = new Float32Array(grid.rows * grid.cols);
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++)
          cover[r * grid.cols + c] = 95 * Math.exp(-((r - 12) ** 2 + (c - cx) ** 2) / 8);
      }
      return cover;
    };
    const frame = (cx: number, offset: number): CloudFrame => ({
      layer: "clouds",
      time: new Date(SLOT + offset * HOUR_MS).toISOString(),
      offsetHours: offset,
      kind: "forecast",
      cover: blob(cx),
    });
    const a = frame(9, 0);
    const b = frame(11, 1);
    // A cell of the model left empty doesn't stop the motion being found.
    a.cover[0] = Number.NaN;
    const flow = frameFlow(grid, a, b);
    assert.ok(flow, "motion found");
    const k = 12 * grid.cols + 10;
    close(flow.dx[k], 2, 0.5, "moved east");
    close(flow.dy[k], 0, 0.5, "not north or south");
    const mid = frameBetween(a, b, 0.5, SLOT + 30 * MIN, flow) as CloudFrame;
    assert.equal(mid.layer, "clouds");
    // Halfway, the cloud is at its halfway place, about as thick as it was (a fade would halve both ends instead).
    const peak = (cover: Float32Array) => {
      let best = 0;
      for (let c = 1; c < grid.cols; c++) if (cover[12 * grid.cols + c] > cover[12 * grid.cols + best]) best = c;
      return best;
    };
    assert.equal(peak(mid.cover), 10);
    assert.ok(mid.cover[12 * grid.cols + 10] > 80, `${mid.cover[12 * grid.cols + 10]}`);
    const faded = frameBetween(a, b, 0.5, SLOT + 30 * MIN, null) as CloudFrame;
    assert.ok(faded.cover[12 * grid.cols + 10] < mid.cover[12 * grid.cols + 10]);
  }),

  check("the simulation draws cloud cover too, in percent", async () => {
    const set = (await weatherSimulation.getRadarFrames({
      layer: "clouds",
      bounds: BANGKOK,
      maxCellsPerSide: 40,
    })) as RadarFrameSet<"clouds">;
    assert.equal(set.layer, "clouds");
    assert.ok(set.frames.length > 20);
    const cover = set.frames[3].cover;
    assert.ok(cover.every((v) => v >= 0 && v <= 100));
    assert.ok(set.range.max > 1, "some cloud");
    assert.equal(set.model.simulated, true);
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
  console.log(`\nAll ${checks} field checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
