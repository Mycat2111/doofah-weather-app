/**
 * Checks for route weather: the router, the stops along the way and the trip outlook.
 * Run with: npm run verify:route
 */
import assert from "node:assert/strict";
import { MESSAGES } from "../src/i18n/messages";
import {
  MAX_STOPS,
  positionAt,
  routeOutlook,
  routeStops,
  stopInterval,
  stopRain,
  type RouteStopWeather,
} from "../src/lib/routeWeather";
import { getRoute } from "../src/services/routing/routeService";
import { BORDER_MIN, FERRY_WAIT_MIN, simulatedRoute } from "../src/services/routing/SimulatedRouter";
import { RouteError, type Route, type RouteRequest } from "../src/services/routing/types";
import { distanceKm } from "../src/services/weathernext3/places";
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

function assertRoute(route: Route, request: RouteRequest) {
  const { path } = route;
  assert.ok(path.length >= 2, "a route has a line");
  assert.ok(distanceKm(path[0], request.origin) < 1, "starts at the origin");
  assert.ok(distanceKm(path[path.length - 1], request.destination) < 1, "ends at the destination");
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i].km >= path[i - 1].km, `km never goes back (point ${i})`);
    assert.ok(path[i].min >= path[i - 1].min, `time never goes back (point ${i})`);
  }
  assert.ok(Math.abs(path[path.length - 1].km - route.distanceKm) < 0.01, "the line is as long as the route");
  assert.ok(Math.abs(path[path.length - 1].min - route.durationMin) < 0.01, "the line takes as long as the route");
  assert.ok(near(Date.parse(route.arrival) - Date.parse(route.departure), route.durationMin * 60_000), "arrival");
}

function expectError(code: string, run: () => unknown) {
  assert.throws(run, (e: unknown) => e instanceof RouteError && e.code === code, `expected ${code}`);
}

async function main() {
  // 1. The simulated router --------------------------------------------------
  const cases: [string, string, number, number][] = [
    // from, to, km range
    ["bangkok", "chiang-mai", 650, 800],
    ["bangkok", "hua-hin", 170, 260],
    ["bangkok", "koh-samui", 600, 800],
    ["bangkok", "vientiane", 580, 720],
  ];
  const routes: Record<string, Route> = {};
  for (const [from, to, minKm, maxKm] of cases) {
    const request = trip(from, to);
    const route = simulatedRoute(request);
    assertRoute(route, request);
    assert.equal(route.source, "simulated");
    assert.ok(route.distanceKm >= minKm && route.distanceKm <= maxKm, `${from} → ${to}: ${route.distanceKm} km`);
    // Road speeds between 40 and 90 km/h, plus border and ferry waits.
    const speed = route.distanceKm / (route.durationMin / 60);
    assert.ok(speed > 30 && speed < 90, `${from} → ${to}: ${speed.toFixed(0)} km/h`);
    routes[to] = route;
    console.log(
      `  ${from} → ${to}: ${Math.round(route.distanceKm)} km, ${hm(route.durationMin)}` +
        `${route.ferry ? ", ferry" : ""}${route.borders ? `, ${route.borders} border` : ""}`,
    );
  }
  assert.ok(routes["koh-samui"].ferry, "Koh Samui is reached by ferry");
  assert.equal(routes["chiang-mai"].ferry, false);
  assert.equal(routes["vientiane"].borders, 1, "Vientiane crosses one border");
  assert.equal(routes["chiang-mai"].borders, 0);
  assert.ok(FERRY_WAIT_MIN > 0 && BORDER_MIN > 0);
  // Same trip, same route: the line is worked out, not random.
  assert.deepEqual(simulatedRoute(trip("bangkok", "chiang-mai")), routes["chiang-mai"]);
  // Reversed, the same roads.
  const back = simulatedRoute(trip("chiang-mai", "bangkok"));
  assert.ok(Math.abs(back.distanceKm - routes["chiang-mai"].distanceKm) < 1, "the way back is as long");
  expectError("noRoute", () => simulatedRoute(trip("bangkok", "tokyo")));
  expectError("samePlace", () => simulatedRoute(trip("bangkok", "bangkok")));
  // The app asks getRoute, which works the route out on the device.
  assert.deepEqual(await getRoute(trip("bangkok", "chiang-mai")), routes["chiang-mai"]);
  await assert.rejects(
    getRoute(trip("bangkok", "tokyo")),
    (e: unknown) => e instanceof RouteError && e.code === "noRoute",
  );
  console.log("✓ Simulated routes follow the roads: ferry to Samui, a border to Vientiane, no road to Tokyo");

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
  console.log("✓ Weather at each stop for when you get there, and the trip's rain in one line");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
