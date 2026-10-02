"use client";

import { useEffect, useState } from "react";
import type { WeatherService } from "@/services/weatherService";
import type { GeoPoint, SpotWeather } from "@/services/WeatherNext3MockService";

// Full precision, so the points read back from the key are exactly the ones given.
const spotKey = (p: GeoPoint) => `${p.lat},${p.lon}`;

/**
 * The weather at a few spots (the favorites) at `time`, read from the same
 * forecast as each place's dashboard. Each spot keeps its last weather while
 * the next loads; one with none yet is undefined.
 */
export function useSpotWeather(
  weather: WeatherService,
  points: GeoPoint[],
  time: number | undefined,
): (SpotWeather | undefined)[] {
  const [spots, setSpots] = useState<Record<string, SpotWeather>>({});
  const keys = points.map(spotKey);
  const key = keys.join("|");

  useEffect(() => {
    if (!key || time === undefined) return;
    let cancelled = false;
    const wanted = key.split("|");
    const at = new Date(time).toISOString();
    weather
      .getWeatherAlong(
        wanted.map((k) => ({ point: { lat: Number(k.split(",")[0]), lon: Number(k.split(",")[1]) }, time: at })),
      )
      .then((found) => {
        if (!cancelled) setSpots((prev) => ({ ...prev, ...Object.fromEntries(wanted.map((k, i) => [k, found[i]])) }));
      })
      .catch(() => {
        // The chips just show no weather until the next try.
      });
    return () => {
      cancelled = true;
    };
  }, [weather, key, time]);

  return keys.map((k) => spots[k]);
}
