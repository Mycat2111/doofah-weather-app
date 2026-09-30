"use client";

import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { Marker, Polyline, Popup, Tooltip, useMap } from "react-leaflet";
import { RAIN_COLOR } from "@/components/route/rainStyle";
import type { Trip } from "@/hooks/useRouteWeather";
import { useI18n } from "@/i18n/I18nProvider";
import { positionAt, stopRain, worseRain, type RouteStopWeather } from "@/lib/routeWeather";
import type { RoutePoint } from "@/services/routing/types";
import { glyphSvg, weatherGlyph } from "./weatherGlyphs";

export interface RouteFocus {
  /** Changes each time the dashboard asks the map to show the trip. */
  key: number;
  /** A stop to fly to, or null for the whole route. */
  stop: number | null;
}

/** The part of the line driven between two times (minutes from the start). */
function pathBetween(path: RoutePoint[], from: number, to: number): L.LatLngTuple[] {
  const a = positionAt(path, from);
  const b = positionAt(path, to);
  return [
    [a.lat, a.lon],
    ...path.filter((p) => p.min > from && p.min < to).map((p): L.LatLngTuple => [p.lat, p.lon]),
    [b.lat, b.lon],
  ];
}

function stopIcon(stop: RouteStopWeather): L.DivIcon {
  const w = stop.weather;
  const rain = stopRain(w);
  const end =
    stop.role === "start"
      ? '<span class="end start"></span>'
      : stop.role === "end"
        ? `<span class="end finish">${glyphSvg("flag", 11, "#0f172a", 2.6)}</span>`
        : "";
  return L.divIcon({
    className: `doofah-route-stop r-${rain}`,
    html: `<span class="bubble">${weatherGlyph(w.condition, w.isDay, 16)}<b>${Math.round(w.temperatureC)}°</b></span>${end}`,
    iconSize: [58, 28],
    iconAnchor: [29, 14],
  });
}

const CAR_SLACK_MIN = 60;

const carIcon = L.divIcon({
  className: "doofah-route-car",
  html: `<span class="pulse"></span><span class="car">${glyphSvg("car-front", 15, "#0f172a", 2.4)}</span>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

interface RouteLayerProps {
  trip: Trip;
  /** The radar timeline's time, to show where you would be then. */
  frameTime: number | null;
  focus?: RouteFocus;
  timeZone: string;
  stopName: (index: number) => string;
}

/** The trip on the radar: the road coloured by rain, a weather bubble per stop, and your car at the timeline's time. */
export function RouteLayer({ trip, frameTime, focus, timeZone, stopName }: RouteLayerProps) {
  const { m, f } = useI18n();
  const map = useMap();
  const { route, stops } = trip;
  const line = useMemo(() => route.path.map((p): L.LatLngTuple => [p.lat, p.lon]), [route.path]);
  const legs = useMemo(
    () =>
      stops.slice(0, -1).map((s, i) => ({
        points: pathBetween(route.path, s.min, stops[i + 1].min),
        rain: worseRain(stopRain(s.weather), stopRain(stops[i + 1].weather)),
      })),
    [route.path, stops],
  );

  const icons = useMemo(() => stops.map(stopIcon), [stops]);

  // Fit the whole route when a new trip arrives or the dashboard asks; fly to a stop when one is picked.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    const tripKey = `${route.departure}|${route.distanceKm}`;
    const focusKey = `${tripKey}#${focus?.key ?? 0}`;
    if (fitted.current === focusKey) return;
    fitted.current = focusKey;
    const stop = focus?.stop != null ? stops[focus.stop] : null;
    if (stop) map.flyTo([stop.point.lat, stop.point.lon], Math.max(map.getZoom(), 9), { duration: 1.2 });
    else
      map.flyToBounds(L.latLngBounds(line), {
        paddingTopLeft: [24, 110],
        paddingBottomRight: [24, 190],
        duration: 1.2,
        maxZoom: 11,
      });
  }, [map, route.departure, route.distanceKm, focus?.key, focus?.stop, stops, line]);

  const start = Date.parse(route.departure);
  const minutesIn = frameTime === null ? null : (frameTime - start) / 60_000;
  // The radar steps an hour at a time, so the car also waits at the start in
  // the hour before you leave and at the end in the hour after you arrive.
  const car =
    minutesIn !== null && minutesIn >= -CAR_SLACK_MIN && minutesIn <= route.durationMin + CAR_SLACK_MIN
      ? positionAt(route.path, minutesIn)
      : null;

  return (
    <>
      <Polyline
        positions={line}
        interactive={false}
        pathOptions={{ color: "#0a0f1e", opacity: 0.7, weight: 10, lineCap: "round", lineJoin: "round" }}
      />
      {legs.map((leg, i) => (
        <Polyline
          key={i}
          positions={leg.points}
          interactive={false}
          pathOptions={{ color: RAIN_COLOR[leg.rain], opacity: 0.95, weight: 5, lineCap: "round", lineJoin: "round" }}
        />
      ))}
      {stops.map((stop, i) => (
        <Marker key={`${route.departure}-${i}`} position={[stop.point.lat, stop.point.lon]} icon={icons[i]}>
          <Popup className="doofah-popup" closeButton={false} autoPan={false}>
            <strong>
              {f.clock(stop.eta, timeZone)} · {stopName(i)}
            </strong>
            <br />
            {m.condition(stop.weather.condition, stop.weather.isDay)} · {f.temp(stop.weather.temperatureC)} ·{" "}
            {m.route.rain[stopRain(stop.weather)]} {m.route.chance(stop.weather.precipitationProbability)}
          </Popup>
        </Marker>
      ))}
      {car && frameTime !== null && (
        <Marker position={[car.lat, car.lon]} icon={carIcon} keyboard={false} zIndexOffset={1000}>
          <Tooltip direction="top" offset={[0, -16]} permanent className="doofah-route-tip">
            {m.route.carHere(f.clock(frameTime, timeZone))}
          </Tooltip>
        </Marker>
      )}
    </>
  );
}
