/**
 * Checks for the spoken weather summary: what it says, how it says times, and which voice reads it.
 * Run with: npm run verify:voice
 */
import assert from "node:assert/strict";
import { spokenTimeEn, spokenTimeTh, spokenWaitEn, spokenWaitTh } from "../src/i18n/spokenTime";
import { rainCountdown, type RainCountdown } from "../src/lib/rainCountdown";
import { pickVoice, type VoiceInfo } from "../src/lib/speech";
import { summaryFacts, weatherSummary, type SummaryInput } from "../src/lib/voiceSummary";
import { PLACES, WeatherNext3MockService } from "../src/services/WeatherNext3MockService";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 30, 7, 20); // 30 Sep 2026, 14:20 in Bangkok
const hasThai = (text: string) => /[฀-๿]/.test(text);

async function main() {
  // 1. Times as people say them ----------------------------------------------
  const th: [number, number, string][] = [
    [17, 0, "ห้าโมงเย็น"],
    [13, 30, "บ่ายโมงครึ่ง"],
    [0, 0, "เที่ยงคืน"],
    [2, 0, "ตีสอง"],
    [7, 0, "เจ็ดโมงเช้า"],
    [12, 0, "เที่ยงวัน"],
    [15, 0, "บ่ายสามโมง"],
    [18, 0, "หกโมงเย็น"],
    [19, 0, "หนึ่งทุ่ม"],
    [20, 10, "สองทุ่ม"],
    [16, 50, "ห้าโมงเย็น"],
    [23, 50, "เที่ยงคืน"],
  ];
  for (const [h, m, said] of th) assert.equal(spokenTimeTh(h, m), said, `${h}:${m}`);
  const en: [number, number, string][] = [
    [17, 0, "5 PM"],
    [17, 20, "5:30 PM"],
    [12, 0, "noon"],
    [0, 0, "midnight"],
    [9, 45, "10 AM"],
    [23, 50, "midnight"],
  ];
  for (const [h, m, said] of en) assert.equal(spokenTimeEn(h, m), said, `${h}:${m}`);
  const waits: [number, string, string][] = [
    [1, "about a minute", "1 นาที"],
    [7, "about 7 minutes", "7 นาที"],
    [33, "about 35 minutes", "35 นาที"],
    [59, "about an hour", "1 ชั่วโมง"],
    [95, "about an hour and a half", "ชั่วโมงครึ่ง"],
    [113, "about 2 hours", "2 ชั่วโมง"],
  ];
  for (const [minutes, sayEn, sayTh] of waits) {
    assert.equal(spokenWaitEn(minutes), sayEn);
    assert.equal(spokenWaitTh(minutes), sayTh);
  }
  console.log("✓ 17:00 is ห้าโมงเย็น / 5 PM, 13:30 บ่ายโมงครึ่ง, 02:00 ตีสอง, 19:00 หนึ่งทุ่ม, 12:00 noon");
  console.log("✓ Waits are rounded: 33 min is about 35 minutes, 113 min about 2 hours (2 ชั่วโมง)");

  // 2. The voice -------------------------------------------------------------
  const voices: VoiceInfo[] = [
    { name: "Samantha", lang: "en-US", localService: true, default: true },
    { name: "Daniel", lang: "en-GB", localService: true },
    { name: "Kanya", lang: "th-TH", localService: true },
    { name: "Google ไทย", lang: "th_TH", localService: false },
    { name: "Microsoft Premwadee Online (Natural) - Thai (Thailand)", lang: "th-TH", localService: false },
  ];
  assert.equal(pickVoice(voices, "th-TH")?.lang.startsWith("th"), true, "a Thai voice for Thai");
  assert.equal(pickVoice(voices, "en-US")?.name, "Samantha");
  assert.equal(pickVoice(voices, "en-GB")?.name, "Daniel", "the exact region first");
  assert.equal(pickVoice(voices.slice(0, 2), "th-TH"), null, "no Thai voice installed");
  assert.equal(pickVoice([{ name: "Mario", lang: "th-TH", localService: false }, voices[2]], "th-TH")?.name, "Kanya");
  console.log(`✓ Thai speech picks a Thai voice (${pickVoice(voices, "th-TH")?.name}); none installed means none`);

  // 3. The summary for every place, in both languages -------------------------
  const svc = new WeatherNext3MockService({ latencyMs: 0, now: () => NOW });
  const kinds = new Set<string>();
  const inputFor = async (id: string, now = NOW): Promise<SummaryInput> => {
    const at = new WeatherNext3MockService({ latencyMs: 0, now: () => now });
    const bundle = await at.getForecastBundle(PLACES.find((p) => p.id === id)!);
    return { ...bundle, countdown: rainCountdown(bundle.current, bundle.hourly, bundle.daily, now), now };
  };
  for (const place of PLACES) {
    const bundle = await svc.getForecastBundle(place);
    const input = { ...bundle, countdown: rainCountdown(bundle.current, bundle.hourly, bundle.daily, NOW) };
    const facts = summaryFacts(input);
    facts.forEach((f) => kinds.add(f.kind));
    assert.equal(facts[0].kind, "greeting");
    assert.equal(facts[1].kind, "now");
    const thai = weatherSummary(input, "th");
    const english = weatherSummary(input, "en");
    assert.equal(thai.lang, "th-TH");
    assert.equal(english.lang, "en-US");
    assert.equal(thai.sentences.length, facts.length);
    assert.equal(english.sentences.length, facts.length);
    for (const line of thai.sentences) assert.ok(hasThai(line) && !/\d{1,2}:\d\d/.test(line), `th: ${line}`);
    for (const line of english.sentences)
      assert.ok(!hasThai(line) && !/\d{1,2}:\d\d(?! [AP]M)/.test(line), `en: ${line}`);
    assert.match(english.sentences[1], /^Right now in .+ it's -?\d+ degrees and /);
    assert.equal(thai.text, thai.sentences.join(" "));
  }
  const bkk = await inputFor("bangkok");
  console.log(`  ${weatherSummary(bkk, "en").text}`);
  console.log(`  ${weatherSummary(bkk, "th").text}`);
  console.log(`✓ ${PLACES.length} places summarised in Thai and English (${[...kinds].join(", ")})`);

  // 4. The request's example: 32 degrees and cloudy, heavy rain around 5 PM ---
  const heavyAt5: RainCountdown = {
    kind: "later",
    at: new Date(Date.UTC(2026, 8, 30, 10)).toISOString(),
    chance: 85,
    clear: false,
  };
  const example: SummaryInput = {
    ...bkk,
    current: {
      ...bkk.current,
      sample: { ...bkk.current.sample, temperatureC: 32, feelsLikeC: 33, condition: "cloudy", isDay: true },
    },
    hourly: bkk.hourly.map((h) =>
      Math.abs(Date.parse(h.time) - Date.UTC(2026, 8, 30, 10)) < HOUR / 2
        ? { ...h, precipitationMm: 9, condition: "heavy-rain" as const }
        : h,
    ),
    countdown: heavyAt5,
  };
  const said = weatherSummary(example, "en").sentences;
  assert.ok(said.includes("Right now in Bangkok it's 32 degrees and cloudy."), said.join(" | "));
  assert.ok(said.includes("Expect heavy rain around 5 PM, so you might want to bring an umbrella."), said.join(" | "));
  const saidTh = weatherSummary(example, "th").sentences;
  assert.ok(saidTh.includes("ตอนนี้ที่กรุงเทพฯ อุณหภูมิ 32 องศา มีเมฆมาก"), saidTh.join(" | "));
  assert.ok(saidTh.includes("คาดว่าฝนจะตกหนักช่วงประมาณห้าโมงเย็น อย่าลืมพกร่มนะ"), saidTh.join(" | "));
  console.log(`  ${said.slice(1, 3).join(" ")}`);
  console.log(`  ${saidTh.slice(1, 3).join(" ")}`);
  console.log("✓ The example from the request, in both languages");

  // 5. Afternoon talks about today; evening about tonight and tomorrow ---------
  const morning = summaryFacts(await inputFor("bangkok", Date.UTC(2026, 8, 30, 2))).map((f) => f.kind);
  const evening = summaryFacts(await inputFor("bangkok", Date.UTC(2026, 8, 30, 12))).map((f) => f.kind);
  assert.ok(morning.includes("today") && !morning.includes("tomorrow"), morning.join());
  assert.ok(evening.includes("tonight") && evening.includes("tomorrow") && !evening.includes("today"), evening.join());
  // A GPS spot away from any town is "where you are".
  const spot = svc.placeForPoint({ lat: 10.5, lon: 101.5 }, "Asia/Bangkok");
  const out = await svc.getForecastBundle(spot);
  const spotInput = { ...out, countdown: rainCountdown(out.current, out.hourly, out.daily, NOW) };
  assert.match(weatherSummary(spotInput, "en").sentences[1], /^Right now where you are /);
  assert.match(weatherSummary(spotInput, "th").sentences[1], /^ตอนนี้ตรงที่คุณอยู่ /);
  console.log("✓ Mornings talk about today, evenings about tonight and tomorrow; a GPS spot is where you are");

  // 6. Real forecasts say how many weather models back it ------------------------
  const vote = { models: 7, wet: 6, heavy: 3, stormModels: 5, storm: 0, ensembles: 4, members: 143 };
  const backed: SummaryInput = {
    ...example,
    countdown: { ...heavyAt5, vote: { ...vote, chance: 85, confidence: 0.8 } },
  };
  const backedEn = weatherSummary(backed, "en").sentences;
  const at = backedEn.indexOf("Expect heavy rain around 5 PM, so you might want to bring an umbrella.");
  assert.equal(backedEn[at + 1], "6 of 7 weather models agree, so that's a fairly safe bet.");
  const backedTh = weatherSummary(backed, "th").sentences;
  assert.ok(backedTh.includes("โมเดลพยากรณ์ 6 จาก 7 ตัวเห็นตรงกัน ค่อนข้างแน่นอน"), backedTh.join(" | "));
  const doubted: SummaryInput = {
    ...example,
    countdown: {
      kind: "starting",
      at: new Date(NOW + 20 * 60_000).toISOString(),
      intensity: "light",
      vote: { ...vote, wet: 1, heavy: 0, chance: 18, confidence: 0.7 },
      doubtful: true,
    },
  };
  const doubtedEn = weatherSummary(doubted, "en").sentences;
  assert.ok(
    doubtedEn.includes("Only 1 of 7 weather models expect it, though, so it may stay dry."),
    doubtedEn.join(" | "),
  );
  const split: SummaryInput = {
    ...example,
    countdown: { ...heavyAt5, chance: 69, vote: { ...vote, wet: 3, chance: 69, confidence: 0.3 } },
  };
  assert.ok(
    weatherSummary(split, "en").sentences.includes("The weather models are split on it, though: 3 of 7 expect rain."),
  );
  const dryDay: SummaryInput = {
    ...example,
    countdown: {
      kind: "dry",
      hours: 24,
      clear: true,
      nextRainDay: null,
      vote: { ...vote, wet: 0, heavy: 0, chance: 4, confidence: 0.9 },
      showerAt: example.hourly[3].time,
    },
  };
  assert.ok(weatherSummary(dryDay, "en").sentences.includes("All 7 weather models agree."));
  assert.equal(
    summaryFacts(example).filter((f) => f.kind === "models").length,
    0,
    "the simulation has no models to count",
  );
  console.log(`  ${backedEn.slice(at, at + 2).join(" ")}`);
  console.log(`  ${doubtedEn.slice(2, 4).join(" ")}`);
  console.log("✓ Real forecasts add how many weather models agree, and how firmly");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
