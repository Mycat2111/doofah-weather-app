"use client";

import { useCallback, useState } from "react";
import type { GeoPoint } from "@/services/WeatherNext3MockService";

export type GeolocationStatus = "idle" | "locating" | "denied" | "unavailable";

/** Wraps navigator.geolocation with a small status machine. */
export function useGeolocation(onLocated: (point: GeoPoint) => void, onFailed?: () => void) {
  const [status, setStatus] = useState<GeolocationStatus>("idle");

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("unavailable");
      onFailed?.();
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus("idle");
        onLocated({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
        onFailed?.();
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }, [onLocated, onFailed]);

  return { status, locate };
}
