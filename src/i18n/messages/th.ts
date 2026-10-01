import type {
  AqiCategory,
  DayOutlook,
  DayOutlookKind,
  DayPeriod,
  NowcastOutlook,
  RainIntensity,
  WeatherCondition,
} from "@/services/weathernext3/types";
import type { LifestyleReason } from "@/lib/lifestyle";
import type { ModelOutlook } from "@/lib/rainCountdown";
import type { RouteOutlook } from "@/lib/routeWeather";
import type { SummaryContext, SummaryFact } from "@/lib/voiceSummary";
import { spokenTimeTh, spokenWaitTh } from "../spokenTime";
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

const ROUTE_LEVEL = { rain: "ฝนน่าจะตก", heavy: "ฝนตกหนัก", storm: "พายุฝนฟ้าคะนอง" };
// ๆ is followed by a space before the next word.
const ROUTE_PATCHY = {
  rain: `ฝนตกเป็นช่วง${YAMOK} `,
  heavy: `ฝนตกหนักเป็นช่วง${YAMOK} `,
  storm: `พายุฝนฟ้าคะนองเป็นช่วง${YAMOK} `,
};

function routeOutlook(
  outlook: RouteOutlook,
  stop: (index: number) => string,
  clock: (index: number) => string,
): string {
  switch (outlook.kind) {
    case "dry":
      return "ไม่มีฝนตลอดทาง";
    case "possible":
      return `อาจมีฝนแถว${stop(outlook.stop)} ประมาณ ${clock(outlook.stop)}${NB}น. (โอกาส ${outlook.chance}%)`;
    case "rain": {
      const level = (outlook.patchy ? ROUTE_PATCHY : ROUTE_LEVEL)[outlook.level];
      return outlook.from === outlook.to
        ? `${level}แถว${stop(outlook.from)} ประมาณ ${clock(outlook.from)}${NB}น.`
        : `${level}ตั้งแต่${stop(outlook.from)}ถึง${stop(outlook.to)} ช่วง ${clock(outlook.from)}–${clock(outlook.to)}${NB}น.`;
    }
  }
}

/* Spoken summary ------------------------------------------------------- */
// Written to be heard: times as people say them (ห้าโมงเย็น, not 17:00 น.),
// units spelled out, and a friendly "นะ" on advice.

const SPOKEN_CONDITION: Record<WeatherCondition, [day: string, night: string]> = {
  clear: ["ท้องฟ้าแจ่มใส", "ท้องฟ้าโปร่ง"],
  "partly-cloudy": ["มีเมฆบางส่วน", "มีเมฆบางส่วน"],
  cloudy: ["มีเมฆมาก", "มีเมฆมาก"],
  fog: ["มีหมอก", "มีหมอก"],
  drizzle: ["มีฝนปรอย", "มีฝนปรอย"],
  rain: ["ฝนกำลังตก", "ฝนกำลังตก"],
  "heavy-rain": ["ฝนกำลังตกหนัก", "ฝนกำลังตกหนัก"],
  thunderstorm: ["มีพายุฝนฟ้าคะนอง", "มีพายุฝนฟ้าคะนอง"],
  snow: ["หิมะกำลังตก", "หิมะกำลังตก"],
};

const SPOKEN_AQI: Record<AqiCategory, string> = {
  Good: "ดี",
  Moderate: "ปานกลาง",
  "Unhealthy for Sensitive Groups": "เริ่มมีผลต่อสุขภาพ",
  Unhealthy: "มีผลต่อสุขภาพ",
  "Very Unhealthy": "มีผลต่อสุขภาพมาก",
  Hazardous: "อันตราย",
};

const WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const GREETING = { morning: "สวัสดีตอนเช้า", afternoon: "สวัสดีตอนบ่าย", evening: "สวัสดีตอนเย็น", night: "สวัสดี" };

const RAIN_STARTING: Record<RainIntensity, (wait: string) => string> = {
  heavy: (wait) => `ฝนหนักกำลังมา จะเริ่มตกในอีกประมาณ ${wait} ถ้าจะออกไปข้างนอกอย่าลืมพกร่มนะ`,
  moderate: (wait) => `ฝนกำลังมา จะเริ่มตกในอีกประมาณ ${wait} พกร่มติดตัวไว้ด้วยนะ`,
  light: (wait) => `ฝนเบา${YAMOK} กำลังมา จะเริ่มตกในอีกประมาณ ${wait} พกร่มติดตัวไว้ด้วยนะ`,
  drizzle: (wait) => `อีกประมาณ ${wait}จะมีฝนปรอย`,
};

