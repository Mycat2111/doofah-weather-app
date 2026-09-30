import { INTL_LOCALE, type Locale } from "./config";

export interface Formatters {
  /** "14:05" in the given time zone. */
  clock: (time: string | number, timeZone: string) => string;
  /** "14", for dense hourly rows. */
  hour: (time: string | number, timeZone: string) => string;
  /** "Today", "Tomorrow", then "Tue" / "วันนี้", "พรุ่งนี้", then "อังคาร". */
  dayName: (dateKey: string, index: number) => string;
  /** "30 Sep" / "30 ก.ย." */
  shortDate: (dateKey: string) => string;
  /** "31°" */
  temp: (celsius: number) => string;
}

// Full Thai day names without the "วัน" prefix, the way Thai calendars and
// weather apps label columns. Intl shortens Thursday to "พฤหัส"; spell it out.
const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

const RELATIVE_DAYS: Record<Locale, [string, string]> = {
  en: ["Today", "Tomorrow"],
  th: ["วันนี้", "พรุ่งนี้"],
};

const cache = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options);
  let format = cache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_LOCALE[locale], options);
    cache.set(key, format);
  }
  return format;
}

/** A YYYY-MM-DD local date key as a UTC midnight, so formatting never shifts the day. */
const dateOf = (dateKey: string) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export function createFormatters(locale: Locale): Formatters {
  return {
    clock: (time, timeZone) =>
      dateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(time)),
    hour: (time, timeZone) =>
      dateTimeFormat(locale, { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(time)),
    dayName: (dateKey, index) => {
      if (index < 2) return RELATIVE_DAYS[locale][index];
      const date = dateOf(dateKey);
      if (locale === "th") return THAI_WEEKDAYS[date.getUTCDay()];
      return dateTimeFormat(locale, { timeZone: "UTC", weekday: "short" }).format(date);
    },
    shortDate: (dateKey) =>
      dateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short" }).format(dateOf(dateKey)),
    temp: (celsius) => `${Math.round(celsius)}°`,
  };
}
