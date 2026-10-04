"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import type { WeatherService } from "@/services/weatherService";
import type { ForecastBundle, Place } from "@/services/weather/types";

const REFRESH_MS = 10 * 60_000;
/** ForecastService reuses a reply this long, so asking again sooner gets the same answer. */
const REUSE_MS = 5 * 60_000;
/** After a failure, asked again after about this long (SWR backs off from it). */
const RETRY_MS = 60_000;

const noSubscription = () => () => {};

/**
 * The forecast for `place`: the copy saved on this device at once, then the
 * network's. A place seen in the last few minutes shows again at once, without
 * asking. Asks again every 10 minutes while the page is visible, and on focus
 * or reconnect at most every 5 minutes. The previous place stays on screen
 * while a new place with no saved copy loads.
 */
export function useForecast(weather: WeatherService, place: Place) {
  // The server can't read the device's copy, so it is only offered after hydration.
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const saved = useMemo(() => (inBrowser ? weather.savedBundle?.(place) : undefined), [inBrowser, weather, place]);

  const { data, error, isValidating, mutate } = useSWR<ForecastBundle>(
    ["forecast", weather.source, place.id],
    () => weather.getForecastBundle(place),
    {
      fallbackData: saved,
      refreshInterval: REFRESH_MS, // paused while the tab is hidden (SWR's default)
      dedupingInterval: REUSE_MS,
      focusThrottleInterval: REUSE_MS,
      errorRetryInterval: RETRY_MS,
    },
  );

  // The last forecast shown, kept on screen while a new place's first answer is on its way.
  const [last, setLast] = useState<ForecastBundle>();
  if (data && data !== last) setLast(data);
  const shown = data ?? last;
  const refresh = useCallback(() => void mutate(), [mutate]);

  return {
    data: shown,
    // Technical detail only; the dashboard shows its own translated message.
    error: error ? (error instanceof Error ? error.message : String(error)) : undefined,
    loading: shown?.current.place.id !== place.id,
    /** The device's saved copy is on screen while the network's is on its way. */
    updating: isValidating && !!shown?.current.savedAt,
    refresh,
  };
}
