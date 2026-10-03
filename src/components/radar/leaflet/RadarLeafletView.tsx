"use client";

import type { MotionValue } from "framer-motion";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useI18n } from "@/i18n/I18nProvider";
import type { Messages } from "@/i18n/messages";
import { haptic } from "@/lib/haptics";
import { useFrameAt } from "@/hooks/useRadarFrames";
import type { Trip } from "@/hooks/useRouteWeather";
import type { CrowdReport } from "@/services/CrowdReportMockService";
import {
  sampleGrid,
  type GeoBounds,
  type GeoPoint,
  type RadarFrame,
  type RadarFrameSet,
  type RadarGridSpec,
} from "@/services/WeatherNext3MockService";
import { PRECIP_SCALE, PRESSURE_SCALE, TEMPERATURE_SCALE, WIND_SCALE } from "../colorScales";
import { FieldRasterLayer } from "./FieldRasterLayer";
import { IsobarLayer } from "./IsobarLayer";
import { ReportMarkers } from "./ReportMarkers";
import { RouteLayer, type RouteFocus } from "./RouteLayer";
import { WindParticleLayer } from "./WindParticleLayer";

export interface RadarLeafletViewProps {
  center: GeoPoint;
  /** The layer's hourly frames over the area in view. */
  frameSet?: RadarFrameSet;
  /** The timeline's time (ms), moving smoothly while it plays; the layers show the weather then. */
  playhead: MotionValue<number>;
  /** The timeline's time to the 10 minutes, for what moves in steps (the car on a trip). */
  time: number | null;
  onViewChange: (bounds: GeoBounds, zoom: number) => void;
  /** Receives the Leaflet map once it exists, for controls drawn outside it. */
  onMap?: (map: L.Map | null) => void;
  /** Show or hide the "use two fingers" hint (touch screens only). */
  onGestureHint?: (show: boolean) => void;
  /** Zoom for the next fly to a new centre (set by "go to my location"); otherwise at least 9. */
  nextZoomRef?: RefObject<number | null>;
  /** People's weather reports to pin on the map, and the time their age is measured from. */
  reports?: CrowdReport[];
  reportsNow?: number;
  /** Night at the place: "sunny" reports show a moon. */
  night?: boolean;
  /** A planned road trip to draw, the stop names, and a request to show it. */
  trip?: Trip | null;
  tripStopName?: (index: number) => string;
  tripFocus?: RouteFocus;
  timeZone?: string;
}

/** Closest zoom level (street level). */
const MAX_ZOOM = 20;
/**
 * Furthest zoom level: about 70° of longitude across a phone, 150° across a
 * laptop, so whole regional systems fit (the monsoon trough from the Bay of
 * Bengal to the South China Sea, a typhoon coming in from the Philippines).
 * One level further and the world would be narrower than a wide map.
 */
const MIN_ZOOM = 3;

/**
 * "You are here": a deep blue bullseye with a thick white rim and drop shadow,
 * over two rings that ripple outwards, so it stands out on dark and light maps
 * and on top of heavy rain, wind and temperature colours.
 */
const userIcon = L.divIcon({
  className: "doofah-user-marker",
  html: '<span class="ripple"></span><span class="ripple late"></span><span class="pin"></span>',
  iconSize: [120, 120],
  iconAnchor: [60, 60],
});

/** Fly to a new place when the selected location changes. */
function Recenter({ center, nextZoomRef }: { center: GeoPoint; nextZoomRef?: RefObject<number | null> }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const zoom = nextZoomRef?.current ?? Math.max(map.getZoom(), 9);
    if (nextZoomRef) nextZoomRef.current = null;
    map.flyTo([center.lat, center.lon], zoom, { duration: 1.4 });
  }, [map, center.lat, center.lon, nextZoomRef]);
  return null;
}

/**
 * Double-click (or double-tap) zoom that stops cleanly at the zoom limits.
 * Leaflet's own handler works out the new centre for the unclamped zoom, so a
 * double click near the closest zoom level shifted the map somewhere else.
 */
function DoubleClickZoom() {
  const map = useMap();
  useMapEvents({
    dblclick: (e) => {
      const step = e.originalEvent.shiftKey ? -1 : 1;
      const zoom = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), map.getZoom() + step));
      if (zoom !== map.getZoom()) map.setZoomAround(e.containerPoint, zoom);
    },
  });
  return null;
}

