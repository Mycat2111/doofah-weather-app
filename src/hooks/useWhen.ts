"use client";

import { useCallback } from "react";
import { useNow } from "@/hooks/useNow";
import { useI18n } from "@/i18n/I18nProvider";
import { whenText } from "@/i18n/when";

/** A time with its day in `timeZone`, the way the storm text says it: "14:00 tomorrow" / "พรุ่งนี้ 14:00 น.". */
export function useWhen(timeZone: string) {
  const { m, f } = useI18n();
  const now = useNow();
  return useCallback(
    (time: string | number) => whenText(m, f, time, timeZone, now ?? new Date(time).getTime()),
    [m, f, now, timeZone],
  );
}
