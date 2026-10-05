/**
 * Checks for the crowdsourced weather reports.
 * Run with: npm run verify:reports
 */
import assert from "node:assert/strict";
import { MESSAGES } from "../src/i18n/messages";
import { agreesWithRadar, verifyRadar } from "../src/lib/crowdVerify";
import {
  addMyReport,
  liveReports,
  markShared,
  parseMyReports,
  radarKind,
  REPORT_KINDS,
  REPORT_RADIUS_KM,
  REPORT_TTL_MS,
  reportLife,
  type CrowdReport,
  type ReportKind,
} from "../src/lib/crowdReports";
import {
  boundsAround,
  cellKind,
  countNear,
  mergeTiles,
  othersOf,
  spread,
  tilesFor,
  type SharedReport,
} from "../src/lib/sharedReports";
import { SimulatedCrowdReports } from "../src/services/simulation/SimulatedCrowdReports";
import { SimulatedWeatherService } from "../src/services/simulation/SimulatedWeatherService";
import { distanceKm, PLACES } from "../src/services/weather/places";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 8, 30, 7, 20); // 30 Sep 2026, 14:20 in Bangkok
const bangkok = PLACES.find((p) => p.id === "bangkok")!;
const weather = new SimulatedWeatherService({ latencyMs: 0, now: () => NOW });
const service = new SimulatedCrowdReports({ weather, latencyMs: 0, now: () => NOW });
const { en, th } = MESSAGES;

const report = (kind: ReportKind, minutesAgo: number, mine = false): CrowdReport => ({
  id: `${kind}-${minutesAgo}-${mine}`,
  kind,
  point: bangkok.point,
  time: new Date(NOW - minutesAgo * MIN).toISOString(),
  mine,
});

