"use client";

import L from "leaflet";
import { useMemo } from "react";
import { CircleMarker, Marker, Polygon, Polyline, Popup, Tooltip } from "react-leaflet";
import { CATEGORY_COLOR } from "@/components/radar/cycloneStyle";
import { CYCLONE_GLYPH } from "@/components/ui/CycloneIcon";
import { useWhen } from "@/hooks/useWhen";
import { useI18n } from "@/i18n/I18nProvider";
import {
  AHEAD_HOURS,
  categoryOf,
  closestApproach,
  coneRings,
  distanceKm,
  lonShift,
  stormAt,
  trackAhead,
  trackPath,
  type Cyclone,
  type CycloneCategory,
  type GeoPoint,
  type TrackPoint,
} from "@/lib/cyclones";

const HOUR_MS = 3_600_000;

const roundKm = (km: number) => Math.round(km / 10) * 10;

const icons = new Map<string, L.DivIcon>();

/** The storm's eye at the timeline's time: the cyclone symbol turning the way the storm does. */
function eyeIcon(category: CycloneCategory, south: boolean): L.DivIcon {
  const key = `${category}${south ? "-s" : ""}`;
  const known = icons.get(key);
  if (known) return known;
  const icon = L.divIcon({
    className: `doofah-cyclone${south ? " south" : ""}`,
    html: `<span class="eye" style="--c:${CATEGORY_COLOR[category]}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">${CYCLONE_GLYPH}</svg></span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
  icons.set(key, icon);
  return icon;
}

interface CycloneLayerProps {
  storms: Cyclone[];
  /** The timeline's time (ms), where each storm's marker sits. */
  time: number;
  /** Now, to the timeline's step. */
  now: number;
  /** The dashboard's place, for distances. */
  place: { name: string; point: GeoPoint };
  timeZone: string;
  /** The storms are the made-up sample. */
  demo?: boolean;
}

/** Tropical cyclones on the map: each storm's cone, its most likely path with a dot every 12 hours, and where it is at the timeline's time. */
export function CycloneLayer({ storms, time, now, place, timeZone, demo = false }: CycloneLayerProps) {
  return (
    <>
      {storms.map((storm) => (
        <StormShape key={storm.id} storm={storm} time={time} now={now} place={place} timeZone={timeZone} demo={demo} />
      ))}
    </>
  );
}

function StormShape({
  storm,
  time,
  now,
  place,
  timeZone,
  demo,
}: Omit<CycloneLayerProps, "storms"> & { storm: Cyclone }) {
  const { m } = useI18n();
  const when = useWhen(timeZone);

  const shape = useMemo(() => {
    const shift = lonShift(storm.track[0].lon, place.point.lon);
    const track = trackAhead(storm.track, now).map((p) => ({ ...p, lon: p.lon - shift }));
    const to = now + AHEAD_HOURS * HOUR_MS;
    const cone = storm.cone
      .filter((c) => Date.parse(c.time) >= now - 6 * HOUR_MS && Date.parse(c.time) <= to)
      .map((c) => ({ ...c, lon: c.lon - shift }));
    const closest = closestApproach(trackPath(storm.track), place.point, now, to);
    return { shift, track, rings: coneRings(cone), closest };
  }, [storm, now, place.point]);

  const title = m.cyclones.storm(
    m.cyclones.category[categoryOf((stormAt(storm, now) ?? storm.track[0]).wind_kmh, storm.basin)],
    storm.name ?? storm.id,
  );
  const closestLine =
    shape.closest && m.cyclones.popup.closest(roundKm(shape.closest.km), place.name, when(shape.closest.time));

  const details = (p: TrackPoint, line: string) => (
    // Unlike a tap-anywhere reading, this tap asks for the storm, so the map makes room for its details.
    <Popup className="doofah-popup" closeButton={false} maxWidth={240} autoPanPadding={[12, 12]}>
      <strong>{title}</strong>
      {demo && ` · ${m.cyclones.demo}`}
      <br />
      {line}
      <br />
      {m.cyclones.popup.away(roundKm(distanceKm(p, place.point)), place.name)}
      {closestLine && (
        <>
          <br />
          {closestLine}
        </>
      )}
    </Popup>
  );

  const { track, rings, shift } = shape;
  const at = stormAt(storm, time);
  const here = at && { ...at, lon: at.lon - shift };
  const category = categoryOf(here?.wind_kmh ?? null, storm.basin);

  return (
    <>
      {rings.length > 0 && (
        <Polygon
          positions={rings}
          interactive={false}
          pathOptions={{ stroke: false, fillColor: "#e2e8f0", fillOpacity: 0.16, fillRule: "nonzero" }}
        />
      )}
      <Polyline
        positions={track.map((p): L.LatLngTuple => [p.lat, p.lon])}
        interactive={false}
        pathOptions={{ color: "#0a0f1e", opacity: 0.6, weight: 7, lineCap: "round", lineJoin: "round" }}
      />
      {track.slice(0, -1).map((p, i) => {
        const next = track[i + 1];
        const past = Date.parse(next.time) <= now;
        return (
          <Polyline
            key={p.time}
            positions={[
              [p.lat, p.lon],
              [next.lat, next.lon],
            ]}
            interactive={false}
            pathOptions={{
              color: CATEGORY_COLOR[categoryOf(p.wind_kmh, storm.basin)],
              opacity: past ? 0.55 : 0.95,
              weight: 3.5,
              dashArray: past ? "4 7" : undefined,
              lineCap: "round",
            }}
          />
        );
      })}
      {track
        .filter((p) => new Date(p.time).getUTCHours() % 12 === 0 && Date.parse(p.time) >= now - 6 * HOUR_MS)
        .map((p) => (
          <CircleMarker
            key={`dot-${p.time}`}
            center={[p.lat, p.lon]}
            radius={6}
            // A tap opens the point's details, not the layer reading underneath.
            bubblingMouseEvents={false}
            className="doofah-cyclone-dot"
            pathOptions={{
              color: "#fff",
              weight: 2,
              fillColor: CATEGORY_COLOR[categoryOf(p.wind_kmh, storm.basin)],
              fillOpacity: 1,
            }}
          >
            {details(p, m.cyclones.popup.point(when(p.time), p.wind_kmh, p.pressure_hpa))}
          </CircleMarker>
        ))}
      {here && (
        <Marker
          position={[here.lat, here.lon]}
          icon={eyeIcon(category, here.lat < 0)}
          keyboard={false}
          zIndexOffset={900}
        >
          <Tooltip direction="right" offset={[16, 0]} permanent className="doofah-route-tip">
            {storm.name ?? storm.id}
          </Tooltip>
          {details(
            here,
            m.cyclones.popup.point(
              m.cyclones.popup.at(when(time)),
              here.wind_kmh === null ? null : Math.round(here.wind_kmh),
              here.pressure_hpa === null ? null : Math.round(here.pressure_hpa),
            ),
          )}
        </Marker>
      )}
    </>
  );
}
