"use client";

import { useEffect, useState } from "react";
import type { WeatherService } from "@/services/weatherService";
import type { ForecastBundle, Place } from "@/services/WeatherNext3MockService";

const REFRESH_MS = 10 * 60_000;

interface ForecastState {
  placeId: string;
  data?: ForecastBundle;
  error?: string;
}

/**
 * Loads the forecast bundle for `place` from `weather` and refreshes it every
 * 10 minutes. The previous place's data stays on screen while a new place loads.
 */
export function useForecast(weather: WeatherService, place: Place) {
  const [state, setState] = useState<ForecastState>({ placeId: "" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    weather
      .getForecastBundle(place)
      .then((data) => !cancelled && setState({ placeId: place.id, data }))
      .catch((error: unknown) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            placeId: place.id,
            // Technical detail only; the dashboard shows its own translated message.
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [weather, place, tick]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  return {
    data: state.data,
    error: state.placeId === place.id ? state.error : undefined,
    loading: state.placeId !== place.id,
    refresh: () => setTick((t) => t + 1),
  };
}
