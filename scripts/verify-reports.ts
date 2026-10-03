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
  parseMyReports,
  radarKind,
  REPORT_KINDS,
  REPORT_RADIUS_KM,
  REPORT_TTL_MS,
  reportLife,
  type CrowdReport,
  type ReportKind,
} from "../src/lib/crowdReports";
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
  assert.ok(community.length > 0, "Bangkok has reports in the last hour");
  for (const r of community) {
    const age = NOW - Date.parse(r.time);
    assert.ok(age >= 0 && age < REPORT_TTL_MS, `${r.id} is from the last hour`);
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
  console.log(`✓ ${community.length} simulated reports around Bangkok, all local and from the last hour`);

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

  // 3. Fading out after an hour ----------------------------------------------
  const fresh = report("sunny", 0);
  const half = report("sunny", 30);
  const old = report("sunny", 60);
  assert.equal(reportLife(fresh, NOW), 1);
  assert.equal(reportLife(half, NOW), 0.5);
  assert.equal(reportLife(old, NOW), 0);
  assert.deepEqual(
    liveReports([old, half, fresh], NOW).map((r) => r.id),
    [fresh.id, half.id],
    "an hour-old report is gone; newest first",
  );
  const far = { ...fresh, id: "far", point: { lat: bangkok.point.lat + 0.5, lon: bangkok.point.lon } };
  assert.deepEqual(
    liveReports([fresh, far], NOW, bangkok.point).map((r) => r.id),
    [fresh.id],
    "55 km away is not local",
  );
  console.log("✓ Reports fade over their hour and leave the map after 60 minutes");

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
