"use client";

import { useEffect, useState } from "react";
import { cellKey, floorHour, inThailand, readNowcast, snapToCell, type Nowcast } from "@/services/weathernext/nowcast";
import type { GeoPoint } from "@/services/WeatherNext3MockService";

const HOUR_MS = 3_600_000;
/** Asked again this long after each hour turns, once the new run's numbers are in. */
const AFTER_HOUR_MS = 2 * 60_000;

/**
 * The next 6 hours of rain at `point` from /api/weathernext, which answers
 * with WeatherNext 3 on the owner's device (or Open-Meteo, saying why, when
 * WeatherNext 3 can't). Only asks when `enabled` (the server found the
 * owner's cookie) and the point is in Thailand; refreshed every hour.
 */
export function useWeatherNextNowcast(enabled: boolean, point: GeoPoint | undefined): Nowcast | null {
  const [found, setFound] = useState<{ key: string; nowcast: Nowcast } | null>(null);
  const [hour, setHour] = useState(0);
  const cell = point ? snapToCell(point.lat, point.lon) : null;
  const key = enabled && cell && inThailand(cell) ? cellKey(cell) : "";

  useEffect(() => {
    if (!key) return;
    const [lat, lon] = key.split(",");
    const controller = new AbortController();
    fetch(`/api/weathernext?${new URLSearchParams({ lat, lon, owner: "1" })}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const nowcast = readNowcast(body);
        if (nowcast) setFound({ key, nowcast });
      })
      .catch(() => {
        // Offline or aborted: the strip keeps what it has.
      });
    const now = Date.now();
    const timer = setTimeout(() => setHour((h) => h + 1), floorHour(now) + HOUR_MS + AFTER_HOUR_MS - now);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, hour]);

  return found && found.key === key ? found.nowcast : null;
}
