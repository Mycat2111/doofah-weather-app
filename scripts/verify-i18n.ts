/**
 * Checks for the Thai / English UI text.
 * Run with: npm run verify:i18n
 */
import assert from "node:assert/strict";
import { localeFromAcceptLanguage } from "../src/i18n/config";
import { createFormatters } from "../src/i18n/format";
import { MESSAGES } from "../src/i18n/messages";
import { placeLabel } from "../src/i18n/places";
import type { RouteOutlook } from "../src/lib/routeWeather";
import type { SummaryFact } from "../src/lib/voiceSummary";
import {
  PLACES,
  WeatherNext3MockService,
  type AqiCategory,
  type DayOutlookKind,
  type DayPeriod,
  type NowcastOutlook,
  type RainIntensity,
  type WeatherCondition,
} from "../src/services/WeatherNext3MockService";

const NOW = Date.UTC(2026, 8, 30, 7, 20); // 30 Sep 2026, 14:20 in Bangkok
const { en, th } = MESSAGES;

const CONDITIONS: WeatherCondition[] = [
  "clear",
  "partly-cloudy",
  "cloudy",
  "fog",
  "drizzle",
  "rain",
  "heavy-rain",
  "thunderstorm",
  "snow",
];
const INTENSITIES: RainIntensity[] = ["drizzle", "light", "moderate", "heavy"];
const DAY_KINDS: DayOutlookKind[] = [
  "thunderstorms",
  "heavy-rain",
  "downpours",
  "showers",
  "light-showers",
  "snow",
  "fog",
  "mostly-cloudy",
  "hot-sunny-spells",
  "sun-and-cloud",
  "hot-sunny",
  "clear",
];
const PERIODS: DayPeriod[] = ["overnight", "morning", "afternoon", "evening"];
const AQI: AqiCategory[] = [
  "Good",
  "Moderate",
  "Unhealthy for Sensitive Groups",
  "Unhealthy",
  "Very Unhealthy",
  "Hazardous",
];

// Latin text that legitimately stays in the Thai UI: names, symbols and units.
const ALLOWED_LATIN = /DooFah|WeatherNext|Google Cloud|OpenStreetMap|WRF|TMD|ECMWF|IFS|PM2\.5|AQI|UV|AI|UTC|hPa|°C/g;
const hasStrayLatin = (text: string) => /[A-Za-z]/.test(text.replace(ALLOWED_LATIN, ""));
const hasThai = (text: string) => /[฀-๿]/.test(text);

let checked = 0;
function assertThai(text: string, where: string) {
  checked++;
  assert.ok(text && hasThai(text), `${where}: expected Thai, got "${text}"`);
  assert.ok(!hasStrayLatin(text), `${where}: untranslated Latin in "${text}"`);
}

/** Walk every string (and every function called with sample values) in a dictionary. */
function collect(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === "string") out.push([path, value]);
  else if (typeof value === "function") {
    const result = (value as (...args: unknown[]) => unknown)("12", "34", "56");
    if (typeof result === "string") out.push([path, result]);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) collect(child, `${path}.${key}`, out);
  }
}