function voiceSummary(facts: SummaryFact[], { place, clock }: SummaryContext): string[] {
  const at = (time: string) => {
    const { hour, minute } = clock(time);
    return spokenTimeTh(hour, minute);
  };
  return facts.map((fact) => {
    switch (fact.kind) {
      case "greeting":
        return GREETING[fact.part];
      case "now": {
        const where = place ? `ที่${place}` : "ตรงที่คุณอยู่";
        const sky = SPOKEN_CONDITION[fact.condition][fact.isDay ? 0 : 1];
        const feels = fact.feelsLikeC === null ? "" : ` แต่รู้สึกเหมือน ${fact.feelsLikeC} องศา`;
        return `ตอนนี้${where} อุณหภูมิ ${fact.tempC} องศา ${sky}${feels}`;
      }
      case "rainStarting":
        return fact.doubtful
          ? `อาจมีฝนตกในอีกประมาณ ${spokenWaitTh(fact.minutes)}`
          : RAIN_STARTING[fact.intensity](spokenWaitTh(fact.minutes));
      case "raining":
        if (!fact.until) return "ฝนน่าจะตกต่อไปอีกพักใหญ่ ถ้าจะออกไปข้างนอกอย่าลืมพกร่มนะ";
        return fact.intensity === "heavy"
          ? `ฝนน่าจะซาลงประมาณ${at(fact.until)} ระหว่างนี้ระวังน้ำท่วมขังบนถนนด้วยนะ`
          : `ฝนน่าจะซาลงประมาณ${at(fact.until)}`;
      case "rainLater": {
        const when = fact.thisHour ? "ภายในชั่วโมงนี้" : `${fact.tomorrow ? "พรุ่งนี้" : ""}ช่วงประมาณ${at(fact.at)}`;
        if (fact.storm) return `คาดว่าจะมีพายุฝนฟ้าคะนอง${when} ควรหาที่หลบให้เรียบร้อยก่อนนะ`;
        if (fact.heavy) return `คาดว่าฝนจะตกหนัก${when} อย่าลืมพกร่มนะ`;
        if (fact.likely) return `ฝนน่าจะตก${when} พกร่มไปด้วยก็ดีนะ`;
        return `มีโอกาสฝนตก ${fact.chance} เปอร์เซ็นต์${when} พกร่มไปด้วยก็ไม่เสียหาย`;
      }
      case "dry":
        return fact.weekday === null
          ? `ไม่มีฝนตลอด ${fact.hours} ชั่วโมงข้างหน้า`
          : `ไม่มีฝนตลอด ${fact.hours} ชั่วโมงข้างหน้า ฝนรอบถัดไปน่าจะเป็นวัน${WEEKDAYS[fact.weekday]}`;
      case "models": {
        const of = fact.agree === fact.total ? `ทั้ง ${fact.total} ตัว` : ` ${fact.agree} จาก ${fact.total} ตัว`;
        if (fact.about === "dry") {
          if (fact.level !== "low") return `โมเดลพยากรณ์${of}เห็นตรงกัน`;
          return fact.agree === fact.total
            ? `แต่ยังมีโอกาสฝนเล็กน้อย แม้โมเดลพยากรณ์ทั้ง ${fact.total} ตัวจะว่าไม่มีฝน`
            : `แต่โมเดลพยากรณ์ยังไม่แน่ใจนัก มี ${fact.agree} จาก ${fact.total} ตัวที่ว่าไม่มีฝน`;
        }
        if (fact.doubtful)
          return fact.agree === 0
            ? `แต่โมเดลพยากรณ์ทั้ง ${fact.total} ตัวไม่มีตัวไหนเห็นด้วย ฝนอาจไม่ตกก็ได้`
            : `แต่มีโมเดลพยากรณ์เห็นด้วยเพียง ${fact.agree} จาก ${fact.total} ตัว ฝนอาจไม่ตกก็ได้`;
        if (fact.level === "high") return `โมเดลพยากรณ์${of}เห็นตรงกัน ค่อนข้างแน่นอน`;
        if (fact.level === "medium") return `โมเดลพยากรณ์${of}เห็นตรงกัน`;
        return `แต่โมเดลพยากรณ์ยังเห็นไม่ตรงกัน มี ${fact.agree} จาก ${fact.total} ตัวที่คาดว่าฝนจะตก`;
      }
      case "today":
        return `วันนี้อุณหภูมิสูงสุด ${fact.maxC} องศา`;
      case "tonight":
        return `คืนนี้อุณหภูมิต่ำสุดประมาณ ${fact.minC} องศา`;
      case "tomorrow":
        return `พรุ่งนี้${daySummary(fact.outlook).replace(" มม.", " มิลลิเมตร")} อุณหภูมิ ${fact.minC} ถึง ${fact.maxC} องศา`;
      case "uv":
        return `รังสียูวีจะขึ้นไปถึงระดับ ${fact.peak} ถ้าออกไปกลางแจ้งอย่าลืมทาครีมกันแดดนะ`;
      case "heat":
        return `อากาศร้อนจัด ดื่มน้ำเยอะ${YAMOK} และหลบแดดด้วยนะ`;
      case "air":
        return `คุณภาพอากาศ${SPOKEN_AQI[fact.category]} ค่าดัชนีอยู่ที่ ${fact.aqi} ควรสวมหน้ากากเมื่ออยู่กลางแจ้ง`;
    }
  });
}

