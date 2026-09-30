/**
 * Clock times and waits the way people say them, for the spoken weather
 * summary. Both round, since they follow "around" / "about".
 */

function roundToHalfHour(hour: number, minute: number): [number, boolean] {
  const halves = Math.round((hour * 60 + minute) / 30) % 48;
  return [Math.floor(halves / 2), halves % 2 === 1];
}

/** "5 PM", "5:30 PM", "noon", "midnight". */
export function spokenTimeEn(hour: number, minute: number): string {
  const [h, half] = roundToHalfHour(hour, minute);
  if (!half && h === 0) return "midnight";
  if (!half && h === 12) return "noon";
  const h12 = h % 12 || 12;
  return `${h12}${half ? ":30" : ""} ${h < 12 ? "AM" : "PM"}`;
}

const TH_NUMBERS = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า", "สิบ", "สิบเอ็ด"];

/**
 * Thai's six-hour clock: ตีสอง, เจ็ดโมงเช้า, เที่ยง, บ่ายสามโมง, ห้าโมงเย็น, สองทุ่ม.
 * On the half hour "ครึ่ง" follows and เช้า / เย็น drop: หกโมงครึ่ง, ห้าโมงครึ่ง.
 */
export function spokenTimeTh(hour: number, minute: number): string {
  const [h, half] = roundToHalfHour(hour, minute);
  const tail = half ? "ครึ่ง" : "";
  if (h === 0) return `เที่ยงคืน${tail}`;
  if (h <= 5) return `ตี${TH_NUMBERS[h]}${tail}`;
  if (h <= 11) return `${TH_NUMBERS[h]}โมง${half ? tail : "เช้า"}`;
  if (h === 12) return half ? "เที่ยงครึ่ง" : "เที่ยงวัน";
  if (h === 13) return `บ่ายโมง${tail}`;
  if (h <= 15) return `บ่าย${TH_NUMBERS[h - 12]}โมง${tail}`;
  if (h <= 18) return `${TH_NUMBERS[h - 12]}โมง${half ? tail : "เย็น"}`;
  return `${TH_NUMBERS[h - 18]}ทุ่ม${tail}`;
}

/** A wait rounded for speech: the minute under 10, 5 minutes under an hour, else the half hour. */
function roundWait(minutes: number): { hours: number; half: boolean; minutes: number } {
  if (minutes < 10) return { hours: 0, half: false, minutes: Math.max(1, Math.round(minutes)) };
  if (minutes < 58) return { hours: 0, half: false, minutes: Math.round(minutes / 5) * 5 };
  const halves = Math.max(2, Math.round(minutes / 30));
  return { hours: Math.floor(halves / 2), half: halves % 2 === 1, minutes: 0 };
}

/** "about 35 minutes", "about an hour and a half", "about 2 hours". */
export function spokenWaitEn(minutes: number): string {
  const w = roundWait(minutes);
  if (!w.hours) return w.minutes === 1 ? "about a minute" : `about ${w.minutes} minutes`;
  if (w.hours === 1) return w.half ? "about an hour and a half" : "about an hour";
  return `about ${w.hours}${w.half ? " and a half" : ""} hours`;
}

/** "35 นาที", "ชั่วโมงครึ่ง", "2 ชั่วโมง". */
export function spokenWaitTh(minutes: number): string {
  const w = roundWait(minutes);
  if (!w.hours) return `${w.minutes} นาที`;
  if (w.hours === 1) return w.half ? "ชั่วโมงครึ่ง" : "1 ชั่วโมง";
  return `${w.hours} ชั่วโมง${w.half ? "ครึ่ง" : ""}`;
}
