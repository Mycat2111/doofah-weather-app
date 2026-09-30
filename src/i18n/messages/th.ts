import type {
  DayOutlook,
  DayOutlookKind,
  DayPeriod,
  NowcastOutlook,
  RainIntensity,
  WeatherCondition,
} from "@/services/weathernext3/types";
import type { Messages } from "./types";

// Thai typesetting notes:
// - A space goes before and after numbers and between clauses; Thai has no commas.
// - "ๆ" takes a space before it (Royal Institute style). That space is a
//   no-break space so a line never starts with "ๆ".
const YAMOK = " ๆ";

const CONDITION: Record<WeatherCondition, string> = {
  clear: "ท้องฟ้าแจ่มใส",
  "partly-cloudy": "มีเมฆบางส่วน",
  cloudy: "มีเมฆมาก",
  fog: "มีหมอก",
  drizzle: "ฝนปรอย",
  rain: "ฝนตก",
  "heavy-rain": "ฝนตกหนัก",
  thunderstorm: "พายุฝนฟ้าคะนอง",
  snow: "หิมะตก",
};

// Eight points: the sixteen-point names are too long to be useful in Thai.
const COMPASS = [
  "เหนือ",
  "ตะวันออกเฉียงเหนือ",
  "ตะวันออก",
  "ตะวันออกเฉียงใต้",
  "ใต้",
  "ตะวันตกเฉียงใต้",
  "ตะวันตก",
  "ตะวันตกเฉียงเหนือ",
];

const STARTING: Record<RainIntensity, (minutes: number) => string> = {
  heavy: (n) => `ฝนจะตกหนักในอีกประมาณ ${n} นาที`,
  moderate: (n) => `ฝนจะเริ่มตกในอีกประมาณ ${n} นาที`,
  light: (n) => `ฝนจะเริ่มตกเบา${YAMOK} ในอีกประมาณ ${n} นาที`,
  drizzle: (n) => `จะมีฝนปรอยในอีกประมาณ ${n} นาที`,
};

const CONTINUING: Record<RainIntensity, string> = {
  heavy: "ฝนจะตกหนักต่อเนื่องอย่างน้อย 2 ชั่วโมง",
  moderate: "ฝนจะตกต่อเนื่องอย่างน้อย 2 ชั่วโมง",
  light: `ฝนจะตกเบา${YAMOK} ต่อเนื่องอย่างน้อย 2 ชั่วโมง`,
  drizzle: "ฝนปรอยจะตกต่อเนื่องอย่างน้อย 2 ชั่วโมง",
};

function nowcast(outlook: NowcastOutlook): string {
  switch (outlook.kind) {
    case "dry":
      return "ไม่มีฝนใน 2 ชั่วโมงข้างหน้า";
    case "starting":
      return STARTING[outlook.intensity](outlook.minutes);
    case "stopping":
      return outlook.intensity === "drizzle"
        ? `ฝนปรอยจะหยุดในอีกประมาณ ${outlook.minutes} นาที`
        : `ฝนจะหยุดตกในอีกประมาณ ${outlook.minutes} นาที`;
    case "continuing":
      return CONTINUING[outlook.intensity];
  }
}

const PERIOD: Record<DayPeriod, string> = {
  overnight: "ช่วงดึก",
  morning: "ช่วงเช้า",
  afternoon: "ช่วงบ่าย",
  evening: "ช่วงค่ำ",
};

