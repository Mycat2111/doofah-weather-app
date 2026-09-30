/**
 * Checks for route weather: the road router (OSRM), the stops along the way and the trip outlook.
 * Run with: npm run verify:route
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MESSAGES } from "../src/i18n/messages";
import {
  MAX_STOPS,
  positionAt,
  routeOutlook,
  blendTrip,
  routeStops,
  stopInterval,
  stopRain,
  type RouteStopWeather,
} from "../src/lib/routeWeather";
import {
  checkTrip,
  FOSSGIS_OSRM_URL,
  MAX_PATH_POINTS,
  osrmRouteUrl,
  routeFromOsrm,
  simplify,
  type OsrmResponse,
} from "../src/services/routing/osrm";
import { decodePolyline, encodePolyline } from "../src/services/routing/polyline";
import { clearRouteCache, getRoute } from "../src/services/routing/routeService";
import { TOWNS } from "../src/services/routing/towns";
import { RouteError, type Route, type RouteRequest } from "../src/services/routing/types";
import { distanceKm } from "../src/services/weathernext3/places";
import type { GeoPoint, HourlyForecast } from "../src/services/weathernext3/types";
import { PLACES, WeatherNext3MockService, type AtmosphericSample } from "../src/services/WeatherNext3MockService";

const NOW = Date.UTC(2026, 8, 30, 7, 20); // 30 Sep 2026, 14:20 in Bangkok
const DEPARTURE = new Date(NOW).toISOString();
const place = (id: string) => PLACES.find((p) => p.id === id)!.point;
const trip = (from: string, to: string): RouteRequest => ({
  origin: place(from),
  destination: place(to),
  departure: DEPARTURE,
});
/** Times are whole milliseconds. */
const near = (a: number, b: number) => Math.abs(a - b) <= 1;
const hm = (min: number) => `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
const { en, th } = MESSAGES;

/** A real OSRM reply (FOSSGIS, 30 Sep 2026): Don Sak pier to Nathon on Koh Samui, with the car ferry. */
const SAMUI: OsrmResponse = JSON.parse(
  readFileSync(new URL("./fixtures/osrm-donsak-samui.json", import.meta.url), "utf8"),
);
const SAMUI_FROM = { lat: 9.316, lon: 99.689 };
const SAMUI_TO = { lat: 9.535, lon: 99.936 };

/**
 * An OSRM-style reply along `via` (a point every km or so), `km` long and
 * taking `hours`, with a ferry between via[ferry[0]] and via[ferry[1]].
 */
function osrmReply(via: GeoPoint[], km: number, hours: number, ferry?: [number, number]): OsrmResponse {
  const points: GeoPoint[] = [via[0]];
  const marks = [0];
  for (let i = 1; i < via.length; i++) {
    const n = Math.max(1, Math.round(distanceKm(via[i - 1], via[i])));
    for (let k = 1; k <= n; k++)
      points.push({
        lat: via[i - 1].lat + ((via[i].lat - via[i - 1].lat) * k) / n,
        lon: via[i - 1].lon + ((via[i].lon - via[i - 1].lon) * k) / n,
      });
    marks.push(points.length - 1);
  }
  const lengths = points.slice(1).map((p, i) => distanceKm(points[i], p) * 1000);
  const scale = (km * 1000) / lengths.reduce((s, v) => s + v, 0);
  const metres = lengths.map((v) => v * scale);
  const seconds = metres.map((v) => (v / (km * 1000)) * hours * 3600);
  const sum = (a: number[], from: number, to: number) => a.slice(from, to).reduce((s, v) => s + v, 0);
  const steps = ferry
    ? [
        {
          mode: "driving",
          name: "",
          distance: sum(metres, 0, marks[ferry[0]]),
          duration: sum(seconds, 0, marks[ferry[0]]),
        },
        {
          mode: "ferry",
          name: "Test ferry",
          distance: sum(metres, marks[ferry[0]], marks[ferry[1]]),
          duration: sum(seconds, marks[ferry[0]], marks[ferry[1]]),
        },
        {
          mode: "driving",
          name: "",
          distance: sum(metres, marks[ferry[1]], metres.length),
          duration: sum(seconds, marks[ferry[1]], seconds.length),
        },
      ]
    : [{ mode: "driving", name: "", distance: km * 1000, duration: hours * 3600 }];
  return {
    code: "Ok",
    routes: [
      {
        distance: km * 1000,
        duration: hours * 3600,
        geometry: encodePolyline(points, 6),
        legs: [
          { distance: km * 1000, duration: hours * 3600, annotation: { distance: metres, duration: seconds }, steps },
        ],
      },
    ],
    waypoints: [
      { location: [via[0].lon, via[0].lat], distance: 20 },
      { location: [via.at(-1)!.lon, via.at(-1)!.lat], distance: 35 },
    ],
  };
}

const TOWN: Record<string, GeoPoint> = Object.fromEntries(TOWNS.map((t) => [t.id, t.point]));

/** Bangkok to Chiang Mai up Highways 1, 32 and 11, with OSRM's own totals for the trip. */
const CHIANG_MAI_VIA = ["bangkok", "ayutthaya", "nakhon-sawan", "kamphaeng-phet", "tak", "lampang", "chiang-mai"].map(
  (id) => TOWN[id],
);

function assertRoute(route: Route, request: Pick<RouteRequest, "origin" | "destination">) {
  const { path } = route;
  assert.ok(path.length >= 2, "a route has a line");
  // The router starts and ends where it joins the roads, close to the points asked for.
  assert.ok(distanceKm(path[0], request.origin) < 1, "starts at the origin");
  assert.ok(distanceKm(path[path.length - 1], request.destination) < 1, "ends at the destination");
  assert.equal(path[0].km, 0);
  assert.equal(path[0].min, 0);
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i].km >= path[i - 1].km, `km never goes back (point ${i})`);
    assert.ok(path[i].min >= path[i - 1].min, `time never goes back (point ${i})`);
  }
  assert.ok(Math.abs(path[path.length - 1].km - route.distanceKm) < 0.01, "the line is as long as the route");
  assert.ok(Math.abs(path[path.length - 1].min - route.durationMin) < 0.01, "the line takes as long as the route");
  assert.ok(near(Date.parse(route.arrival) - Date.parse(route.departure), route.durationMin * 60_000), "arrival");
  assert.ok(path.length <= MAX_PATH_POINTS, `${path.length} points to draw`);
}

function expectError(code: string, run: () => unknown) {
  assert.throws(run, (e: unknown) => e instanceof RouteError && e.code === code, `expected ${code}`);
}

/** A fetch that answers every request with `reply`, and notes when each came. */
function fakeFetch(reply: (url: string) => { status?: number; body: unknown } | Error) {
  const calls: { url: string; at: number }[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url, at: Date.now() });
    const answer = reply(url);
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

async function main() {
  // 1. Real roads from OSRM ----------------------------------------------------
  // The polyline6 format both ways.
  const line = [
    { lat: 13.756331, lon: 100.501765 },
    { lat: 13.7, lon: 100.4 },
    { lat: -33.8688, lon: 151.2093 },
  ];
  assert.deepEqual(decodePolyline(encodePolyline(line, 6), 6), line);
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5), [
    { lat: 38.5, lon: -120.2 },
    { lat: 40.7, lon: -120.95 },
    { lat: 43.252, lon: -126.453 },
  ]);
  assert.equal(
    osrmRouteUrl(FOSSGIS_OSRM_URL + "/", place("bangkok"), place("hua-hin")),
    "https://routing.openstreetmap.de/routed-car/route/v1/driving/100.50180,13.75630;99.95770,12.56840" +
      "?overview=full&geometries=polyline6&annotations=duration%2Cdistance&steps=true&generate_hints=false",
  );

  // A real reply: the drive to Don Sak pier, the car ferry, and the island roads to Nathon.
  const samui = routeFromOsrm(SAMUI);
  const samuiRoute = {
    ...samui,
    departure: DEPARTURE,
    arrival: new Date(NOW + samui.durationMin * 60_000).toISOString(),
  };
  assertRoute(samuiRoute, { origin: SAMUI_FROM, destination: SAMUI_TO });
  assert.equal(samui.source, "osrm");
  assert.ok(Math.abs(samui.distanceKm - 43.4314) < 0.001, `${samui.distanceKm} km`);
  assert.ok(Math.abs(samui.durationMin - 6660.2 / 60) < 0.001, `${samui.durationMin} min`);
  assert.equal(samui.ferries.length, 1);
  const ferry = samui.ferries[0];
  assert.equal(ferry.name, "Surat Thani (Don Sak) - Ko Samui (Lipa Noi)");
  assert.equal(ferry.minutes, 90);
  // The crossing starts at Don Sak pier and lands at Lipa Noi, where OSRM's steps say.
  const [boardAt, landAt] = [samui.path[ferry.from], samui.path[ferry.to]];
  assert.ok(distanceKm(boardAt, { lat: 9.329156, lon: 99.744965 }) < 0.05, "boards at Don Sak");
  assert.ok(distanceKm(landAt, { lat: 9.481672, lon: 99.925414 }) < 0.05, "lands at Lipa Noi");
  // Its nine stretches take 600 s each (turn time is spread over the whole trip).
  const onBoard = landAt.min - boardAt.min;
  assert.ok(Math.abs(onBoard - 90 * (6660.2 / 6624.2)) < 0.01, `${onBoard} min on board`);
  assert.ok(Math.abs(landAt.km - boardAt.km - 26.1429) < 0.05, `${landAt.km - boardAt.km} km on board`);
  // Every point of the original line is within a few metres of the one drawn.
  const full = decodePolyline(SAMUI.routes![0].geometry, 6);
  assert.ok(samui.path.length < full.length, `${full.length} points drawn as ${samui.path.length}`);
  console.log(
    `  Don Sak → Nathon (real OSRM reply): ${samui.distanceKm.toFixed(1)} km, ${hm(samui.durationMin)}, ` +
      `ferry ${hm(ferry.minutes)}, ${full.length} points drawn as ${samui.path.length}`,
  );

  // Simplifying keeps the points it is told to, and keeps long lines short.
  const zigzag = Array.from({ length: 20_000 }, (_, i) => ({ lat: 13 + i * 0.0005, lon: 100 + (i % 2) * 0.001 }));
  const kept = simplify(zigzag, new Set([7, 12_345]));
  assert.ok(kept.length <= MAX_PATH_POINTS && kept.includes(7) && kept.includes(12_345), `${kept.length} kept`);
  assert.equal(kept[0], 0);
  assert.equal(kept.at(-1), zigzag.length - 1);
  const straight = Array.from({ length: 500 }, (_, i) => ({ lat: 13 + i * 0.001, lon: 100 + i * 0.001 }));
  assert.deepEqual(simplify(straight, new Set()), [0, 499], "a straight road needs only its ends");

  // Bangkok to Chiang Mai, with a ferry in a made-up reply to check where it lands on the line.
  const cmReply = osrmReply(CHIANG_MAI_VIA, 685.0507, 30961 / 3600);
  const chiangMai = { ...routeFromOsrm(cmReply), departure: DEPARTURE, arrival: "" };
  chiangMai.arrival = new Date(NOW + chiangMai.durationMin * 60_000).toISOString();
  assertRoute(chiangMai, trip("bangkok", "chiang-mai"));
  assert.equal(chiangMai.ferries.length, 0);
  const withFerry = routeFromOsrm(osrmReply(CHIANG_MAI_VIA, 685, 9, [2, 3]));
  assert.equal(withFerry.ferries.length, 1);
  const f = withFerry.ferries[0];
  assert.ok(distanceKm(withFerry.path[f.from], TOWN["nakhon-sawan"]) < 0.5, "ferry boards at the right point");
  assert.ok(distanceKm(withFerry.path[f.to], TOWN["kamphaeng-phet"]) < 0.5, "ferry lands at the right point");

  // Trips no router is asked about.
  expectError("samePlace", () => checkTrip(trip("bangkok", "bangkok")));
  expectError("tooFar", () => checkTrip(trip("bangkok", "tokyo")));
  checkTrip(trip("bangkok", "singapore"));
  // OSRM's own refusals, and a destination the roads never reach (an island with no car ferry).
  expectError("noRoute", () => routeFromOsrm({ code: "NoRoute", message: "Impossible route between points" }));
  expectError("noRoute", () => routeFromOsrm({ code: "NoSegment" }));
  expectError("failed", () => routeFromOsrm({ code: "TooBig" }));
  expectError("noRoute", () =>
    routeFromOsrm({ ...SAMUI, waypoints: [SAMUI.waypoints![0], { ...SAMUI.waypoints![1], distance: 38_000 }] }),
  );

  // getRoute: the same trip once, whatever the departure time; one request a second at most.
  clearRouteCache();
  const net = fakeFetch((url) => ({ body: url.includes("98.98530") ? cmReply : SAMUI }));
  const request = trip("bangkok", "chiang-mai");
  const first = await getRoute(request, { fetch: net.fetch });
  assert.equal(net.calls.length, 1);
  assert.ok(net.calls[0].url.startsWith(`${FOSSGIS_OSRM_URL}/route/v1/driving/100.50180,13.75630;98.98530,18.78830?`));
  const later = await getRoute(
    { ...request, departure: new Date(NOW + 3 * 3_600_000).toISOString() },
    { fetch: net.fetch },
  );
  assert.equal(net.calls.length, 1, "another departure time asks nothing new");
  assert.equal(Date.parse(later.departure) - Date.parse(first.departure), 3 * 3_600_000);
  assert.deepEqual(later.path, first.path);
  await getRoute(
    { origin: SAMUI_FROM, destination: SAMUI_TO, departure: DEPARTURE },
    { fetch: net.fetch, osrmUrl: "https://osrm.example/" },
  );
  assert.equal(net.calls.length, 2);
  assert.ok(net.calls[1].url.startsWith("https://osrm.example/route/v1/driving/"), "OSRM_URL picks the server");
  assert.ok(net.calls[1].at - net.calls[0].at >= 1100, `${net.calls[1].at - net.calls[0].at} ms between requests`);

  // OSRM's HTTP 400 carries its reason; a failure is not kept, so trying again asks again.
  clearRouteCache();
  let answer: { status?: number; body: unknown } | Error = {
    status: 400,
    body: { code: "NoRoute", message: "No route" },
  };
  const flaky = fakeFetch(() => answer);
  const ask = () => getRoute(trip("bangkok", "hua-hin"), { fetch: flaky.fetch });
  const rejectsWith = (code: string) => (e: unknown) => e instanceof RouteError && e.code === code;
  await assert.rejects(ask(), rejectsWith("noRoute"));
  answer = { status: 429, body: "Too many requests" };
  await assert.rejects(ask(), rejectsWith("failed"));
  answer = new TypeError("fetch failed");
  await assert.rejects(ask(), rejectsWith("failed"));
  const onLine = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
  await assert.rejects(ask(), rejectsWith("offline"));
  if (onLine) Object.defineProperty(globalThis, "navigator", onLine);
  answer = { body: SAMUI };
  await ask();
  assert.equal(flaky.calls.length, 5, "every failed try asked again");
  // Giving up on a trip does not spoil it for the next one to ask.
  clearRouteCache();
  const quit = new AbortController();
  const given = getRoute(trip("bangkok", "pattaya"), { fetch: flaky.fetch, signal: quit.signal });
  quit.abort();
  await assert.rejects(given);
  await getRoute(trip("bangkok", "pattaya"), { fetch: flaky.fetch });
  assert.equal(flaky.calls.length, 6, "the given-up request was still used");
  await assert.rejects(getRoute(trip("bangkok", "tokyo"), { fetch: flaky.fetch }), rejectsWith("tooFar"));
  assert.equal(flaky.calls.length, 6, "too far is decided without the router");
  // A trip given up on while it waits for its turn never reaches the router, nor holds up the next one.
  clearRouteCache();
  const queued = fakeFetch(() => ({ body: SAMUI }));
  await getRoute(trip("bangkok", "hua-hin"), { fetch: queued.fetch });
  const drop = new AbortController();
  const dropped = getRoute(trip("bangkok", "pattaya"), { fetch: queued.fetch, signal: drop.signal });
  const next = getRoute(trip("bangkok", "chiang-mai"), { fetch: queued.fetch });
  drop.abort();
  await assert.rejects(dropped);
  await next;
  assert.equal(queued.calls.length, 2, "the trip given up on was never asked");
  assert.ok(queued.calls[1].url.includes("98.98530"), "the next trip took its turn");
  const gap = queued.calls[1].at - queued.calls[0].at;
  assert.ok(gap >= 1100 && gap < 2000, `${gap} ms: one gap, not two`);
  // No router the site may use (no operator address for FOSSGIS): every trip says so, without asking anyone.
  await assert.rejects(
    getRoute(trip("bangkok", "pattaya"), { fetch: queued.fetch, osrmUrl: null }),
    rejectsWith("unavailable"),
  );
  await assert.rejects(
    getRoute(trip("bangkok", "tokyo"), { fetch: queued.fetch, osrmUrl: null }),
    rejectsWith("tooFar"),
  );
  assert.equal(queued.calls.length, 2);
  console.log("✓ OSRM routes follow real roads: ferries found, lines thinned, one request a second, errors explained");

  const routes: Record<string, Route> = { "chiang-mai": chiangMai, samui: samuiRoute };

  // 2. Stops along the way -----------------------------------------------------
  assert.equal(stopInterval(60), 15);
  assert.equal(stopInterval(9 * 60), 60);
  assert.equal(stopInterval(40 * 60), 180);
  for (const route of Object.values(routes)) {
    const stops = routeStops(route);
    assert.ok(stops.length >= 2 && stops.length <= MAX_STOPS, `${stops.length} stops`);
    assert.equal(stops[0].role, "start");
    assert.equal(stops[0].min, 0);
    assert.equal(stops.at(-1)!.role, "end");
    assert.equal(stops.at(-1)!.min, route.durationMin);
    assert.ok(stops.slice(1, -1).every((s) => s.role === "stop"));
    for (let i = 1; i < stops.length; i++) {
      assert.ok(stops[i].min > stops[i - 1].min && stops[i].km >= stops[i - 1].km, "stops in order");
      assert.ok(near(Date.parse(stops[i].eta) - Date.parse(route.departure), stops[i].min * 60_000), "eta");
      // No name twice in a row, and none that repeats where you start or end.
      if (stops[i].town) assert.notEqual(stops[i].town!.name, stops[i - 1].town?.name);
    }
    const ends = [stops[0], stops.at(-1)!].map((s) => s.town?.name);
    for (const s of stops.slice(1, -1))
      assert.ok(!s.town || !ends.includes(s.town.name), `${s.town?.name} repeats an end`);
  }
  const cm = routeStops(routes["chiang-mai"]);
  console.log(`  Bangkok → Chiang Mai: ${Math.round(chiangMai.distanceKm)} km, ${hm(chiangMai.durationMin)}`);
  assert.ok(cm.filter((s) => s.town).length >= 5, "most stops to Chiang Mai are named after towns");
  console.log(`  Bangkok → Chiang Mai: ${cm.map((s) => s.town?.th ?? th.route.km(s.km)).join(" · ")}`);
  const mid5 = positionAt(routes["chiang-mai"].path, 300);
  assert.equal(mid5.min, 300);
  console.log("✓ Up to 10 stops, in order, each with the time you get there and a town name when one is near");

  // 3. Weather at each stop and the trip in one line ---------------------------
  const svc = new WeatherNext3MockService({ latencyMs: 0, now: () => NOW });
  const stops = routeStops(routes["chiang-mai"]);
  const weather = await svc.getWeatherAlong(stops.map((s) => ({ point: s.point, time: s.eta })));
  assert.equal(weather.length, stops.length);
  // Each stop's weather is the model's at that spot, at the time you get there (what the radar shows then).
  weather.forEach((w, i) => {
    assert.equal(Date.parse(w.time), Date.parse(stops[i].eta));
    assert.deepEqual(w, svc.sampleAt(stops[i].point, Date.parse(stops[i].eta)));
  });

  const sampleWith = (p: Partial<AtmosphericSample>): AtmosphericSample => ({
    ...weather[0],
    precipitationMm: 0,
    precipitationProbability: 5,
    condition: "clear",
    ...p,
  });
  const dry = sampleWith({});
  const maybe = sampleWith({ precipitationProbability: 40, condition: "cloudy" });
  const wet = sampleWith({ precipitationMm: 1.2, precipitationProbability: 80, condition: "rain" });
  const heavy = sampleWith({ precipitationMm: 6, precipitationProbability: 90, condition: "heavy-rain" });
  const storm = sampleWith({ precipitationMm: 8, precipitationProbability: 90, condition: "thunderstorm" });
  assert.deepEqual([dry, maybe, wet, heavy, storm].map(stopRain), ["dry", "possible", "rain", "heavy", "storm"]);

  const withWeather = (...ws: AtmosphericSample[]): RouteStopWeather[] =>
    ws.map((w, i) => ({ ...stops[Math.min(i, stops.length - 1)], weather: w }));
  assert.deepEqual(routeOutlook(withWeather(dry, dry, dry)), { kind: "dry" });
  assert.deepEqual(routeOutlook(withWeather(dry, maybe, dry)), { kind: "possible", stop: 1, chance: 40 });
  assert.deepEqual(routeOutlook(withWeather(dry, wet, heavy, dry)), {
    kind: "rain",
    from: 1,
    to: 2,
    level: "heavy",
    chance: 90,
    patchy: false,
  });
  // Rain again later in the drive is part of the outlook, "on and off".
  const onAndOff = routeOutlook(withWeather(dry, wet, dry, dry, storm));
  assert.deepEqual(onAndOff, { kind: "rain", from: 1, to: 4, level: "storm", chance: 90, patchy: true });
  const name = (i: number) => ["Bangkok", "Nakhon Sawan", "Tak", "Lampang"][i];
  const clock = (i: number) => ["14:20", "17:00", "18:30", "20:00"][i];
  const outlook = routeOutlook(withWeather(dry, wet, heavy, dry));
  assert.equal(en.routeOutlook(outlook, name, clock), "Heavy rain from Nakhon Sawan to Tak, 17:00–18:30");
  console.log(`  ${en.routeOutlook(outlook, name, clock)}`);
  const five = (i: number) => ["Bangkok", "Nakhon Sawan", "Tak", "Lampang", "Chiang Mai"][i];
  assert.equal(
    en.routeOutlook(onAndOff, five, (i) => `${17 + i}:00`),
    "Thunderstorms on and off from Nakhon Sawan to Chiang Mai, 18:00–21:00",
  );
  console.log(`  ${en.routeOutlook(onAndOff, five, (i) => `${17 + i}:00`)}`);
  const thaiFive = (i: number) => ["กรุงเทพฯ", "นครสวรรค์", "ตาก", "ลำปาง", "เชียงใหม่"][i];
  assert.equal(
    th.routeOutlook(onAndOff, thaiFive, (i) => `${17 + i}:00`),
    "พายุฝนฟ้าคะนองเป็นช่วง\u00a0ๆ ตั้งแต่นครสวรรค์ถึงเชียงใหม่ ช่วง 18:00–21:00\u00a0น.",
  );
  console.log(`  ${th.routeOutlook(outlook, (i) => ["กรุงเทพฯ", "นครสวรรค์", "ตาก"][i], clock)}`);
  // Stops near the dashboard's place take its blended chance of rain for their hour, so the two agree.
  const legs = withWeather(dry, dry, dry);
  const start = legs[0];
  const hourStart = Math.floor(Date.parse(start.eta) / 3_600_000) * 3_600_000;
  const blendHour = (chance: number, vote = true) =>
    ({
      ...dry,
      time: new Date(hourStart).toISOString(),
      precipitationProbability: chance,
      ...(vote ? { vote: { chance } } : {}),
    }) as unknown as HourlyForecast;
  const plain = { stops: legs, outlook: routeOutlook(legs) };
  const blendedTrip = blendTrip(plain, start.point, [blendHour(40)]);
  assert.equal(blendedTrip.stops[0].weather.precipitationProbability, 40, "the start reads the dashboard's hour");
  assert.deepEqual(blendedTrip.outlook, { kind: "possible", stop: 0, chance: 40 }, "and the outlook follows");
  assert.equal(blendedTrip.stops[1], legs[1], "stops away from the place keep their own forecast");
  assert.equal(blendTrip(plain, start.point, [blendHour(40, false)]), plain, "only hours the models voted on");
  assert.equal(blendTrip(plain, { lat: 0, lon: 0 }, [blendHour(40)]), plain, "nowhere near the place");
  console.log("✓ Weather at each stop for when you get there, and the trip's rain in one line");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