async function main() {
  // 1. The examples from the request ---------------------------------------
  assert.equal(th.condition("heavy-rain", true), "ฝนตกหนัก");
  assert.equal(th.condition("clear", false), "ท้องฟ้าแจ่มใส");
  const fth = createFormatters("th");
  const fen = createFormatters("en");
  assert.equal(fth.dayName("2026-09-28", 2), "จันทร์");
  assert.equal(fth.dayName("2026-09-29", 2), "อังคาร");
  assert.equal(fth.dayName("2026-10-01", 2), "พฤหัสบดี");
  assert.equal(fth.dayName("2026-09-30", 0), "วันนี้");
  assert.equal(fth.dayName("2026-10-01", 1), "พรุ่งนี้");
  assert.equal(fth.shortDate("2026-09-30"), "30 ก.ย.");
  assert.equal(fth.clock(NOW, "Asia/Bangkok"), "14:20");
  assert.equal(fth.hour(NOW, "Asia/Bangkok"), "14");
  assert.equal(fen.dayName("2026-09-28", 2), "Mon");
  // The 15-day list shows the date under each day: "Mon / Oct 12", "จันทร์ / 12 ต.ค.".
  assert.equal(fen.shortDate("2026-10-12"), "Oct 12");
  assert.equal(fth.shortDate("2026-10-12"), "12 ต.ค.");
  assert.equal(fen.clock(NOW, "Asia/Bangkok"), "14:20");
  console.log(
    `✓ ฝนตกหนัก, ท้องฟ้าแจ่มใส, ${fth.dayName("2026-09-28", 2)}, ${fth.dayName("2026-09-29", 2)}, ` +
      `${fth.shortDate("2026-09-30")}, ${fth.clock(NOW, "Asia/Bangkok")}`,
  );

  // 2. Every generated Thai phrase is Thai ----------------------------------
  for (const c of CONDITIONS) {
    for (const isDay of [true, false]) {
      assertThai(th.condition(c, isDay), `condition ${c}`);
      assert.ok(en.condition(c, isDay), `English condition ${c}`);
    }
  }
  for (const a of AQI) assertThai(th.aqi[a], `AQI ${a}`);
  for (const uv of [0, 3, 6, 8, 11]) assertThai(th.uv(uv), `UV ${uv}`);
  for (let deg = 0; deg < 360; deg += 5) assertThai(th.compass(deg), `compass ${deg}`);
  const outlooks: NowcastOutlook[] = [{ kind: "dry" }];
  for (const intensity of INTENSITIES) {
    outlooks.push({ kind: "starting", minutes: 40, intensity });
    outlooks.push({ kind: "stopping", minutes: 20, intensity });
    outlooks.push({ kind: "continuing", intensity });
  }
  for (const o of outlooks) assertThai(th.nowcast(o), `nowcast ${JSON.stringify(o)}`);
  for (const kind of DAY_KINDS) {
    for (const period of PERIODS) {
      for (const wind of ["calm", "breezy", "windy"] as const) {
        assertThai(th.daySummary({ kind, period, wind, precipitationMm: 24.6 }), `day ${kind} ${period} ${wind}`);
      }
    }
  }
  const routeOutlooks: RouteOutlook[] = [
    { kind: "dry" },
    { kind: "possible", stop: 2, chance: 45 },
    { kind: "rain", from: 3, to: 3, level: "rain", chance: 80, patchy: false },
    { kind: "rain", from: 1, to: 4, level: "heavy", chance: 90, patchy: false },
    { kind: "rain", from: 5, to: 6, level: "storm", chance: 85, patchy: false },
    ...(["rain", "heavy", "storm"] as const).map((level) => ({
      kind: "rain" as const,
      from: 1,
      to: 5,
      level,
      chance: 90,
      patchy: true,
    })),
  ];
  for (const o of routeOutlooks)
    assertThai(
      th.routeOutlook(
        o,
        (i) => `เมือง${i}`,
        (i) => `1${i}:30`,
      ),
      `route ${JSON.stringify(o)}`,
    );
  // The live countdown names hours, and calls rain under an even chance possible.
  for (const text of [
    th.countdown.possibleAround("17:00"),
    th.countdown.possibleNow,
    th.countdown.possibleFrom("17:00", 40),
    th.countdown.chance(40),
  ])
    assertThai(text, "countdown");
  assert.equal(en.countdown.possibleFrom("5 PM", 40), "Rain possible from 5 PM · 40% chance");
  assert.equal(th.countdown.possibleFrom("17:00", 40), "อาจมีฝนตั้งแต่ 17:00\u00a0น. · โอกาส 40%");
  // Each hour's forecast model, named the same way in both languages.
  for (const model of ["WRF", "ECMWF", "WRF+ECMWF"] as const) {
    assertThai(th.forecastModel.about[model], `model ${model}`);
    assert.ok(en.forecastModel.about[model].includes(model.split("+")[0]), `English ${model}`);
  }
  const later = {
    at: "2026-09-30T10:00:00Z",
    thisHour: false,
    chance: 40,
    likely: false,
    heavy: false,
    storm: false,
    tomorrow: false,
  };
  const facts: SummaryFact[] = [
    ...(["morning", "afternoon", "evening", "night"] as const).map((part) => ({ kind: "greeting" as const, part })),
    { kind: "now", tempC: 32, condition: "cloudy", isDay: true, feelsLikeC: 38 },
    ...CONDITIONS.map((condition) => ({ kind: "now" as const, tempC: 25, condition, isDay: false, feelsLikeC: null })),
    ...INTENSITIES.map((intensity) => ({ kind: "rainStarting" as const, minutes: 12, intensity })),
    ...INTENSITIES.map((intensity) => ({ kind: "raining" as const, intensity, until: "2026-09-30T11:00:00Z" })),
    { kind: "raining", intensity: "light", until: null },
    { kind: "rainLater", ...later },
    { kind: "rainLater", ...later, chance: 80, likely: true, tomorrow: true },
    { kind: "rainLater", ...later, heavy: true },
    { kind: "rainLater", ...later, storm: true },
    { kind: "rainLater", ...later, thisHour: true },
    { kind: "rainLater", ...later, thisHour: true, chance: 80, likely: true, heavy: true },
    { kind: "dry", hours: 24, weekday: 4 },
    { kind: "dry", hours: 24, weekday: null },
    { kind: "today", maxC: 34 },
    { kind: "tonight", minC: 25 },
    ...DAY_KINDS.map((kind) => ({
      kind: "tomorrow" as const,
      outlook: { kind, period: "afternoon" as const, wind: "breezy" as const, precipitationMm: 12.4 },
      minC: 24,
      maxC: 33,
    })),
    { kind: "uv", peak: 9 },
    { kind: "heat", feelsLikeC: 43 },
    ...AQI.map((category) => ({ kind: "air" as const, aqi: 160, category })),
  ];
  const clock = () => ({ hour: 17, minute: 0 });
  for (const place of ["กรุงเทพฯ", null]) {
    th.voiceSummary(facts, { place, clock }).forEach((line, i) => assertThai(line, `voice ${facts[i].kind}`));
  }
  console.log(`✓ ${checked} generated Thai phrases, none with untranslated words`);

  // 3. Every static Thai string ---------------------------------------------
  const strings: [string, string][] = [];
  const skip = new Set([
    "condition",
    "aqi",
    "uv",
    "compass",
    "nowcast",
    "daySummary",
    "lifestyleReason",
    "routeOutlook",
    "voiceSummary",
  ]);
  for (const [key, value] of Object.entries(th)) if (!skip.has(key)) collect(value, key, strings);
  for (const [path, text] of strings) {
    assert.ok(!hasStrayLatin(text), `th.${path}: untranslated Latin in "${text}"`);
  }
  console.log(`✓ ${strings.length} Thai UI strings, none left in English`);

  // 4. Real forecasts phrased in Thai match the English summaries -----------
  const svc = new WeatherNext3MockService({ latencyMs: 0, now: () => NOW });
  let days = 0;
  for (const place of PLACES) {
    const bundle = await svc.getForecastBundle(place);
    assert.equal(en.nowcast(bundle.current.nowcast.outlook), bundle.current.nowcast.summary);
    assertThai(th.nowcast(bundle.current.nowcast.outlook), `${place.id} nowcast`);
    for (const day of bundle.daily) {
      assert.equal(en.daySummary(day.outlook), day.summary, `${place.id} ${day.date} outlook matches summary`);
      assertThai(th.daySummary(day.outlook), `${place.id} ${day.date}`);
      days++;
    }
  }
  const sample = (await svc.getForecastBundle(PLACES[0])).daily.slice(0, 4);
  for (const d of sample)
    console.log(`  ${fth.dayName(d.date, 2).padEnd(9)} ${d.summary}  →  ${th.daySummary(d.outlook)}`);
  console.log(`✓ ${days} forecast days across ${PLACES.length} places phrase the same outlook in both languages`);

  // 5. Places ---------------------------------------------------------------
  for (const place of PLACES) {
    assert.ok(place.th, `${place.id} has Thai names`);
    const label = placeLabel(place, "th");
    assertThai(label.name, `${place.id} name`);
    assertThai(label.area, `${place.id} area`);
  }
  const first = async (q: string) => (await svc.searchPlaces(q))[0]?.id;
  assert.equal(await first("โคราช"), "korat");
  assert.equal(await first("กทม"), "bangkok");
  assert.equal(await first("กรุงเทพ"), "bangkok");
  assert.equal(await first("โตเกียว"), "tokyo");
  assert.equal(await first("ลอนดอน"), "london");
  assert.equal(await first("tokyo"), "tokyo");
  assert.equal(await first("สมุย"), "koh-samui");
  const here = svc.placeForPoint({ lat: 10.5, lon: 101.5 }, "Asia/Bangkok");
  assert.equal(placeLabel(here, "th").name, "ตำแหน่งของคุณ");
  assert.equal(placeLabel(here, "en").name, "Your location");
  console.log(`✓ ${PLACES.length} places have Thai names; Thai search finds โคราช, กทม, โตเกียว, สมุย`);

  // 6. Language negotiation -------------------------------------------------
  assert.equal(localeFromAcceptLanguage("th-TH,th;q=0.9,en;q=0.8"), "th");
  assert.equal(localeFromAcceptLanguage("en-US,en;q=0.9,th;q=0.8"), "en");
  assert.equal(localeFromAcceptLanguage("fr-FR,fr;q=0.9"), undefined);
  assert.equal(localeFromAcceptLanguage("fr;q=1, th;q=0.5"), "th");
  assert.equal(localeFromAcceptLanguage("th;q=0"), undefined);
  assert.equal(localeFromAcceptLanguage(null), undefined);
  console.log("✓ Accept-Language picks Thai or English by preference");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
