"use client";

import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { Marker, Popup } from "react-leaflet";
import { useI18n } from "@/i18n/I18nProvider";
import { REPORT_TTL_MS, reportLife, type CrowdReport, type ReportKind } from "@/lib/crowdReports";
import { AT_SPOT, cellKind, spread, type Offset, type ReportCell } from "@/lib/sharedReports";
import type { GeoPoint } from "@/services/weather/types";

// Lucide's icons (sun, moon, cloud, cloud-drizzle, cloud-rain-wind) as SVG
// strings, since Leaflet markers are plain HTML rather than React.
const GLYPH: Record<ReportKind | "moon", string> = {
  sunny:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  cloudy: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  lightRain:
    '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M8 19v1M8 14v1M16 19v1M16 14v1M12 21v1M12 16v1"/>',
  heavyRain:
    '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m9.2 22 3-7M9 13l-3 7m11-7-3 7"/>',
};

const icons = new Map<string, L.DivIcon>();

function reportIcon(kind: ReportKind, mine: boolean, night: boolean, you: string, [dx, dy]: Offset): L.DivIcon {
  const key = `${kind}|${mine}|${night}|${you}|${dx},${dy}`;
  let icon = icons.get(key);
  if (!icon) {
    const glyph = GLYPH[kind === "sunny" && night ? "moon" : kind];
    icon = L.divIcon({
      className: `doofah-report-marker${mine ? " mine" : ""}`,
      html:
        `<span class="life"></span><span class="bubble k-${kind}">` +
        `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>` +
        `</span>${mine ? `<span class="you">${you}</span>` : ""}`,
      iconSize: [30, 30],
      // Your own report sits on the shoulder of the "you are here" pin.
      iconAnchor: mine ? [-8, 42] : [15 - dx, 15 - dy],
    });
    icons.set(key, icon);
  }
  return icon;
}

function ReportMarker({
  report,
  offset,
  now,
  night,
}: {
  report: CrowdReport;
  offset: Offset;
  now: number;
  night: boolean;
}) {
  const { m } = useI18n();
  const ref = useRef<L.Marker>(null);
  const position = useMemo<L.LatLngTuple>(() => [report.point.lat, report.point.lon], [report.point]);
  const life = reportLife(report, now);
  const name = report.kind === "sunny" && night ? m.reports.clear : m.reports.kinds[report.kind];
  const minutes = Math.max(0, Math.floor((now - Date.parse(report.time)) / 60_000));
  const label = `${report.mine ? `${m.reports.you}: ` : ""}${name} · ${m.reports.ago(minutes)}`;

  // The ring and the fade both follow the time left, through one CSS variable.
  useEffect(() => {
    ref.current?.getElement()?.style.setProperty("--life", life.toFixed(3));
  }, [life]);

  return (
    <Marker
      ref={ref}
      position={position}
      icon={reportIcon(report.kind, report.mine, night, m.reports.you, offset)}
      title={label}
      keyboard={false}
      zIndexOffset={report.mine ? 1000 : 0}
      eventHandlers={{ add: (e) => e.target.getElement()?.style.setProperty("--life", life.toFixed(3)) }}
    >
      <Popup
        className="doofah-popup"
        closeButton={false}
        autoPan={false}
        offset={report.mine ? [23, -38] : [offset[0], offset[1] - 8]}
      >
        {label}
      </Popup>
    </Marker>
  );
}

const countIcons = new Map<string, L.DivIcon>();

function cellIcon(kind: ReportKind, count: number, night: boolean): L.DivIcon {
  const shown = count > 999 ? "999+" : String(count);
  const key = `${kind}|${shown}|${night}`;
  let icon = countIcons.get(key);
  if (!icon) {
    const glyph = GLYPH[kind === "sunny" && night ? "moon" : kind];
    icon = L.divIcon({
      className: "doofah-report-marker cell",
      html:
        `<span class="life"></span><span class="bubble k-${kind}">` +
        `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>` +
        `</span><span class="count">${shown}</span>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    countIcons.set(key, icon);
  }
  return icon;
}

/** Many reports counted together in a busy area: the kind most of them say, and how many. */
function CellMarker({ cell, now, night }: { cell: ReportCell; now: number; night: boolean }) {
  const { m } = useI18n();
  const ref = useRef<L.Marker>(null);
  const position = useMemo<L.LatLngTuple>(() => [cell.lat, cell.lon], [cell.lat, cell.lon]);
  const kind = cellKind(cell);
  const life = Math.min(1, Math.max(0, 1 - (now - Date.parse(cell.newest)) / REPORT_TTL_MS));
  const label = m.reports.counted(cell.count, kind === "sunny" && night ? m.reports.clear : m.reports.kinds[kind]);

  useEffect(() => {
    ref.current?.getElement()?.style.setProperty("--life", life.toFixed(3));
  }, [life]);

  return (
    <Marker
      ref={ref}
      position={position}
      icon={cellIcon(kind, cell.count, night)}
      title={label}
      keyboard={false}
      eventHandlers={{ add: (e) => e.target.getElement()?.style.setProperty("--life", life.toFixed(3)) }}
    >
      <Popup className="doofah-popup" closeButton={false} autoPan={false} offset={[0, -10]}>
        {label}
      </Popup>
    </Marker>
  );
}

/** People's weather reports from the last 3 hours, fading out as they age, and counted ones in busy areas. */
export function ReportMarkers({
  reports,
  cells = [],
  center,
  now,
  night,
}: {
  reports: CrowdReport[];
  cells?: ReportCell[];
  /** The place's spot, where the "you are here" pin sits. */
  center?: GeoPoint;
  now: number;
  night: boolean;
}) {
  const offsets = useMemo(() => spread(reports, center), [reports, center]);
  return (
    <>
      {cells.map((c) => (
        <CellMarker key={`${c.lat},${c.lon}`} cell={c} now={now} night={night} />
      ))}
      {reports.map((r) => (
        <ReportMarker key={r.id} report={r} offset={offsets.get(r.id) ?? AT_SPOT} now={now} night={night} />
      ))}
    </>
  );
}
