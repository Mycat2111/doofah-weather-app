"use client";

import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { Marker, Popup } from "react-leaflet";
import { useI18n } from "@/i18n/I18nProvider";
import { reportLife, type CrowdReport, type ReportKind } from "@/services/CrowdReportMockService";

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

function reportIcon(kind: ReportKind, mine: boolean, night: boolean, you: string): L.DivIcon {
  const key = `${kind}|${mine}|${night}|${you}`;
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
      iconAnchor: mine ? [-8, 42] : [15, 15],
    });
    icons.set(key, icon);
  }
  return icon;
}

function ReportMarker({ report, now, night }: { report: CrowdReport; now: number; night: boolean }) {
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
      icon={reportIcon(report.kind, report.mine, night, m.reports.you)}
      title={label}
      keyboard={false}
      zIndexOffset={report.mine ? 1000 : 0}
      eventHandlers={{ add: (e) => e.target.getElement()?.style.setProperty("--life", life.toFixed(3)) }}
    >
      <Popup className="doofah-popup" closeButton={false} autoPan={false} offset={report.mine ? [23, -38] : [0, -8]}>
        {label}
      </Popup>
    </Marker>
  );
}

/** People's weather reports from the last hour, fading out as they age. */
export function ReportMarkers({ reports, now, night }: { reports: CrowdReport[]; now: number; night: boolean }) {
  return reports.map((r) => <ReportMarker key={r.id} report={r} now={now} night={night} />);
}
