"use client";

import { useCallback } from "react";
import { useNow } from "@/hooks/useNow";
import { useI18n } from "@/i18n/I18nProvider";
import { daysBetween, localDateKey } from "@/services/weathernext3/time";

/** A time with its day in `timeZone`, the way the storm text says it: "14:00 tomorrow" / "พรุ่งนี้ 14:00 น.". */
export function useWhen(timeZone: string) {
  const { m, f } = useI18n();
  const now = useNow();
  return useCallback(
    (time: string | number) => {
      const ms = new Date(time).getTime();
      const key = localDateKey(ms, timeZone);
      const day = daysBetween(localDateKey(now ?? ms, timeZone), key);
      return m.cyclones.when(f.clock(time, timeZone), day, f.dayName(key, 2));
    },
    [m, f, now, timeZone],
  );
}