const DAY: Record<DayOutlookKind, (when: string, mm: number) => string> = {
  thunderstorms: (when) => `มีโอกาสเกิดพายุฝนฟ้าคะนอง${when}`,
  "heavy-rain": (when, mm) => `ฝนตกหนัก${when} ประมาณ ${mm} มม.`,
  downpours: (when) => `ฝนตกหนักเป็นพัก${YAMOK} ${when}`,
  showers: (when) => `มีฝนตก${when}`,
  "light-showers": (when) => `มีฝนเล็กน้อย${when}`,
  snow: (when) => `มีหิมะตก${when}`,
  fog: () => `มีหมอกช่วงเช้า แล้วค่อย${YAMOK} จางลง`,
  "mostly-cloudy": () => "มีเมฆเป็นส่วนมาก",
  "hot-sunny-spells": () => `อากาศร้อน มีแดดเป็นช่วง${YAMOK}`,
  "sun-and-cloud": () => "มีแดดสลับเมฆ",
  "hot-sunny": () => "อากาศร้อน แดดจัด",
  clear: () => "ท้องฟ้าแจ่มใส",
};

function daySummary({ kind, period, precipitationMm, wind }: DayOutlook): string {
  const text = DAY[kind](PERIOD[period], Math.round(precipitationMm));
  if (wind === "windy") return `${text} ลมแรง`;
  if (wind === "breezy") return `${text} ลมค่อนข้างแรง`;
  return text;
}