function modelOutlook(o: ModelOutlook): string {
  if (o.kind === "dry") {
    const at = o.shower ? `ราว ${o.shower}${NB}น.` : "ในชั่วโมงนี้";
    if (o.level === "low")
      return o.agree === o.total
        ? `ยังไม่แน่นอน มีโอกาสฝนเล็กน้อย ${o.chance}% ${at} แม้โมเดลทั้ง ${o.total} ตัวจะว่าไม่มีฝน`
        : `ยังไม่แน่นอน มีโอกาสฝนเล็กน้อย ${o.chance}% ${at} โมเดล ${o.agree} จาก ${o.total} ตัวว่าไม่มีฝน`;
    if (o.agree === o.total) return `โมเดลทั้ง ${o.total} ตัวเห็นตรงกันว่าไม่มีฝนใน ${o.hours} ชั่วโมงข้างหน้า`;
    return `โมเดล ${o.total - o.agree} จาก ${o.total} ตัวมีฝนเล็กน้อยใน ${o.hours} ชั่วโมงข้างหน้า น่าจะเป็น${at} (${o.chance}%)`;
  }
  const when = o.hour ? `ตั้งแต่ราว ${o.hour}${NB}น.` : "ในชั่วโมงนี้";
  const around = o.hour ? `ราว ${o.hour}${NB}น.` : "ในชั่วโมงนี้";
  const of = o.agree === o.total ? `ทั้ง ${o.total} ตัว` : ` ${o.agree} จาก ${o.total} ตัว`;
  const also = o.storm
    ? ` มี ${o.storm} ตัวที่คาดว่าจะมีพายุฝนฟ้าคะนอง`
    : o.heavy
      ? ` มี ${o.heavy} ตัวที่คาดว่าฝนจะตกหนัก`
      : "";
  if (o.doubtful)
    return o.agree === 0
      ? `ไม่มีโมเดลใดใน ${o.total} ตัวคาดว่าฝนจะตก${around} อาจไม่ตกก็ได้ (${o.chance}%)`
      : `มีเพียง ${o.agree} จาก ${o.total} โมเดลที่คาดว่าฝนจะตก${around} อาจไม่ตกก็ได้ (${o.chance}%)`;
  if (o.level === "high") return `มั่นใจสูงว่าฝนจะตก${when} โมเดล${of}เห็นตรงกัน${also}`;
  if (o.level === "medium") return `โมเดล ${o.agree} จาก ${o.total} ตัวคาดว่าฝนจะตก${when}${also} (${o.chance}%)`;
  return `โมเดลยังเห็นไม่ตรงกันเรื่องฝน${around} มี ${o.agree} จาก ${o.total} ตัวที่คาดว่าจะตก${also} (${o.chance}%)`;
}

