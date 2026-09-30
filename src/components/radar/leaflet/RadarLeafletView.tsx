"use client";

import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Popup, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useI18n } from "@/i18n/I18nProvider";
import type { Messages } from "@/i18n/messages";
import { haptic } from "@/lib/haptics";
import {
  sampleGrid,
  type GeoBounds,
  type GeoPoint,
  type RadarFrame,
  type RadarGridSpec,
} from "@/services/WeatherNext3MockService";
import { PRECIP_SCALE, PRESSURE_SCALE, TEMPERATURE_SCALE, WIND_SCALE } from "../colorScales";
import { FieldRasterLayer } from "./FieldRasterLayer";
import { IsobarLayer } from "./IsobarLayer";
import { WindParticleLayer } from "./WindParticleLayer";

export interface RadarLeafletViewProps {
  center: GeoPoint;
  cellBounds: GeoBounds;
  grid?: RadarGridSpec;
  frame?: RadarFrame;
  onViewChange: (bounds: GeoBounds, zoom: number) => void;
  /** Receives the Leaflet map once it exists, for controls drawn outside it. */
  onMap?: (map: L.Map | null) => void;
  /** Show or hide the "use two fingers" hint (touch screens only). */
  onGestureHint?: (show: boolean) => void;
}

const userIcon = L.divIcon({
  className: "doofah-user-marker",
  html: '<span class="ring"></span><span class="dot"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

/** Fly to a new place when the selected location changes. */
function Recenter({ center }: { center: GeoPoint }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    map.flyTo([center.lat, center.lon], Math.max(map.getZoom(), 9), { duration: 1.4 });
  }, [map, center.lat, center.lon]);
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

function FrameLayers({ grid, frame }: { grid: RadarGridSpec; frame: RadarFrame }) {
  switch (frame.layer) {
    case "precipitation":
      return <FieldRasterLayer grid={grid} values={frame.rate} cloud={frame.cloud} scale={PRECIP_SCALE} />;
    case "temperature":
      return (
        <FieldRasterLayer grid={grid} values={frame.temperature} scale={TEMPERATURE_SCALE} label={temperatureLabel} />
      );
    case "wind":
      return (
        <>
          <FieldRasterLayer grid={grid} values={frame.speed} scale={WIND_SCALE} />
          <WindParticleLayer grid={grid} u={frame.u} v={frame.v} />
        </>
      );
    case "pressure":
      return (
        <>
          <FieldRasterLayer grid={grid} values={frame.pressure} scale={PRESSURE_SCALE} />
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
      eventHandlers={{ remove: () => setPoint(null) }}
    >
      {describe(grid, frame, point, m)}
    </Popup>
  );
}

export default function RadarLeafletView({
  center,
  cellBounds,
  grid,
  frame,
  onViewChange,
  onMap,
  onGestureHint,
}: RadarLeafletViewProps) {
  return (
    <MapContainer
      ref={onMap}
      center={[center.lat, center.lon]}
      zoom={9}
      minZoom={5}
      maxZoom={12}
      // Quarter steps: a pinch settles close to where the fingers left it
      // instead of jumping to the nearest whole zoom level.
      zoomSnap={0.25}
      // Pinching past the zoom limits stops there instead of bouncing back.
      bounceAtZoomLimits={false}
      zoomControl={false}
      attributionControl={false}
      worldCopyJump
      className="doofah-map h-full w-full"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="doofah-tiles"
        maxZoom={19}
        // CORS requests, so the service worker can keep viewed tiles for offline use.
        crossOrigin
      />
      <TouchGestures onHint={onGestureHint} />
      <Recenter center={center} />
      <ViewReporter onViewChange={onViewChange} />
      {grid && frame && <FrameLayers grid={grid} frame={frame} />}
      <Rectangle
        bounds={cellBounds}
        pathOptions={{ color: "#ffffff", weight: 1.5, dashArray: "4 4", fillColor: "#7dd3fc", fillOpacity: 0.08 }}
        interactive={false}
      />
      <Marker position={[center.lat, center.lon]} icon={userIcon} keyboard={false} />
      <Probe grid={grid} frame={frame} />
    </MapContainer>
  );
}
