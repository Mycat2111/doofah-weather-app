/**
 * Checks for the weather alert rules.
 * Run with: npm run verify:alerts
 */
import assert from "node:assert/strict";
import { MESSAGES } from "../src/i18n/messages";
import { alertTips, weatherAlerts, type WeatherAlert } from "../src/lib/alerts";
import {
  PLACES,
  WeatherNext3MockService,
  type ForecastBundle,
  type HourlyForecast,
  type WeatherCondition,
} from "../src/services/WeatherNext3MockService";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 30, 7, 20); // 30 Sep 2026, 14:20 in Bangkok
const service = new WeatherNext3MockService({ latencyMs: 0, now: () => NOW });

async function main() {
  const base = await service.getForecastBundle(PLACES.find((p) => p.id === "bangkok")!, 12);

  /** A calm, clean-air copy of the forecast with the given changes. */
  function scenario({
    aqi = 60,
    condition = "partly-cloudy",
    hours = {},
  }: {
    aqi?: number;
    condition?: WeatherCondition;
    hours?: Record<number, Partial<HourlyForecast>>;
  }): ForecastBundle {
    const hourly = base.hourly.map((h, i) => ({
      ...h,
      condition: "partly-cloudy" as WeatherCondition,
      precipitationProbability: 20,
      ...hours[i],
    }));
    return {
      ...base,
      current: {
        ...base.current,
        observedAt: new Date(NOW).toISOString(),
        sample: { ...base.current.sample, condition },
        airQuality: { ...base.current.airQuality, aqi, category: aqi > 200 ? "Very Unhealthy" : "Unhealthy" },
      },
      hourly,
    };
  }
  const alertsOf = (b: ForecastBundle) => weatherAlerts(b.current, b.hourly);
  const kinds = (b: ForecastBundle) => alertsOf(b).map((a) => `${a.kind}:${a.level}`);

  // Hour 0 starts at 14:00, before now; hour 1 at 15:00, 40 minutes away.
  assert.equal(Date.parse(base.hourly[0].time), NOW - 20 * 60_000);

  // 1. Air quality ------------------------------------------------------
  assert.deepEqual(kinds(scenario({})), [], "a calm, clean hour raises nothing");
  assert.deepEqual(kinds(scenario({ aqi: 150 })), [], "AQI 150 is not above the limit");
  assert.deepEqual(kinds(scenario({ aqi: 151 })), ["air:warning"]);
  assert.deepEqual(kinds(scenario({ aqi: 201 })), ["air:severe"]);
  console.log("✓ Air alerts start above AQI 150 and turn severe above 200");

  // 2. Rain -------------------------------------------------------------
  assert.deepEqual(kinds(scenario({ hours: { 2: { precipitationProbability: 80 } } })), [], "80% is not above 80%");
  const rain = alertsOf(
    scenario({ hours: { 2: { precipitationProbability: 85 }, 3: { precipitationProbability: 95 } } }),
  );
  assert.equal(rain.length, 1);
  assert.ok(rain[0].kind === "rain");
  assert.equal(rain[0].startsAt, base.hourly[2].time, "starts with the first hour above 80%");
  assert.equal(rain[0].chance, 95, "reports the highest chance in the window");
  assert.equal(rain[0].heavy, false);
  const rainNow = alertsOf(scenario({ hours: { 0: { precipitationProbability: 90, condition: "heavy-rain" } } }))[0];
  assert.ok(rainNow.kind === "rain" && rainNow.startsAt === null && rainNow.heavy, "this hour counts as now");
  // Hour 3 starts at 17:00, inside the next 3 hours; hour 4 (18:00) does not.
  assert.equal(kinds(scenario({ hours: { 3: { precipitationProbability: 90 } } })).length, 1);
  assert.deepEqual(kinds(scenario({ hours: { 4: { precipitationProbability: 90 } } })), []);
  console.log("✓ Rain alerts need a chance above 80% within the next 3 hours");

  // 3. Thunderstorms ----------------------------------------------------
  const stormNow = alertsOf(scenario({ condition: "thunderstorm" }))[0];
  assert.ok(stormNow.kind === "storm" && stormNow.startsAt === null);
  const stormSoon = alertsOf(scenario({ hours: { 2: { condition: "thunderstorm", precipitationProbability: 88 } } }));
  assert.ok(stormSoon[0].kind === "storm" && stormSoon[0].startsAt === base.hourly[2].time);
  assert.equal(stormSoon.length, 1, "a storm alert already covers the rain it brings");
  assert.deepEqual(kinds(scenario({ hours: { 3: { condition: "thunderstorm" } } })), [], "17:00 is beyond 2 hours");
  console.log("✓ Storm alerts cover now and the next 2 hours, and replace the rain alert");

  // 4. Order and tips -----------------------------------------------------
  assert.deepEqual(kinds(scenario({ aqi: 180, hours: { 1: { precipitationProbability: 90 } } })), [
    "air:warning",
    "rain:warning",
  ]);
  assert.deepEqual(kinds(scenario({ aqi: 250, condition: "thunderstorm" })), ["storm:severe", "air:severe"]);
  const all: WeatherAlert[] = [
    ...alertsOf(scenario({ condition: "thunderstorm", aqi: 250 })),
    ...alertsOf(scenario({ aqi: 160, hours: { 1: { precipitationProbability: 90, condition: "heavy-rain" } } })),
  ];
  for (const alert of all) {
    const tips = alertTips(alert);
    assert.ok(tips.length >= 2, `${alert.kind} has tips`);
    for (const tip of tips) assert.ok(MESSAGES.th.alerts.tips[tip] && MESSAGES.en.alerts.tips[tip]);
  }
  assert.ok(alertTips(all.find((a) => a.kind === "rain")!).includes("umbrella"));
  assert.equal(MESSAGES.th.alerts.tips.umbrella, "ควรพกร่ม");
  assert.equal(MESSAGES.th.alerts.tips.mask, "ควรสวมหน้ากากกันฝุ่น PM2.5");
  console.log("✓ Most urgent first; every alert has tips in Thai and English");

  // 5. The simulated weather over a week ----------------------------------
  let checked = 0;
  const seen: Record<string, number> = {};
  for (let h = 0; h < 7 * 24; h += 6) {
    const now = NOW + h * HOUR;
    const week = new WeatherNext3MockService({ latencyMs: 0, now: () => now });
    for (const place of PLACES) {
      const bundle = await week.getForecastBundle(place, 6);
      for (const alert of weatherAlerts(bundle.current, bundle.hourly)) {
        seen[alert.kind] = (seen[alert.kind] ?? 0) + 1;
        if (alert.kind !== "air" && alert.startsAt) {
          const lead = (Date.parse(alert.startsAt) - now) / HOUR;
          assert.ok(lead > 0 && lead < (alert.kind === "storm" ? 2 : 3), `${place.id}: ${alert.kind} in ${lead} h`);
        }
      }
      checked++;
    }
  }
  console.log(`✓ ${checked} simulated forecasts give well-formed alerts (${JSON.stringify(seen)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