export const th: Messages = {
  meta: {
    title: "DooFah ดูฟ้า · พยากรณ์อากาศรอบตัวคุณ",
    description:
      "พยากรณ์อากาศเฉพาะพื้นที่ พร้อมแผนที่เรดาร์ นับถอยหลังก่อนฝนตก พยากรณ์รายชั่วโมงและล่วงหน้า 15 วัน และอากาศตลอดเส้นทางขับรถ",
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
  routeOutlook,
  modelOutlook,
  voiceSummary,

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
    models: (count) => `${count} โมเดล`,
    modelsTitle: "โอกาสฝนรวมจาก:",
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
    clearFor: (hours) => `ท้องฟ้าโปร่งอีก ${hours}${NB}ชั่วโมง`,
    dryFor: (hours) => `ไม่มีฝนอีก ${hours}${NB}ชั่วโมง`,
    rainFrom: (clock, chance) => `ฝนมีแนวโน้มตกตั้งแต่ ${clock}${NB}น. · โอกาส ${chance}%`,
    nextRain: (day, date) => `ฝนรอบถัดไปน่าจะเป็นวัน${day} ${date}`,
    nextRainTomorrow: "ฝนรอบถัดไปน่าจะเป็นพรุ่งนี้",
    noRainAhead: "ไม่มีฝนในพยากรณ์ 15 วัน",
    radar: "เรดาร์",
    maybeIn: (duration) => `อาจมีฝนในอีก ${duration}`,
    maybeNow: "อาจมีฝนตอนนี้",
    maybeAt: (clock) => `อาจเริ่มตกราว ${clock}${NB}น.`,
    likelyAround: (clock) => `ฝนน่าจะตกราว ${clock}${NB}น.`,
    likelyNow: "ฝนน่าจะตกในชั่วโมงนี้",
    modelsAgree: (agree, total) => `${agree}/${total} โมเดล`,
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

  route: {
    title: "สภาพอากาศตลอดเส้นทาง",
    from: "ต้นทาง",
    to: "ปลายทาง",
    toPlaceholder: "จะไปที่ไหน",
    searchPlaceholder: "ค้นหาเมือง",
    myLocation: "ตำแหน่งของฉัน",
    swap: "สลับต้นทางกับปลายทาง",
    clear: "ล้างเส้นทาง",
    leave: "ออกเดินทาง",
    leaveNow: "ตอนนี้",
    leaveIn: (hours) => `อีก ${hours}${NB}ชม.`,
    planning: "กำลังวางเส้นทาง…",
    hint: "เลือกปลายทางเพื่อดูสภาพอากาศแต่ละช่วงของเส้นทาง ตามเวลาที่คุณจะไปถึง",
    duration: (minutes) => {
      const h = Math.floor(Math.round(minutes) / 60);
      const m = Math.round(minutes) % 60;
      return h ? (m ? `${h}${NB}ชม. ${m}${NB}นาที` : `${h}${NB}ชม.`) : `${m}${NB}นาที`;
    },
    distance: (km) => `${Math.round(km)}${NB}กม.`,
    arrive: (clock) => `ถึง ${clock}${NB}น.`,
    ferry: (minutes) => `ลงเรือเฟอร์รี ${th.route.duration(minutes)}`,
    km: (km) => `กม.${NB}${Math.round(km)}`,
    advice: {
      rain: "เผื่อเวลาเดินทาง และเว้นระยะห่างจากคันหน้าบนถนนเปียก",
      heavy: "ขับช้าลง อาจมีน้ำท่วมขังและทัศนวิสัยไม่ดี",
      storm: "ลองเลื่อนเวลาออกเดินทาง หรือแวะพักในที่ปลอดภัยจนกว่าพายุจะผ่านไป",
    },
    rain: { dry: "ไม่มีฝน", possible: "อาจมีฝน", rain: "ฝนตก", heavy: "ฝนตกหนัก", storm: "พายุฝนฟ้าคะนอง" },
    chance: (percent) => `${percent}%`,
    timeline: "ไทม์ไลน์การเดินทาง",
    showOnMap: "ดูบนแผนที่",
    stopOnMap: (name, clock) => `${name} เวลา ${clock}${NB}น. ดูบนแผนที่`,
    carHere: (clock) => `คุณ เวลา ${clock}${NB}น.`,
    errors: {
      noRoute: "ไม่มีถนนหรือเรือเฟอร์รีรับรถระหว่างสองที่นี้",
      samePlace: "ต้นทางกับปลายทางเป็นที่เดียวกัน",
      tooFar: "ไกลเกินกว่าจะวางแผนขับรถ",
      offline: "ต้องต่ออินเทอร์เน็ตเพื่อวางเส้นทาง",
      failed: "ติดต่อระบบวางเส้นทางไม่ได้",
      weather: "โหลดสภาพอากาศตลอดเส้นทางไม่สำเร็จ",
      unavailable: "เว็บไซต์นี้ยังวางเส้นทางไม่ได้",
    },
    retry: "ลองอีกครั้ง",
    routeBy: "เส้นทางโดย",
    roadCredit: { before: "ข้อมูลถนน © ผู้ร่วมให้ข้อมูล ", after: "" },
    fixMap: "แจ้งแผนที่ผิด",
  },

  voice: {
    play: "ฟังสรุปอากาศด้วย AI",
    short: "สรุปด้วย AI",
    title: "สรุปสภาพอากาศด้วย AI",
    stop: "หยุด",
    replay: "ฟังอีกครั้ง",
    close: "ปิด",
    noSpeech: "เบราว์เซอร์นี้อ่านออกเสียงไม่ได้ อ่านสรุปด้านล่างแทนได้เลย",
    noVoice:
      "เครื่องนี้ไม่มีเสียงอ่านภาษาไทย เสียงที่ได้ยินอาจฟังไม่ชัด เพิ่มเสียงภาษาไทยได้ในการตั้งค่าการอ่านออกเสียงของเครื่อง",
    aiVoice: "เสียงสังเคราะห์ด้วย AI · Google Cloud",
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
    nowcast: {
      title: "WeatherNext 3 · 6 ชั่วโมงข้างหน้า",
      experimental: "พยากรณ์ทดลองด้วย AI ของ Google DeepMind ไม่ใช่คำเตือนทางการ",
      run: (utc) => `รอบ ${utc} UTC`,
      legend: "แถบและ p90: ปริมาณฝนที่มีเพียง 1 ใน 10 จาก 64 รอบจำลองที่เกินกว่านี้ · ขีดขาว: ค่ากลาง",
      light: "เบา",
      heavy: "หนัก",
      p90: (mm) => `p90 ${mm} มม.`,
      bar: (median, p90) => `ฝน: ค่ากลาง ${median} มม. 9 ใน 10 รอบให้ไม่เกิน ${p90} มม.`,
      atLeast: (percent) => `≥${percent}%`,
      atMost: (percent) => `<${percent}%`,
      unavailable: (reason) => `WeatherNext 3 ตอบไม่ได้ (${reason}) ชั่วโมงเหล่านี้จึงมาจาก Open-Meteo`,
      reasons: {
        "not-owner": "ไม่ใช่อุปกรณ์ของเจ้าของ",
        locked: "เบราว์เซอร์นี้ยังไม่ได้ปลดล็อก",
        "not-configured": "ตั้งค่าไม่ครบ",
        "outside-thailand": "อยู่นอกประเทศไทย",
        "no-data": "ไม่มีรอบพยากรณ์ล่าสุด",
        "too-costly": "การค้นข้อมูลจะมีค่าใช้จ่ายสูงเกินไป",
        busy: "ค้นข้อมูลครบโควตาของชั่วโมงนี้แล้ว",
        error: "BigQuery ปฏิเสธคำขอ",
      },
    },
  },

  daily: {
    label: "พยากรณ์ 15 วัน",
    title: "พยากรณ์ 15 วัน",
    range: (low, high) => `ต่ำสุด ${low} สูงสุด ${high}`,
    nowMarker: (temp) => `ตอนนี้ ${temp}`,
    confidence: (percent) => `ความเชื่อมั่นของโมเดล ${percent}%`,
    vote: (wet, total, percent) =>
      `${wet ? `มีฝนใน ${wet} จาก ${total} โมเดล` : `ไม่มีฝนในโมเดลทั้ง ${total} ตัว`} · ความมั่นใจ ${percent}%`,
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
    simulated: "เรดาร์จำลอง",
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
    offline: (clock) => `ออฟไลน์อยู่ · แสดงพยากรณ์ที่โหลดไว้เมื่อ ${clock}${NB}น.`,
    retry: "ลองอีกครั้ง",
  },

  footer: {
    credit: "DooFah ดูฟ้า · ข้อมูลพยากรณ์จำลองตามแบบ WeatherNext 3 (กริด 5 กม. รายชั่วโมง 15 วัน)",
    modelRun: (utc) => `โมเดลรอบ ${utc} UTC`,
    weatherBy: "ข้อมูลพยากรณ์อากาศจาก",
    airBy: "ข้อมูลคุณภาพอากาศจาก",
    contact: "ติดต่อ:",
    blendBy: "โอกาสฝนและความมั่นใจ: DooFah รวมจากโมเดลของ",
  },
};