async function main() {
  // 1. Other people's reports -------------------------------------------------
  const community = await service.getCommunityReports(bangkok.point);
  assert.deepEqual(community, service.communityReports(bangkok.point, NOW), "same place and time, same reports");
  assert.ok(community.length > 0, "Bangkok has reports in the last 3 hours");
  for (const r of community) {
    const age = NOW - Date.parse(r.time);
    assert.ok(age >= 0 && age < REPORT_TTL_MS, `${r.id} is from the last 3 hours`);
    assert.ok(distanceKm(bangkok.point, r.point) <= REPORT_RADIUS_KM + 0.01, `${r.id} is local`);
    assert.ok(!r.mine);
  }
  // Ten minutes later the oldest have expired and new ones have arrived, the rest unchanged.
  const later = service.communityReports(bangkok.point, NOW + 10 * MIN);
  const kept = community.filter((r) => NOW + 10 * MIN - Date.parse(r.time) < REPORT_TTL_MS).map((r) => r.id);
  assert.deepEqual(
    later.filter((r) => Date.parse(r.time) <= NOW).map((r) => r.id),
    kept,
  );
  console.log(`✓ ${community.length} simulated reports around Bangkok, all local and from the last 3 hours`);

  // Across places and a week, most people report what the model shows.
  let total = 0;
  let matching = 0;
  let rainy = 0;
  const statuses: Record<string, number> = {};
  for (let h = 0; h < 7 * 24; h += 7) {
    const now = NOW + h * HOUR;
    const w = new SimulatedWeatherService({ latencyMs: 0, now: () => now });
    const s = new SimulatedCrowdReports({ weather: w, latencyMs: 0, now: () => now });
    for (const place of PLACES) {
      const reports = s.communityReports(place.point, now);
      for (const r of reports) {
        total++;
        if (r.kind === s.radarAt(r)) matching++;
        if (r.kind === "lightRain" || r.kind === "heavyRain") rainy++;
      }
      const v = verifyRadar(reports, (r) => s.radarAt(r));
      statuses[v?.status ?? "none"] = (statuses[v?.status ?? "none"] ?? 0) + 1;
    }
  }
  const share = matching / total;
  assert.ok(share > 0.8 && share < 0.95, `${Math.round(share * 100)}% of reports match the model`);
  console.log(
    `✓ ${total} simulated reports: ${Math.round(share * 100)}% match the model, ${rainy} say rain (${JSON.stringify(statuses)})`,
  );

  // 2. Your reports ----------------------------------------------------------
  let mine = addMyReport([], "lightRain", bangkok.point, NOW - 20 * MIN);
  mine = addMyReport(mine, "heavyRain", bangkok.point, NOW - 5 * MIN);
  assert.deepEqual(
    mine.map((r) => r.kind),
    ["heavyRain", "lightRain"],
    "a report 15 minutes after the last one is a new report",
  );
  mine = addMyReport(mine, "cloudy", bangkok.point, NOW);
  assert.deepEqual(
    mine.map((r) => r.kind),
    ["cloudy", "lightRain"],
    "within 10 minutes a new tap changes your last report",
  );
  assert.ok(mine.every((r) => r.mine));
  assert.deepEqual(parseMyReports(JSON.stringify(mine)), mine, "saved and read back");
  assert.deepEqual(parseMyReports("not json"), []);
  assert.deepEqual(parseMyReports('[{"id":"x","kind":"hail"}]'), [], "unknown kinds are ignored");
  console.log("✓ Your reports are saved; a second tap within 10 minutes changes your report");

  // Shared: the ids the backend gave are kept, and carried over when a report is replaced.
  let shared = addMyReport([], "lightRain", bangkok.point, NOW - 20 * MIN);
  shared = markShared(shared, shared[0].id, "41");
  shared = addMyReport(shared, "heavyRain", bangkok.point, NOW - 5 * MIN);
  assert.deepEqual(shared[0].serverIds, undefined, "15 minutes later it's a new report, not yet shared");
  shared = markShared(shared, shared[0].id, "42");
  shared = addMyReport(shared, "cloudy", bangkok.point, NOW);
  assert.deepEqual(shared[0].serverIds, ["42"], "a change of mind keeps the replaced report's id");
  shared = markShared(shared, shared[0].id, "43");
  assert.deepEqual(
    shared.map((r) => r.serverIds),
    [["43", "42"], ["41"]],
  );
  assert.deepEqual(parseMyReports(JSON.stringify(shared)), shared, "ids saved and read back");
  assert.deepEqual(
    parseMyReports(
      '[{"id":"x","kind":"sunny","point":{"lat":1,"lon":2},"time":"2026-09-30T07:00:00Z","serverIds":[4]}]',
    ),
    [],
  );

  // Everyone's reports leave this device's own out, wherever they came from.
  const fromServer = (id: string, kind: ReportKind, lat = 13.76, lon = 100.5): SharedReport => ({
    id,
    kind,
    lat,
    lon,
    time: new Date(NOW - 5 * MIN).toISOString(),
  });
  const others = othersOf(
    [fromServer("41", "sunny"), fromServer("42", "heavyRain"), fromServer("50", "lightRain")],
    shared,
  );
  assert.deepEqual(
    others.map((r) => [r.id, r.kind, r.mine]),
    [["s50", "lightRain", false]],
    "the device's own reports (and the one it replaced) show from its storage only",
  );
  assert.deepEqual(
    mergeTiles([
      { reports: [fromServer("50", "lightRain"), fromServer("51", "sunny")], cells: [] },
      { reports: [fromServer("51", "sunny")], cells: [] },
    ]).reports.map((r) => r.id),
    ["50", "51"],
    "a report on a tile edge comes back from both tiles, and counts once",
  );
  const cell = {
    lat: 13.9,
    lon: 100.6,
    count: 240,
    kinds: { sunny: 0, cloudy: 40, lightRain: 80, heavyRain: 120 },
    newest: "",
  };
  const farCell = { ...cell, lat: 15, count: 99 };
  assert.equal(
    countNear(
      othersOf([fromServer("50", "lightRain"), fromServer("60", "sunny", 14.5)], []),
      [cell, farCell],
      bangkok.point,
      REPORT_RADIUS_KM,
    ),
    241,
  );
  assert.equal(cellKind(cell), "heavyRain");
  assert.equal(
    cellKind({ ...cell, kinds: { sunny: 3, cloudy: 0, lightRain: 3, heavyRain: 0 } }),
    "lightRain",
    "rain wins a tie",
  );
  const near = boundsAround(bangkok.point, REPORT_RADIUS_KM);
  assert.ok(near[1][0] - near[0][0] > 0.5 && near[1][0] - near[0][0] < 0.56, "30 km each way");
  assert.ok(tilesFor(near).length <= 4);
  assert.equal(en.reports.counted(240, en.reports.kinds.heavyRain), "240 reports · mostly heavy rain");
  assert.equal(th.reports.counted(240, th.reports.kinds.heavyRain), "240 รายงาน · ส่วนใหญ่ฝนตกหนัก");
  // Everyone looking at Bangkok reports from its centre: those bubbles go round it, clear of the pin.
  const atCentre = (id: string, minutes: number): CrowdReport => ({ ...report("sunny", minutes), id });
  const elsewhere = { ...atCentre("e1", 3), point: { lat: 14.1, lon: 100.6 } };
  const offsets = spread(
    [atCentre("c1", 1), atCentre("c2", 2), atCentre("c3", 3), elsewhere, { ...atCentre("me", 0), mine: true }],
    bangkok.point,
  );
  assert.equal(offsets.get("me"), undefined, "your own bubble keeps its place on the pin's shoulder");
  assert.deepEqual(offsets.get("e1"), [0, 0], "alone on its spot, a bubble stays there");
  assert.deepEqual(
    [offsets.get("c1"), offsets.get("c2"), offsets.get("c3")],
    [
      [-30, 0],
      [-21, 21],
      [0, 30],
    ],
  );
  const many = spread(
    Array.from({ length: 13 }, (_, i) => atCentre(`m${i}`, i)),
    bangkok.point,
  );
  const spots = [...many.values()].map(([x, y]) => `${x},${y}`);
  assert.equal(new Set(spots).size, 13, "13 bubbles at one spot, none on top of another");
  assert.ok(
    [...many.values()].every(([x, y]) => Math.hypot(x, y) >= 29),
    "and none under the pin",
  );
  assert.ok(
    [...many.values()].every(([x, y]) => !(x > 0 && y < 0 && Math.abs(Math.atan2(-y, x) * (180 / Math.PI) - 50) < 30)),
    "nor over your own bubble",
  );
  console.log("✓ Shared reports: your own show once, busy areas count, rain wins a tie, shared spots spread out");

  // 3. Fading out over 3 hours -----------------------------------------------
  const fresh = report("sunny", 0);
  const half = report("sunny", 90);
  const old = report("sunny", 180);
  assert.equal(reportLife(fresh, NOW), 1);
  assert.equal(reportLife(half, NOW), 0.5);
  assert.equal(reportLife(old, NOW), 0);
  assert.deepEqual(
    liveReports([old, half, fresh], NOW).map((r) => r.id),
    [fresh.id, half.id],
    "a 3-hour-old report is gone; newest first",
  );
  const far = { ...fresh, id: "far", point: { lat: bangkok.point.lat + 0.5, lon: bangkok.point.lon } };
  assert.deepEqual(
    liveReports([fresh, far], NOW, bangkok.point).map((r) => r.id),
    [fresh.id],
    "55 km away is not local",
  );
  console.log("✓ Reports fade over their 3 hours and leave the map after 180 minutes");

  // 4. Verified by local users -------------------------------------------------
  assert.equal(radarKind({ precipitationMm: 5, cloudCover: 100 }), "heavyRain");
  assert.equal(radarKind({ precipitationMm: 0.5, cloudCover: 100 }), "lightRain");
  assert.equal(radarKind({ precipitationMm: 0, cloudCover: 80 }), "cloudy");
  assert.equal(radarKind({ precipitationMm: 0, cloudCover: 10 }), "sunny");
  assert.ok(agreesWithRadar(report("heavyRain", 1), "lightRain"), "light or heavy, rain is rain");
  assert.ok(agreesWithRadar(report("sunny", 1), "cloudy"), "sunny or cloudy, dry is dry");
  assert.ok(!agreesWithRadar(report("sunny", 1), "lightRain"));

  const raining = () => "lightRain" as const;
  assert.equal(verifyRadar([], raining), null);
  const kinds = (list: ReportKind[]) => list.map((k, i) => report(k, i + 1));
  assert.deepEqual(verifyRadar(kinds(["lightRain"]), raining), { status: "few", agreeing: 1, total: 1 });
  assert.deepEqual(verifyRadar(kinds(["lightRain", "heavyRain"]), raining), {
    status: "verified",
    agreeing: 2,
    total: 2,
  });
  assert.equal(verifyRadar(kinds(["lightRain", "heavyRain", "sunny"]), raining)?.status, "verified", "2 of 3");
  assert.equal(verifyRadar(kinds(["lightRain", "sunny", "cloudy", "heavyRain"]), raining)?.status, "few", "2 of 4");
  assert.equal(verifyRadar(kinds(["sunny", "cloudy", "lightRain"]), raining)?.status, "disputed", "1 of 3");
  assert.equal(en.reports.verified(5), "Verified by 5 local users");
  assert.equal(th.reports.verified(5), "ยืนยันโดยผู้ใช้ในพื้นที่ 5 คน");
  console.log(`✓ "${en.reports.verified(5)}" needs 2+ people and 60% agreeing with the radar`);

  // 5. Wording ---------------------------------------------------------------
  for (const kind of REPORT_KINDS) assert.ok(th.reports.kinds[kind] && en.reports.kinds[kind]);
  assert.deepEqual(
    REPORT_KINDS.map((k) => en.reports.kinds[k]),
    ["Sunny", "Cloudy", "Light rain", "Heavy rain"],
  );
  assert.equal(th.reports.yours(th.reports.kinds.heavyRain, th.reports.ago(3)), "คุณรายงานว่าฝนตกหนัก · 3 นาทีที่แล้ว");
  console.log(`✓ Buttons: ${REPORT_KINDS.map((k) => th.reports.kinds[k]).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
