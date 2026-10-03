"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useForecast } from "@/hooks/useForecast";
import { readOpeningPlace, saveLastPlace } from "@/lib/favorites";
import { bundleAt } from "@/services/forecast/bundle";
import type { WeatherService } from "@/services/weatherService";
import { DEFAULT_PLACE } from "@/services/weather/places";
import type { ForecastBundle, Place } from "@/services/weather/types";

/**
 * The dashboard's one place, one forecast and one moment, shared by every
 * screen: the weather card, details, sky, rain countdown and lifestyle cards
 * show the moment picked on the map's timeline, and "Back to now" on the card
 * moves the map's timeline back too.
 */
export interface WeatherState {
  /** The place on screen. */
  place: Place;
  setPlace: (place: Place) => void;
  /** Its forecast, as at now. */
  forecast?: ForecastBundle;
  status: {
    /** A new place's forecast is on its way (the previous one stays on screen, dimmed). */
    loading: boolean;
    /** Why the forecast could not be loaded (technical; screens show their own words). */
    error?: string;
    refresh: () => void;
  };
  /** The moment shown: null for now, else a time on the map's timeline (ms). */
  time: number | null;
  /** Show another moment, or now (null). The map's timeline moves there. */
  setTime: (time: number | null) => void;
  /**
   * The forecast as at `time`; `forecast` itself for now, or when the forecast
   * doesn't reach `time`. Its conditions carry `forecastFor` when they are for
   * another moment.
   */
  here?: ForecastBundle;
  /** For the map's timeline: the last setTime, to move to (a new key each time). */
  seek: { time: number | null; key: number };
  /** For the map's timeline: it moved by itself (playing, scrubbing), so the rest follows without moving it back. */
  followMap: (time: number | null) => void;
  /** Where the map's layers come from: the same source as the forecast. */
  fields: Pick<WeatherService, "source" | "getRadarFrames">;
}

const WeatherStateContext = createContext<WeatherState | null>(null);

const noSubscription = () => () => {};

export function WeatherStateProvider({ weather, children }: { weather: WeatherService; children: ReactNode }) {
  // False on the server and while hydrating, true in the browser after that.
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const [chosen, setPlace] = useState<Place | null>(null);
  // Until a place is picked, open on a saved favorite (the server, which
  // cannot see localStorage, renders the default place first).
  const place = chosen ?? (inBrowser ? readOpeningPlace() : undefined) ?? DEFAULT_PLACE;
  const { data: forecast, loading, error, refresh } = useForecast(weather, place);
  const [time, setShown] = useState<number | null>(null);
  const [seek, setSeek] = useState<{ time: number | null; key: number }>({ time: null, key: 0 });

  // Remember what is on screen, so the app reopens on it if it is a favorite.
  useEffect(() => {
    if (inBrowser) saveLastPlace(place);
  }, [inBrowser, place]);

  const setTime = useCallback((next: number | null) => {
    setShown(next);
    setSeek((s) => ({ time: next, key: s.key + 1 }));
  }, []);

  const here = useMemo(() => {
    if (!forecast || time === null) return forecast;
    // The simulation answers for any moment from the model behind its map layers.
    const own = weather.momentAt?.(forecast.current.place.point, time) ?? {};
    return bundleAt(forecast, time, own) ?? forecast;
  }, [forecast, time, weather]);

  const value = useMemo<WeatherState>(
    () => ({
      place,
      setPlace,
      forecast,
      status: { loading, error, refresh },
      time,
      setTime,
      here,
      seek,
      followMap: setShown,
      fields: weather,
    }),
    [place, forecast, loading, error, refresh, time, setTime, here, seek, weather],
  );
  return <WeatherStateContext.Provider value={value}>{children}</WeatherStateContext.Provider>;
}

/** The dashboard's shared place, forecast and moment. */
export function useWeatherState(): WeatherState {
  const state = useContext(WeatherStateContext);
  if (!state) throw new Error("useWeatherState needs a WeatherStateProvider above it");
  return state;
}
