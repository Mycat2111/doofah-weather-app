"use client";

import { useEffect, useState } from "react";
import { cellKey, floorHour, inThailand, readNowcast, snapToCell, type Nowcast } from "@/services/weathernext/nowcast";
import type { GeoPoint } from "@/services/WeatherNext3MockService";

const HOUR_MS = 3_600_000;
/** Asked again this long after each hour turns, for the new hour's numbers. */
const AFTER_HOUR_MS = 2 * 60_000;
/** Asked again this soon after a failure or an Open-Meteo answer (just past the 5 minutes the browser keeps it). */
const RETRY_MS = 6 * 60_000;
/** Never asked again sooner than this. */
const MIN_WAIT_MS = 30_000;

/**
 * The next 6 hours of rain at `point` from /api/weathernext, which answers
 * with WeatherNext 3 on the owner's device (or Open-Meteo, saying why, when
 * WeatherNext 3 can't). Only asks when `enabled` (the server found the
 * owner's cookie) and the point is in Thailand. A WeatherNext 3 answer is
 * refreshed after its hour ends; anything else is retried a few minutes on.
 */
export function useWeatherNextNowcast(enabled: boolean, point: GeoPoint | undefined): Nowcast | null {
  const [found, setFound] = useState<{ key: string; nowcast: Nowcast } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cell = point ? snapToCell(point.lat, point.lon) : null;
  const key = enabled && cell && inThailand(cell) ? cellKey(cell) : "";

  useEffect(() => {
    if (!key) return;
    const [lat, lon] = key.split(",");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = (ms: number) => {
      timer = setTimeout(() => setAttempt((a) => a + 1), Math.max(MIN_WAIT_MS, ms));
    };
    const failed = () => {
      // Keep what is shown unless its first hour is already over.
      setFound((f) => (f && Date.parse(f.nowcast.hours[0]?.time ?? "") < floorHour(Date.now()) ? null : f));
      again(RETRY_MS);
    };
    fetch(`/api/weathernext?${new URLSearchParams({ lat, lon, owner: "1" })}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const nowcast = readNowcast(body);
        if (!nowcast) return failed();
        setFound({ key, nowcast });
        const first = Date.parse(nowcast.hours[0]?.time ?? "");
        const next = nowcast.source === "weathernext3" && Number.isFinite(first) ? first + HOUR_MS + AFTER_HOUR_MS : 0;
        again(next ? next - Date.now() : RETRY_MS);
      })
      .catch(() => {
        // Offline: the strip keeps what it has, and asks again later. Aborted: a newer request took over.
        if (!controller.signal.aborted) failed();
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, attempt]);

  return found && found.key === key ? found.nowcast : null;
}