/** Report the visible area (padded) so frames can be computed for it. */
function ViewReporter({ onViewChange }: { onViewChange: RadarLeafletViewProps["onViewChange"] }) {
  const map = useMap();
  useEffect(() => {
    const report = () => {
      const b = map.getBounds().pad(0.15);
      onViewChange(
        [
          [b.getSouth(), b.getWest()],
          [b.getNorth(), b.getEast()],
        ],
        map.getZoom(),
      );
    };
    map.on("moveend", report);
    report();
    return () => {
      map.off("moveend", report);
    };
  }, [map, onViewChange]);
  return null;
}

/** How far one finger has to drag on the map before the hint shows. */
const HINT_DISTANCE_PX = 20;
/** How long the hint stays after the finger lifts. */
const HINT_MS = 1200;

/**
 * On touch screens one finger scrolls the page and two fingers move and zoom
 * the map, like an embedded Google map: the map fills most of a phone screen,
 * so a one-finger drag that moved it would trap the page scroll. A one-finger
 * drag shows a short hint instead. Mouse and trackpad drag the map as usual.
 */
function TouchGestures({ onHint }: { onHint?: (show: boolean) => void }) {
  const map = useMap();
  const hintRef = useRef(onHint);

  useEffect(() => {
    hintRef.current = onHint;
  });

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const applyPointer = () => {
      // Without dragging, Leaflet sets `touch-action: pan-x pan-y` on the map, so
      // the browser scrolls the page for one finger and leaves pinches to Leaflet.
      if (coarse.matches) map.dragging.disable();
      else map.dragging.enable();
    };
    applyPointer();
    coarse.addEventListener("change", applyPointer);

    const container = map.getContainer();
    let start: { x: number; y: number } | null = null;
    let hideTimer = 0;
    const setHint = (show: boolean) => {
      window.clearTimeout(hideTimer);
      hintRef.current?.(show);
    };
    const onStart = (e: TouchEvent) => {
      start = null;
      if (map.dragging.enabled()) return;
      if (e.touches.length === 1) start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      else setHint(false);
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) < HINT_DISTANCE_PX) return;
      start = null;
      setHint(true);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return;
      start = null;
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => hintRef.current?.(false), HINT_MS);
    };

    const options = { passive: true };
    container.addEventListener("touchstart", onStart, options);
    container.addEventListener("touchmove", onMove, options);
    container.addEventListener("touchend", onEnd, options);
    container.addEventListener("touchcancel", onEnd, options);
    return () => {
      coarse.removeEventListener("change", applyPointer);
      container.removeEventListener("touchstart", onStart);
      container.removeEventListener("touchmove", onMove);
      container.removeEventListener("touchend", onEnd);
      container.removeEventListener("touchcancel", onEnd);
      window.clearTimeout(hideTimer);
    };
  }, [map]);

  return null;
}

const temperatureLabel = (v: number) => `${Math.round(v)}°`;

function FrameLayers({ grid, frame, draft }: { grid: RadarGridSpec; frame: RadarFrame; draft: boolean }) {
  switch (frame.layer) {
    case "precipitation":
      return (
        <FieldRasterLayer grid={grid} values={frame.rate} cloud={frame.cloud} scale={PRECIP_SCALE} draft={draft} />
      );
    case "temperature":
      return (
        <FieldRasterLayer
          grid={grid}
          values={frame.temperature}
          scale={TEMPERATURE_SCALE}
          label={temperatureLabel}
          draft={draft}
        />
      );
    case "wind":
      return (
        <>
          <FieldRasterLayer grid={grid} values={frame.speed} scale={WIND_SCALE} draft={draft} />
          <WindParticleLayer grid={grid} u={frame.u} v={frame.v} />
        </>
      );
    case "pressure":
      return (
        <>
          <FieldRasterLayer grid={grid} values={frame.pressure} scale={PRESSURE_SCALE} draft={draft} />
          <IsobarLayer grid={grid} pressure={frame.pressure} />
        </>
      );
  }
}

