import type {
  DayOutlook,
  DayOutlookKind,
  DayPeriod,
  NowcastOutlook,
  RainIntensity,
  WeatherCondition,
} from "@/services/weathernext3/types";
import type { LifestyleReason } from "@/lib/lifestyle";
import type { Messages } from "./types";

// Thai typesetting notes:
// - A space goes before and after numbers and between clauses; Thai has no commas.
// - "ๆ" takes a space before it (Royal Institute style). That space is a
//   no-break space so a line never starts with "ๆ".
const YAMOK = " ๆ";
// Keeps "น." and units on the same line as the number before them.
const NB = "\u00a0";

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

function lifestyleReason(reason: LifestyleReason, clock: (time: string) => string): string {
  switch (reason.kind) {
    case "rainNow":
      return "ฝนกำลังตก";
    case "rainAt":
      return `ฝนอาจตกราว ${clock(reason.time)}${NB}น.`;
    case "heavyRain":
      return reason.time ? `ฝนตกหนักราว ${clock(reason.time)}${NB}น.` : "ฝนตกหนักขณะนี้";
    case "rainTomorrow":
      return `โอกาสฝนพรุ่งนี้ ${reason.chance}%`;
    case "rainTonight":
      return "คืนนี้มีแนวโน้มฝนตก";
    case "dryUntil":
      return `ไม่มีฝนถึง ${clock(reason.time)}${NB}น.`;
    case "dryDays":
      return `ไม่มีฝนอีก ${reason.days} วัน`;
    case "noSun":
      return "รอแดดตอนเช้า";
    case "humid":
      return `ความชื้น ${reason.humidity}% ผ้าแห้งช้า`;
    case "storm":
      return "มีพายุฝนฟ้าคะนองใกล้เคียง";
    case "air":
      return `คุณภาพอากาศ AQI ${reason.aqi}`;
    case "heat":
      return reason.coolerAt
        ? `รู้สึกเหมือน ${reason.feelsLikeC}° เย็นลงตั้งแต่ ${clock(reason.coolerAt)}${NB}น.`
        : `รู้สึกเหมือน ${reason.feelsLikeC}°`;
    case "pleasant":
      return `รู้สึกเหมือน ${reason.feelsLikeC}°`;
    case "uv":
      return `UV สูงสุด ${reason.peak} ถึง ${clock(reason.until)}${NB}น.`;
    case "uvLow":
      return "UV ต่ำตลอดวัน";
    case "sunDown":
      return "ไม่มีแดดตอนนี้";
    case "fog":
      return `ทัศนวิสัย ${reason.visibilityKm} กม.`;
    case "clearRoads":
      return "ไม่มีฝนหรือหมอก";
    case "clouds":
      return `คืนนี้มีเมฆ ${reason.percent}%`;
  }
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
  lifestyleReason,

  header: {
    searchPlaceholder: "ค้นหาเมือง… (เช่น เชียงใหม่)",
    searchLabel: "ค้นหาสถานที่",
    closeSearch: "ปิดการค้นหา",
    locate: "ใช้ตำแหน่งของฉัน",
    locateDenied: "ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง",
    locateUnavailable: "ระบุตำแหน่งไม่ได้",
    language: "ภาษา",
  },

  favorites: {
    label: "สถานที่โปรด",
    empty: "แตะรูปดาวข้างชื่อสถานที่เพื่อปักหมุดไว้ตรงนี้",
    save: (place) => `บันทึก ${place} เป็นสถานที่โปรด`,
    remove: (place) => `ลบ ${place} ออกจากสถานที่โปรด`,
    editFavorite: (place) => `แก้ไขสถานที่โปรด ${place}`,
    saved: "บันทึกเป็นสถานที่โปรดแล้ว",
    name: "ชื่อ",
    quickLabels: "ป้ายชื่อด่วน",
    home: "บ้าน",
    office: "ที่ทำงาน",
    removeShort: "ลบออก",
    edit: "แก้ไข",
    done: "เสร็จ",
  },

  alerts: {
    label: "แจ้งเตือนสภาพอากาศ",
    dismiss: "ปิดการแจ้งเตือน",
    stormNow: "มีพายุฝนฟ้าคะนองขณะนี้",
    stormFrom: (clock) => `อาจเกิดพายุฝนฟ้าคะนองตั้งแต่ ${clock} น.`,
    stormDetail: (chance) => `ระวังฟ้าผ่าและลมกระโชกแรง · โอกาสฝน ${chance}%`,
    rainNow: "ฝนมีแนวโน้มตกในชั่วโมงนี้",
    rainFrom: (clock) => `ฝนมีแนวโน้มตกตั้งแต่ ${clock} น.`,
    rainDetail: (chance, hours) => `โอกาสฝนสูงสุด ${chance}% ใน ${hours} ชั่วโมงข้างหน้า`,
    heavyAtTimes: `อาจตกหนักเป็นพัก${YAMOK}`,
    air: (category) => `คุณภาพอากาศ${category}`,
    airDetail: (aqi, pm25) => `AQI ${aqi} · PM2.5 ${pm25}`,
    tipsLabel: "ข้อแนะนำ",
    tips: {
      umbrella: "ควรพกร่ม",
      stayIndoors: "อยู่ในอาคารหากทำได้",
      avoidOpenGround: "หลีกเลี่ยงที่โล่งแจ้งและต้นไม้ใหญ่",
      unplug: "ถอดปลั๊กเครื่องใช้ไฟฟ้า",
      travelTime: "เผื่อเวลาเดินทาง",
      floodedRoads: "ระวังน้ำท่วมขังบนถนน",
      mask: "ควรสวมหน้ากากกันฝุ่น PM2.5",
      noOutdoorExercise: "งดออกกำลังกายกลางแจ้ง",
      closeWindows: "ปิดหน้าต่างและเปิดเครื่องฟอกอากาศ",
      sensitiveGroups: "เด็ก ผู้สูงอายุ และผู้มีโรคหัวใจหรือโรคปอดควรอยู่ในอาคาร",
    },
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

  countdown: {
    label: "นับถอยหลังฝน",
    rainIn: {
      drizzle: (d) => `ฝนปรอยจะมาในอีก ${d}`,
      light: (d) => `ฝนจะตกเบา${YAMOK} ในอีก ${d}`,
      moderate: (d) => `ฝนจะตกในอีก ${d}`,
      heavy: (d) => `ฝนจะตกหนักในอีก ${d}`,
    },
    startingNow: "ฝนกำลังจะตก",
    raining: {
      drizzle: "มีฝนปรอยอยู่ตอนนี้",
      light: `ฝนกำลังตกเบา${YAMOK}`,
      moderate: "ฝนกำลังตก",
      heavy: "ฝนกำลังตกหนัก",
    },
    startsAt: (clock) => `เริ่มราว ${clock}${NB}น.`,
    easesIn: (d, clock) => `จะหยุดในอีก ${d} ราว ${clock}${NB}น.`,
    easesAround: (clock) => `น่าจะหยุดราว ${clock}${NB}น.`,
    easingNow: "ฝนกำลังจะหยุด",
    noBreak: (hours) => `จะตกต่อเนื่องอีกอย่างน้อย ${hours} ชั่วโมง`,
    clearFor: (hours) => `ท้องฟ้าโปร่งตลอด ${hours} ชั่วโมงข้างหน้า`,
    dryFor: (hours) => `ไม่มีฝนตลอด ${hours} ชั่วโมงข้างหน้า`,
    rainFrom: (clock, chance) => `ฝนมีแนวโน้มตกตั้งแต่ ${clock}${NB}น. · โอกาส ${chance}%`,
    nextRain: (day, date) => `ฝนรอบถัดไปน่าจะเป็นวัน${day} ${date}`,
    nextRainTomorrow: "ฝนรอบถัดไปน่าจะเป็นพรุ่งนี้",
    noRainAhead: "ไม่มีฝนในพยากรณ์ 15 วัน",
    radar: "เรดาร์",
    duration: (minutes) => {
      if (minutes < 60) return `${minutes}${NB}นาที`;
      const h = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest ? `${h}${NB}ชม. ${rest}${NB}นาที` : `${h}${NB}ชม.`;
    },
  },

  lifestyle: {
    title: "ดัชนีการใช้ชีวิต",
    activities: {
      laundry: "ตากผ้า",
      carWash: "ล้างรถ",
      run: "วิ่งกลางแจ้ง",
      commute: "เดินทาง",
      sunscreen: "ครีมกันแดด",
      stargazing: "ดูดาว",
    },
    status: {
      laundry: { good: "ตากได้เลย", fair: "แห้งช้า", poor: "ยังไม่ควรตาก" },
      carWash: { good: "ล้างได้เลย", fair: "เสี่ยงฝนพรุ่งนี้", poor: "ยังไม่ควรล้าง" },
      run: { good: "ปลอดภัย", fair: "ควรระวัง", poor: "ไม่แนะนำ" },
      commute: { good: "สะดวก", fair: "เผื่อเวลา", poor: "อาจล่าช้า" },
      sunscreen: { good: "ไม่จำเป็น", fair: "ควรทา", poor: "ต้องทา" },
      stargazing: { good: "ฟ้าเปิด", fair: "เมฆบางส่วน", poor: "ฟ้าปิด" },
    },
  },

  reports: {
    title: "ท้องฟ้าตรงที่คุณอยู่เป็นอย่างไร",
    kinds: { sunny: "แดดออก", cloudy: "มีเมฆ", lightRain: "ฝนเล็กน้อย", heavyRain: "ฝนตกหนัก" },
    clear: "ฟ้าโปร่ง",
    hint: "แตะครั้งเดียวเพื่อแชร์บนแผนที่ให้คนแถวนี้เห็น",
    thanks: "ขอบคุณ! รายงานของคุณจะแสดงบนแผนที่ 1 ชั่วโมง",
    yours: (kind, ago) => `คุณรายงานว่า${kind} · ${ago}`,
    ago: (minutes) => (minutes < 1 ? "เมื่อสักครู่" : `${minutes}${NB}นาทีที่แล้ว`),
    nearby: (count) => `ใกล้คุณ ${count} รายงาน`,
    you: "คุณ",
    verified: (people) => `ยืนยันโดยผู้ใช้ในพื้นที่ ${people} คน`,
    disputed: (agreeing, total) => `ผู้ใช้ในพื้นที่เห็นต่าง ตรงกัน ${agreeing} จาก ${total}`,
    few: (count) => `รายงานจากผู้ใช้ ${count} รายการ`,
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
    zoomIn: "ซูมเข้า",
    zoomOut: "ซูมออก",
    recenter: "ไปที่ตำแหน่งของฉัน",
    twoFingers: "ใช้สองนิ้วเพื่อเลื่อนแผนที่",
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
