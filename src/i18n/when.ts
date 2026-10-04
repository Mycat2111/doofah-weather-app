import type { Formatters } from "./format";
import type { Messages } from "./messages/types";
import { daysBetween, localDateKey } from "@/services/weather/time";

/**
 * A time with its day in `timeZone`, the way the storm text says it:
 * "14:00 tomorrow" / "พรุ่งนี้ 14:00 น.", the day counted from `now`. Shared by
 * the storm banner (useWhen) and storm notifications, written on the server.
 */
export function whenText(m: Messages, f: Formatters, time: string | number, timeZone: string, now: number): string {
  const key = localDateKey(new Date(time).getTime(), timeZone);
  const day = daysBetween(localDateKey(now, timeZone), key);
  return m.cyclones.when(f.clock(time, timeZone), day, f.dayName(key, 2));
}