function describe(grid: RadarGridSpec, frame: RadarFrame, p: GeoPoint, m: Messages): string {
  const at = (values: Float32Array) => sampleGrid(grid, values, p.lat, p.lon);
  const { probe, outsideArea } = m.radar;
  switch (frame.layer) {
    case "precipitation": {
      const r = at(frame.rate);
      if (Number.isNaN(r)) return outsideArea;
      return r < 0.1 ? probe.noRain(Math.round(at(frame.cloud) * 100)) : probe.rain(r.toFixed(1));
    }
    case "temperature": {
      const t = at(frame.temperature);
      return Number.isNaN(t) ? outsideArea : probe.temperature(t.toFixed(1));
    }
    case "wind": {
      const s = at(frame.speed);
      return Number.isNaN(s) ? outsideArea : probe.wind(Math.round(s));
    }
    case "pressure": {
      const v = at(frame.pressure);
      return Number.isNaN(v) ? outsideArea : probe.pressure(v.toFixed(1));
    }
  }
}

/** The layers and their tap-to-read popup at the playhead's time, between hours too. */
function TimelineLayers({ frameSet, playhead }: { frameSet?: RadarFrameSet; playhead: MotionValue<number> }) {
  const shown = useFrameAt(frameSet, playhead);
  return (
    <>
      {shown && <FrameLayers grid={shown.grid} frame={shown.frame} draft={shown.moving} />}
      <Probe grid={shown?.grid} frame={shown?.frame} />
    </>
  );
}

/** Tap anywhere to read the active layer's value at that spot. */
function Probe({ grid, frame }: { grid?: RadarGridSpec; frame?: RadarFrame }) {
  const { m } = useI18n();
  const [point, setPoint] = useState<GeoPoint | null>(null);
  useMapEvents({
    click: (e) => {
      haptic("selection");
      setPoint({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
  });
  if (!point || !grid || !frame) return null;
  return (
    <Popup
      position={[point.lat, point.lon]}
      className="doofah-popup"
      closeButton={false}
      // Never move the map to fit the reading: a tap near the edge would shift the view.
      autoPan={false}
      eventHandlers={{ remove: () => setPoint(null) }}
    >
      {describe(grid, frame, point, m)}
    </Popup>
  );
}

export default function RadarLeafletView({
  center,
  frameSet,
  playhead,
  time,
  onViewChange,
  onMap,
  onGestureHint,
  nextZoomRef,
  reports = [],
  reportsNow = 0,
  night = false,
  trip = null,
  tripStopName = String,
  tripFocus,
  timeZone = "UTC",
}: RadarLeafletViewProps) {
  // The same array between renders, so playback and new frames never make
  // react-leaflet move the marker (which would fight a zoom in progress).
  const position = useMemo<L.LatLngTuple>(() => [center.lat, center.lon], [center.lat, center.lon]);
  return (
    <MapContainer
      ref={onMap}
      center={position}
      zoom={9}
      minZoom={MIN_ZOOM}
      // Street level. The weather is a 5 km grid, smoothed, so this is for
      // seeing exactly where rain sits relative to your street.
      maxZoom={MAX_ZOOM}
      // No snapping: a pinch or wheel zoom stays exactly where it was left.
      // Snapping animates to the nearest step around the map centre, which
      // pulls the place under your fingers or cursor away after you let go.
      zoomSnap={0}
      // Buttons and double taps still zoom by whole levels.
      zoomDelta={1}
      // Pinching past the zoom limits stops there instead of bouncing back.
      bounceAtZoomLimits={false}
      doubleClickZoom={false}
      zoomControl={false}
      attributionControl={false}
      worldCopyJump
      className="doofah-map h-full w-full"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="doofah-tiles"
        maxZoom={MAX_ZOOM}
        // OpenStreetMap draws tiles up to level 19; closer, those are enlarged.
        maxNativeZoom={19}
        // CORS requests, so the service worker can keep viewed tiles for offline use.
        crossOrigin
      />
      <TouchGestures onHint={onGestureHint} />
      <DoubleClickZoom />
      <Recenter center={center} nextZoomRef={nextZoomRef} />
      <ViewReporter onViewChange={onViewChange} />
      <TimelineLayers frameSet={frameSet} playhead={playhead} />
      {trip && (
        <RouteLayer trip={trip} frameTime={time} focus={tripFocus} timeZone={timeZone} stopName={tripStopName} />
      )}
      <Marker position={position} icon={userIcon} keyboard={false} interactive={false} />
      <ReportMarkers reports={reports} now={reportsNow} night={night} />
    </MapContainer>
  );
}
