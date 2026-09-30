"use client";

import { useCallback, useEffect, useState } from "react";
import { routeOutlook, routeStops, type RouteOutlook, type RouteStopWeather } from "@/lib/routeWeather";
import { getRoute, RouteError, type Route, type RouteErrorCode } from "@/services/routing/routeService";
import type { WeatherService } from "@/services/weatherService";
import type { Place } from "@/services/WeatherNext3MockService";

const HOUR_MS = 3_600_000;

export interface Trip {
  route: Route;
  stops: RouteStopWeather[];
  outlook: RouteOutlook;
}

interface TripState {
  key: string;
  trip?: Trip;
  error?: RouteErrorCode;
}

/**
 * A road trip and the weather along it. The origin follows the dashboard's
 * place until another one is picked; setting a destination plans the drive
 * and fetches the forecast from `weather` at every stop for the time you get
 * there.
 */
export function useRouteWeather(weather: WeatherService, place: Place) {
  const [pickedOrigin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [leaveInHours, setLeaveInHours] = useState(0);
  const [state, setState] = useState<TripState>({ key: "" });
  // A new request each time, so "leave now" really is now when asked again.
  const [attempt, setAttempt] = useState(0);
  const origin = pickedOrigin ?? place;
  const key = destination ? `${origin.id}>${destination.id}+${leaveInHours}#${attempt}` : "";

  // Plain numbers, so a place object rebuilt with the same values starts no new request.
  const [fromLat, fromLon] = [origin.point.lat, origin.point.lon];
  const [toLat, toLon] = destination ? [destination.point.lat, destination.point.lon] : [NaN, NaN];
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const departure = new Date(Date.now() + leaveInHours * HOUR_MS).toISOString();
    (async () => {
      try {
        const route = await getRoute({
          origin: { lat: fromLat, lon: fromLon },
          destination: { lat: toLat, lon: toLon },
          departure,
        });
        const stops = routeStops(route);
        const along = await weather.getWeatherAlong(stops.map((s) => ({ point: s.point, time: s.eta })));
        const withWeather = stops.map((s, i) => ({ ...s, weather: along[i] }));
        if (!controller.signal.aborted)
          setState({ key, trip: { route, stops: withWeather, outlook: routeOutlook(withWeather) } });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ key, error: error instanceof RouteError ? error.code : "failed" });
      }
    })();
    return () => controller.abort();
  }, [weather, key, fromLat, fromLon, toLat, toLon, leaveInHours]);

  const swap = useCallback(() => {
    if (!destination) return;
    setOrigin(destination);
    setDestination(origin);
  }, [origin, destination]);

  const clear = useCallback(() => {
    setDestination(null);
    setOrigin(null);
    setLeaveInHours(0);
  }, []);

  const current = destination && state.key === key ? state : undefined;
  return {
    origin,
    destination,
    leaveInHours,
    setOrigin,
    setDestination,
    setLeaveInHours,
    swap,
    clear,
    retry: () => setAttempt((a) => a + 1),
    loading: !!destination && state.key !== key,
    trip: current?.trip ?? null,
    error: current?.error ?? null,
  };
}

export type RouteWeatherState = ReturnType<typeof useRouteWeather>;