export const th: Messages = {
  meta: {
    title: "DooFah ดูฟ้า · พยากรณ์อากาศรอบตัวคุณ",
    description:
      "พยากรณ์อากาศเฉพาะพื้นที่ พร้อมแผนที่เรดาร์ละเอียด 5 กม. พยากรณ์รายชั่วโมงและล่วงหน้า 15 วัน จากข้อมูลจำลองแบบ WeatherNext 3",
  },

  units: {
    kmh: "กม./ชม.",
    km: "กม.",
    mm: "มม.",
    mmPerHour: "มม./ชม.",
    metres: "ม.",
    microgramsPerCubicMetre: "มคก./ลบ.ม.",
  },

  condition: (condition) => CONDITION[condition],
  aqi: {
    Good: "ดี",
    Moderate: "ปานกลาง",
    "Unhealthy for Sensitive Groups": "เริ่มมีผลต่อสุขภาพ",
    Unhealthy: "มีผลต่อสุขภาพ",
    "Very Unhealthy": "มีผลต่อสุขภาพมาก",
    Hazardous: "อันตราย",
  },
  uv: (index) => {
    if (index < 3) return "ต่ำ";
    if (index < 6) return "ปานกลาง";
    if (index < 8) return "สูง";
    if (index < 11) return "สูงมาก";
    return "อันตราย";
  },
  compass: (degrees) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8],
  nowcast,
  daySummary,

  header: {
    searchPlaceholder: "ค้นหาเมือง… (เช่น เชียงใหม่)",
    searchLabel: "ค้นหาสถานที่",
    closeSearch: "ปิดการค้นหา",
    locate: "ใช้ตำแหน่งของฉัน",
    locateDenied: "ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง",
    locateUnavailable: "ระบุตำแหน่งไม่ได้",
    language: "ภาษา",
  },

  hero: {
    label: "สภาพอากาศปัจจุบัน",
    updated: (clock) => `อัปเดต ${clock} น.`,
    precisionBefore: "ละเอียด",
    precisionAfter: "",
    cellTitle: (cellId) => `ช่องกริด WeatherNext 3 ${cellId}`,
    feelsLike: (temp) => `รู้สึกเหมือน ${temp}`,
    highLow: (high, low) => `สูงสุด ${high} ต่ำสุด ${low}`,
    now: "ตอนนี้",
    hoursAhead: (hours) => `+${hours} ชม.`,
    aqi: "AQI",
  },

  hourly: {
    label: "พยากรณ์รายชั่วโมง",
    title: "48 ชั่วโมงข้างหน้า",
    scrollLabel: "พยากรณ์รายชั่วโมง เลื่อนดูในแนวนอน",
    earlier: "ชั่วโมงก่อนหน้า",
    later: "ชั่วโมงถัดไป",
    now: "ตอนนี้",
    sunrise: "อาทิตย์ขึ้น",
    sunset: "อาทิตย์ตก",
  },

  daily: {
    label: "พยากรณ์ 15 วัน",
    title: "พยากรณ์ 15 วัน",
    range: (low, high) => `ต่ำสุด ${low} สูงสุด ${high}`,
    nowMarker: (temp) => `ตอนนี้ ${temp}`,
    confidence: (percent) => `ความเชื่อมั่นของโมเดล ${percent}%`,
    sparkline: "อุณหภูมิและฝนรายชั่วโมง",
    rain: "ฝน",
    wind: "ลม",
    uv: "UV",
    humidity: "ความชื้น",
    sunrise: "อาทิตย์ขึ้น",
    sunset: "อาทิตย์ตก",
  },

  details: {
    wind: "ลม",
    windFrom: (direction) => `จากทิศ${direction}`,
    gusts: (speed) => `ลมกระโชก ${speed}`,
    humidity: "ความชื้น",
    dewPoint: (temp) => `จุดน้ำค้าง ${temp}`,
    uvIndex: "ดัชนี UV",
    pressure: "ความกดอากาศ",
    pressureLow: "ต่ำ อากาศแปรปรวน",
    pressureHigh: "สูง อากาศคงที่",
    pressureNormal: "ใกล้เคียงปกติ",
    visibility: "ทัศนวิสัย",
    cloudCover: (percent) => `เมฆปกคลุม ${percent}%`,
    sun: "ดวงอาทิตย์",
  },

  radar: {
    label: "แผนที่เรดาร์สภาพอากาศ",
    layerGroup: "ชั้นข้อมูลแผนที่",
    layers: {
      precipitation: { short: "ฝน", long: "เรดาร์น้ำฝน", legend: "ปริมาณฝน" },
      wind: { short: "ลม", long: "กระแสลม", legend: "ลมที่ระดับ 10 ม." },
      temperature: { short: "อุณหภูมิ", long: "แผนที่อุณหภูมิ", legend: "อุณหภูมิที่ระดับ 2 ม." },
      pressure: { short: "ความกดอากาศ", long: "เส้นความกดอากาศเท่า", legend: "ความกดอากาศระดับน้ำทะเล" },
    },
    loading: "กำลังโหลดชั้นข้อมูล",
    grid: (km) => `กริด ${km} กม.`,
    run: (utcClock) => `รอบ ${utcClock} UTC`,
    play: "เล่นภาพเคลื่อนไหว",
    pause: "หยุดภาพเคลื่อนไหว",
    mapTime: "เวลาบนแผนที่",
    now: "ตอนนี้",
    offset: (hours) => (hours > 0 ? `+${hours} ชม.` : `−${Math.abs(hours)} ชม.`),
    past: "เรดาร์ย้อนหลัง",
    analysis: "ข้อมูลล่าสุด",
    forecast: "พยากรณ์",
    outsideArea: "นอกพื้นที่ที่โหลดไว้",
    // The wording openstreetmap.org itself uses in Thai.
    attribution: { before: "แผนที่ © ผู้ร่วมให้ข้อมูล ", after: "" },
    probe: {
      noRain: (cloudPercent) => `ไม่มีฝน · เมฆ ${cloudPercent}%`,
      rain: (rate) => `ฝน ${rate} มม./ชม.`,
      temperature: (temp) => `${temp} °C ที่ระดับ 2 ม.`,
      wind: (speed) => `ลม ${speed} กม./ชม. ที่ระดับ 10 ม.`,
      pressure: (hpa) => `${hpa} hPa`,
    },
  },

  errors: {
    forecast: "โหลดข้อมูลพยากรณ์ไม่สำเร็จ",
    retry: "ลองอีกครั้ง",
  },

  footer: {
    credit: "DooFah ดูฟ้า · ข้อมูลพยากรณ์จำลองตามแบบ WeatherNext 3 (กริด 5 กม. รายชั่วโมง 15 วัน)",
    modelRun: (utc) => `โมเดลรอบ ${utc} UTC`,
  },
};
