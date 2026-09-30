/**
 * Checks for the rain countdown and the lifestyle cards.
 * Run with: npm run verify:lifestyle
 */
import assert from "node:assert/strict";
import { createFormatters } from "../src/i18n/format";
import { MESSAGES } from "../src/i18n/messages";
import { lifestyleIndex, type Activity, type LifestyleReason, type LifestyleStatus } from "../src/lib/lifestyle";
import { dryHoursUntil, minutesUntil, rainCountdown, type RainCountdown } from "../src/lib/rainCountdown";
import {
  PLACES,
  WeatherNext3MockService,
  type AtmosphericSample,
  type ForecastBundle,
  type HourlyForecast,
} from "../src/services/WeatherNext3MockService";

const HOUR = 3_600_000;
const MIN = 60_000;
const NOW = Date.UTC(2026, 8, 30, 7, 20); // 30 Sep 2026, 14:20 in Bangkok
const TZ = "Asia/Bangkok";
const service = new WeatherNext3MockService({ latencyMs: 0, now: () => NOW });
const { en, th } = MESSAGES;
const fen = createFormatters("en");
const clockEn = (t: string) => fen.clock(t, TZ);
const clockTh = (t: string) => createFormatters("th").clock(t, TZ);

const hasThai = (text: string) => /[฀-๿]/.test(text);
const hasStrayLatin = (text: string) => /[A-Za-z]/.test(text.replace(/AQI|UV/g, ""));
function assertThai(text: string, where: string) {
  assert.ok(hasThai(text) && !hasStrayLatin(text), `${where}: "${text}" is not all Thai`);
}

