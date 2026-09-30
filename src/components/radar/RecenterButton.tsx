"use client";

import type { Map as LeafletMap } from "leaflet";
import { LoaderCircle, Navigation } from "lucide-react";
import { useCallback, type RefObject } from "react";
import { TapButton } from "@/components/ui/TapButton";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useI18n } from "@/i18n/I18nProvider";
import type { GeoPoint } from "@/services/WeatherNext3MockService";

/** Street-level view: close enough to see which side of town the rain is on. */
export const RECENTER_ZOOM = 13;

interface RecenterButtonProps {
  map: LeafletMap | null;
  /** Where the map's marker is now (the selected place). */
  current: GeoPoint;
  /** Switches the dashboard to the located place. */
  onLocated: (point: GeoPoint) => void;
  /** Read by the map when the place changes, so it flies in to RECENTER_ZOOM. */
  nextZoomRef: RefObject<number | null>;
  className?: string;
}

/**
 * "Go to my location": finds you by GPS, makes that the dashboard's place and
 * flies the map there. Without a location fix it flies back to the marker.
 * Tapping again after a failure asks for the location again.
 */
export function RecenterButton({ map, current, onLocated, nextZoomRef, className = "" }: RecenterButtonProps) {
  const { m } = useI18n();

  const found = useCallback(
    (point: GeoPoint) => {
      if (point.lat === current.lat && point.lon === current.lon) {
        // Already the selected place, so the map will not move by itself.
        map?.flyTo([point.lat, point.lon], RECENTER_ZOOM, { duration: 1.2 });
      } else {
        nextZoomRef.current = RECENTER_ZOOM;
        onLocated(point);
      }
    },
    [map, current.lat, current.lon, nextZoomRef, onLocated],
  );
  // No fix (permission denied, no signal): at least bring the marker back into view.
  const backToMarker = useCallback(
    () => map?.flyTo([current.lat, current.lon], Math.max(map.getZoom(), RECENTER_ZOOM), { duration: 1.2 }),
    [map, current.lat, current.lon],
  );
  const geo = useGeolocation(found, backToMarker);

  if (!map) return null;

  const failed = geo.status === "denied" || geo.status === "unavailable";
  const label =
    geo.status === "denied"
      ? m.header.locateDenied
      : geo.status === "unavailable"
        ? m.header.locateUnavailable
        : m.radar.recenter;

  return (
    <TapButton
      haptic="light"
      tapScale={0.86}
      onClick={geo.locate}
      disabled={geo.status === "locating"}
      aria-label={label}
      title={label}
      className={`glass-dark grid size-10 place-items-center rounded-2xl shadow-lg transition-colors hover:bg-white/12 pointer-coarse:size-11 ${
        failed ? "text-amber-200" : "text-sky-200"
      } ${className}`}
    >
      {geo.status === "locating" ? (
        <LoaderCircle className="size-[18px] animate-spin" aria-hidden />
      ) : (
        <Navigation className="size-[18px] fill-current" aria-hidden />
      )}
    </TapButton>
  );
}
