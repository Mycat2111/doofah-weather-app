/**
 * Checks for the spoken weather summary: what it says, how it says times, and which voice reads it.
 * Run with: npm run verify:voice
 */
import assert from "node:assert/strict";
import { spokenTimeEn, spokenTimeTh, spokenWaitEn, spokenWaitTh } from "../src/i18n/spokenTime";
import { rainCountdown, type RainCountdown } from "../src/lib/rainCountdown";
import { pickVoice, type VoiceInfo } from "../src/lib/speech";
import { summaryFacts, weatherSummary, type SummaryInput } from "../src/lib/voiceSummary";
import { MAX_TEXT, pickGoogleVoice, RATE_LIMIT, voiceServer } from "../src/services/tts/googleTts";
import { SimulatedWeatherService } from "../src/services/simulation/SimulatedWeatherService";
import { placeForPoint, PLACES } from "../src/services/weather/places";

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
  const svc = new SimulatedWeatherService({ latencyMs: 0, now: () => NOW });
  const kinds = new Set<string>();
  const inputFor = async (id: string, now = NOW): Promise<SummaryInput> => {
    const at = new SimulatedWeatherService({ latencyMs: 0, now: () => now });
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
  const spot = placeForPoint({ lat: 10.5, lon: 101.5 }, "Asia/Bangkok");
  const out = await svc.getForecastBundle(spot);
  const spotInput = { ...out, countdown: rainCountdown(out.current, out.hourly, out.daily, NOW) };
  assert.match(weatherSummary(spotInput, "en").sentences[1], /^Right now where you are /);
  assert.match(weatherSummary(spotInput, "th").sentences[1], /^ตอนนี้ตรงที่คุณอยู่ /);
  console.log("✓ Mornings talk about today, evenings about tonight and tomorrow; a GPS spot is where you are");

  // 6. Live forecasts name hours: rain this hour is "within the hour", a doubtful hour gives its chance
  const thisHour: SummaryInput = {
    ...example,
    countdown: { kind: "later", at: new Date(NOW).toISOString(), chance: 80, clear: false, soon: true },
  };
  const thisHourEn = weatherSummary(thisHour, "en").sentences;
  assert.ok(
    thisHourEn.some((s) => /^(Rain is likely|Expect heavy rain|Expect thunderstorms) within the hour/.test(s)),
    thisHourEn.join(" | "),
  );
  assert.ok(weatherSummary(thisHour, "th").sentences.some((s) => s.includes("ภายในชั่วโมงนี้")));
  const showers: SummaryInput = {
    ...example,
    hourly: bkk.hourly.map((h) => {
      const t = Date.parse(h.time);
      return t >= Date.UTC(2026, 8, 30, 10) && t < Date.UTC(2026, 8, 30, 13)
        ? { ...h, precipitationMm: 0.3, condition: "drizzle" as const }
        : h;
    }),
    countdown: { ...heavyAt5, chance: 40 },
  };
  const showersEn = weatherSummary(showers, "en").sentences;
  assert.ok(
    showersEn.includes("There's a 40 percent chance of rain around 5 PM, so an umbrella wouldn't hurt."),
    showersEn.join(" | "),
  );
  console.log(`  ${thisHourEn.find((s) => s.includes("within the hour"))}`);
  console.log(`  ${showersEn.find((s) => s.includes("percent chance"))}`);
  console.log("✓ Live forecasts: rain this hour comes within the hour, and a doubtful hour gives its chance");

  // 7. The AI voice: Google Cloud Text-to-Speech behind /api/voice --------------
  const googleVoices = [
    { name: "th-TH-Standard-A", languageCodes: ["th-TH"] },
    { name: "th-TH-Neural2-C", languageCodes: ["th-TH"] },
    { name: "th-TH-Chirp3-HD-Charon", languageCodes: ["th-TH"] },
    { name: "th-TH-Chirp3-HD-Aoede", languageCodes: ["th-TH"] },
    { name: "en-US-Chirp3-HD-Puck", languageCodes: ["en-US"] },
    { name: "en-US-Wavenet-D", languageCodes: ["en-US"] },
  ];
  assert.equal(pickGoogleVoice(googleVoices, "th-TH"), "th-TH-Chirp3-HD-Aoede", "the wanted Chirp 3 HD voice");
  assert.equal(pickGoogleVoice(googleVoices, "en-US"), "en-US-Chirp3-HD-Puck", "else another Chirp 3 HD voice");
  assert.equal(pickGoogleVoice(googleVoices.slice(0, 2), "th-TH"), "th-TH-Neural2-C", "else the best older kind");
  assert.equal(pickGoogleVoice([], "th-TH"), null);

  const MP3 = Buffer.from("ID3 fake mp3");
  const calls: { url: string; init?: RequestInit }[] = [];
  let googleDown = false;
  const google: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (googleDown) throw new TypeError("fetch failed");
    if (url.endsWith("/voices")) return Response.json({ voices: googleVoices });
    const body = JSON.parse(String(init?.body));
    if (body.input.text === "quota") return Response.json({ error: { message: "Quota exceeded" } }, { status: 429 });
    return Response.json({ audioContent: MP3.toString("base64") });
  };
  let clock = NOW;
  const server = voiceServer("test-key", google, () => clock);
  const ask = (query: Record<string, string>, headers: Record<string, string> = {}) =>
    server.handle(
      new Request(`https://doofah.example/api/voice?${new URLSearchParams(query)}`, {
        headers: { "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.7", ...headers },
      }),
    );
  const sentence = "ฝนน่าจะตกช่วงประมาณห้าโมงเย็น พกร่มไปด้วยก็ดีนะ";
  const spoken = await ask({ lang: "th-TH", text: sentence });
  assert.equal(spoken.status, 200);
  assert.equal(spoken.headers.get("content-type"), "audio/mpeg");
  assert.equal(spoken.headers.get("x-voice"), "th-TH-Chirp3-HD-Aoede");
  assert.match(spoken.headers.get("cache-control")!, /s-maxage=604800/, "Vercel's edge keeps each sentence");
  assert.deepEqual(Buffer.from(await spoken.arrayBuffer()), MP3);
  const synth = calls.find((c) => c.url.endsWith("/text:synthesize"))!;
  assert.deepEqual(JSON.parse(String(synth.init!.body)), {
    input: { text: sentence },
    voice: { languageCode: "th-TH", name: "th-TH-Chirp3-HD-Aoede" },
    audioConfig: { audioEncoding: "MP3" },
  });
  assert.equal(
    (synth.init!.headers as Record<string, string>)["X-Goog-Api-Key"],
    "test-key",
    "the key goes in a header",
  );
  assert.ok(!calls.some((c) => c.url.includes("test-key")), "never in a URL");
  await ask({ lang: "en-US", text: "Good afternoon!" });
  assert.equal(calls.filter((c) => c.url.endsWith("/voices")).length, 1, "the voices are asked once a day");
  clock += 25 * HOUR;
  await ask({ lang: "en-US", text: "Good evening!" });
  assert.equal(calls.filter((c) => c.url.endsWith("/voices")).length, 2);

  const status = async (r: Promise<Response>) => (await r).status;
  assert.equal(
    await status(voiceServer(undefined, google).handle(new Request("https://doofah.example/api/voice"))),
    404,
    "no key",
  );
  assert.equal(
    await status(ask({ lang: "th-TH", text: "สวัสดี" }, { "sec-fetch-site": "cross-site" })),
    403,
    "other sites",
  );
  const bare = new Request("https://doofah.example/api/voice?lang=th-TH&text=x");
  assert.equal(await status(server.handle(bare)), 403, "a request without a browser's word on where it came from");
  assert.equal(await status(ask({ lang: "fr-FR", text: "Bonjour" })), 400, "only Thai and English");
  assert.equal(await status(ask({ lang: "th-TH", text: "  " })), 400, "no text");
  assert.equal(await status(ask({ lang: "th-TH", text: "ก".repeat(MAX_TEXT + 1) })), 400, "too long");
  assert.equal(await status(ask({ lang: "th-TH", text: "quota" })), 502, "Google's own errors");
  googleDown = true;
  assert.equal(await status(ask({ lang: "th-TH", text: "ไม่มีเน็ต" })), 502, "Google down");
  googleDown = false;
  // One visitor, one share of readings; others are not held up.
  const limited = voiceServer("test-key", google, () => clock);
  const from = (ip: string) =>
    limited.handle(
      new Request(`https://doofah.example/api/voice?lang=en-US&text=Hi`, {
        headers: { "sec-fetch-site": "same-origin", "x-forwarded-for": ip },
      }),
    );
  for (let i = 0; i < RATE_LIMIT; i++) assert.equal(await status(from("198.51.100.1")), 200);
  assert.equal(await status(from("198.51.100.1")), 429);
  assert.equal(await status(from("198.51.100.2")), 200);
  clock += 11 * 60_000;
  assert.equal(await status(from("198.51.100.1")), 200, "until the window has passed");
  console.log(
    "✓ The AI voice: Google's Chirp 3 HD voices, the key kept on the server, only DooFah's pages, a share each",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