async function main() {
  const base = await service.getForecastBundle(PLACES.find((p) => p.id === "bangkok")!);
  assert.equal(Date.parse(base.hourly[0].time), NOW - 20 * MIN, "hour 0 starts at 14:00");
  assert.ok(base.current.sample.isDay, "14:20 is daytime");

  /** A dry, mild, clean-air copy of the forecast with the given changes. */
  function scenario({
    steps = {},
    sample = {},
    hours = {},
    aqi = 60,
    tomorrowChance = 20,
  }: {
    /** Nowcast rain rates by 10-minute step. */
    steps?: Record<number, number>;
    sample?: Partial<AtmosphericSample>;
    hours?: Record<number, Partial<HourlyForecast>>;
    aqi?: number;
    tomorrowChance?: number;
  }): ForecastBundle {
    const hourly = base.hourly.map((h, i) => ({
      ...h,
      condition: "partly-cloudy" as const,
      precipitationProbability: 10,
      precipitationMm: 0,
      cloudCover: 20,
      humidity: 60,
      feelsLikeC: 30,
      uvIndex: h.isDay ? 5 : 0,
      ...hours[i],
    }));
    return {
      ...base,
      current: {
        ...base.current,
        observedAt: new Date(NOW).toISOString(),
        sample: {
          ...base.current.sample,
          condition: "partly-cloudy",
          feelsLikeC: 30,
          humidity: 60,
          cloudCover: 20,
          uvIndex: 5,
          visibilityKm: 10,
          ...sample,
        },
        airQuality: { ...base.current.airQuality, aqi },
        nowcast: {
          ...base.current.nowcast,
          steps: base.current.nowcast.steps.map((s, i) => ({ ...s, precipitationMm: steps[i] ?? 0 })),
        },
      },
      hourly,
      daily: base.daily.map((d, i) => ({ ...d, precipitationProbability: i === 1 ? tomorrowChance : 20 })),
    };
  }
  const countdownOf = (b: ForecastBundle) => rainCountdown(b.current, b.hourly, b.daily);
  const cards = (b: ForecastBundle) => lifestyleIndex(b.current, b.hourly, b.daily);
  const card = (b: ForecastBundle, activity: Activity) => cards(b).find((s) => s.activity === activity)!;
  const brief = (s: LifestyleStatus) => `${s.level}:${s.reason.kind}`;
  const say = (s: LifestyleStatus) =>
    `${en.lifestyle.activities[s.activity]}: ${en.lifestyle.status[s.activity][s.level]} (${en.lifestyleReason(s.reason, clockEn)})`;

  // 1. Countdown from the radar nowcast ------------------------------------
  const soon = countdownOf(scenario({ steps: { 1: 0.05, 2: 0.1, 3: 3 } }));
  assert.ok(soon.kind === "starting");
  assert.equal(minutesUntil(soon.at, NOW), 20);
  assert.equal(soon.intensity, "moderate", "named by the heaviest step in its first half hour");
  const soonText = en.countdown.rainIn[soon.intensity](en.countdown.duration(minutesUntil(soon.at, NOW)));
  assert.equal(soonText, "Rain expected in 20 min");
  assert.equal(
    th.countdown.rainIn[soon.intensity](th.countdown.duration(minutesUntil(soon.at, NOW))),
    "ฝนจะตกในอีก 20\u00a0นาที",
  );
  // Between steps the start is interpolated to the minute: 0 → 1 mm/h crosses 0.1 a tenth of the way.
  const between = countdownOf(scenario({ steps: { 2: 1, 3: 1 } }));
  assert.ok(between.kind === "starting" && minutesUntil(between.at, NOW) === 11 && between.intensity === "light");
  // The live countdown runs down with the clock and stops at zero.
  assert.equal(minutesUntil(soon.at, NOW + 7 * MIN), 13);
  assert.equal(minutesUntil(soon.at, NOW + 25 * MIN), 0);
  assert.equal(en.countdown.duration(75), "1 h 15 min");
  assert.equal(th.countdown.duration(60), "1\u00a0ชม.");
  console.log(`✓ Radar countdown to the minute: "${soonText}", "${th.countdown.rainIn.moderate("20 นาที")}"`);

  const easing = countdownOf(scenario({ steps: { 0: 2, 1: 2, 2: 2, 3: 2 } }));
  assert.ok(easing.kind === "raining" && easing.precise && easing.intensity === "moderate");
  assert.equal(minutesUntil(easing.until!, NOW), 40, "2 → 0 mm/h crosses 0.1 at 95% of the step: 39.5 min");
  const allWet = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [i, 9]));
  const wetHours = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [i, { precipitationProbability: 90 }]));
  const long = countdownOf(scenario({ steps: allWet, hours: wetHours }));
  assert.ok(long.kind === "raining" && !long.precise && long.intensity === "heavy");
  assert.equal(long.until, base.hourly[4].time, "past the radar, the first dry forecast hour (18:00)");
  const everyHourWet = Object.fromEntries(base.hourly.map((_, i) => [i, { precipitationProbability: 90 }]));
  const endless = countdownOf(scenario({ steps: allWet, hours: everyHourWet }));
  assert.ok(endless.kind === "raining" && endless.until === null);
  console.log("✓ While it rains: easing time from the radar, then from the hourly forecast");

  // 2. Past the radar: the hourly forecast -----------------------------------
  const later = countdownOf(scenario({ hours: { 5: { precipitationProbability: 70 } } }));
  assert.ok(later.kind === "later" && later.at === base.hourly[5].time && later.chance === 70 && later.clear);
  assert.equal(dryHoursUntil(later.at, NOW), 4, "19:00 is 4 h 40 min away: 4 full dry hours");
  assert.equal(en.countdown.clearFor(dryHoursUntil(later.at, NOW)), "Clear sky for the next 4 hours");
  assert.equal(en.countdown.clearFor(3), "Clear sky for the next 3 hours");
  assert.equal(th.countdown.clearFor(3), "ท้องฟ้าโปร่งอีก 3\u00a0ชั่วโมง", "short enough not to wrap on a phone");
  const cloudy = countdownOf(
    scenario({ hours: { 0: { cloudCover: 90 }, 1: { cloudCover: 90 }, 2: { precipitationProbability: 60 } } }),
  );
  assert.ok(cloudy.kind === "later" && !cloudy.clear);
  assert.equal(Date.parse(cloudy.at), NOW + 2 * HOUR, "an hour that overlaps the radar starts where the radar ends");
  assert.equal(dryHoursUntil(cloudy.at, NOW), 2);
  const dry = countdownOf(scenario({ tomorrowChance: 70 }));
  assert.ok(dry.kind === "dry" && dry.hours === 24 && dry.clear && dry.nextRainDay === 1);
  assert.equal(
    en.countdown.nextRain(fen.dayName(base.daily[3].date, 3), fen.shortDate(base.daily[3].date)),
    "Next rain likely Sat, Oct 3",
  );
  console.log(`✓ Then the hourly forecast: "${en.countdown.clearFor(3)}", "${th.countdown.clearFor(3)}"`);

  // 3. Lifestyle cards ------------------------------------------------------
  const calm = scenario({});
  assert.deepEqual(
    cards(calm).map((s) => `${s.activity}:${brief(s)}`),
    [
      "laundry:good:dryUntil",
      "carWash:good:dryDays",
      "run:good:pleasant",
      "commute:good:clearRoads",
      "sunscreen:fair:uv",
      "stargazing:good:clouds",
    ],
  );
  assert.equal(say(card(calm, "laundry")), `Laundry: Good time (Dry until ${clockEn(base.current.sunset!)})`);
  assert.equal(say(card(calm, "run")), "Outdoor run: Safe (Feels like 30°)");
  assert.equal(say(card(calm, "carWash")), "Car wash: Good day to wash (Dry for the next 7 days)");

  // Laundry: rain within 4 hours, humid air, no sun left.
  assert.equal(brief(card(scenario({ steps: { 3: 1 } }), "laundry")), "poor:rainAt");
  assert.equal(brief(card(scenario({ hours: { 4: { precipitationProbability: 60 } } }), "laundry")), "poor:rainAt");
  assert.equal(brief(card(scenario({ hours: { 5: { precipitationProbability: 60 } } }), "laundry")), "good:dryUntil");
  assert.equal(brief(card(scenario({ steps: { 0: 1 } }), "laundry")), "poor:rainNow");
  const humid = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i, { humidity: 90 }]));
  assert.equal(brief(card(scenario({ hours: humid }), "laundry")), "fair:humid");
  assert.equal(brief(card(scenario({ sample: { isDay: false } }), "laundry")), "fair:noSun");

  // Car wash: rain later today spoils it; rain tomorrow is a risk.
  const tomorrowRain = scenario({ tomorrowChance: 70 });
  assert.equal(say(card(tomorrowRain, "carWash")), "Car wash: Risk of rain tomorrow (70% chance of rain tomorrow)");
  assert.equal(`${th.lifestyle.activities.carWash}: ${th.lifestyle.status.carWash.fair}`, "ล้างรถ: เสี่ยงฝนพรุ่งนี้");
  assert.equal(brief(card(scenario({ hours: { 8: { precipitationProbability: 60 } } }), "carWash")), "poor:rainAt");

  // Outdoor run: storms, bad air and heat first; then rain, warmth, air and UV.
  assert.equal(brief(card(scenario({ hours: { 1: { condition: "thunderstorm" } } }), "run")), "poor:storm");
  assert.equal(brief(card(scenario({ aqi: 151 }), "run")), "poor:air");
  assert.equal(brief(card(scenario({ aqi: 120 }), "run")), "fair:air");
  assert.equal(brief(card(scenario({ sample: { feelsLikeC: 41 } }), "run")), "poor:heat");
  const warm = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [i, { feelsLikeC: 38 }]));
  const hot = card(scenario({ sample: { feelsLikeC: 38 }, hours: warm }), "run");
  assert.equal(say(hot), "Outdoor run: Take care (Feels like 38°, cooler from 18:00)");
  assert.equal(brief(card(scenario({ steps: { 4: 1 } }), "run")), "fair:rainAt");
  assert.equal(brief(card(scenario({ steps: { 8: 1 } }), "run")), "good:pleasant", "rain in 80 min is after the run");
  assert.equal(brief(card(scenario({ sample: { uvIndex: 9 } }), "run")), "fair:uv");

  // Commute: heavy rain means delays; any rain or fog means extra time.
  assert.equal(brief(card(scenario({ hours: { 2: { condition: "heavy-rain" } } }), "commute")), "poor:heavyRain");
  assert.equal(brief(card(scenario({ steps: { 2: 9 } }), "commute")), "poor:heavyRain");
  assert.equal(brief(card(scenario({ steps: { 2: 1 } }), "commute")), "fair:rainAt");
  assert.equal(brief(card(scenario({ sample: { visibilityKm: 1.2 } }), "commute")), "fair:fog");

  // Sunscreen follows today's highest UV from now on.
  const strongSun = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [i, { uvIndex: i < 2 ? 9 : 1 }]));
  const uv = card(scenario({ hours: strongSun }), "sunscreen");
  assert.equal(say(uv), "Sunscreen: Essential (UV up to 9 until 16:00)");
  assert.equal(brief(card(scenario({ sample: { isDay: false } }), "sunscreen")), "good:sunDown");

  // Stargazing looks at tonight's first dark hours.
  const night = base.hourly.flatMap((h, i) => (h.sunElevationDeg < -6 ? [i] : [])).slice(0, 5);
  const tonight = (change: Partial<HourlyForecast>) => Object.fromEntries(night.map((i) => [i, change]));
  assert.equal(brief(card(scenario({ hours: tonight({ cloudCover: 50 }) }), "stargazing")), "fair:clouds");
  assert.equal(brief(card(scenario({ hours: tonight({ cloudCover: 80 }) }), "stargazing")), "poor:clouds");
  assert.equal(
    brief(card(scenario({ hours: { [night[2]]: { precipitationProbability: 70 } } }), "stargazing")),
    "poor:rainTonight",
  );
  console.log(`✓ Lifestyle rules: "${say(card(calm, "laundry"))}", "${say(card(tomorrowRain, "carWash"))}"`);

  // 4. Every reason reads in both languages -----------------------------------
  const t = new Date(NOW + HOUR).toISOString();
  const reasons: LifestyleReason[] = [
    { kind: "rainNow" },
    { kind: "rainAt", time: t },
    { kind: "heavyRain", time: t },
    { kind: "heavyRain", time: null },
    { kind: "rainTomorrow", chance: 70 },
    { kind: "rainTonight" },
    { kind: "dryUntil", time: t },
    { kind: "dryDays", days: 3 },
    { kind: "noSun" },
    { kind: "humid", humidity: 88 },
    { kind: "storm" },
    { kind: "air", aqi: 160 },
    { kind: "heat", feelsLikeC: 38, coolerAt: t },
    { kind: "heat", feelsLikeC: 42, coolerAt: null },
    { kind: "pleasant", feelsLikeC: 29 },
    { kind: "uv", peak: 9, until: t },
    { kind: "uvLow" },
    { kind: "sunDown" },
    { kind: "fog", visibilityKm: 1.2 },
    { kind: "clearRoads" },
    { kind: "clouds", percent: 30 },
  ];
  for (const r of reasons) {
    assertThai(th.lifestyleReason(r, clockTh), `reason ${r.kind}`);
    assert.ok(en.lifestyleReason(r, clockEn), `English reason ${r.kind}`);
  }
  console.log(`✓ ${reasons.length} reasons worded in Thai and English`);

  // 5. The simulated weather over a week --------------------------------------
  let checked = 0;
  const kinds: Record<string, number> = {};
  for (let h = 0; h < 7 * 24; h += 5) {
    const now = NOW + h * HOUR;
    const week = new WeatherNext3MockService({ latencyMs: 0, now: () => now });
    for (const place of PLACES) {
      const b = await week.getForecastBundle(place);
      const c: RainCountdown = rainCountdown(b.current, b.hourly, b.daily);
      kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      if (c.kind === "starting") {
        const minutes = minutesUntil(c.at, now);
        assert.ok(minutes > 0 && minutes <= 120, `${place.id}: rain in ${minutes} min`);
      }
      if (c.kind === "later") assert.ok(Date.parse(c.at) >= now + 2 * HOUR && Date.parse(c.at) < now + 24 * HOUR);
      const statuses = lifestyleIndex(b.current, b.hourly, b.daily, now, c);
      assert.equal(statuses.length, 6);
      // The cards and the badge read the same countdown.
      if (c.kind === "raining") {
        assert.equal(brief(statuses.find((s) => s.activity === "laundry")!), "poor:rainNow", place.id);
      }
      for (const s of statuses) {
        const clock = (time: string) => createFormatters("th").clock(time, place.timeZone);
        assertThai(th.lifestyleReason(s.reason, clock), `${place.id} ${s.activity}`);
      }
      checked++;
    }
  }
  console.log(`✓ ${checked} simulated forecasts give consistent countdowns and cards (${JSON.stringify(kinds)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
