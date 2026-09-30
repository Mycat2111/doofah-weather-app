"use client";

import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Popup, Rectangle, TileLayer, ZoomControl, useMap, useMapEvents } from "react-leaflet";
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

function describe(grid: RadarGridSpec, frame: RadarFrame, p: GeoPoint): string {
  const at = (values: Float32Array) => sampleGrid(grid, values, p.lat, p.lon);
  switch (frame.layer) {
    case "precipitation": {
      const r = at(frame.rate);
      if (Number.isNaN(r)) return "Outside the loaded area";
      return r < 0.1 ? `No rain · cloud ${Math.round(at(frame.cloud) * 100)}%` : `Rain ${r.toFixed(1)} mm/h`;
    }
    case "temperature": {
      const t = at(frame.temperature);
      return Number.isNaN(t) ? "Outside the loaded area" : `${t.toFixed(1)} °C at 2 m`;
    }
    case "wind": {
      const s = at(frame.speed);
      return Number.isNaN(s) ? "Outside the loaded area" : `Wind ${Math.round(s)} km/h at 10 m`;
    }
    case "pressure": {
      const v = at(frame.pressure);
      return Number.isNaN(v) ? "Outside the loaded area" : `${v.toFixed(1)} hPa`;
    }
  }
}

/** Tap anywhere to read the active layer's value at that spot. */
function Probe({ grid, frame }: { grid?: RadarGridSpec; frame?: RadarFrame }) {
  const [point, setPoint] = useState<GeoPoint | null>(null);
  useMapEvents({
    click: (e) => setPoint({ lat: e.latlng.lat, lon: e.latlng.lng }),
  });
  if (!point || !grid || !frame) return null;
  return (
    <Popup
      position={[point.lat, point.lon]}
      className="doofah-popup"
      closeButton={false}
      eventHandlers={{ remove: () => setPoint(null) }}
    >
      {describe(grid, frame, point)}
    </Popup>
  );
}

export default function RadarLeafletView({ center, cellBounds, grid, frame, onViewChange }: RadarLeafletViewProps) {
  return (
    <MapContainer
      center={[center.lat, center.lon]}
      zoom={9}
      minZoom={5}
      maxZoom={12}
      zoomControl={false}
      attributionControl={false}
      worldCopyJump
      className="doofah-map h-full w-full"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="doofah-tiles"
        maxZoom={19}
      />
      <ZoomControl position="topright" />
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
